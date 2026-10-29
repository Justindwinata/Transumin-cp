import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';

import { AppModule } from '../app.module.js';
import { configureApplication } from '../application.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';

const ids = {
  source: randomUUID(),
  secondSource: randomUUID(),
  version: randomUUID(),
  secondVersion: randomUUID(),
  ingestionRun: randomUUID(),
  operator: randomUUID(),
  secondVersionOperator: randomUUID(),
  station: randomUUID(),
  stationEntity: randomUUID(),
  stopA: randomUUID(),
  stopAEntity: randomUUID(),
  stopB: randomUUID(),
  stopBEntity: randomUUID(),
  route: randomUUID(),
  routeEntity: randomUUID(),
  wrongRouteEntity: randomUUID(),
  crossVersionRouteEntity: randomUUID(),
  service: randomUUID(),
  shape: randomUUID(),
  trip: randomUUID(),
  stopTime: randomUUID(),
  transfer: randomUUID(),
  transferEntity: randomUUID(),
  segment: randomUUID(),
  segmentEntity: randomUUID(),
  traversal: randomUUID(),
} as const;

const database = createDatabase();
let app: INestApplication;
let baseUrl: string;

async function clearPhaseOneFixtures(): Promise<void> {
  for (const table of [
    'transit.trip_segment_traversal',
    'transit.transit_segment',
    'transit.trip_frequency',
    'transit.transfer',
    'transit.stop_time',
    'transit.trip',
    'transit.transit_shape',
    'transit.service_calendar',
    'transit.route',
    'transit.stop',
    'transit.station',
    'transit.operator',
  ]) {
    await sql
      .raw(
        `delete from ${table} where dataset_version_id in (` +
          `'${ids.version}'::uuid, '${ids.secondVersion}'::uuid)`,
      )
      .execute(database);
  }
  await sql`
    delete from twin.mobility_entity
    where creation_dataset_version_id in (
      ${ids.version}::uuid, ${ids.secondVersion}::uuid
    )
  `.execute(database);
  await sql`
    delete from meta.ingestion_run
    where dataset_version_id in (${ids.version}::uuid, ${ids.secondVersion}::uuid)
  `.execute(database);
  await sql`
    delete from meta.dataset_version
    where id in (${ids.version}::uuid, ${ids.secondVersion}::uuid)
  `.execute(database);
  await sql`
    delete from meta.dataset_source
    where id in (${ids.source}::uuid, ${ids.secondSource}::uuid)
  `.execute(database);
}

async function listenLocally(application: INestApplication): Promise<string> {
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address() as AddressInfo | null;
  assert.ok(address !== null);
  return `http://127.0.0.1:${address.port}`;
}

async function insertProvenanceFixture(): Promise<void> {
  await sql`
    insert into meta.dataset_source (
      id, source_key, name, provider, source_type, license_name,
      access_method, coverage_notes, verification_status
    ) values (
      ${ids.source}::uuid,
      'test-sample-transit',
      'TEST Sample Transit Source',
      'TEST Fixture Provider',
      'TEST_FIXTURE',
      'TEST-ONLY',
      'LOCAL_TEST_FIXTURE',
      'Synthetic records for automated tests only.',
      'NOT_VERIFIED'
    )
  `.execute(database);

  await sql`
    insert into meta.dataset_source (
      id, source_key, name, provider, source_type, license_name,
      access_method, coverage_notes, verification_status
    ) values (
      ${ids.secondSource}::uuid,
      'test-second-source',
      'TEST Second Source',
      'TEST Fixture Provider',
      'TEST_FIXTURE',
      'TEST-ONLY',
      'LOCAL_TEST_FIXTURE',
      'Synthetic records for pagination tests only.',
      'NOT_VERIFIED'
    )
  `.execute(database);

  await sql`
    insert into meta.dataset_version (
      id, source_id, version_label, checksum_sha256, retrieved_at,
      effective_from, effective_to, raw_path_ref, manifest_path, validation_status
    ) values (
      ${ids.version}::uuid,
      ${ids.source}::uuid,
      'TEST-v1',
      ${'a'.repeat(64)},
      '2026-01-02T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:00Z'::timestamptz,
      '2026-01-31T23:59:59Z'::timestamptz,
      'data/fixtures/TEST-ONLY-v1',
      'data/manifests/TEST-ONLY-v1.json',
      'VALID'
    ), (
      ${ids.secondVersion}::uuid,
      ${ids.source}::uuid,
      'TEST-v2',
      ${'b'.repeat(64)},
      '2026-02-02T00:00:00Z'::timestamptz,
      '2026-02-01T00:00:00Z'::timestamptz,
      '2026-02-28T23:59:59Z'::timestamptz,
      'data/fixtures/TEST-ONLY-v2',
      'data/manifests/TEST-ONLY-v2.json',
      'VALID'
    )
  `.execute(database);

  await sql`
    insert into meta.ingestion_run (
      id, dataset_version_id, started_at, completed_at, status,
      records_read, records_written, records_rejected
    ) values (
      ${ids.ingestionRun}::uuid,
      ${ids.version}::uuid,
      '2026-01-02T00:01:00Z'::timestamptz,
      '2026-01-02T00:02:00Z'::timestamptz,
      'SUCCEEDED',
      11,
      10,
      1
    )
  `.execute(database);
}

async function insertTransitFixture(): Promise<void> {
  await sql`
    insert into transit.operator (
      id, dataset_version_id, external_id, code, name, mode_group
    ) values (
      ${ids.operator}::uuid, ${ids.version}::uuid,
      'TEST-OP', 'TEST-OP', 'TEST Operator', 'TEST_MODE'
    ), (
      ${ids.secondVersionOperator}::uuid, ${ids.secondVersion}::uuid,
      'TEST-OP', 'TEST-OP', 'TEST Operator v2', 'TEST_MODE'
    )
  `.execute(database);

  await sql`
    insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
    values
      (${ids.stationEntity}::uuid, 'STATION', ${ids.version}::uuid),
      (${ids.stopAEntity}::uuid, 'STOP', ${ids.version}::uuid),
      (${ids.stopBEntity}::uuid, 'STOP', ${ids.version}::uuid),
      (${ids.routeEntity}::uuid, 'ROUTE', ${ids.version}::uuid),
      (${ids.wrongRouteEntity}::uuid, 'STOP', ${ids.version}::uuid),
      (${ids.crossVersionRouteEntity}::uuid, 'ROUTE', ${ids.version}::uuid),
      (${ids.transferEntity}::uuid, 'TRANSFER', ${ids.version}::uuid),
      (${ids.segmentEntity}::uuid, 'TRANSIT_SEGMENT', ${ids.version}::uuid)
  `.execute(database);

  await sql`
    insert into transit.station (
      id, mobility_entity_id, dataset_version_id, external_id, name,
      station_type, geom
    ) values (
      ${ids.station}::uuid,
      ${ids.stationEntity}::uuid,
      ${ids.version}::uuid,
      'TEST-STATION',
      'TEST Station',
      'TEST_TYPE',
      ST_SetSRID(ST_MakePoint(106.8, -6.2), 4326)
    )
  `.execute(database);

  await sql`
    insert into transit.stop (
      id, mobility_entity_id, dataset_version_id, station_id,
      external_id, name, geom
    ) values
      (
        ${ids.stopA}::uuid, ${ids.stopAEntity}::uuid, ${ids.version}::uuid,
        ${ids.station}::uuid, 'TEST-STOP-A', 'TEST Stop A',
        ST_SetSRID(ST_MakePoint(106.8, -6.2), 4326)
      ),
      (
        ${ids.stopB}::uuid, ${ids.stopBEntity}::uuid, ${ids.version}::uuid,
        ${ids.station}::uuid, 'TEST-STOP-B', 'TEST Stop B',
        ST_SetSRID(ST_MakePoint(106.81, -6.21), 4326)
      )
  `.execute(database);

  await sql`
    insert into transit.route (
      id, mobility_entity_id, dataset_version_id, operator_id,
      external_id, short_name, mode
    ) values (
      ${ids.route}::uuid,
      ${ids.routeEntity}::uuid,
      ${ids.version}::uuid,
      ${ids.operator}::uuid,
      'TEST-ROUTE',
      'T1',
      'TEST_MODE'
    )
  `.execute(database);

  await sql`
    insert into transit.service_calendar (
      id, dataset_version_id, operator_id, service_code,
      start_date, end_date, monday, tuesday, wednesday, thursday,
      friday, saturday, sunday
    ) values (
      ${ids.service}::uuid,
      ${ids.version}::uuid,
      ${ids.operator}::uuid,
      'TEST-WEEKDAY',
      '2026-01-01',
      '2026-12-31',
      true, true, true, true, true, false, false
    )
  `.execute(database);

  await sql`
    insert into transit.transit_shape (
      id, dataset_version_id, external_id, geom
    ) values (
      ${ids.shape}::uuid,
      ${ids.version}::uuid,
      'TEST-SHAPE',
      ST_GeomFromText('LINESTRING(106.8 -6.2,106.81 -6.21)', 4326)
    )
  `.execute(database);

  await sql`
    insert into transit.trip (
      id, dataset_version_id, route_id, service_calendar_id,
      transit_shape_id, external_id, direction_id, headsign
    ) values (
      ${ids.trip}::uuid,
      ${ids.version}::uuid,
      ${ids.route}::uuid,
      ${ids.service}::uuid,
      ${ids.shape}::uuid,
      'TEST-TRIP',
      0,
      'TEST Destination'
    )
  `.execute(database);

  await sql`
    insert into transit.stop_time (
      id, dataset_version_id, trip_id, stop_id, stop_sequence,
      arrival_seconds, departure_seconds, pickup_type, dropoff_type
    ) values (
      ${ids.stopTime}::uuid,
      ${ids.version}::uuid,
      ${ids.trip}::uuid,
      ${ids.stopA}::uuid,
      0,
      90000,
      90600,
      0,
      0
    )
  `.execute(database);

  await sql`
    insert into transit.transfer (
      id, mobility_entity_id, dataset_version_id, from_stop_id, to_stop_id,
      transfer_type, min_transfer_seconds, walking_distance_m, geom,
      validation_status
    ) values (
      ${ids.transfer}::uuid,
      ${ids.transferEntity}::uuid,
      ${ids.version}::uuid,
      ${ids.stopA}::uuid,
      ${ids.stopB}::uuid,
      'TEST_WALK',
      120,
      150,
      ST_GeomFromText('LINESTRING(106.8 -6.2,106.81 -6.21)', 4326),
      'NOT_VALIDATED'
    )
  `.execute(database);

  await sql`
    insert into transit.transit_segment (
      id, mobility_entity_id, dataset_version_id, route_id,
      from_stop_id, to_stop_id, direction_id, geom
    ) values (
      ${ids.segment}::uuid,
      ${ids.segmentEntity}::uuid,
      ${ids.version}::uuid,
      ${ids.route}::uuid,
      ${ids.stopA}::uuid,
      ${ids.stopB}::uuid,
      0,
      ST_GeomFromText('LINESTRING(106.8 -6.2,106.81 -6.21)', 4326)
    )
  `.execute(database);

  await sql`
    insert into transit.trip_segment_traversal (
      id, dataset_version_id, transit_segment_id, trip_id, route_id,
      from_stop_id, to_stop_id, transit_shape_id, direction_id,
      segment_sequence, geom
    ) values (
      ${ids.traversal}::uuid,
      ${ids.version}::uuid,
      ${ids.segment}::uuid,
      ${ids.trip}::uuid,
      ${ids.route}::uuid,
      ${ids.stopA}::uuid,
      ${ids.stopB}::uuid,
      ${ids.shape}::uuid,
      0,
      0,
      ST_GeomFromText('LINESTRING(106.8 -6.2,106.81 -6.21)', 4326)
    )
  `.execute(database);
}

describe('FR-012 Phase 1A provenance and canonical transit foundation', () => {
  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    baseUrl = await listenLocally(app);
  });

  after(async () => {
    await clearPhaseOneFixtures();
    await app.close();
    await database.destroy();
  });

  it('retains the canonical transit tables alongside authorized Twin tables and GiST indexes', async () => {
    const tableResult = await sql<{ tableName: string }>`
      select table_schema || '.' || table_name as "tableName"
      from information_schema.tables
      where table_schema in ('meta', 'transit', 'twin')
        and table_type = 'BASE TABLE'
        and table_name not like 'kysely_%'
      order by table_schema, table_name
    `.execute(database);
    const indexResult = await sql<{ indexName: string }>`
      select indexname as "indexName"
      from pg_indexes
      where schemaname = 'transit'
        and indexdef ilike '% using gist %'
      order by indexname
    `.execute(database);

    assert.deepEqual(
      tableResult.rows.map((row) => row.tableName),
      [
        'meta.dataset_source',
        'meta.dataset_version',
        'meta.entity_alias',
        'meta.ingestion_run',
        'meta.source_entity_reference',
        'transit.operator',
        'transit.route',
        'transit.service_calendar',
        'transit.station',
        'transit.stop',
        'transit.stop_time',
        'transit.transfer',
        'transit.transit_segment',
        'transit.transit_shape',
        'transit.trip',
        'transit.trip_frequency',
        'transit.trip_segment_traversal',
        'twin.mobility_entity',
        'twin.mobility_state',
        'twin.mobility_state_history',
        'twin.network_snapshot',
        'twin.network_snapshot_state',
        'twin.operational_observation',
      ],
    );
    assert.deepEqual(
      indexResult.rows.map((row) => row.indexName),
      [
        'station_geom_gist',
        'stop_geom_gist',
        'transfer_geom_gist',
        'transit_segment_geom_gist',
        'transit_shape_geom_gist',
        'trip_segment_traversal_geom_gist',
      ],
    );
  });

  it('returns an honest registry without leaking fixture state', async () => {
    const response = await fetch(`${baseUrl}/api/v1/data-sources`);
    const body = (await response.json()) as {
      data: Array<{ source_key: string }>;
      meta: { request_id: string; warnings: unknown[]; next_cursor: null };
    };

    assert.equal(response.status, 200);
    assert.equal(
      body.data.some((source) => source.source_key.startsWith('test-')),
      false,
    );
    assert.equal(body.meta.next_cursor, null);
    assert.deepEqual(body.meta.warnings, []);
    assert.match(body.meta.request_id, /^[0-9a-f-]{36}$/i);
  });

  it('enforces provenance lineage, checksums, status consistency, and delete restrictions', async () => {
    await insertProvenanceFixture();

    await assert.rejects(
      sql`
        insert into meta.dataset_version (
          id, source_id, version_label, checksum_sha256, retrieved_at,
          raw_path_ref, manifest_path, validation_status
        ) values (
          ${randomUUID()}::uuid,
          ${ids.source}::uuid,
          'TEST-invalid-checksum',
          'not-a-checksum',
          now(),
          'data/fixtures/TEST-invalid',
          'data/manifests/TEST-invalid.json',
          'INVALID'
        )
      `.execute(database),
      /dataset_version_checksum_sha256_check/,
    );
    await assert.rejects(
      sql`
        insert into meta.ingestion_run (
          id, dataset_version_id, started_at, completed_at, status,
          records_read, records_written, records_rejected
        ) values (
          ${randomUUID()}::uuid,
          ${ids.version}::uuid,
          now(),
          null,
          'SUCCEEDED',
          1,
          1,
          0
        )
      `.execute(database),
      /ingestion_run_completed_at_check/,
    );
    await assert.rejects(
      sql`delete from meta.dataset_source where id = ${ids.source}::uuid`.execute(
        database,
      ),
      /dataset_version_source_fk/,
    );
  });

  it('exposes fixture sources and versions through the provenance API', async () => {
    const firstResponse = await fetch(
      `${baseUrl}/api/v1/data-sources?limit=100`,
    );
    const firstBody = (await firstResponse.json()) as {
      data: Array<{ source_key: string; verification_status: string }>;
      meta: { next_cursor: string | null };
    };

    assert.equal(firstResponse.status, 200);
    const fixture = firstBody.data.find(
      (source) => source.source_key === 'test-sample-transit',
    );
    assert.equal(firstResponse.status, 200);
    assert.equal(fixture?.verification_status, 'NOT_VERIFIED');
    assert.ok(
      firstBody.data.some(
        (source) => source.source_key === 'test-second-source',
      ),
    );

    const versionsResponse = await fetch(
      `${baseUrl}/api/v1/data-sources/${ids.source}/versions?limit=1`,
    );
    const versionsBody = (await versionsResponse.json()) as {
      data: Array<{
        version_label: string;
        checksum_sha256: string;
        validation_status: string;
      }>;
      meta: { next_cursor: string | null };
    };
    assert.equal(versionsResponse.status, 200);
    assert.equal(versionsBody.data[0]?.version_label, 'TEST-v2');
    assert.equal(versionsBody.data[0]?.checksum_sha256, 'b'.repeat(64));
    assert.equal(versionsBody.data[0]?.validation_status, 'VALID');
    assert.ok(versionsBody.meta.next_cursor !== null);
  });

  it('returns canonical error envelopes for invalid input and unknown sources', async () => {
    const invalidResponse = await fetch(
      `${baseUrl}/api/v1/data-sources?limit=101`,
    );
    const invalidBody = (await invalidResponse.json()) as {
      error: { code: string; request_id: string };
    };
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
    assert.match(invalidBody.error.request_id, /^[0-9a-f-]{36}$/i);

    const missingId = randomUUID();
    const missingResponse = await fetch(
      `${baseUrl}/api/v1/data-sources/${missingId}/versions`,
    );
    const missingBody = (await missingResponse.json()) as {
      error: { code: string; details: { source_id: string } };
    };
    assert.equal(missingResponse.status, 404);
    assert.equal(missingBody.error.code, 'NOT_FOUND');
    assert.equal(missingBody.error.details.source_id, missingId);
  });

  it('persists a version-scoped canonical transit graph with stable typed identities', async () => {
    await insertTransitFixture();

    const result = await sql<{
      arrivalSeconds: number;
      departureSeconds: number;
      stationSrid: number;
      shapeSrid: number;
      segmentType: string;
      routeEntityType: string;
    }>`
      select
        st.arrival_seconds as "arrivalSeconds",
        st.departure_seconds as "departureSeconds",
        ST_SRID(s.geom) as "stationSrid",
        ST_SRID(ts.geom) as "shapeSrid",
        GeometryType(seg.geom) as "segmentType",
        me.entity_type as "routeEntityType"
      from transit.stop_time st
      join transit.trip t on t.id = st.trip_id
      join transit.route r on r.id = t.route_id
      join twin.mobility_entity me on me.id = r.mobility_entity_id
      join transit.station s on s.id = ${ids.station}::uuid
      join transit.transit_shape ts on ts.id = t.transit_shape_id
      join transit.transit_segment seg on seg.route_id = r.id
      where st.id = ${ids.stopTime}::uuid
    `.execute(database);

    assert.equal(result.rows[0]?.arrivalSeconds, 90000);
    assert.equal(result.rows[0]?.departureSeconds, 90600);
    assert.equal(result.rows[0]?.stationSrid, 4326);
    assert.equal(result.rows[0]?.shapeSrid, 4326);
    assert.equal(result.rows[0]?.segmentType, 'LINESTRING');
    assert.equal(result.rows[0]?.routeEntityType, 'ROUTE');
  });

  it('rejects invalid identity types, cross-version topology, and invalid service times', async () => {
    await assert.rejects(
      sql`
        insert into transit.route (
          id, mobility_entity_id, dataset_version_id, operator_id,
          external_id, short_name, mode
        ) values (
          ${randomUUID()}::uuid,
          ${ids.wrongRouteEntity}::uuid,
          ${ids.version}::uuid,
          ${ids.operator}::uuid,
          'TEST-WRONG-IDENTITY',
          'BAD',
          'TEST_MODE'
        )
      `.execute(database),
      /must have entity_type ROUTE/,
    );

    await assert.rejects(
      sql`
        insert into transit.route (
          id, mobility_entity_id, dataset_version_id, operator_id,
          external_id, short_name, mode
        ) values (
          ${randomUUID()}::uuid,
          ${ids.crossVersionRouteEntity}::uuid,
          ${ids.version}::uuid,
          ${ids.secondVersionOperator}::uuid,
          'TEST-CROSS-VERSION',
          'BAD',
          'TEST_MODE'
        )
      `.execute(database),
      /route_operator_fk/,
    );

    await assert.rejects(
      sql`
        insert into transit.stop_time (
          id, dataset_version_id, trip_id, stop_id, stop_sequence,
          arrival_seconds, departure_seconds
        ) values (
          ${randomUUID()}::uuid,
          ${ids.version}::uuid,
          ${ids.trip}::uuid,
          ${ids.stopB}::uuid,
          1,
          100,
          99
        )
      `.execute(database),
      /stop_time_departure_check/,
    );
  });
});
