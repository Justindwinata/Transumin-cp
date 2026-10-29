import { sql, type Kysely } from 'kysely';

/**
 * Additive accepted-route read model. Original journey_plan/journey_leg/dependency
 * rows remain immutable research history. The pointer write performed by the
 * recovery acceptance transaction materializes a rebased current itinerary
 * (immutable completed history + accepted replacement suffix) plus its
 * dependencies, so reads, fan-out, and boarding/alighting safeguards follow the
 * route the traveller is actually on. No progress replay; no pointer clearing.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table journey.active_journey
      add column current_itinerary_json jsonb,
      add column accepted_before_leg_count integer,
      add constraint active_journey_current_itinerary_check check (
        current_itinerary_json is null or jsonb_typeof(current_itinerary_json) = 'object'
      ),
      add constraint active_journey_accepted_before_check check (
        accepted_before_leg_count is null or accepted_before_leg_count >= 0
      ),
      add constraint active_journey_current_pointer_check check (
        (accepted_recovery_id is null and current_itinerary_json is null) or
        (accepted_recovery_id is not null)
      )
  `.execute(database);
  await sql`
    create table journey.active_journey_dependency (
      id uuid primary key,
      journey_id uuid not null references journey.active_journey(journey_id) on delete restrict,
      recovery_id uuid not null references recovery.recovery_acceptance(recovery_id) on delete restrict,
      leg_sequence integer not null check (leg_sequence >= 0),
      mobility_entity_id uuid not null references twin.mobility_entity(id) on delete restrict,
      canonical_entity_id uuid not null references twin.mobility_entity(id) on delete restrict,
      entity_type text not null,
      product_mode text not null,
      provenance_ref text not null,
      constraint active_journey_dependency_type_check check (entity_type in ('STOP','STATION','ROUTE')),
      constraint active_journey_dependency_identity_check check (canonical_entity_id = mobility_entity_id),
      constraint active_journey_dependency_unique unique (recovery_id, leg_sequence, mobility_entity_id)
    )
  `.execute(database);
  await sql`create index active_journey_dependency_entity_idx on journey.active_journey_dependency (mobility_entity_id, journey_id, leg_sequence)`.execute(
    database,
  );
  await sql`
    create table journey.current_impact_dependency (
      impact_id uuid not null references journey.journey_impact(id) on delete restrict,
      dependency_id uuid not null references journey.active_journey_dependency(id) on delete restrict,
      primary key (impact_id, dependency_id)
    )
  `.execute(database);
  await sql`
    create function journey.materialize_accepted_itinerary()
    returns trigger language plpgsql as $function$
    declare acceptance jsonb; completed_count integer; source_plan jsonb; merged jsonb; progress_count integer; boarded integer; alighted integer;
    begin
      if new.accepted_recovery_id is null then
        new.current_itinerary_json := null;
        new.accepted_before_leg_count := null;
        if old.accepted_recovery_id is not null then raise exception 'ACCEPTED_ITINERARY_POINTER_CANNOT_CLEAR'; end if;
        return new;
      end if;
      if tg_op = 'UPDATE' and new.accepted_recovery_id is not distinct from old.accepted_recovery_id and old.current_itinerary_json is not null then
        return new;
      end if;
      select ra.accepted_journey_json, rp.completed_leg_count
        into acceptance, completed_count
        from recovery.recovery_acceptance ra
        join recovery.recovery_plan rp on rp.id=ra.recovery_id
       where ra.recovery_id=new.accepted_recovery_id;
      select completed_leg_count, boarding_confirmed_leg_sequence, alighting_confirmed_leg_sequence
        into progress_count, boarded, alighted from journey.journey_progress
        where journey_id=new.journey_id for update;
      if progress_count <> completed_count then raise exception 'ACCEPTED_ITINERARY_PROGRESS_MISMATCH'; end if;
      if boarded >= completed_count and boarded is distinct from alighted then
        raise exception 'ACCEPTED_ITINERARY_STILL_ONBOARD';
      end if;
      if acceptance is null then raise exception 'ACCEPTED_ITINERARY_NOT_FOUND'; end if;
      if jsonb_array_length(coalesce(acceptance->'legs', '[]'::jsonb)) = 0 then
        raise exception 'ACCEPTED_ITINERARY_EMPTY';
      end if;
      select coalesce(old.current_itinerary_json, p.original_plan_json) into source_plan
        from journey.journey_plan p where p.id=new.journey_id;
      select jsonb_build_object(
        'journeyId', acceptance->'journeyId',
        'origin', source_plan->'origin',
        'destination', acceptance->'destination',
        'startAt', case when completed_count > 0 then source_plan->'startAt' else acceptance->'startAt' end,
        'endAt', acceptance->'endAt',
        'durationSeconds', acceptance->'durationSeconds',
        'transferCount', acceptance->'transferCount',
        'walkingDistanceMeters', acceptance->'walkingDistanceMeters',
        'fareStatus', 'UNKNOWN',
        'routingContext', acceptance->'routingContext',
        'legs', coalesce((
          select jsonb_agg(value order by ordinal)
            from jsonb_array_elements(source_plan->'legs') with ordinality as l(value, ordinal)
           where ordinal <= completed_count
        ), '[]'::jsonb) || coalesce((
          select jsonb_agg(value || jsonb_build_object('sequence', completed_count + ordinal - 1) order by ordinal)
            from jsonb_array_elements(acceptance->'legs') with ordinality as l(value, ordinal)
        ), '[]'::jsonb)
      ) into merged;
      if jsonb_array_length(merged->'legs') <> completed_count + jsonb_array_length(acceptance->'legs') then
        raise exception 'ACCEPTED_ITINERARY_HISTORY_MISMATCH';
      end if;
      new.current_itinerary_json := merged;
      new.accepted_before_leg_count := completed_count;

      insert into journey.active_journey_dependency (
        id, journey_id, recovery_id, leg_sequence, mobility_entity_id,
        canonical_entity_id, entity_type, product_mode, provenance_ref
      )
      select md5(new.accepted_recovery_id::text || ':' || s.sequence::text || ':' || (binding->>'mobilityEntityId'))::uuid,
        new.journey_id, new.accepted_recovery_id, s.sequence,
        (binding->>'mobilityEntityId')::uuid, (binding->>'canonicalEntityId')::uuid,
        binding->>'entityType', binding->>'productMode', binding->>'provenanceRef'
      from jsonb_array_elements(acceptance->'legs') with ordinality as l(leg, ordinal),
        jsonb_array_elements(leg->'entityBindings') as b(binding),
        lateral (select completed_count + ordinal - 1 as sequence) s
      where binding->>'mobilityEntityId' is not null
      on conflict do nothing;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`
    create trigger active_journey_materialize_accepted_itinerary
    before update of accepted_recovery_id on journey.active_journey
    for each row execute function journey.materialize_accepted_itinerary()
  `.execute(database);
  await sql`update journey.active_journey set accepted_recovery_id=accepted_recovery_id where accepted_recovery_id is not null`.execute(
    database,
  );
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists active_journey_materialize_accepted_itinerary on journey.active_journey`.execute(
    database,
  );
  await sql`drop function if exists journey.materialize_accepted_itinerary()`.execute(
    database,
  );
  await sql`drop table if exists journey.current_impact_dependency`.execute(
    database,
  );
  await sql`drop table if exists journey.active_journey_dependency`.execute(
    database,
  );
  await sql`alter table journey.active_journey drop constraint if exists active_journey_current_pointer_check, drop constraint if exists active_journey_current_itinerary_check, drop constraint if exists active_journey_accepted_before_check, drop column if exists current_itinerary_json, drop column if exists accepted_before_leg_count`.execute(
    database,
  );
}
