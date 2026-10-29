import { sql, type Kysely } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`create schema if not exists recovery`.execute(database);
  await sql`
    create table recovery.recovery_plan (
      id uuid primary key,
      active_journey_id uuid not null,
      impact_id uuid not null,
      owner_ref text not null,
      idempotency_key text not null,
      method text not null,
      status text not null,
      progress_revision integer not null,
      completed_leg_count integer not null,
      recovery_anchor_name text not null,
      recovery_anchor_lat double precision not null,
      recovery_anchor_lon double precision not null,
      recovery_at timestamptz not null,
      network_snapshot_id uuid not null,
      mobility_projection_version text not null,
      original_journey_fingerprint text not null,
      proposed_fingerprint text,
      baseline_fingerprint text,
      preserved_leg_count integer not null,
      eligible_remaining_leg_count integer not null,
      changed_leg_count integer not null,
      added_travel_time_seconds integer,
      added_transfers integer,
      plan_change_count integer not null,
      disrupted_entity_avoided boolean not null,
      state_validation_ms double precision not null,
      preservation_processing_ms double precision not null,
      proposed_routing_ms double precision not null,
      baseline_routing_ms double precision not null,
      total_computation_ms double precision not null,
      triggering_entity_id uuid not null,
      state_transition_id uuid not null,
      reason text not null,
      proposed_journey_json jsonb,
      baseline_journey_json jsonb,
      comparison_json jsonb not null,
      created_at timestamptz not null default now(),
      constraint recovery_plan_journey_fk foreign key (active_journey_id)
        references journey.active_journey (journey_id) on delete restrict,
      constraint recovery_plan_impact_fk foreign key (impact_id)
        references journey.journey_impact (id) on delete restrict,
      constraint recovery_plan_snapshot_fk foreign key (network_snapshot_id)
        references twin.network_snapshot (id) on delete restrict,
      constraint recovery_plan_entity_fk foreign key (triggering_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint recovery_plan_transition_fk foreign key (state_transition_id)
        references twin.mobility_state_history (id) on delete restrict,
      constraint recovery_method_check check (method='STATE_AWARE_REPAIR'),
      constraint recovery_status_check check (status in ('COMPLETED','NO_PATH','FAILED')),
      constraint recovery_counts_check check (
        progress_revision >= 1 and completed_leg_count >= 0 and
        preserved_leg_count >= 0 and eligible_remaining_leg_count >= 0 and
        changed_leg_count >= 0 and plan_change_count >= 0
      ),
      constraint recovery_anchor_check check (
        recovery_anchor_lat between -90 and 90 and recovery_anchor_lon between -180 and 180
      ),
      constraint recovery_owner_idempotency unique (owner_ref, idempotency_key)
    )
  `.execute(database);
  await sql`create index recovery_plan_journey_idx on recovery.recovery_plan (active_journey_id, created_at desc)`.execute(
    database,
  );
  await sql`
    create table recovery.recovery_segment (
      id uuid primary key,
      recovery_id uuid not null,
      sequence integer not null,
      classification text not null,
      original_leg_sequence integer,
      result_leg_json jsonb,
      constraint recovery_segment_plan_fk foreign key (recovery_id)
        references recovery.recovery_plan (id) on delete restrict,
      constraint recovery_segment_class_check check (
        classification in ('COMPLETED','STILL_VALID','INVALIDATED','REPAIRED_REPLACED')
      ),
      constraint recovery_segment_unique unique (recovery_id, sequence)
    )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists recovery.recovery_segment`.execute(database);
  await sql`drop table if exists recovery.recovery_plan`.execute(database);
  await sql`drop schema if exists recovery`.execute(database);
}
