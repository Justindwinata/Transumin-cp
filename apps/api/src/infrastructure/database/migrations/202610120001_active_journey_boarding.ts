import { sql, type Kysely } from 'kysely';

/** M4: explicit passenger boarding and alighting evidence stays separate from GPS. */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table journey.journey_progress
      add column boarding_confirmed_leg_sequence integer,
      add column boarding_confirmed_at timestamptz,
      add column alighting_confirmed_leg_sequence integer,
      add column alighting_confirmed_at timestamptz,
      add constraint journey_progress_boarding_pair check (
        (boarding_confirmed_leg_sequence is null and boarding_confirmed_at is null) or
        (boarding_confirmed_leg_sequence is not null and boarding_confirmed_at is not null)
      ),
      add constraint journey_progress_alighting_pair check (
        (alighting_confirmed_leg_sequence is null and alighting_confirmed_at is null) or
        (alighting_confirmed_leg_sequence is not null and alighting_confirmed_at is not null)
      )
  `.execute(database);
  await sql`
    alter table journey.journey_state_event
      drop constraint journey_state_event_type_check,
      add constraint journey_state_event_type_check check (
        event_type in ('ACTIVATED','PROGRESS_UPDATED','BOARDED','ALIGHTED','COMPLETED','CANCELLED','IMPACT_DETECTED')
      )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table journey.journey_state_event
      drop constraint journey_state_event_type_check,
      add constraint journey_state_event_type_check check (
        event_type in ('ACTIVATED','PROGRESS_UPDATED','COMPLETED','CANCELLED','IMPACT_DETECTED')
      )
  `.execute(database);
  await sql`
    alter table journey.journey_progress
      drop constraint journey_progress_boarding_pair,
      drop constraint journey_progress_alighting_pair,
      drop column boarding_confirmed_leg_sequence,
      drop column boarding_confirmed_at,
      drop column alighting_confirmed_leg_sequence,
      drop column alighting_confirmed_at
  `.execute(database);
}
