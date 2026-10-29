import { sql, type Kysely } from 'kysely';

/** SCX-FR-003/004/005: hazard evidence remains separate from operational incident lifecycle. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table disruption.event
      add column observed_at timestamptz,
      add column expires_at timestamptz,
      add column source_classification text
  `.execute(database);
  await sql`
    alter table disruption.event add constraint disruption_event_hazard_evidence_check check (
      incident_type <> 'FLOOD' or (
        observed_at is not null and expires_at is not null and observed_at < expires_at and
        source_classification is not null and operational_state = 'UNKNOWN'
      )
    ) not valid
  `.execute(database);

  await sql`
    create table disruption.operational_incident (
      id uuid primary key,
      incident_type text not null,
      lifecycle_status text not null,
      source_class text not null,
      source_id uuid not null,
      source_authority text not null,
      source_channel text not null,
      evidence_type text not null,
      operational_state text not null,
      observed_at timestamptz not null,
      effective_from timestamptz not null,
      effective_to timestamptz,
      expires_at timestamptz not null,
      received_at timestamptz not null,
      reason text not null,
      provenance_ref text not null,
      raw_reference text not null,
      supporting_hazard_event_id uuid,
      evidence_identity text not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint operational_incident_hazard_fk foreign key (supporting_hazard_event_id)
        references disruption.event (id) on delete restrict,
      constraint operational_incident_lifecycle_check check (
        lifecycle_status in ('INGESTED_UNVERIFIED','VERIFIED_ACTIVE','RESOLVED','RETRACTED')
      ),
      constraint operational_incident_source_class_check check (
        source_class in ('SIMULATED','MANUAL_VERIFIED','GTFS_RT','AUTHORIZED_OPERATOR_API')
      ),
      constraint operational_incident_type_check check (
        incident_type in ('STATION_CLOSURE','STOP_CLOSURE','SERVICE_SUSPENSION','SERVICE_TRUNCATION','ROUTE_DIVERSION','INFRASTRUCTURE_FAILURE','MANUAL_OPERATOR_INCIDENT','OTHER')
      ),
      constraint operational_incident_evidence_check check (
        evidence_type in ('OBSERVED','LIVE','SIMULATED')
      ),
      constraint operational_incident_state_check check (
        operational_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint operational_incident_temporal_check check (
        observed_at <= received_at and effective_from < expires_at and
        (effective_to is null or (effective_to > effective_from and effective_to <= expires_at))
      ),
      constraint operational_incident_reference_check check (
        btrim(reason) <> '' and btrim(provenance_ref) <> '' and
        btrim(raw_reference) <> '' and evidence_identity ~ '^[0-9a-f]{64}$'
      )
    )
  `.execute(database);
  await sql`create index operational_incident_effective_idx on disruption.operational_incident (lifecycle_status, effective_from, expires_at)`.execute(
    database,
  );

  await sql`
    create table disruption.operational_incident_entity (
      incident_id uuid not null,
      mobility_entity_id uuid not null,
      entity_type text not null,
      mode text not null,
      created_at timestamptz not null default now(),
      primary key (incident_id, mobility_entity_id, mode),
      constraint incident_entity_incident_fk foreign key (incident_id)
        references disruption.operational_incident (id) on delete restrict,
      constraint incident_entity_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint incident_entity_type_check check (entity_type in ('ROUTE','STOP','STATION')),
      constraint incident_entity_mode_check check (
        mode in ('TRANSJAKARTA','MIKROTRANS','KRL','MRT_JAKARTA','LRT_JAKARTA','LRT_JABODEBEK')
      )
    )
  `.execute(database);
  await sql`create index incident_entity_mobility_idx on disruption.operational_incident_entity (mobility_entity_id, incident_id)`.execute(
    database,
  );
  await sql`
    create function disruption.enforce_incident_entity_type()
    returns trigger language plpgsql as $function$
    begin
      if not exists (
        select 1 from twin.mobility_entity
        where id = new.mobility_entity_id and entity_type = new.entity_type
      ) then raise exception 'INCIDENT_CANONICAL_ENTITY_TYPE_MISMATCH'; end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`
    create trigger incident_entity_exact_type
      before insert or update on disruption.operational_incident_entity
      for each row execute function disruption.enforce_incident_entity_type()
  `.execute(database);

  await sql`
    create table disruption.operational_incident_journal (
      id uuid primary key,
      incident_id uuid not null,
      revision integer not null,
      lifecycle_status text not null,
      changed_at timestamptz not null,
      reason text not null,
      provenance_ref text not null,
      observation_id uuid,
      hazard_event_id uuid,
      entry_identity text not null unique,
      constraint incident_journal_incident_fk foreign key (incident_id)
        references disruption.operational_incident (id) on delete restrict,
      constraint incident_journal_observation_fk foreign key (observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint incident_journal_hazard_fk foreign key (hazard_event_id)
        references disruption.event (id) on delete restrict,
      constraint incident_journal_unique_revision unique (incident_id, revision),
      constraint incident_journal_revision_check check (revision >= 1),
      constraint incident_journal_status_check check (
        lifecycle_status in ('INGESTED_UNVERIFIED','VERIFIED_ACTIVE','RESOLVED','RETRACTED')
      ),
      constraint incident_journal_reference_check check (
        btrim(reason) <> '' and btrim(provenance_ref) <> '' and entry_identity ~ '^[0-9a-f]{64}$'
      )
    )
  `.execute(database);
  await sql`create index incident_journal_incident_time_idx on disruption.operational_incident_journal (incident_id, changed_at, revision)`.execute(
    database,
  );
  await sql`
    create function disruption.prevent_incident_journal_mutation()
    returns trigger language plpgsql as $function$
    begin raise exception 'OPERATIONAL_INCIDENT_JOURNAL_APPEND_ONLY'; end;
    $function$
  `.execute(database);
  await sql`
    create trigger operational_incident_journal_append_only
      before update or delete on disruption.operational_incident_journal
      for each row execute function disruption.prevent_incident_journal_mutation()
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists operational_incident_journal_append_only on disruption.operational_incident_journal`.execute(
    database,
  );
  await sql`drop function if exists disruption.prevent_incident_journal_mutation()`.execute(
    database,
  );
  await sql`drop table if exists disruption.operational_incident_journal`.execute(
    database,
  );
  await sql`drop trigger if exists incident_entity_exact_type on disruption.operational_incident_entity`.execute(
    database,
  );
  await sql`drop function if exists disruption.enforce_incident_entity_type()`.execute(
    database,
  );
  await sql`drop table if exists disruption.operational_incident_entity`.execute(
    database,
  );
  await sql`drop table if exists disruption.operational_incident`.execute(
    database,
  );
  await sql`alter table disruption.event drop constraint if exists disruption_event_hazard_evidence_check`.execute(
    database,
  );
  await sql`alter table disruption.event drop column if exists source_classification, drop column if exists expires_at, drop column if exists observed_at`.execute(
    database,
  );
}
