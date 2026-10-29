import { sql, type Kysely } from 'kysely';

/**
 * Acceptance remains additive: journey_plan/original_plan_json, journey_leg,
 * journey_progress, confirmations, and state-event history are never rewritten.
 * Recovery: down removes only acceptance pointers/lineage after application rollback;
 * export recovery.recovery_acceptance first if acceptance audit must be retained.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table recovery.recovery_acceptance (
      recovery_id uuid primary key,
      owner_ref text not null,
      idempotency_key text not null,
      active_journey_id uuid not null,
      accepted_progress_revision integer not null,
      accepted_impact_id uuid not null,
      accepted_state_transition_id uuid not null,
      accepted_projection_version text not null,
      accepted_journey_fingerprint text not null,
      accepted_journey_json jsonb not null,
      acceptance_json jsonb not null,
      accepted_at timestamptz not null default now(),
      constraint recovery_acceptance_plan_fk foreign key (recovery_id)
        references recovery.recovery_plan (id) on delete restrict,
      constraint recovery_acceptance_journey_fk foreign key (active_journey_id)
        references journey.active_journey (journey_id) on delete restrict,
      constraint recovery_acceptance_impact_fk foreign key (accepted_impact_id)
        references journey.journey_impact (id) on delete restrict,
      constraint recovery_acceptance_transition_fk foreign key (accepted_state_transition_id)
        references twin.mobility_state_history (id) on delete restrict,
      constraint recovery_acceptance_revision_check check (accepted_progress_revision >= 1),
      constraint recovery_acceptance_owner_idempotency unique (owner_ref, idempotency_key)
    )
  `.execute(database);
  await sql`
    alter table journey.active_journey add column accepted_recovery_id uuid,
      add column recovery_accepted_at timestamptz,
      add constraint active_journey_accepted_recovery_fk
        foreign key (accepted_recovery_id)
        references recovery.recovery_acceptance (recovery_id) on delete restrict,
      add constraint active_journey_recovery_pointer_check check (
        (accepted_recovery_id is null) = (recovery_accepted_at is null)
      )
  `.execute(database);
  await sql`create index recovery_acceptance_journey_idx on recovery.recovery_acceptance (active_journey_id, accepted_at desc)`.execute(
    database,
  );
  await sql`
    alter table journey.journey_state_event
      drop constraint if exists journey_state_event_type_check,
      add constraint journey_state_event_type_check check (
        event_type in ('ACTIVATED','PROGRESS_UPDATED','BOARDED','ALIGHTED','COMPLETED','CANCELLED','IMPACT_DETECTED','RECOVERY_ACCEPTED')
      )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table journey.journey_state_event
      drop constraint if exists journey_state_event_type_check,
      add constraint journey_state_event_type_check check (
        event_type in ('ACTIVATED','PROGRESS_UPDATED','BOARDED','ALIGHTED','COMPLETED','CANCELLED','IMPACT_DETECTED')
      )
  `.execute(database);
  await sql`alter table journey.active_journey drop constraint if exists active_journey_recovery_pointer_check, drop constraint if exists active_journey_accepted_recovery_fk, drop column if exists recovery_accepted_at, drop column if exists accepted_recovery_id`.execute(
    database,
  );
  await sql`drop table if exists recovery.recovery_acceptance`.execute(
    database,
  );
}
