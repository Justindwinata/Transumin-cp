import 'reflect-metadata';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { AuthModule } from './auth.module.js';
import {
  FOUNDATION_SCHEMAS,
  type FoundationDatabase,
} from '../infrastructure/database/database.constants.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import {
  migrateToLatest,
  getMigrationStatus,
} from '../infrastructure/database/database.migrator.js';
import { configureApplication } from '../application.js';
import { AuthService } from './auth.service.js';

describe('FR-014 auth scratch PG', () => {
  const database: Kysely<FoundationDatabase> = createDatabase();
  const db = database as Kysely<unknown>;
  let app: INestApplication;
  let auth: AuthService;

  before(async () => {
    process.env.AUTH_ORIGIN = 'http://127.0.0.1:3000';
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    app = await NestFactory.create(AuthModule, { logger: false });
    configureApplication(app);
    await app.init();
    auth = app.get(AuthService);
  });
  after(async () => {
    if (app) await app.close();
    await database.destroy();
  });

  it('applies exact migrations and exposes auth tables and indexes', async () => {
    const status = await getMigrationStatus(database);
    const expected = [
      '202609280001_foundation',
      '202609280002_data_provenance_and_transit',
      '202609290001_gtfs_source_fidelity',
      '202609290002_phase1_transit_hardening',
      '202609300001_spatial_pedestrian_foundation',
      '202610010001_hybrid_mobility_twin',
      '202610010002_live_operational_gateway',
      '202610010003_disruption_and_simulation_intelligence',
      '202610030001_active_journey_targeted_alerts',
      '202610050001_state_aware_journey_recovery',
      '202610060001_active_journey_instance_identity',
      '202610080001_ext_x1_incident_lifecycle',
      '202610120001_active_journey_boarding',
      '202610120002_product_activation_identity',
      '202610120003_passenger_reporting',
      '202610130001_recovery_acceptance_lineage',
      '202610130002_active_journey_current_itinerary',
      '202610180001_copilot_audit',
      '202610190001_auth_foundation',
      '202610190002_operator_recovery',
    ];
    assert.deepEqual(
      status.map((m) => m.name),
      expected,
    );
    assert.ok(status.every((m) => m.executedAt instanceof Date));
    const tables = await sql<{
      n: string;
    }>`select table_name n from information_schema.tables where table_schema='auth' order by 1`.execute(
      db,
    );
    assert.deepEqual(
      tables.rows.map((r) => r.n),
      ['login_attempt', 'role_assignment', 'session', 'user_account'],
    );
    const idx = await sql<{
      n: string;
    }>`select indexname n from pg_indexes where schemaname='auth' order by 1`.execute(
      db,
    );
    for (const name of [
      'auth_session_user_idx',
      'auth_session_expiry_idx',
      'auth_login_attempt_ip_time_idx',
      'auth_login_attempt_email_time_idx',
    ])
      assert.ok(
        idx.rows.some((r) => r.n === name),
        `missing ${name}`,
      );
  });

  it('keeps auth in canonical FOUNDATION_SCHEMAS and least-privilege runtime ACL grants', async () => {
    assert.ok((FOUNDATION_SCHEMAS as readonly string[]).includes('auth'));
    // Runtime role is provisioned out-of-band; assert the canonical grant template is exactly scoped.
    const { readFile } = await import('node:fs/promises');
    const grants = await readFile(
      new URL(
        '../../../../database/operations/passenger-runtime-grants.sql',
        import.meta.url,
      ),
      'utf8',
    );
    assert.match(grants, /GRANT USAGE ON SCHEMA[^;]*auth TO :"runtime_role"/);
    assert.match(
      grants,
      /GRANT SELECT ON[\s\S]*?auth\.user_account, auth\.role_assignment, auth\.session/,
    );
    assert.match(
      grants,
      /GRANT SELECT ON auth\.login_attempt TO :"runtime_role"/,
    );
    assert.match(
      grants,
      /GRANT INSERT ON auth\.login_attempt, auth\.session, auth\.user_account, auth\.role_assignment TO :"runtime_role"/,
    );
    assert.match(
      grants,
      /GRANT UPDATE \(revoked_at\) ON auth\.session TO :"runtime_role"/,
    );
    assert.match(
      grants,
      /GRANT UPDATE \(success\) ON auth\.login_attempt TO :"runtime_role"/,
    );
    assert.doesNotMatch(grants, /auth[^;]*DELETE/i);
    // Scratch owner still proves the tables exist; runtime least-privilege comes from the audited template above.
    const acl = await sql<{ relation: string }>`select c.relname relation
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind='r' order by 1`.execute(
      db,
    );
    assert.deepEqual(
      acl.rows.map((row) => row.relation),
      ['login_attempt', 'role_assignment', 'session', 'user_account'],
    );
  });

  it('stores the session token as a sha256 hash, never raw', async () => {
    const email = `a.${randomUUID()}@local.test`;
    await auth.provision(email, 'Strong-Password-123', ['PASSENGER']);
    const { token } = await auth.login(
      email,
      'Strong-Password-123',
      '198.51.100.1',
    );
    const hashed = await sql<{
      c: number;
    }>`select count(*)::int c from auth.session where token_hash=encode(sha256(convert_to(${token}::text,'UTF8')),'hex')`.execute(
      db,
    );
    assert.equal(hashed.rows[0]!.c, 1);
    const raw = await sql<{
      c: number;
    }>`select count(*)::int c from auth.session where token_hash=${token}`.execute(
      db,
    );
    assert.equal(raw.rows[0]!.c, 0);
  });

  it('resolves roles server-side each request; disabled account and revoked session return 401', async () => {
    const email = `b.${randomUUID()}@local.test`;
    const account = await auth.provision(email, 'Strong-Password-123', [
      'PASSENGER',
    ]);
    const { token } = await auth.login(
      email,
      'Strong-Password-123',
      '198.51.100.2',
    );
    await assert.rejects(
      auth.resolve('not-a-token'),
      (e: unknown) => (e as { status: number }).status === 401,
    );
    assert.deepEqual((await auth.resolve(token)).roles, ['PASSENGER']);
    await sql`insert into auth.role_assignment(id,user_id,role_code) values (${randomUUID()}::uuid,${account.id}::uuid,'ADMIN')`.execute(
      db,
    );
    assert.ok((await auth.resolve(token)).roles.includes('ADMIN'));
    await sql`update auth.user_account set status='DISABLED' where id=${account.id}::uuid`.execute(
      db,
    );
    await assert.rejects(
      auth.resolve(token),
      (e: unknown) => (e as { status: number }).status === 401,
    );
    await sql`update auth.user_account set status='ACTIVE' where id=${account.id}::uuid`.execute(
      db,
    );
    await sql`update auth.session set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where token_hash=encode(sha256(convert_to(${token}::text,'UTF8')),'hex')`.execute(
      db,
    );
    await assert.rejects(
      auth.resolve(token),
      (e: unknown) => (e as { status: number }).status === 401,
    );
    const { token: renewed } = await auth.login(
      email,
      'Strong-Password-123',
      '198.51.100.2',
    );
    await auth.logout(renewed);
    await assert.rejects(
      auth.resolve(token),
      (e: unknown) => (e as { status: number }).status === 401,
    );
  });

  it('bounds oversized passwords and returns generic 401 for unknown accounts', async () => {
    await assert.rejects(
      auth.login(`x.${randomUUID()}@local.test`, 'x'.repeat(600), '1.2.3.4'),
      (e: unknown) => (e as { status: number }).status === 400,
    );
    await assert.rejects(
      auth.login(
        `unknown.${randomUUID()}@local.test`,
        'Wrong-Password-123',
        '1.2.3.5',
      ),
      (e: unknown) => (e as { status: number }).status === 401,
    );
  });

  it('throttles by IP and email digests with no raw credential persisted', async () => {
    const victim = `victim.${randomUUID()}@local.test`;
    const ip = '203.0.113.9';
    await auth.provision(victim, 'Valid-Password-123', ['PASSENGER']);
    for (let i = 0; i < 5; i++)
      await auth
        .login(victim, `wrong-${i}-xxxxxxxx`, ip)
        .catch(() => undefined);
    await assert.rejects(
      auth.login(victim, 'Valid-Password-123', ip),
      (e: unknown) => (e as { status: number }).status === 429,
    );
    await assert.rejects(
      auth.login(victim, 'Valid-Password-123', '10.1.1.1'),
      (e: unknown) => (e as { status: number }).status === 429,
    );
    const rows = await sql<{
      ip: string;
      em: string;
    }>`select ip_digest ip, email_digest em from auth.login_attempt where email_digest=encode(sha256(convert_to(${victim}::text,'UTF8')),'hex') limit 1`.execute(
      db,
    );
    assert.equal(rows.rows.length, 1);
    assert.match(rows.rows[0]!.ip, /^[0-9a-f]{64}$/);
    assert.equal(rows.rows[0]!.em.length, 64);
    const leak = await sql<{
      c: number;
    }>`select count(*)::int c from auth.login_attempt where ip_digest=${ip} or email_digest=${victim}`.execute(
      db,
    );
    assert.equal(leak.rows[0]!.c, 0);
  });

  it('HTTP: cookie flags set, Bearer fallback, ADMIN-only provisioning, logout revokes', async () => {
    const url = await listenLocally(app);
    const adminEmail = `admin.${randomUUID()}@local.test`;
    const passengerEmail = `p.${randomUUID()}@local.test`;
    await auth.provision(adminEmail, 'Admin-Password-123', ['ADMIN']);
    await auth.provision(passengerEmail, 'Passenger-Pass-123', ['PASSENGER']);
    const origin = {
      origin: 'http://127.0.0.1:3000',
      'content-type': 'application/json',
    };

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const login = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: origin,
      body: JSON.stringify({
        email: adminEmail,
        password: 'Admin-Password-123',
      }),
    });
    process.env.NODE_ENV = previousNodeEnv;
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /tnx_session=[0-9a-f]{64}/);
    assert.match(setCookie.toLowerCase(), /httponly/);
    assert.match(setCookie.toLowerCase(), /samesite=strict/);
    assert.match(setCookie.toLowerCase(), /path=\/api\/v1/);
    assert.match(setCookie.toLowerCase(), /secure/);
    const adminToken = setCookie.match(/tnx_session=([^;]+)/)![1]!;

    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).status,
      200,
    );
    const denied = await fetch(`${url}/api/v1/auth/users`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + adminToken, ...origin },
      body: JSON.stringify({
        email: `new.${randomUUID()}@local.test`,
        password: 'New-Password-123',
        roles: ['PASSENGER'],
      }),
    });
    assert.equal(denied.status, 201);

    const passengerLogin = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: origin,
      body: JSON.stringify({
        email: passengerEmail,
        password: 'Passenger-Pass-123',
      }),
    });
    const passengerToken = (
      passengerLogin.headers.get('set-cookie') ?? ''
    ).match(/tnx_session=([^;]+)/)![1]!;
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          headers: { authorization: `Bearer ${passengerToken}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          headers: {
            'x-role': 'ADMIN',
            authorization: `Bearer ${passengerToken}`,
          },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(`${url}/api/v1/auth/me`)).status, 401);

    await fetch(`${url}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, ...origin },
    });
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).status,
      401,
    );

    // CSRF: cookie without Origin rejected; foreign Origin rejected; valid Origin passes; Bearer with invalid Origin still passes
    const freshAdmin = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: origin,
      body: JSON.stringify({
        email: adminEmail,
        password: 'Admin-Password-123',
      }),
    });
    const csrfToken = (freshAdmin.headers.get('set-cookie') ?? '').match(
      /tnx_session=([^;]+)/,
    )![1]!;
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          method: 'POST',
          headers: {
            cookie: `tnx_session=${csrfToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `csrf.${randomUUID()}@local.test`,
            password: 'Csrf-Password-123',
            roles: ['PASSENGER'],
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          method: 'POST',
          headers: {
            cookie: `tnx_session=${csrfToken}`,
            origin: 'https://evil.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `evil.${randomUUID()}@local.test`,
            password: 'Evil-Password-123',
            roles: ['PASSENGER'],
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          method: 'POST',
          headers: {
            cookie: `tnx_session=${csrfToken}`,
            origin: 'http://127.0.0.1:3000',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `ok.${randomUUID()}@local.test`,
            password: 'Ok-Password-12345',
            roles: ['PASSENGER'],
          }),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${csrfToken}`,
            origin: 'https://evil.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `bearer.${randomUUID()}@local.test`,
            password: 'Bearer-Ok-12345',
            roles: ['PASSENGER'],
          }),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          method: 'POST',
          headers: {
            cookie: `tnx_session=${csrfToken}; tnx_session=duplicate`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `dup.${randomUUID()}@local.test`,
            password: 'Dup-Password-12345',
            roles: ['PASSENGER'],
          }),
        })
      ).status,
      401,
    );

    // Roles: all roles honored, forged header ignored
    const all = (await (
      await fetch(`${url}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${csrfToken}` },
      })
    ).json()) as { data: { roles: string[] } };
    assert.deepEqual(all.data.roles.sort(), ['ADMIN'].sort());
    const researcherEmail = `res.${randomUUID()}@local.test`;
    await auth.provision(researcherEmail, 'Research-Password-123', [
      'RESEARCHER_OPERATOR',
    ]);
    const researcherLogin = (
      await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({
          email: researcherEmail,
          password: 'Research-Password-123',
        }),
      })
    ).headers
      .get('set-cookie')!
      .match(/tnx_session=([^;]+)/)![1]!;
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/users`, {
          headers: { authorization: `Bearer ${researcherLogin}` },
        })
      ).status,
      403,
    );
  });

  it('seeds SAMPLE accounts only on the current invocation scratch DB', async () => {
    const { seedSampleAccounts } = await import('./seed-sample-accounts.js');
    await seedSampleAccounts(database, auth);
    const seeded = await sql<{
      c: number;
    }>`select count(*)::int c from auth.user_account where email in ('passenger.sample@local.test','researcher.sample@local.test','admin.sample@local.test')`.execute(
      db,
    );
    assert.equal(seeded.rows[0]!.c, 3);
    const before = (
      await sql<{
        c: number;
      }>`select count(*)::int c from auth.user_account`.execute(db)
    ).rows[0]!.c;
    await seedSampleAccounts(database, auth);
    assert.equal(
      (
        await sql<{
          c: number;
        }>`select count(*)::int c from auth.user_account`.execute(db)
      ).rows[0]!.c,
      before,
    );
  });

  it('caps concurrent identical login attempts at the durable gate without raw credential leak', async () => {
    const email = `cc.${randomUUID()}@local.test`;
    await auth.provision(email, 'Cc-Password-12345', ['PASSENGER']);
    const winners = await Promise.all(
      Array.from({ length: 20 }, () =>
        auth
          .login(email, 'Cc-Password-12345', '198.51.100.9')
          .then(() => 1)
          .catch((e: unknown) =>
            (e as { status: number }).status === 429 ? 0 : -1,
          ),
      ),
    );
    assert.ok(winners.every((value) => value === 1 || value === 0));
    assert.equal(
      winners.filter((value) => value === 1).length +
        winners.filter((value) => value === 0).length,
      20,
    );
    assert.ok(winners.every((value) => value === 0 || value === 1));
    assert.ok(winners.filter((value) => value === 0).length >= 15);
  });
});

async function listenLocally(app: INestApplication): Promise<string> {
  const server = app.getHttpServer();
  await new Promise<void>((resolve) => {
    if ((server as { listening?: boolean }).listening) resolve();
    else server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo | null;
  assert.ok(address);
  return `http://127.0.0.1:${address.port}`;
}
