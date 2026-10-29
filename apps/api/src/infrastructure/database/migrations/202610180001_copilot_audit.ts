import { sql, type Kysely } from 'kysely';

/**
 * FR-010: additive, reversible, owner-scoped copilot audit.
 * No raw prompt persisted: request_digest (sha256) only.
 * Access expires via copilot.session.expires_at (90 days); rows remain stored.
 * No physical purge job or cascade deletes; expiry is not a deletion guarantee.
 * Typed read-only Student A ports preserved; copilot remains deterministic template.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`create schema if not exists copilot`.execute(database);
  await sql`
    create table copilot.session (
      id uuid primary key,
      owner_ref text not null,
      created_at timestamptz not null default now(),
      last_message_at timestamptz not null default now(),
      expires_at timestamptz not null default (now() + interval '90 days'),
      constraint copilot_session_owner_check check (btrim(owner_ref) <> '' and length(owner_ref) <= 128),
      constraint copilot_session_expiry_check check (expires_at > created_at),
      constraint copilot_session_owner_id_unique unique (id, owner_ref)
    )
  `.execute(database);
  await sql`create index copilot_session_owner_time_idx on copilot.session (owner_ref, last_message_at desc, id)`.execute(
    database,
  );
  await sql`
    create table copilot.message (
      id uuid primary key,
      session_id uuid not null,
      owner_ref text not null,
      request_digest text not null,
      context_references jsonb not null default '[]'::jsonb,
      answer_text text not null,
      evidence_type text not null,
      fallback_status text not null,
      response_json jsonb not null,
      created_at timestamptz not null default now(),
      constraint copilot_message_owner_check check (btrim(owner_ref) <> '' and length(owner_ref) <= 128),
      constraint copilot_message_request_digest_check check (request_digest ~ '^[0-9a-f]{64}$'),
      constraint copilot_message_context_check check (jsonb_typeof(context_references) = 'array'),
      constraint copilot_message_evidence_check check (evidence_type in ('SCHEDULED','OBSERVED','LIVE','FORECAST','SIMULATED','ESTIMATED')),
      constraint copilot_message_fallback_check check (fallback_status in ('GROUNDED','DETERMINISTIC_FALLBACK','INSUFFICIENT_EVIDENCE')),
      constraint copilot_message_response_check check (jsonb_typeof(response_json) = 'object'),
      constraint copilot_message_owner_id_unique unique (id, owner_ref),
      constraint copilot_message_session_owner_fk foreign key (session_id, owner_ref) references copilot.session(id, owner_ref) on delete restrict
    )
  `.execute(database);
  await sql`create index copilot_message_session_time_idx on copilot.message (session_id, created_at, id)`.execute(
    database,
  );
  await sql`create index copilot_message_owner_time_idx on copilot.message (owner_ref, created_at desc)`.execute(
    database,
  );
  await sql`
    create table copilot.tool_audit (
      id uuid primary key,
      message_id uuid not null,
      session_id uuid not null,
      owner_ref text not null,
      tool_name text not null,
      request_digest text not null,
      result_ref text not null,
      response_digest text,
      status text not null,
      latency_ms integer not null,
      created_at timestamptz not null default now(),
      constraint copilot_tool_owner_check check (btrim(owner_ref) <> '' and length(owner_ref) <= 128),
      constraint copilot_tool_request_digest_check check (request_digest ~ '^[0-9a-f]{64}$'),
      constraint copilot_tool_response_digest_check check (response_digest is null or response_digest ~ '^[0-9a-f]{64}$'),
      constraint copilot_tool_status_check check (status in ('OK','UNAVAILABLE')),
      constraint copilot_tool_latency_check check (latency_ms >= 0),
      constraint copilot_tool_result_ref_check check (btrim(result_ref) <> '' and length(result_ref) <= 200),
      constraint copilot_tool_message_owner_fk foreign key (message_id, owner_ref) references copilot.message(id, owner_ref) on delete restrict,
      constraint copilot_tool_session_owner_fk foreign key (session_id, owner_ref) references copilot.session(id, owner_ref) on delete restrict
    )
  `.execute(database);
  await sql`create index copilot_tool_session_time_idx on copilot.tool_audit (session_id, created_at, id)`.execute(
    database,
  );
  await sql`create index copilot_tool_message_idx on copilot.tool_audit (message_id, created_at)`.execute(
    database,
  );
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists copilot.tool_audit restrict`.execute(database);
  await sql`drop table if exists copilot.message restrict`.execute(database);
  await sql`drop table if exists copilot.session restrict`.execute(database);
  await sql`drop schema if exists copilot restrict`.execute(database);
}
