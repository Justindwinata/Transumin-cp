import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

import { AppModule } from '../../app.module.js';
import { configureApplication } from '../../application.js';
import { ReadinessController } from '../../health/readiness.controller.js';
import { ReadinessService } from '../../health/readiness.service.js';
import { createDatabase } from './database.client.js';
import {
  FOUNDATION_SCHEMAS,
  type FoundationDatabase,
} from './database.constants.js';
import { getMigrationStatus, migrateToLatest } from './database.migrator.js';
import { assertInvocationScratchDatabase } from './scratch.guard.js';

const unavailableDatabase = new Kysely<FoundationDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: '127.0.0.1',
      port: 1,
      database: 'unavailable',
      user: 'unavailable',
      password: 'unavailable',
      connectionTimeoutMillis: 250,
    }),
  }),
});

@Module({
  controllers: [ReadinessController],
  providers: [
    {
      provide: ReadinessService,
      useFactory: () => new ReadinessService(unavailableDatabase),
    },
  ],
})
class UnavailableReadinessTestModule {}

async function listenLocally(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address !== null);
  return `http://127.0.0.1:${address.port}`;
}

describe('PostgreSQL/PostGIS foundation', () => {
  const database = createDatabase();

  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
  });

  after(async () => {
    await database.destroy();
    await unavailableDatabase.destroy();
  });

  it('connects to PostgreSQL and executes a real PostGIS geometry operation', async () => {
    const result = await sql<{
      postgresVersion: string;
      postgisVersion: string;
      geometryText: string;
      srid: number;
    }>`
      select
        current_setting('server_version') as "postgresVersion",
        PostGIS_Lib_Version() as "postgisVersion",
        ST_AsText(ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326)) as "geometryText",
        ST_SRID(ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326)) as srid
    `.execute(database);
    const row = result.rows[0];

    assert.ok(row !== undefined);
    assert.match(row.postgresVersion, /^17\./);
    assert.match(row.postgisVersion, /^3\.6/);
    assert.equal(row.geometryText, 'POINT(106.8456 -6.2088)');
    assert.equal(row.srid, 4326);
  });

  it('applies the initial migration once and exposes every canonical logical schema', async () => {
    const secondRun = await migrateToLatest(database);
    const status = await getMigrationStatus(database);
    const schemas = await sql<{ schemaName: string }>`
      select schema_name as "schemaName"
      from information_schema.schemata
      where schema_name in (
        'meta', 'transit', 'spatial', 'twin', 'disruption',
        'simulation', 'journey', 'research', 'auth', 'ai'
      )
      order by schema_name
    `.execute(database);

    const migrationNames = status.map((migration) => migration.name);
    assert.equal(secondRun.length, 0);
    assert.ok(migrationNames.length > 0);
    assert.deepEqual(migrationNames, [...migrationNames].sort());
    assert.equal(new Set(migrationNames).size, migrationNames.length);
    assert.ok(
      status.every((migration) => migration.executedAt instanceof Date),
      'Every discovered migration must be applied',
    );
    const ledger = await sql<{ name: string }>`
      select name from meta.kysely_migration order by name
    `.execute(database);
    assert.deepEqual(
      ledger.rows.map((row) => row.name),
      migrationNames,
      'Applied ledger must equal the migration files discovered in source',
    );
    assert.deepEqual(
      schemas.rows.map((row) => row.schemaName).sort(),
      [...FOUNDATION_SCHEMAS].sort(),
    );
  });

  it('enforces the unvalidated hazard-evidence check on new writes and validates it cleanly', async () => {
    const constraintBefore = await sql<{ validated: boolean }>`
      select convalidated as validated from pg_constraint
      where conrelid='disruption.event'::regclass
        and conname='disruption_event_hazard_evidence_check'
    `.execute(database);
    assert.deepEqual(constraintBefore.rows, [{ validated: false }]);

    await assert.rejects(
      sql`
        insert into disruption.event (
          id, incident_type, source_id, evidence_type, operational_state,
          effective_from, effective_to, received_at, geometry, reason,
          provenance_ref, raw_reference, dedupe_key
        ) values (
          '70000000-0000-4000-8000-000000000001'::uuid, 'FLOOD',
          '70000000-0000-4000-8000-000000000002'::uuid, 'OBSERVED', 'UNKNOWN',
          '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z',
          '2026-10-01T00:01:00Z', ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326),
          'Invalid flood evidence fixture.', 'fixture:hazard-check',
          'fixture:hazard-check', ${'7'.repeat(64)}
        )
      `.execute(database),
      /disruption_event_hazard_evidence_check/,
    );

    await sql`
      alter table disruption.event
      validate constraint disruption_event_hazard_evidence_check
    `.execute(database);
    const constraintAfter = await sql<{ validated: boolean }>`
      select convalidated as validated from pg_constraint
      where conrelid='disruption.event'::regclass
        and conname='disruption_event_hazard_evidence_check'
    `.execute(database);
    assert.deepEqual(constraintAfter.rows, [{ validated: true }]);
  });

  it('serves independent liveness and database-backed readiness endpoints', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    const baseUrl = await listenLocally(app);

    try {
      const [liveness, readiness, prefixedReadiness] = await Promise.all([
        fetch(`${baseUrl}/health/live`),
        fetch(`${baseUrl}/health/ready`),
        fetch(`${baseUrl}/api/v1/health/ready`),
      ]);
      const readinessBody = (await readiness.json()) as {
        status: string;
        dependencies: { database: { status: string; postgis: string } };
      };

      assert.equal(liveness.status, 200);
      assert.equal(readiness.status, 200);
      assert.equal(readinessBody.status, 'ready');
      assert.equal(readinessBody.dependencies.database.status, 'up');
      assert.equal(readinessBody.dependencies.database.postgis, 'available');
      assert.equal(prefixedReadiness.status, 404);
    } finally {
      await app.close();
    }
  });

  it('returns 503 without leaking connection details when PostgreSQL is unavailable', async () => {
    const app = await NestFactory.create(UnavailableReadinessTestModule, {
      logger: false,
    });
    const baseUrl = await listenLocally(app);

    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      const body = (await response.json()) as {
        status: string;
        dependencies: { database: { status: string } };
      };

      assert.equal(response.status, 503);
      assert.equal(body.status, 'not_ready');
      assert.equal(body.dependencies.database.status, 'down');
      assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
    } finally {
      await app.close();
    }
  });
});
