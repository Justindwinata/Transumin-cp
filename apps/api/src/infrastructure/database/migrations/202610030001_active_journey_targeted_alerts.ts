import { sql, type Kysely } from 'kysely';

/** FR-009: immutable selected plans, separate progress, indexed dependencies, and scoped alerts. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table journey.journey_plan (
      id uuid primary key,
      owner_ref text not null,
      plan_fingerprint text not null,
      original_plan_json jsonb not null,
      origin_lat double precision not null,
      origin_lon double precision not null,
      destination_lat double precision not null,
      destination_lon double precision not null,
      planned_start_at timestamptz not null,
      planned_end_at timestamptz not null,
      routing_snapshot_id text not null,
      routing_manifest_sha256 text not null,
      graph_sha256 text not null,
      network_snapshot_id uuid not null,
      network_snapshot_hash text not null,
      mobility_projection_version text not null,
      service_date date not null,
      timezone text not null,
      planned_at timestamptz not null,
      created_at timestamptz not null default now(),
      constraint journey_plan_snapshot_fk foreign key (network_snapshot_id)
        references twin.network_snapshot (id) on delete restrict,
      constraint journey_plan_owner_check check (btrim(owner_ref) <> '' and length(owner_ref) <= 128),
      constraint journey_plan_fingerprint_check check (plan_fingerprint ~ '^[0-9a-f]{64}$'),
      constraint journey_plan_hash_check check (
        routing_manifest_sha256 ~ '^[0-9a-f]{64}$' and
        graph_sha256 ~ '^[0-9a-f]{64}$' and
        network_snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      constraint journey_plan_json_check check (jsonb_typeof(original_plan_json) = 'object'),
      constraint journey_plan_time_check check (planned_end_at >= planned_start_at),
      constraint journey_plan_timezone_check check (timezone = 'Asia/Jakarta'),
      constraint journey_plan_owner_fingerprint_unique unique (owner_ref, plan_fingerprint)
    )
  `.execute(database);
  await sql`create index journey_plan_owner_idx on journey.journey_plan (owner_ref, created_at desc)`.execute(
    database,
  );

  await sql`
    create table journey.active_journey (
      journey_id uuid primary key,
      lifecycle_status text not null default 'ACTIVE',
      activated_at timestamptz not null,
      completed_at timestamptz,
      cancelled_at timestamptz,
      updated_at timestamptz not null default now(),
      constraint active_journey_plan_fk foreign key (journey_id)
        references journey.journey_plan (id) on delete restrict,
      constraint active_journey_status_check check (
        lifecycle_status in ('ACTIVE','COMPLETED','CANCELLED')
      ),
      constraint active_journey_terminal_check check (
        (lifecycle_status = 'ACTIVE' and completed_at is null and cancelled_at is null) or
        (lifecycle_status = 'COMPLETED' and completed_at is not null and cancelled_at is null) or
        (lifecycle_status = 'CANCELLED' and cancelled_at is not null and completed_at is null)
      )
    )
  `.execute(database);
  await sql`create index active_journey_status_idx on journey.active_journey (lifecycle_status, activated_at)`.execute(
    database,
  );

  await sql`
    create table journey.journey_leg (
      id uuid primary key,
      journey_id uuid not null,
      sequence integer not null,
      mode text not null,
      start_at timestamptz not null,
      end_at timestamptz not null,
      timing_precision text not null,
      leg_fingerprint text not null,
      original_leg_json jsonb not null,
      constraint journey_leg_plan_fk foreign key (journey_id)
        references journey.journey_plan (id) on delete restrict,
      constraint journey_leg_sequence_check check (sequence >= 0),
      constraint journey_leg_time_check check (end_at >= start_at),
      constraint journey_leg_mode_check check (
        mode in ('WALK','TRANSJAKARTA','MIKROTRANS','KRL','MRT_JAKARTA','LRT_JAKARTA','LRT_JABODEBEK')
      ),
      constraint journey_leg_timing_check check (
        timing_precision in ('EXACT_SCHEDULE','FREQUENCY_DERIVED','SOURCE_GTFS_WITH_FREQUENCIES','ESTIMATED')
      ),
      constraint journey_leg_fingerprint_check check (leg_fingerprint ~ '^[0-9a-f]{64}$'),
      constraint journey_leg_json_check check (jsonb_typeof(original_leg_json) = 'object'),
      constraint journey_leg_sequence_unique unique (journey_id, sequence)
    )
  `.execute(database);

  await sql`
    create table journey.journey_dependency (
      id uuid primary key,
      journey_id uuid not null,
      leg_sequence integer not null,
      mobility_entity_id uuid not null,
      canonical_entity_id uuid not null,
      entity_type text not null,
      product_mode text not null,
      provenance_ref text not null,
      constraint journey_dependency_leg_fk foreign key (journey_id, leg_sequence)
        references journey.journey_leg (journey_id, sequence) on delete restrict,
      constraint journey_dependency_mobility_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint journey_dependency_canonical_fk foreign key (canonical_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint journey_dependency_type_check check (entity_type in ('STOP','STATION','ROUTE')),
      constraint journey_dependency_provenance_check check (btrim(provenance_ref) <> ''),
      constraint journey_dependency_identity_check check (canonical_entity_id = mobility_entity_id),
      constraint journey_dependency_unique unique (journey_id, leg_sequence, mobility_entity_id)
    )
  `.execute(database);
  await sql`create index journey_dependency_entity_idx on journey.journey_dependency (mobility_entity_id, journey_id, leg_sequence)`.execute(
    database,
  );

  await sql`
    create table journey.journey_progress (
      journey_id uuid primary key,
      completed_leg_count integer not null default 0,
      current_leg_sequence integer,
      progress_method text not null default 'CONTROLLED_MANUAL',
      recorded_at timestamptz not null,
      revision integer not null default 1,
      updated_at timestamptz not null default now(),
      constraint journey_progress_active_fk foreign key (journey_id)
        references journey.active_journey (journey_id) on delete restrict,
      constraint journey_progress_count_check check (completed_leg_count >= 0),
      constraint journey_progress_sequence_check check (current_leg_sequence is null or current_leg_sequence >= 0),
      constraint journey_progress_method_check check (progress_method = 'CONTROLLED_MANUAL'),
      constraint journey_progress_revision_check check (revision >= 1)
    )
  `.execute(database);

  await sql`
    create table journey.journey_state_event (
      id uuid primary key,
      journey_id uuid not null,
      event_type text not null,
      occurred_at timestamptz not null,
      event_fingerprint text not null unique,
      payload_json jsonb not null default '{}'::jsonb,
      constraint journey_state_event_active_fk foreign key (journey_id)
        references journey.active_journey (journey_id) on delete restrict,
      constraint journey_state_event_type_check check (
        event_type in ('ACTIVATED','PROGRESS_UPDATED','COMPLETED','CANCELLED','IMPACT_DETECTED')
      ),
      constraint journey_state_event_payload_check check (jsonb_typeof(payload_json) = 'object')
    )
  `.execute(database);
  await sql`create index journey_state_event_time_idx on journey.journey_state_event (journey_id, occurred_at desc)`.execute(
    database,
  );

  await sql`
    create table journey.journey_impact (
      id uuid primary key,
      journey_id uuid not null,
      owner_ref text not null,
      state_transition_id uuid not null,
      mobility_entity_id uuid not null,
      impact_status text not null,
      operational_state text not null,
      evidence_type text,
      freshness_status text not null,
      observation_id uuid,
      source_id uuid,
      observed_at timestamptz,
      received_at timestamptz,
      expires_at timestamptz,
      provenance_ref text,
      projection_version text not null,
      detected_at timestamptz not null default now(),
      resolved_at timestamptz,
      constraint journey_impact_active_fk foreign key (journey_id)
        references journey.active_journey (journey_id) on delete restrict,
      constraint journey_impact_transition_fk foreign key (state_transition_id)
        references twin.mobility_state_history (id) on delete restrict,
      constraint journey_impact_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint journey_impact_observation_fk foreign key (observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint journey_impact_status_check check (impact_status in ('BLOCKING','AFFECTED','RECOVERING')),
      constraint journey_impact_state_check check (operational_state in ('UNAVAILABLE','DEGRADED','DISRUPTED','RECOVERING')),
      constraint journey_impact_freshness_check check (freshness_status in ('FRESH','AGING','STALE')),
      constraint journey_impact_unique unique (journey_id, state_transition_id)
    )
  `.execute(database);
  await sql`create index journey_impact_journey_idx on journey.journey_impact (journey_id, detected_at desc)`.execute(
    database,
  );

  await sql`
    create table journey.journey_impact_dependency (
      impact_id uuid not null,
      dependency_id uuid not null,
      primary key (impact_id, dependency_id),
      constraint journey_impact_dependency_impact_fk foreign key (impact_id)
        references journey.journey_impact (id) on delete restrict,
      constraint journey_impact_dependency_dependency_fk foreign key (dependency_id)
        references journey.journey_dependency (id) on delete restrict
    )
  `.execute(database);

  await sql`
    create table journey.targeted_alert (
      id uuid primary key,
      impact_id uuid not null unique,
      journey_id uuid not null,
      owner_ref text not null,
      alert_type text not null,
      message text not null,
      created_at timestamptz not null default now(),
      read_at timestamptz,
      resolved_at timestamptz,
      constraint targeted_alert_impact_fk foreign key (impact_id)
        references journey.journey_impact (id) on delete restrict,
      constraint targeted_alert_journey_fk foreign key (journey_id)
        references journey.active_journey (journey_id) on delete restrict,
      constraint targeted_alert_type_check check (alert_type in ('BLOCKING','DISRUPTION','RECOVERY_UPDATE')),
      constraint targeted_alert_message_check check (btrim(message) <> '')
    )
  `.execute(database);
  await sql`create index targeted_alert_scope_idx on journey.targeted_alert (owner_ref, journey_id, created_at desc)`.execute(
    database,
  );

  await sql`
    create function journey.prevent_selected_plan_mutation()
    returns trigger language plpgsql as $function$
    begin
      raise exception 'SELECTED_JOURNEY_PLAN_IMMUTABLE';
    end;
    $function$
  `.execute(database);
  for (const table of ['journey_plan', 'journey_leg', 'journey_dependency'])
    await sql
      .raw(
        `
      create trigger ${table}_immutable
      before update or delete on journey.${table}
      for each row execute function journey.prevent_selected_plan_mutation()
    `,
      )
      .execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists journey.targeted_alert`.execute(database);
  await sql`drop table if exists journey.journey_impact_dependency`.execute(
    database,
  );
  await sql`drop table if exists journey.journey_impact`.execute(database);
  await sql`drop table if exists journey.journey_state_event`.execute(database);
  await sql`drop table if exists journey.journey_progress`.execute(database);
  await sql`drop table if exists journey.journey_dependency`.execute(database);
  await sql`drop table if exists journey.journey_leg`.execute(database);
  await sql`drop table if exists journey.active_journey`.execute(database);
  await sql`drop table if exists journey.journey_plan`.execute(database);
  await sql`drop function if exists journey.prevent_selected_plan_mutation()`.execute(
    database,
  );
}
