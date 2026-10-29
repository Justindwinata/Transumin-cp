import { sql, type Kysely } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table disruption.source_health (
      source_id uuid primary key,
      status text not null,
      last_checked_at timestamptz not null,
      last_success_at timestamptz,
      consecutive_failures integer not null default 0,
      error_summary text,
      constraint source_health_status_check check (
        status in ('HEALTHY','DEGRADED','UNHEALTHY','UNKNOWN')
      ),
      constraint source_health_failure_check check (consecutive_failures >= 0),
      constraint source_health_consistency_check check (
        (status = 'HEALTHY' and consecutive_failures = 0 and error_summary is null)
        or status <> 'HEALTHY'
      )
    )
  `.execute(database);
  await sql`
    create index source_health_checked_idx
      on disruption.source_health (last_checked_at desc)
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists disruption.source_health`.execute(database);
}
