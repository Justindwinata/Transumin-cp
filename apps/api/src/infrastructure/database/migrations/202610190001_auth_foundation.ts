import { sql, type Kysely } from 'kysely';

/** FR-014: additive local identities and revocable server-side sessions; auth schema safe if existing. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create schema if not exists auth`.execute(db);
  await sql`create table auth.user_account (
    id uuid primary key,
    email text not null unique,
    password_hash text not null,
    status text not null default 'ACTIVE',
    created_at timestamptz not null default now(),
    constraint auth_email_check check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
    constraint auth_password_check check (password_hash ~ '^scrypt[$][0-9a-f]{32}[$][0-9a-f]{128}$'),
    constraint auth_status_check check (status in ('ACTIVE','DISABLED'))
  )`.execute(db);
  await sql`create table auth.role_assignment (
    id uuid primary key,
    user_id uuid not null references auth.user_account(id) on delete cascade,
    role_code text not null check (role_code in ('PASSENGER','RESEARCHER_OPERATOR','ADMIN')),
    unique(user_id, role_code)
  )`.execute(db);
  await sql`create table auth.session (
    id uuid primary key,
    user_id uuid not null references auth.user_account(id) on delete cascade,
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    constraint auth_session_expiry_check check (expires_at > created_at),
    constraint auth_session_revoked_check check (revoked_at is null or revoked_at >= created_at)
  )`.execute(db);
  await sql`create index auth_session_user_idx on auth.session(user_id)`.execute(
    db,
  );
  await sql`create index auth_session_expiry_idx on auth.session(expires_at) where revoked_at is null`.execute(
    db,
  );
  // ponytail: throttle is in-DB durable digest counters; 15m window, no Redis. Upgrade to distributed counter when multi-instance rate limiting needed.
  await sql`create table auth.login_attempt (
    id uuid primary key,
    ip_digest text not null check (ip_digest ~ '^[0-9a-f]{64}$'),
    email_digest text not null check (email_digest ~ '^[0-9a-f]{64}$'),
    success boolean not null,
    attempted_at timestamptz not null default now()
  )`.execute(db);
  await sql`create index auth_login_attempt_ip_time_idx on auth.login_attempt(ip_digest, attempted_at desc)`.execute(
    db,
  );
  await sql`create index auth_login_attempt_email_time_idx on auth.login_attempt(email_digest, attempted_at desc)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists auth.login_attempt restrict`.execute(db);
  await sql`drop table if exists auth.session restrict`.execute(db);
  await sql`drop table if exists auth.role_assignment restrict`.execute(db);
  await sql`drop table if exists auth.user_account restrict`.execute(db);
}
