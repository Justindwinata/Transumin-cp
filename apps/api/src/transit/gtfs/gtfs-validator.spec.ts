import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deterministicUuid, normalizeGtfsFeed } from './gtfs-normalizer.js';
import type { TransJakartaManifest } from './gtfs.types.js';
import { parseGtfsTime, validateGtfsTextFiles } from './gtfs-validator.js';

const manifest: TransJakartaManifest = {
  schemaVersion: 1,
  datasetSourceId: '10000000-0000-4000-8000-000000000001',
  datasetVersionId: '10000000-0000-4000-8000-000000000002',
  sourceKey: 'test-sample-gtfs',
  versionLabel: 'TEST-SAMPLE-v1',
  source: {
    publisher: 'TEST Fixture Publisher',
    publicationPage: 'https://example.test/gtfs',
    requestedDownloadUrl: 'https://example.test/gtfs.zip',
    resolvedDownloadUrl: 'https://example.test/gtfs.zip',
    accessMethod: 'HTTPS_DOWNLOAD',
    httpStatus: 200,
    contentType: 'application/zip',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenseEvidenceUrl: 'https://example.test/license',
  },
  snapshot: {
    retrievedAt: '2026-01-01T00:00:00Z',
    archiveFilename: 'TEST-SAMPLE.zip',
    rawPathRef: 'data/fixtures/TEST-SAMPLE.zip',
    bytes: 1,
    sha256: 'a'.repeat(64),
  },
  serviceCoverage: {
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
  },
  validation: {
    status: 'VALID',
    validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1',
    qualityReportPath: 'data/manifests/TEST-SAMPLE-quality.json',
    externalValidatorStatus: 'NOT_VERIFIED',
    externalValidatorNote: 'TEST-only fixture.',
  },
};

function validFixture(): Record<string, string> {
  return {
    'agency.txt':
      'agency_id,agency_name,agency_url,agency_timezone\nA,TEST Agency,https://example.test,Asia/Jakarta\n',
    'calendar.txt':
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n',
    'routes.txt':
      'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color,route_sort_order\nR,A,T1,TEST Route,BRT,3,https://example.test/r,112233,FFFFFF,1\n',
    'stops.txt':
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\nS1,TEST Stop 1,-6.2,106.8,0,\nS2,TEST Stop 2,-6.21,106.81,0,\n',
    'trips.txt':
      'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\nR,WK,T,TEST Destination,0,SH\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\nT,25:00:00,25:00:30,S1,1,0,0\nT,25:10:00,25:10:30,S2,2,0,0\n',
    'shapes.txt':
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH,-6.2,106.8,1\nSH,-6.205,106.805,2\nSH,-6.21,106.81,3\n',
    'transfers.txt':
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\nS1,S2,2,120\n',
    'frequencies.txt':
      'trip_id,start_time,end_time,headway_secs,exact_times\nT,05:00:00,06:00:00,600,0\n',
  };
}

describe('deterministic GTFS parser and validator', () => {
  it('supports GTFS times beyond 24 hours and rejects malformed values', () => {
    assert.equal(parseGtfsTime('27:05:09'), 97_509);
    assert.equal(parseGtfsTime('24:00:00'), 86_400);
    assert.equal(parseGtfsTime('-01:00:00'), null);
    assert.equal(parseGtfsTime('12:60:00'), null);
    assert.equal(parseGtfsTime('not-time'), null);
  });

  it('validates schema, references, geometry, service coverage, and topology', () => {
    const parsed = validateGtfsTextFiles(validFixture());

    assert.equal(parsed.report.status, 'VALID');
    assert.equal(parsed.report.metrics.gtfsTimesOver24Hours, 2);
    assert.equal(parsed.report.metrics.orphanRecords, 0);
    assert.equal(parsed.report.metrics.rowsRejected, 0);
    assert.equal(parsed.report.metrics.logicalTransitSegments, 1);
    assert.equal(parsed.report.metrics.tripSegmentTraversals, 1);
    assert.equal(parsed.report.metrics.frequencies, 1);
    assert.equal(parsed.report.metrics.nullOrInvalidGeometries, 0);
  });

  it('reports missing files, malformed CSV rows, and broken references', () => {
    const files = validFixture();
    delete files['routes.txt'];
    files['stops.txt'] =
      'stop_id,stop_name,stop_lat,stop_lon\nS1,TEST Stop,-6.2,106.8,EXTRA\n';
    files['stop_times.txt'] =
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT,08:00:00,08:00:00,UNKNOWN,1\n';
    const parsed = validateGtfsTextFiles(files);
    const codes = new Set(parsed.report.issues.map((issue) => issue.code));

    assert.equal(parsed.report.status, 'INVALID');
    assert.ok(codes.has('MISSING_REQUIRED_FILE'));
    assert.ok(codes.has('CSV_UNREADABLE'));
    assert.ok(codes.has('TRIP_ROUTE_ORPHAN'));
    assert.ok(codes.has('STOP_TIME_STOP_ORPHAN'));
    assert.ok(parsed.report.metrics.rowsRejected > 0);
  });

  it('blocks calendar exceptions until the canonical exception model exists', () => {
    const files = validFixture();
    files['calendar_dates.txt'] =
      'service_id,date,exception_type\nWK,20260101,2\n';
    const parsed = validateGtfsTextFiles(files);

    assert.equal(parsed.report.status, 'INVALID');
    assert.ok(
      parsed.report.issues.some(
        (issue) => issue.code === 'SERVICE_EXCEPTIONS_REQUIRE_SCHEMA',
      ),
    );
  });

  it('normalizes source identities and derives a shape-backed segment deterministically', () => {
    const parsed = validateGtfsTextFiles(validFixture());
    const first = normalizeGtfsFeed(parsed, manifest);
    const second = normalizeGtfsFeed(parsed, manifest);

    assert.equal(first.routes[0]?.externalId, 'R');
    assert.equal(first.routes[0]?.description, 'BRT');
    assert.equal(first.transitSegments.length, 1);
    assert.equal(first.tripSegmentTraversals.length, 1);
    assert.equal(first.tripFrequencies.length, 1);
    assert.ok((first.transitSegments[0]?.points.length ?? 0) >= 2);
    assert.equal(first.routes[0]?.id, second.routes[0]?.id);
    assert.notEqual(
      deterministicUuid(manifest.datasetVersionId, 'route', 'R'),
      deterministicUuid('20000000-0000-4000-8000-000000000002', 'route', 'R'),
    );
  });

  it('rejects malformed frequency semantics', () => {
    const files = validFixture();
    files['frequencies.txt'] =
      'trip_id,start_time,end_time,headway_secs,exact_times\nT,06:00:00,05:00:00,0,2\n';
    const parsed = validateGtfsTextFiles(files);
    const codes = new Set(parsed.report.issues.map((issue) => issue.code));

    assert.equal(parsed.report.status, 'INVALID');
    assert.ok(codes.has('INVALID_FREQUENCY'));
    assert.ok(codes.has('INVALID_FREQUENCY_EXACT_TIMES'));
  });

  it('keeps identical external IDs collision-safe across source versions', () => {
    const parsed = validateGtfsTextFiles(validFixture());
    const first = normalizeGtfsFeed(parsed, manifest);
    const other = normalizeGtfsFeed(parsed, {
      ...manifest,
      datasetSourceId: '20000000-0000-4000-8000-000000000001',
      datasetVersionId: '20000000-0000-4000-8000-000000000002',
      sourceKey: 'test-other-operator',
    });

    assert.equal(first.routes[0]?.externalId, other.routes[0]?.externalId);
    assert.notEqual(first.routes[0]?.id, other.routes[0]?.id);
    assert.notEqual(first.stops[0]?.id, other.stops[0]?.id);
  });
});
