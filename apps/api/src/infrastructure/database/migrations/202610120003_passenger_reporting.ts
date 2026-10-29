import { sql, type Kysely } from 'kysely';

/** M5: passenger reports stay outside operational evidence until controlled review. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create schema report
  `.execute(database);
  await sql`
    create table report.passenger_report (
      id uuid primary key,
      owner_ref varchar(128) not null,
      active_journey_id uuid,
      category text not null,
      observation_time timestamptz not null,
      received_at timestamptz not null default now(),
      mobility_entity_id uuid not null,
      entity_type text not null,
      description text not null,
      source text not null default 'PASSENGER_SELF_REPORT',
      verification_status text not null default 'REPORTED_UNVERIFIED',
      idempotency_key varchar(128) not null,
      request_fingerprint char(64) not null,
      created_at timestamptz not null default now(),
      constraint passenger_report_owner_check check (btrim(owner_ref) <> ''),
      constraint passenger_report_journey_fk foreign key (active_journey_id)
        references journey.journey_plan (id) on delete restrict,
      constraint passenger_report_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint passenger_report_entity_type_check check (entity_type in ('STOP','STATION','ROUTE')),
      constraint passenger_report_category_check check (category in ('CLEANLINESS','CROWDING','ACCESSIBILITY','SAFETY','SERVICE','OTHER')),
      constraint passenger_report_description_check check (char_length(description) between 1 and 2000 and description !~ '[[:cntrl:]]'),
      constraint passenger_report_status_check check (verification_status in ('REPORTED_UNVERIFIED','CONTROLLED_VERIFIED')),
      constraint passenger_report_source_check check (source = 'PASSENGER_SELF_REPORT'),
      constraint passenger_report_idempotency_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$' and request_fingerprint ~ '^[0-9a-f]{64}$'),
      constraint passenger_report_owner_key_unique unique (owner_ref, idempotency_key)
    )
  `.execute(database);
  await sql`create index passenger_report_owner_created_idx on report.passenger_report (owner_ref, created_at desc)`.execute(
    database,
  );
  await sql`
    create function report.enforce_passenger_report_entity_type()
    returns trigger language plpgsql as $function$
    begin
      if not exists (
        select 1 from twin.mobility_entity
        where id = new.mobility_entity_id and entity_type = new.entity_type
      ) then raise exception 'PASSENGER_REPORT_ENTITY_TYPE_MISMATCH'; end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`
    create trigger passenger_report_exact_entity_type
      before insert or update on report.passenger_report
      for each row execute function report.enforce_passenger_report_entity_type()
  `.execute(database);
  await sql`
    create table report.passenger_report_review (
      report_id uuid primary key references report.passenger_report (id) on delete restrict,
      incident_id uuid not null unique,
      reviewer_ref varchar(128) not null check (btrim(reviewer_ref) <> ''),
      evidence_json jsonb not null check (jsonb_typeof(evidence_json) = 'object'),
      created_at timestamptz not null default now()
    )
  `.execute(database);
  await sql`
    create table report.passenger_report_verification (
      id uuid primary key,
      report_id uuid not null,
      reviewer_ref varchar(128) not null,
      incident_id uuid not null,
      decision text not null,
      operational_state text not null,
      reason text not null,
      verified_at timestamptz not null default now(),
      constraint passenger_report_verification_report_fk foreign key (report_id)
        references report.passenger_report (id) on delete restrict,
      constraint passenger_report_verification_incident_fk foreign key (incident_id)
        references disruption.operational_incident (id) on delete restrict,
      constraint passenger_report_verification_report_unique unique (report_id),
      constraint passenger_report_verification_decision_check check (decision = 'VERIFIED'),
      constraint passenger_report_verification_state_check check (operational_state in ('DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING')),
      constraint passenger_report_verification_reason_check check (char_length(reason) between 1 and 1000 and reason !~ '[[:cntrl:]]' and btrim(reviewer_ref) <> '')
    )
  `.execute(database);
  await sql`
    create function report.prevent_passenger_verification_mutation()
    returns trigger language plpgsql as $function$
    begin raise exception 'PASSENGER_REPORT_VERIFICATION_APPEND_ONLY'; end;
    $function$
  `.execute(database);
  await sql`
    create trigger passenger_report_verification_append_only
      before update or delete on report.passenger_report_verification
      for each row execute function report.prevent_passenger_verification_mutation()
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop trigger passenger_report_verification_append_only on report.passenger_report_verification`.execute(
    database,
  );
  await sql`drop function report.prevent_passenger_verification_mutation()`.execute(
    database,
  );
  await sql`drop table report.passenger_report_verification`.execute(database);
  await sql`drop table report.passenger_report_review`.execute(database);
  await sql`drop trigger passenger_report_exact_entity_type on report.passenger_report`.execute(
    database,
  );
  await sql`drop function report.enforce_passenger_report_entity_type()`.execute(
    database,
  );
  await sql`drop table report.passenger_report`.execute(database);
  await sql`drop schema report`.execute(database);
}
