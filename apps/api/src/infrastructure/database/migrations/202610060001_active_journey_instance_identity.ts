import { sql, type Kysely } from 'kysely';

/** Keep the immutable router plan ID distinct from the owner-scoped active instance. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table journey.journey_plan
    add column routing_journey_id uuid generated always as
      ((original_plan_json ->> 'journeyId')::uuid) stored
  `.execute(database);
  await sql`
    create index journey_plan_routing_identity_idx
      on journey.journey_plan (routing_journey_id, owner_ref)
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists journey.journey_plan_routing_identity_idx`.execute(
    database,
  );
  await sql`alter table journey.journey_plan drop column if exists routing_journey_id`.execute(
    database,
  );
}
