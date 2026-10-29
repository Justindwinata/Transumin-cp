import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { createDatabase } from '../../infrastructure/database/database.client.js';
import { migrateToLatest } from '../../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../../infrastructure/database/scratch.guard.js';
import {
  getCanonicalCounts,
  GTFS_PIPELINE_VERSION,
  ingestGtfsFeed,
} from './gtfs-ingestor.js';
import { normalizeGtfsFeed } from './gtfs-normalizer.js';
import type {
  NormalizedGtfsFeed,
  TransJakartaManifest,
  TransJakartaRegistry,
} from './gtfs.types.js';
import { validateGtfsTextFiles } from './gtfs-validator.js';

const sourceId = '30000000-0000-4000-8000-000000000001';
const versionId = '30000000-0000-4000-8000-000000000002';
const failedVersionId = '30000000-0000-4000-8000-000000000003';

const registry: TransJakartaRegistry = {
  schemaVersion: 1,
  sourceId,
  sourceKey: 'test-gtfs-ingestion-transaction',
  datasetName: 'TEST GTFS Ingestion Fixture',
  publisher: 'TEST Fixture Publisher',
  publicationPage: 'https://example.test/gtfs',
  officialDownloadUrl: 'https://example.test/gtfs.zip',
  accessMethod: 'HTTPS_DOWNLOAD',
  license: {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    evidenceUrl: 'https://example.test/license',
    attributionRequirement: 'TEST attribution only.',
    redistributionImplication: 'TEST fixture only.',
  },
  verification: {
    status: 'VERIFIED',
    verifiedAt: '2026-01-01T00:00:00Z',
    evidence: ['TEST synthetic fixture.'],
    corroboration: [],
  },
  currentManifest: 'data/manifests/TEST-GTFS-v1.json',
};

function manifest(
  id: string,
  label: string,
  checksumCharacter: string,
): TransJakartaManifest {
  return {
    schemaVersion: 1,
    datasetSourceId: sourceId,
    datasetVersionId: id,
    sourceKey: registry.sourceKey,
    versionLabel: label,
    source: {
      publisher: registry.publisher,
      publicationPage: registry.publicationPage,
      requestedDownloadUrl: registry.officialDownloadUrl,
      resolvedDownloadUrl: registry.officialDownloadUrl,
      accessMethod: 'HTTPS_DOWNLOAD',
      httpStatus: 200,
      contentType: 'application/zip',
      licenseName: 'CC BY 4.0',
      licenseUrl: registry.license.url,
      licenseEvidenceUrl: registry.license.evidenceUrl,
    },
    snapshot: {
      retrievedAt: '2026-01-01T00:00:00Z',
      archiveFilename: 'TEST-SAMPLE.zip',
      rawPathRef: `data/fixtures/${label}.zip`,
      bytes: 1,
      sha256: checksumCharacter.repeat(64),
    },
    serviceCoverage: {
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    },
    validation: {
      status: 'VALID',
      validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1',
      qualityReportPath: `data/manifests/${label}-quality.json`,
      externalValidatorStatus: 'NOT_VERIFIED',
      externalValidatorNote: 'TEST-only fixture.',
    },
  };
}

function fixture(): Record<string, string> {
  return {
    'agency.txt':
      'agency_id,agency_name,agency_url,agency_timezone\nA,TEST Agency,https://example.test,Asia/Jakarta\n',
    'calendar.txt':
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n',
    'routes.txt':
      'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type\nR,A,T1,TEST Route,BRT,3\n',
    'stops.txt':
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\nS1,TEST Stop 1,-6.2,106.8,0,\nS2,TEST Stop 2,-6.21,106.81,0,\n',
    'trips.txt':
      'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nR,WK,T,TEST Destination,0,SH\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT,25:00:00,25:00:30,S1,1\nT,25:10:00,25:10:30,S2,2\n',
    'shapes.txt':
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH,-6.2,106.8,1\nSH,-6.21,106.81,2\n',
    'transfers.txt':
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\nS1,S2,2,120\n',
    'frequencies.txt':
      'trip_id,start_time,end_time,headway_secs,exact_times\nT,05:00:00,06:00:00,600,0\n',
  };
}

const database = createDatabase();
const successfulManifest = manifest(versionId, 'TEST-GTFS-v1', 'c');
const failedManifest = manifest(failedVersionId, 'TEST-GTFS-v2-failure', 'd');

async function clearFixtures(): Promise<void> {
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
          `'${versionId}'::uuid, '${failedVersionId}'::uuid)`,
      )
      .execute(database);
  }
  await sql`
    delete from twin.mobility_entity
    where creation_dataset_version_id in (
      ${versionId}::uuid, ${failedVersionId}::uuid
    )
  `.execute(database);
  await sql`
    delete from meta.ingestion_run
    where dataset_version_id in (${versionId}::uuid, ${failedVersionId}::uuid)
  `.execute(database);
  await sql`
    delete from meta.dataset_version
    where id in (${versionId}::uuid, ${failedVersionId}::uuid)
  `.execute(database);
  await sql`delete from meta.dataset_source where id = ${sourceId}::uuid`.execute(
    database,
  );
}

describe('FR-012 transactional GTFS canonical ingestion', () => {
  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    await clearFixtures();
  });

  after(async () => {
    await clearFixtures();
    await database.destroy();
  });

  it('ingests canonical counts and performs deterministic no-duplication replay', async () => {
    const parsed = validateGtfsTextFiles(fixture());
    const feed = normalizeGtfsFeed(parsed, successfulManifest);
    const first = await ingestGtfsFeed(registry, successfulManifest, feed);
    const second = await ingestGtfsFeed(registry, successfulManifest, feed);
    const counts = await getCanonicalCounts(versionId);

    assert.equal(first.status, 'COMPLETED');
    assert.equal(second.status, 'ALREADY_IMPORTED');
    assert.equal(second.ingestionRunId, first.ingestionRunId);
    assert.deepEqual(counts, {
      operators: 1,
      routes: 1,
      stations: 0,
      stops: 2,
      serviceCalendars: 1,
      serviceExceptions: 0,
      tripFrequencies: 1,
      shapes: 1,
      trips: 1,
      stopTimes: 2,
      transfers: 1,
      transitSegments: 1,
      tripSegmentTraversals: 1,
      mobilityEntities: 5,
      invalidGeometries: 0,
    });
    await assert.rejects(
      sql`
        insert into meta.dataset_version (
          id, source_id, version_label, checksum_sha256, retrieved_at,
          raw_path_ref, manifest_path, validation_status
        ) values (
          ${randomUUID()}::uuid,
          ${sourceId}::uuid,
          'TEST-GTFS-duplicate-checksum',
          ${'c'.repeat(64)},
          now(),
          'data/fixtures/TEST-GTFS-duplicate-checksum.zip',
          'data/manifests/TEST-GTFS-duplicate-checksum.json',
          'VALID'
        )
      `.execute(database),
      /dataset_version_source_checksum_unique/,
    );
  });

  it('preserves the prior canonical graph when a versioned rebuild fails', async () => {
    await sql`
      update meta.ingestion_run
      set pipeline_version = 'PHASE_1B_V1'
      where dataset_version_id = ${versionId}::uuid and status = 'SUCCEEDED'
    `.execute(database);
    const parsed = validateGtfsTextFiles(fixture());
    const normalized = normalizeGtfsFeed(parsed, successfulManifest);
    const broken: NormalizedGtfsFeed = {
      ...normalized,
      routes: normalized.routes.map((route) => ({
        ...route,
        operatorId: randomUUID(),
      })),
    };

    await assert.rejects(
      ingestGtfsFeed(registry, successfulManifest, broken),
      /route_operator_fk/,
    );
    assert.equal((await getCanonicalCounts(versionId)).routes, 1);

    const repaired = await ingestGtfsFeed(
      registry,
      successfulManifest,
      normalized,
    );
    const replay = await ingestGtfsFeed(
      registry,
      successfulManifest,
      normalized,
    );
    assert.equal(repaired.status, 'COMPLETED');
    assert.equal(replay.status, 'ALREADY_IMPORTED');
    assert.equal(replay.ingestionRunId, repaired.ingestionRunId);
    const run = await sql<{
      pipelineVersion: string;
      replacesIngestionRunId: string | null;
    }>`
      select
        pipeline_version as "pipelineVersion",
        replaces_ingestion_run_id as "replacesIngestionRunId"
      from meta.ingestion_run
      where id = ${repaired.ingestionRunId}::uuid
    `.execute(database);
    assert.equal(run.rows[0]?.pipelineVersion, GTFS_PIPELINE_VERSION);
    assert.ok(run.rows[0]?.replacesIngestionRunId);
  });

  it('rolls back every canonical row and preserves a failed audit run', async () => {
    const parsed = validateGtfsTextFiles(fixture());
    const normalized = normalizeGtfsFeed(parsed, failedManifest);
    const broken: NormalizedGtfsFeed = {
      ...normalized,
      routes: normalized.routes.map((route) => ({
        ...route,
        operatorId: randomUUID(),
      })),
    };

    await assert.rejects(
      ingestGtfsFeed(registry, failedManifest, broken),
      /route_operator_fk/,
    );
    const counts = await getCanonicalCounts(failedVersionId);
    const run = await sql<{ status: string; recordsWritten: string }>`
      select status, records_written::text as "recordsWritten"
      from meta.ingestion_run
      where dataset_version_id = ${failedVersionId}::uuid
    `.execute(database);

    assert.deepEqual(counts, {
      operators: 0,
      routes: 0,
      stations: 0,
      stops: 0,
      serviceCalendars: 0,
      serviceExceptions: 0,
      tripFrequencies: 0,
      shapes: 0,
      trips: 0,
      stopTimes: 0,
      transfers: 0,
      transitSegments: 0,
      tripSegmentTraversals: 0,
      mobilityEntities: 0,
      invalidGeometries: 0,
    });
    assert.equal(run.rows[0]?.status, 'FAILED');
    assert.equal(run.rows[0]?.recordsWritten, '0');
  });
});
