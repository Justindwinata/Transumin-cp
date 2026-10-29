import { sql, type Kysely } from 'kysely';

/** FR-007 audit record. Existing topology, snapshots and simulation evidence stay immutable. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table recovery.operator_recovery_plan (
      id uuid primary key,
      owner_ref text not null,
      idempotency_key text not null,
      fingerprint text not null,
      route_id uuid not null references transit.route(id) on delete restrict,
      network_snapshot_id uuid not null references twin.network_snapshot(id) on delete restrict,
      simulation_run_id uuid references simulation.run(id) on delete restrict,
      validation_status text not null,
      estimated_vehicle_requirement integer,
      analysis_json jsonb not null,
      created_at timestamptz not null default now(),
      constraint operator_recovery_owner_check check (btrim(owner_ref) <> ''),
      constraint operator_recovery_key_check check (length(idempotency_key) between 8 and 128),
      constraint operator_recovery_fingerprint_check check (fingerprint ~ '^[0-9a-f]{64}$'),
      constraint operator_recovery_status_check check (validation_status in ('VALIDATED','REQUIRES_OPERATOR_VALIDATION','INSUFFICIENT_EVIDENCE')),
      constraint operator_recovery_fleet_check check (estimated_vehicle_requirement is null or estimated_vehicle_requirement >= 0),
      constraint operator_recovery_payload_check check (jsonb_typeof(analysis_json) = 'object'),
      constraint operator_recovery_idempotency_unique unique (owner_ref, idempotency_key)
    )
  `.execute(database);
  await sql`create index operator_recovery_route_created_idx on recovery.operator_recovery_plan (route_id, created_at desc)`.execute(
    database,
  );
}

export async function down(database: Kysely<unknown>): Promise<void> {
  // Preserve audit data: export recovery.operator_recovery_plan before rollback.
  await sql`drop index if exists recovery.operator_recovery_route_created_idx`.execute(
    database,
  );
  await sql`drop table if exists recovery.operator_recovery_plan`.execute(
    database,
  );
}
