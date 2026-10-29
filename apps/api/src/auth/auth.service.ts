// FR-014: local credential authentication; every authorization resolves current DB state.
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as derive,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DATABASE } from '../infrastructure/database/database.constants.js';
import { authError } from './auth.error.js';

export type Role = 'PASSENGER' | 'RESEARCHER_OPERATOR' | 'ADMIN';
export type Principal = {
  userId: string;
  email: string;
  roles: Role[];
  sessionId: string;
};
type Account = {
  id: string;
  email: string;
  password_hash: string;
  status: string;
};
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$2e622237a7f481f7a93451d3eba55034e80ab5b766324c394b3c8c2ed3740039f1e266c84e962aa9194a7ed138d0df2f1cf6104af9c7200a8037563362e52a08`;
const scrypt = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    derive(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
export const isRole = (value: unknown): value is Role =>
  value === 'PASSENGER' || value === 'RESEARCHER_OPERATOR' || value === 'ADMIN';

@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<unknown>) {}

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<{ principal: Principal; token: string }> {
    const normalized = email.trim().toLowerCase();
    if (
      !normalized ||
      normalized.length > 254 ||
      !password ||
      password.length > 512
    )
      throw authError('INVALID_INPUT', 400);
    const reservation = await this.reserve(ip, normalized);
    if (reservation === 'UNAVAILABLE') throw authError('AUTH_UNAVAILABLE', 503);
    if (reservation === 'THROTTLED') throw authError('RATE_LIMITED', 429);
    const account = (
      await sql<Account>`select id,email,password_hash,status from auth.user_account where email=${normalized}`.execute(
        this.db,
      )
    ).rows[0];
    const valid = await verifyPassword(
      password,
      account?.password_hash ?? DUMMY_HASH,
    );
    if (!account || account.status !== 'ACTIVE' || !valid)
      throw authError('AUTH_REQUIRED', 401);
    await sql`update auth.login_attempt set success=true where id=${reservation}::uuid`.execute(
      this.db,
    );
    const token = randomBytes(32).toString('hex');
    const sessionId = randomUUID();
    await sql`insert into auth.session(id,user_id,token_hash,expires_at) values (${sessionId}::uuid,${account.id}::uuid,${digest(token)},now()+interval '12 hours')`.execute(
      this.db,
    );
    return {
      token,
      principal: await this.principal(account.id, account.email, sessionId),
    };
  }

  async resolve(token: string | undefined): Promise<Principal> {
    if (!token || !/^[0-9a-f]{64}$/.test(token))
      throw authError('AUTH_REQUIRED', 401);
    const row = (
      await sql<{
        session_id: string;
        user_id: string;
        email: string;
      }>`select s.id session_id,u.id user_id,u.email from auth.session s join auth.user_account u on u.id=s.user_id where s.token_hash=${digest(token)} and s.revoked_at is null and s.expires_at > now() and u.status='ACTIVE'`.execute(
        this.db,
      )
    ).rows[0];
    if (!row) throw authError('AUTH_REQUIRED', 401);
    return this.principal(row.user_id, row.email, row.session_id);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) throw authError('AUTH_REQUIRED', 401);
    await sql`update auth.session set revoked_at=now() where token_hash=${digest(token)} and revoked_at is null`.execute(
      this.db,
    );
  }

  async listUsers() {
    return (
      await sql<{
        id: string;
        email: string;
        status: string;
        roles: Role[];
      }>`select u.id,u.email,u.status,coalesce(array_agg(r.role_code order by r.role_code) filter (where r.role_code is not null),'{}') roles from auth.user_account u left join auth.role_assignment r on r.user_id=u.id group by u.id order by u.created_at,u.id`.execute(
        this.db,
      )
    ).rows;
  }

  private async reserve(
    ip: string,
    email: string,
  ): Promise<string | 'THROTTLED' | 'UNAVAILABLE'> {
    try {
      return await this.db.transaction().execute(async (tx) => {
        const keys = [`ip:${digest(ip)}`, `email:${digest(email)}`].sort();
        for (const key of keys)
          await sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(
            tx,
          );
        const rows = await sql<{ ip_count: number; email_count: number }>`select
          count(*) filter (where ip_digest=${digest(ip)})::int ip_count,
          count(*) filter (where email_digest=${digest(email)})::int email_count
          from auth.login_attempt where attempted_at > now()-interval '15 minutes'
          and (ip_digest=${digest(ip)} or email_digest=${digest(email)})`.execute(
          tx,
        );
        if (rows.rows[0]!.ip_count >= 20 || rows.rows[0]!.email_count >= 5)
          return 'THROTTLED';
        const id = randomUUID();
        await sql`insert into auth.login_attempt(id,ip_digest,email_digest,success) values (${id}::uuid,${digest(ip)},${digest(email)},false)`.execute(
          tx,
        );
        return id;
      });
    } catch {
      return 'UNAVAILABLE';
    }
  }

  private async principal(
    userId: string,
    email: string,
    sessionId: string,
  ): Promise<Principal> {
    const roles = await sql<{
      role_code: Role;
    }>`select role_code from auth.role_assignment where user_id=${userId}::uuid order by role_code`.execute(
      this.db,
    );
    return {
      userId,
      email,
      roles: roles.rows.map((r) => r.role_code),
      sessionId,
    };
  }

  async provision(
    email: string,
    password: string,
    roles: Role[],
  ): Promise<{ id: string; email: string; roles: Role[] }> {
    const normalized = email.trim().toLowerCase();
    if (
      normalized.length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ||
      password.length < 12 ||
      password.length > 512 ||
      roles.length === 0 ||
      roles.length > 3 ||
      !roles.every(isRole)
    )
      throw authError('INVALID_USER', 400);
    const id = randomUUID();
    const salt = randomBytes(16);
    const passwordHash = `scrypt$${salt.toString('hex')}$${(await scrypt(password, salt)).toString('hex')}`;
    try {
      await this.db.transaction().execute(async (tx) => {
        await sql`insert into auth.user_account(id,email,password_hash) values (${id}::uuid,${normalized},${passwordHash})`.execute(
          tx,
        );
        for (const role of new Set(roles))
          await sql`insert into auth.role_assignment(id,user_id,role_code) values (${randomUUID()}::uuid,${id}::uuid,${role})`.execute(
            tx,
          );
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      )
        throw authError('USER_EXISTS', 409);
      throw error;
    }
    return { id, email: normalized, roles: [...new Set(roles)] };
  }
}

async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const match = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  const salt = Buffer.from(match?.[1] ?? '0'.repeat(32), 'hex');
  const expected = Buffer.from(match?.[2] ?? '0'.repeat(128), 'hex');
  const actual = await scrypt(password, salt);
  return timingSafeEqual(expected, actual) && Boolean(match);
}
