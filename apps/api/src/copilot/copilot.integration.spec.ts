import 'reflect-metadata';
import assert from 'node:assert/strict';
import { CopilotAuditService } from './application/copilot-audit.service.js';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { CopilotController } from './interface/copilot.controller.js';
import { CopilotService } from './application/copilot.service.js';
import type { CopilotAnswer } from './application/copilot.service.js';
import { randomUUID, createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { getDatabaseConfig } from '../infrastructure/database/database.config.js';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import {
  getMigrationStatus,
  migrateToLatest,
} from '../infrastructure/database/database.migrator.js';

describe('FR-010 copilot scratch PG', () => {
  const database = createDatabase();
  const owner = `copilot-owner:${randomUUID()}`;
  const other = `copilot-owner:${randomUUID()}`;

  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
  });
  after(async () => {
    await database.destroy();
  });

  it('migrates clean and exposes copilot session/message/tool_audit', async () => {
    const status = await getMigrationStatus(database);
    assert.ok(
      status.some(
        (m) =>
          m.name === '202610180001_copilot_audit' &&
          m.executedAt instanceof Date,
      ),
    );
    const tables = await sql<{
      n: string;
    }>`select table_name as n from information_schema.tables where table_schema='copilot' order by table_name`.execute(
      database,
    );
    assert.deepEqual(
      tables.rows.map((r) => r.n),
      ['message', 'session', 'tool_audit'],
    );
  });

  it('enforces owner-scoped session/message/tool_audit with request_digest and rejects cross-owner read', async () => {
    const sid = randomUUID();
    const mid = randomUUID();
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          message: 'hi',
          context_references: [`journey:${randomUUID()}`],
        }),
      )
      .digest('hex');
    await sql`insert into copilot.session (id, owner_ref) values (${sid}::uuid, ${owner})`.execute(
      database,
    );
    await sql`insert into copilot.message (id, session_id, owner_ref, request_digest, context_references, answer_text, evidence_type, fallback_status, response_json) values (${mid}::uuid, ${sid}::uuid, ${owner}, ${digest}, '[]'::jsonb, 'answer', 'SCHEDULED', 'DETERMINISTIC_FALLBACK', '{}'::jsonb)`.execute(
      database,
    );
    await sql`insert into copilot.tool_audit (id, message_id, session_id, owner_ref, tool_name, request_digest, result_ref, status, latency_ms) values (${randomUUID()}::uuid, ${mid}::uuid, ${sid}::uuid, ${owner}, 'explainJourneyRoute', ${digest}, 'tool-result:1', 'OK', 5)`.execute(
      database,
    );
    // cross-owner message insert must fail due to session owner FK
    await assert.rejects(
      sql`insert into copilot.message (id, session_id, owner_ref, request_digest, context_references, answer_text, evidence_type, fallback_status, response_json) values (${randomUUID()}::uuid, ${sid}::uuid, ${other}, ${digest}, '[]'::jsonb, 'answer', 'SCHEDULED', 'DETERMINISTIC_FALLBACK', '{}'::jsonb)`.execute(
        database,
      ),
      /copilot_message_session_owner_fk|copilot_session_owner_id_unique/,
    );
    // request_digest format check
    await assert.rejects(
      sql`insert into copilot.message (id, session_id, owner_ref, request_digest, context_references, answer_text, evidence_type, fallback_status, response_json) values (${randomUUID()}::uuid, ${sid}::uuid, ${owner}, 'bad', '[]'::jsonb, 'answer', 'SCHEDULED', 'DETERMINISTIC_FALLBACK', '{}'::jsonb)`.execute(
        database,
      ),
      /copilot_message_request_digest_check/,
    );
  });

  const answer = (): CopilotAnswer => ({
    messageId: randomUUID(),
    answer: 'SIMULATED test answer',
    evidenceType: 'SIMULATED',
    fallbackStatus: 'DETERMINISTIC_FALLBACK',
    evidenceReferences: [],
    toolResultReferences: [],
    toolAudit: [],
    meta: { warnings: ['SIMULATED fixture'], observedAt: null },
  });
  const audit = new CopilotAuditService(database);

  it('reads only owned sessions; rejects foreign, missing and expired sessions without executing tools', async () => {
    const ref = `test:${randomUUID()}`;
    const saved = await audit.record(
      { ownerRef: ref, message: 'SIMULATED', refs: [] },
      async () => answer(),
    );
    const history = await audit.get(saved.sessionId, ref);
    assert.equal((history.messages as unknown[]).length, 1);
    for (const id of [saved.sessionId, randomUUID()]) {
      await assert.rejects(audit.get(id, other), { status: 404 });
      await assert.rejects(
        audit.record(
          { ownerRef: other, sessionId: id, message: 'SIMULATED', refs: [] },
          async () => {
            throw new Error('Tool must not execute');
          },
        ),
        { status: 404 },
      );
    }
    await assert.rejects(audit.get(saved.sessionId, undefined), {
      status: 400,
    });
    await sql`update copilot.session set created_at=now()-interval '91 days', expires_at=now()-interval '1 day' where id=${saved.sessionId}::uuid`.execute(
      database,
    );
    await assert.rejects(audit.get(saved.sessionId, ref), { status: 404 });
    await assert.rejects(
      audit.record(
        {
          ownerRef: ref,
          sessionId: saved.sessionId,
          message: 'SIMULATED',
          refs: [],
        },
        async () => answer(),
      ),
      { status: 404 },
    );
    const retained = await sql<{
      count: number;
    }>`select count(*)::int as count from copilot.message where session_id=${saved.sessionId}::uuid`.execute(
      database,
    );
    assert.equal(retained.rows[0]!.count, 1); // Expiry hides history; not physical deletion.
  });

  it('persists principal-shaped research audit refs and isolates user owners', async () => {
    const user = `user:${randomUUID()}`;
    const foreign = `user:${randomUUID()}`;
    const saved = await audit.record(
      {
        ownerRef: user,
        message: 'Explain simulation run and operator analysis',
        refs: [`simulation-run:${randomUUID()}`],
      },
      async () => answer(),
    );
    assert.equal(
      (await audit.get(saved.sessionId, user)).session_id,
      saved.sessionId,
    );
    await assert.rejects(audit.get(saved.sessionId, foreign), { status: 404 });
    await sql`update copilot.session set created_at=now()-interval '91 days', expires_at=now()-interval '1 day' where id=${saved.sessionId}::uuid`.execute(
      database,
    );
    await assert.rejects(audit.get(saved.sessionId, user), { status: 404 });
  });

  it('serializes concurrent owner quota across sessions without blocking other owners', async () => {
    const ref = `quota:${randomUUID()}`;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 21 }, () =>
        audit.record(
          { ownerRef: ref, message: 'SIMULATED', refs: [] },
          async () => answer(),
        ),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 20);
    const rejected = outcomes.filter((r) => r.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal((rejected[0] as PromiseRejectedResult).reason.status, 429);
    await audit.record(
      { ownerRef: `other:${randomUUID()}`, message: 'SIMULATED', refs: [] },
      async () => answer(),
    );
    const counts = await sql<{
      count: number;
    }>`select count(*)::int as count from copilot.session where owner_ref=${ref}`.execute(
      database,
    );
    assert.equal(counts.rows[0]!.count, 20);
    await sql`update copilot.message set created_at=now()-interval '61 seconds' where owner_ref=${ref}`.execute(
      database,
    );
    await audit.record(
      { ownerRef: ref, message: 'SIMULATED', refs: [] },
      async () => answer(),
    );
  });

  it('rolls back session and message when tool audit persistence fails', async () => {
    const ref = `rollback:${randomUUID()}`;
    await assert.rejects(
      audit.record(
        { ownerRef: ref, message: 'SIMULATED', refs: [] },
        async () => ({
          ...answer(),
          toolAudit: [
            {
              tool: 'explainJourneyRoute',
              resultRef: '',
              status: 'OK',
              latencyMs: 1,
            },
          ],
        }),
      ),
      /copilot_tool_result_ref_check/,
    );
    const rows = await sql<{
      count: number;
    }>`select count(*)::int as count from copilot.session where owner_ref=${ref}`.execute(
      database,
    );
    assert.equal(rows.rows[0]!.count, 0);
  });

  it('runs audit under exact non-owner runtime grants; denies deletion and DDL', async () => {
    const role = `copilot_runtime_${randomUUID().replaceAll('-', '')}`;
    await sql
      .raw(
        `create role ${role} nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      )
      .execute(database);
    await sql.raw(`grant usage on schema copilot to ${role}`).execute(database);
    await sql
      .raw(
        `grant select,insert,update on all tables in schema copilot to ${role}`,
      )
      .execute(database);
    const pool = new Pool({ ...getDatabaseConfig(), max: 1 });
    const runtime = new Kysely<FoundationDatabase>({
      dialect: new PostgresDialect({ pool }),
    });
    try {
      await sql.raw(`set role ${role}`).execute(runtime);
      const service = new CopilotAuditService(runtime);
      const ref = `runtime:${randomUUID()}`;
      const saved = await service.record(
        { ownerRef: ref, message: 'SIMULATED', refs: [] },
        async () => ({
          ...answer(),
          toolAudit: [
            {
              tool: 'explainJourneyRoute',
              resultRef: 'SIMULATED:result',
              status: 'OK',
              latencyMs: 1,
            },
          ],
        }),
      );
      assert.equal(
        ((await service.get(saved.sessionId, ref)).messages as unknown[])
          .length,
        1,
      );
      await assert.rejects(
        sql`delete from copilot.message`.execute(runtime),
        /permission denied/,
      );
      await assert.rejects(
        sql`create table copilot.forbidden(id int)`.execute(runtime),
        /permission denied/,
      );
    } finally {
      await runtime.destroy();
      await sql.raw(`drop owned by ${role}`).execute(database);
      await sql.raw(`drop role ${role}`).execute(database);
    }
  });

  it('GET session HTTP denies missing identity, foreign owner and missing owner', async () => {
    const ref = `http:${randomUUID()}`;
    const saved = await audit.record(
      { ownerRef: ref, message: 'SIMULATED', refs: [] },
      async () => answer(),
    );
    @Module({
      controllers: [CopilotController],
      providers: [
        { provide: CopilotAuditService, useValue: audit },
        { provide: CopilotService, useValue: {} },
      ],
    })
    class TestModule {}
    const prior = process.env.PASSENGER_SERVICE_TOKEN;
    process.env.PASSENGER_SERVICE_TOKEN = 't'.repeat(64);
    const app = await NestFactory.create(TestModule, { logger: false });
    try {
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}/copilot/sessions/${saved.sessionId}`;
      const auth = {
        'x-passenger-service-token': 't'.repeat(64),
        'x-journey-owner': ref,
      };
      assert.equal((await fetch(url)).status, 401);
      assert.equal(
        (
          await fetch(url, {
            headers: {
              'x-passenger-service-token': auth['x-passenger-service-token'],
            },
          })
        ).status,
        400,
      );
      const foreign = await fetch(url, {
        headers: { ...auth, 'x-journey-owner': other },
      });
      assert.equal(foreign.status, 404);
      assert.equal(
        JSON.stringify(await foreign.json()).includes(saved.messageId),
        false,
      );
      const own = await fetch(url, { headers: auth });
      assert.equal(own.status, 200);
      const body = (await own.json()) as {
        data: { messages: { message_id: string }[] };
      };
      assert.equal(body.data.messages[0]!.message_id, saved.messageId);
    } finally {
      await app.close();
      if (prior === undefined) delete process.env.PASSENGER_SERVICE_TOKEN;
      else process.env.PASSENGER_SERVICE_TOKEN = prior;
    }
  });

  it('supports rollback and reapply of copilot audit migration', async () => {
    const status = await getMigrationStatus(database);
    const applied = status.filter((m) => m.executedAt).length;
    // rollback last migration via down
    const mig =
      await import('./../infrastructure/database/migrations/202610180001_copilot_audit.js');
    await mig.down(database as unknown as Kysely<unknown>);
    const missing = await sql<{
      n: string;
    }>`select table_name as n from information_schema.tables where table_schema='copilot'`.execute(
      database,
    );
    assert.equal(missing.rows.length, 0);
    await mig.up(database as unknown as Kysely<unknown>);
    const restored = await sql<{
      n: string;
    }>`select table_name as n from information_schema.tables where table_schema='copilot' order by table_name`.execute(
      database,
    );
    assert.deepEqual(
      restored.rows.map((r) => r.n),
      ['message', 'session', 'tool_audit'],
    );
    assert.equal(
      (await getMigrationStatus(database)).filter((m) => m.executedAt).length,
      applied,
    );
  });
});
