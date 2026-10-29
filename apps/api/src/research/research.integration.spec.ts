import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { configureApplication } from '../application.js';
import { AuthService } from '../auth/auth.service.js';
import { ResearchModule } from './research.module.js';
import { ResearchReadModel } from './research.read-model.js';

// SIMULATED fixtures only; never product data. Suite owns and removes scratch DB.
describe('FR-011/FR-013 research scratch PG', () => {
  const db = createDatabase();
  const read = new ResearchReadModel(db);
  const source = randomUUID();
  const transit = randomUUID();
  const spatial = randomUUID();
  const other = randomUUID();
  const snapshot = randomUUID();
  let app: INestApplication;
  let base: string;
  before(async () => {
    await assertInvocationScratchDatabase(db);
    await migrateToLatest(db);
    await sql`insert into meta.dataset_source(id,source_key,name,provider,source_type,verification_status) values (${source}::uuid,'research-simulated','SIMULATED research fixture','TEST','CONTROLLED_REPLAY','VERIFIED')`.execute(
      db,
    );
    for (const [index, version] of [transit, spatial, other].entries()) {
      await sql`insert into meta.dataset_version(id,source_id,version_label,checksum_sha256,retrieved_at,raw_path_ref,manifest_path,validation_status) values (${version}::uuid,${source}::uuid,${`SIMULATED-${index}`},${String(index).repeat(64)},now(),'fixture:research','fixture:research','VALID')`.execute(
        db,
      );
    }
    await sql`insert into twin.network_snapshot(id,transit_dataset_version_id,spatial_dataset_version_id,processing_version,state_cutoff_at,manifest_ref,content_hash,status,finalized_at) values (${snapshot}::uuid,${transit}::uuid,${spatial}::uuid,'SIMULATED',now(),'fixture:research',${'f'.repeat(64)},'FINALIZED',now())`.execute(
      db,
    );
    app = await NestFactory.create(ResearchModule, { logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  after(async () => {
    if (app) await app.close();
    await db.destroy();
  });

  it('reads empty lists and absent experiment schema honestly', async () => {
    assert.deepEqual(await read.scenarios(), { data: [], next_cursor: null });
    assert.deepEqual(await read.runs(), { data: [], next_cursor: null });
    assert.equal(
      (await read.experiments()).availability,
      'EXPERIMENT_SCHEMA_NOT_INSTALLED',
    );
  });

  it('paginates filled scenarios/runs with exact frontend identifiers', async () => {
    // Same millisecond, distinct microseconds: cursor must preserve PG precision.
    for (let i = 0; i < 3; i++) {
      const scenario = randomUUID();
      await sql`insert into simulation.scenario(id,name,created_at) values (${scenario}::uuid,${`SIMULATED-${i}`},'2026-10-19 00:00:00.123456+00'::timestamptz + ${i} * interval '1 microsecond')`.execute(
        db,
      );
      await sql`insert into simulation.run(id,scenario_id,network_snapshot_id,status,idempotency_key,request_hash,configuration_json,engine_version,provenance_ref,created_at) values (${randomUUID()}::uuid,${scenario}::uuid,${snapshot}::uuid,'PENDING',${`SIMULATED-${i}`},'fixture','{}','SIMULATED','fixture:research','2026-10-19 00:00:00.123456+00'::timestamptz + ${i} * interval '1 microsecond')`.execute(
        db,
      );
    }
    for (const list of [read.scenarios.bind(read), read.runs.bind(read)]) {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list('1', cursor);
        assert.equal(page.data.length, 1);
        const row = page.data[0]!;
        ids.push(
          'simulation_run_id' in row ? row.simulation_run_id : row.scenario_id,
        );
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      assert.equal(new Set(ids).size, 3);
    }
    await assert.rejects(read.scenarios('101'), /limit/);
    await assert.rejects(read.runs('0'), /limit/);
    const scenarioPage = await read.scenarios('1');
    await assert.rejects(read.runs('1', scenarioPage.next_cursor!), /cursor/);
  });

  it('aligns geometry to finalized snapshot datasets, clips lines and caps at 5000', async () => {
    // Stops use transit version; rail lines use spatial version; unrelated version excluded.
    for (const version of [transit, other]) {
      const entity = randomUUID();
      await sql`insert into twin.mobility_entity(id,entity_type,creation_dataset_version_id) values (${entity}::uuid,'STOP',${version}::uuid)`.execute(
        db,
      );
      await sql`insert into transit.stop(id,mobility_entity_id,dataset_version_id,external_id,name,geom) values (${randomUUID()}::uuid,${entity}::uuid,${version}::uuid,'fixture','SIMULATED stop',ST_SetSRID(ST_MakePoint(106.8,-6.2),4326))`.execute(
        db,
      );
    }
    await sql`insert into twin.mobility_entity(id,entity_type,creation_dataset_version_id) select md5('research-rail-'||n)::uuid,'RAIL_TOPOLOGY_EDGE',${spatial}::uuid from generate_series(1,5001) n`.execute(
      db,
    );
    await sql`insert into spatial.rail_topology_edge(id,mobility_entity_id,dataset_version_id,operator_key,external_way_id,rail_class,geom) select md5('research-rail-row-'||n)::uuid,md5('research-rail-'||n)::uuid,${spatial}::uuid,'SIMULATED',n::text,'RAIL',ST_GeomFromText('LINESTRING(106.7 -6.2,106.9 -6.2)',4326) from generate_series(1,5001) n`.execute(
      db,
    );
    const result = await read.geometry(snapshot, '106.79,-6.21,106.81,-6.19');
    assert.equal(result.features.length, 5000);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.dataset_version_ids, [transit, spatial]);
    const features = result.features as {
      geometry: { type: string; coordinates: number[][] };
      properties: { kind: string };
    }[];
    const line = features.find(
      (f) => f.properties.kind === 'rail_topology_edge',
    )!;
    assert.deepEqual(line.geometry.coordinates, [
      [106.79, -6.2],
      [106.81, -6.2],
    ]);
    assert.equal(
      features.filter((f) => f.properties.kind === 'stop').length,
      1,
    );
    assert.equal(
      (await read.geometry(snapshot, '100,-7,101,-6')).features.length,
      0,
    );
    assert.equal(
      (await read.geometry(randomUUID())).coverage,
      'SNAPSHOT_NOT_FOUND_OR_NOT_FINALIZED',
    );
    const draft = randomUUID();
    await sql`insert into twin.network_snapshot(id,transit_dataset_version_id,spatial_dataset_version_id,processing_version,state_cutoff_at,manifest_ref,content_hash,status) values (${draft}::uuid,${transit}::uuid,${spatial}::uuid,'SIMULATED',now(),'fixture:draft',${'e'.repeat(64)},'DRAFT')`.execute(
      db,
    );
    assert.equal((await read.geometry(draft)).features.length, 0);
  });

  it('returns installed experiment records, empty availability and bounded pages', async () => {
    // Test-only prospective shape; not research methodology or production migration.
    await sql`create table research.experiment_run(id uuid primary key,created_at timestamptz not null,manifest_ref text not null)`.execute(
      db,
    );
    assert.equal(
      (await read.experiments()).availability,
      'NO_RECORDED_EXPERIMENT_RUNS',
    );
    for (let n = 0; n < 3; n++)
      await sql`insert into research.experiment_run values (${randomUUID()}::uuid,now()+${n}*interval '1 second','fixture:SIMULATED')`.execute(
        db,
      );
    const first = await read.experiments('2');
    assert.equal(first.data.length, 2);
    assert.equal(first.availability, 'AVAILABLE');
    const last = await read.experiments('2', first.next_cursor!);
    assert.equal(last.data.length, 1);
    assert.equal(last.next_cursor, null);
    assert.equal(first.data[0]?.manifest_ref, 'fixture:SIMULATED');
  });

  it('enforces HTTP 401/403 and permits researcher/admin across research routes', async () => {
    const auth = app.get(AuthService);
    const paths = [
      'scenarios',
      'simulation-runs',
      'experiments',
      `network/snapshots/${snapshot}/geometry`,
    ];
    for (const path of paths)
      assert.equal((await fetch(`${base}/${path}`)).status, 401);
    for (const role of ['PASSENGER', 'RESEARCHER_OPERATOR', 'ADMIN'] as const) {
      const email = `${role.toLowerCase()}@research.example`;
      await auth.provision(email, 'Research-Password-123', [role]);
      const { token } = await auth.login(
        email,
        'Research-Password-123',
        `fixture-${role}`,
      );
      for (const path of paths) {
        const response = await fetch(`${base}/${path}`, {
          headers: { cookie: `tnx_session=${token}` },
        });
        assert.equal(
          response.status,
          role === 'PASSENGER' ? 403 : 200,
          `${role} ${path}`,
        );
      }
    }
  });
});
