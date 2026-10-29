import { sql, type Kysely } from 'kysely';

/** Independent product activations; legacy plans and research hashes remain immutable. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table journey.journey_plan drop constraint journey_plan_owner_fingerprint_unique;
    create table journey.activation_receipt (
      owner_ref text not null check (length(owner_ref) between 1 and 128),
      idempotency_key text not null check (length(idempotency_key) between 8 and 128),
      request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
      active_journey_id uuid not null references journey.active_journey(journey_id) on delete restrict,
      created_at timestamptz not null default now(),
      primary key (owner_ref, idempotency_key)
    )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  // Restore only when independent duplicate plans do not exist; otherwise fails safely.
  await sql`alter table journey.journey_plan add constraint journey_plan_owner_fingerprint_unique unique (owner_ref, plan_fingerprint)`.execute(
    database,
  );
  await sql`drop table journey.activation_receipt`.execute(database);
}
