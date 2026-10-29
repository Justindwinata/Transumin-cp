import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { configureApplication } from '../application.js';
import { AuthService, type Role } from '../auth/auth.service.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import {
  getMigrationStatus,
  migrateToLatest,
} from '../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { OperatorRecoveryModule } from './operator-recovery.module.js';
import type { OperatorAnalysis } from './domain/operator-recovery.js';

// SAMPLE topology/timings, not an official TransJakarta schedule or flood observation.
const source = randomUUID();
const version = randomUUID();
const operator = randomUUID();
const route = randomUUID();
const snapshot = randomUUID();
const calendar = randomUUID();
const stops = Array.from({ length: 4 }, () => randomUUID());
const segments = [0, 1].map(() =>
  Array.from({ length: 3 }, () => randomUUID()),
);
const trips = [randomUUID(), randomUUID()];
const expectedMigrations = [
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

describe('FR-007 SAMPLE scratch PostgreSQL/PostGIS HTTP integration', () => {
  const database = createDatabase();
  let app: INestApplication | undefined;
  let base: string;
  let ownerToken: string;
  let otherToken: string;
  let passengerToken: string;
  const input = () => ({
    route_id: route,
    network_snapshot_id: snapshot,
    blocked_transit_segment_ids: [segments[0]![1]!],
    target_headway_seconds: 300,
    turnaround_buffer_seconds: 60,
  });
  const post = (
    token?: string,
    key = randomUUID(),
    body: Record<string, unknown> = input(),
  ) =>
    fetch(`${base}/api/v1/operator-recovery/analyses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': key,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const noKeyPost = (token: string, body: Record<string, unknown> = input()) =>
    fetch(`${base}/api/v1/operator-recovery/analyses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const get = (id: string, token?: string) =>
    fetch(`${base}/api/v1/operator-recovery/analyses/${id}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  async function data(response: Response): Promise<OperatorAnalysis> {
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: OperatorAnalysis }).data;
  }

  before(async () => {
    await assertInvocationScratchDatabase(database); // Must precede migrations AND every fixture write.
    await migrateToLatest(database);
    await fixture();
    app = await NestFactory.create(OperatorRecoveryModule, { logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const auth = app.get(AuthService);
    async function token(roles: Role[], suffix: string): Promise<string> {
      const email = `sample.fr007.${suffix}.${randomUUID()}@local.test`;
      await auth.provision(email, 'SAMPLE-Test-Password-123', roles);
      return (
        await auth.login(
          email,
          'SAMPLE-Test-Password-123',
          `sample-fr007-${suffix}`,
        )
      ).token;
    }
    ownerToken = await token(['RESEARCHER_OPERATOR'], 'owner');
    otherToken = await token(['RESEARCHER_OPERATOR'], 'other');
    passengerToken = await token(['PASSENGER'], 'passenger');
  });
  after(async () => {
    if (app) await app.close();
    await database.destroy(); // Harness owns scratch deletion; finalized evidence stays immutable.
  });

  it('applies exactly the coordinated 20 migrations and uses PostGIS', async () => {
    const files = (
      await readdir(
        new URL('../infrastructure/database/migrations/', import.meta.url),
      )
    )
      .filter((file) => file.endsWith('.ts'))
      .map((file) => file.slice(0, -3))
      .sort();
    assert.deepEqual(files, expectedMigrations);
    const status = await getMigrationStatus(database);
    assert.deepEqual(
      status.map((entry) => entry.name),
      expectedMigrations,
    );
    assert.ok(status.every((entry) => entry.executedAt instanceof Date));
    const spatial = await sql<{
      length: number;
    }>`select ST_Length(geom::geography) as length from transit.transit_segment where id=${segments[0]![0]!}::uuid`.execute(
      database,
    );
    assert.ok(spatial.rows[0]!.length > 100);
  });

  it('HTTP rejects anonymous and passenger callers; spoofed role headers never authorize', async () => {
    assert.equal((await post()).status, 401);
    assert.equal((await get(randomUUID())).status, 401);
    assert.equal((await post(passengerToken)).status, 403);
    const spoof = await fetch(
      `${base}/api/v1/operator-recovery/analyses/${randomUUID()}`,
      {
        headers: {
          authorization: `Bearer ${passengerToken}`,
          'x-role': 'RESEARCHER_OPERATOR',
        },
      },
    );
    assert.equal(spoof.status, 403);
  });

  it('requires an idempotency key and validates request shape before analysis', async () => {
    const missingKey = await noKeyPost(ownerToken);
    assert.equal(missingKey.status, 422);
    assert.match(await missingKey.text(), /Idempotency-Key/i);
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          blocked_transit_segment_ids: [],
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          unknown_field: true,
        })
      ).status,
      422,
    );
  });

  it('populates split/cut/fleet through real adapter, replays receipts, and isolates owners', async () => {
    const key = randomUUID();
    const first = await data(await post(ownerToken, key));
    assert.deepEqual(first.upstream_service, [segments[0]![0]]);
    assert.deepEqual(first.downstream_service, [segments[0]![2]]);
    assert.equal(first.cut_point_candidate, stops[1]);
    assert.equal(first.restart_point_candidate, stops[2]);
    assert.equal(first.estimated_vehicle_requirement, 4);
    assert.equal(first.validation_status, 'REQUIRES_OPERATOR_VALIDATION');
    assert.equal(first.provenance.evidence_type, 'SCHEDULED');
    assert.equal(
      first.assumptions.fleet_source,
      'GTFS stop_time running time, both directions',
    );
    assert.deepEqual(await data(await post(ownerToken, key)), first);
    const own = await get(first.analysis_id, ownerToken);
    assert.equal(own.status, 200);
    assert.deepEqual(
      ((await own.json()) as { data: OperatorAnalysis }).data,
      first,
    );
    assert.equal((await get(first.analysis_id, otherToken)).status, 404);
    const separate = await data(await post(otherToken, key));
    assert.notEqual(separate.analysis_id, first.analysis_id);
    const conflict = await post(ownerToken, key, {
      ...input(),
      target_headway_seconds: 301,
    });
    assert.equal(conflict.status, 409);
    assert.equal(
      ((await conflict.json()) as { error: { code: string } }).error.code,
      'CONFLICT',
    );
  });

  it('concurrent same-key replay returns one persisted receipt; conflicting concurrent payload loses with 409', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => post(ownerToken, key).then(data)),
    );
    assert.ok(
      results.every((result) => result.analysis_id === results[0]!.analysis_id),
    );
    const count = await sql<{
      n: number;
    }>`select count(*)::int n from recovery.operator_recovery_plan where idempotency_key=${key}`.execute(
      database,
    );
    assert.equal(count.rows[0]!.n, 1);
    const conflictKey = randomUUID();
    const responses = await Promise.all([
      post(ownerToken, conflictKey),
      post(ownerToken, conflictKey, {
        ...input(),
        target_headway_seconds: 301,
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409],
    );
    await Promise.all(responses.map((response) => response.text()));
  });

  it('validates references and bounds, keeps fleet null without reverse timing', async () => {
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          network_snapshot_id: randomUUID(),
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          target_headway_seconds: 0,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          turnaround_buffer_seconds: 7201,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          temporary_bridge_resource: {
            mode: 'BUS',
            vehicle_count: -1,
            cycle_time_seconds: 300,
          },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await post(ownerToken, randomUUID(), {
          ...input(),
          blocked_transit_segment_ids: [randomUUID()],
        })
      ).status,
      422,
    );
    await sql`delete from transit.stop_time where trip_id=${trips[1]!}::uuid`.execute(
      database,
    );
    const result = await data(await post(ownerToken));
    assert.equal(result.estimated_vehicle_requirement, null);
    assert.equal(result.cut_point_candidate, stops[1]);
  });

  async function fixture(): Promise<void> {
    await sql`insert into meta.dataset_source (id,source_key,name,provider,source_type,license_name,verification_status)
      values (${source}::uuid,'SAMPLE-fr007','SAMPLE FR-007 topology','SAMPLE','TEST_FIXTURE','TEST-ONLY','NOT_VERIFIED')`.execute(
      database,
    );
    await sql`insert into meta.dataset_version (id,source_id,version_label,checksum_sha256,retrieved_at,raw_path_ref,manifest_path,validation_status)
      values (${version}::uuid,${source}::uuid,'SAMPLE-fr007-v1',${'f'.repeat(64)},now(),'SAMPLE:fr007','SAMPLE:fr007','VALID')`.execute(
      database,
    );
    await sql`insert into transit.operator (id,dataset_version_id,external_id,code,name,mode_group)
      values (${operator}::uuid,${version}::uuid,'SAMPLE','SAMPLE','SAMPLE TransJakarta','BUS')`.execute(
      database,
    );
    const routeEntity = randomUUID();
    await sql`insert into twin.mobility_entity (id,entity_type,creation_dataset_version_id) values (${routeEntity}::uuid,'ROUTE',${version}::uuid)`.execute(
      database,
    );
    await sql`insert into transit.route (id,mobility_entity_id,dataset_version_id,operator_id,external_id,short_name,mode)
      values (${route}::uuid,${routeEntity}::uuid,${version}::uuid,${operator}::uuid,'SAMPLE','SAMPLE','TRANSJAKARTA')`.execute(
      database,
    );
    for (const [i, stop] of stops.entries()) {
      const entity = randomUUID();
      await sql`insert into twin.mobility_entity (id,entity_type,creation_dataset_version_id) values (${entity}::uuid,'STOP',${version}::uuid)`.execute(
        database,
      );
      await sql`insert into transit.stop (id,mobility_entity_id,dataset_version_id,external_id,name,geom)
        values (${stop}::uuid,${entity}::uuid,${version}::uuid,${`SAMPLE-${i}`},${`SAMPLE Stop ${i}`},ST_SetSRID(ST_MakePoint(${106.8 + i * 0.01},-6.2),4326))`.execute(
        database,
      );
    }
    await sql`insert into transit.service_calendar (id,dataset_version_id,operator_id,service_code,start_date,end_date,monday,tuesday,wednesday,thursday,friday,saturday,sunday)
      values (${calendar}::uuid,${version}::uuid,${operator}::uuid,'SAMPLE','2026-01-01','2026-12-31',true,true,true,true,true,true,true)`.execute(
      database,
    );
    for (const direction of [0, 1]) {
      const order = direction === 0 ? stops : [...stops].reverse();
      const times = direction === 0 ? [0, 120, 300, 450] : [0, 160, 350, 480];
      await sql`insert into transit.trip (id,dataset_version_id,route_id,service_calendar_id,external_id,direction_id)
        values (${trips[direction]!}::uuid,${version}::uuid,${route}::uuid,${calendar}::uuid,${`SAMPLE-${direction}`},${direction})`.execute(
        database,
      );
      for (let i = 0; i < 4; i++) {
        await sql`insert into transit.stop_time (id,dataset_version_id,trip_id,stop_id,stop_sequence,arrival_seconds,departure_seconds)
          values (${randomUUID()}::uuid,${version}::uuid,${trips[direction]!}::uuid,${order[i]!}::uuid,${i},${times[i]!},${times[i]!})`.execute(
          database,
        );
        if (i === 3) continue;
        const entity = randomUUID();
        await sql`insert into twin.mobility_entity (id,entity_type,creation_dataset_version_id) values (${entity}::uuid,'TRANSIT_SEGMENT',${version}::uuid)`.execute(
          database,
        );
        await sql`insert into transit.transit_segment (id,mobility_entity_id,dataset_version_id,route_id,from_stop_id,to_stop_id,direction_id,geom)
          select ${segments[direction]![i]!}::uuid,${entity}::uuid,${version}::uuid,${route}::uuid,a.id,b.id,${direction},ST_MakeLine(a.geom,b.geom)
          from transit.stop a,transit.stop b where a.id=${order[i]!}::uuid and b.id=${order[i + 1]!}::uuid`.execute(
          database,
        );
        await sql`insert into transit.trip_segment_traversal (id,dataset_version_id,transit_segment_id,trip_id,route_id,from_stop_id,to_stop_id,direction_id,segment_sequence,geom)
          select ${randomUUID()}::uuid,dataset_version_id,id,${trips[direction]!}::uuid,route_id,from_stop_id,to_stop_id,direction_id,${i},geom
          from transit.transit_segment where id=${segments[direction]![i]!}::uuid`.execute(
          database,
        );
      }
    }
    await sql`insert into twin.network_snapshot (id,transit_dataset_version_id,spatial_dataset_version_id,processing_version,state_cutoff_at,manifest_ref,content_hash,status,finalized_at)
      values (${snapshot}::uuid,${version}::uuid,${version}::uuid,'SAMPLE-FR007',now(),'SAMPLE:fr007',${'e'.repeat(64)},'FINALIZED',now())`.execute(
      database,
    );
  }
});
