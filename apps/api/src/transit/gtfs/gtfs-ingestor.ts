import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { getDatabaseConfig } from '../../infrastructure/database/database.config.js';
import type {
  Coordinate,
  NormalizedGtfsFeed,
  TransJakartaManifest,
  TransJakartaRegistry,
} from './gtfs.types.js';

const BATCH_SIZE = 500;
export const GTFS_PIPELINE_VERSION = 'PHASE_1C_V2';

export type IngestionResult =
  | {
      readonly status: 'COMPLETED';
      readonly ingestionRunId: string;
      readonly datasetVersionId: string;
      readonly recordsRead: number;
      readonly recordsWritten: number;
      readonly recordsRejected: number;
    }
  | {
      readonly status: 'ALREADY_IMPORTED';
      readonly ingestionRunId: string;
      readonly datasetVersionId: string;
      readonly recordsRead: number;
      readonly recordsWritten: number;
      readonly recordsRejected: number;
    };

export interface CanonicalCounts {
  readonly operators: number;
  readonly routes: number;
  readonly stations: number;
  readonly stops: number;
  readonly serviceCalendars: number;
  readonly serviceExceptions: number;
  readonly tripFrequencies: number;
  readonly shapes: number;
  readonly trips: number;
  readonly stopTimes: number;
  readonly transfers: number;
  readonly transitSegments: number;
  readonly tripSegmentTraversals: number;
  readonly mobilityEntities: number;
  readonly invalidGeometries: number;
}

function placeholders(
  rowCount: number,
  valueCount: number,
  rowExpression?: (offset: number) => string,
): string {
  return Array.from({ length: rowCount }, (_, row) => {
    const offset = row * valueCount;
    return (
      rowExpression?.(offset) ??
      `(${Array.from({ length: valueCount }, (__, column) => `$${offset + column + 1}`).join(', ')})`
    );
  }).join(', ');
}

async function batchInsert(
  client: PoolClient,
  prefix: string,
  values: readonly (readonly unknown[])[],
  rowExpression?: (offset: number) => string,
): Promise<void> {
  for (let start = 0; start < values.length; start += BATCH_SIZE) {
    const batch = values.slice(start, start + BATCH_SIZE);
    if (batch.length === 0) continue;
    const valueCount = batch[0]?.length ?? 0;
    if (valueCount === 0 || batch.some((row) => row.length !== valueCount)) {
      throw new Error(
        'Canonical batch insert received inconsistent row widths',
      );
    }
    await client.query(
      `${prefix} values ${placeholders(batch.length, valueCount, rowExpression)}`,
      batch.flat(),
    );
  }
}

function pointWkt(point: Coordinate): string {
  return `POINT(${point.longitude} ${point.latitude})`;
}

function lineWkt(points: readonly Coordinate[]): string {
  return `LINESTRING(${points.map((point) => `${point.longitude} ${point.latitude}`).join(',')})`;
}

async function registerProvenance(
  client: PoolClient,
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
  feed: NormalizedGtfsFeed,
): Promise<void> {
  const sourceResult = await client.query<{ id: string }>(
    `insert into meta.dataset_source (
      id, source_key, name, provider, source_type, canonical_url,
      license_name, license_url, access_method, access_notes,
      coverage_notes, redistribution_rule, verification_status
    ) values (
      $1::uuid, $2, $3, $4, 'GTFS_STATIC', $5,
      $6, $7, $8, $9, $10, $11, 'VERIFIED'
    )
    on conflict (source_key) do update set
      name = excluded.name,
      provider = excluded.provider,
      source_type = excluded.source_type,
      canonical_url = excluded.canonical_url,
      license_name = excluded.license_name,
      license_url = excluded.license_url,
      access_method = excluded.access_method,
      access_notes = excluded.access_notes,
      coverage_notes = excluded.coverage_notes,
      redistribution_rule = excluded.redistribution_rule,
      verification_status = excluded.verification_status,
      updated_at = now()
    returning id`,
    [
      registry.sourceId,
      registry.sourceKey,
      registry.datasetName,
      registry.publisher,
      registry.publicationPage,
      registry.license.name,
      registry.license.url,
      registry.accessMethod,
      `Official download endpoint: ${registry.officialDownloadUrl}`,
      'TransJakarta static scheduled service; category coverage is reported from GTFS route_desc.',
      registry.license.redistributionImplication,
    ],
  );
  const persistedSourceId = sourceResult.rows[0]?.id;
  if (persistedSourceId !== registry.sourceId) {
    throw new Error(
      'Existing source_key is associated with a different immutable source ID',
    );
  }

  const existingVersion = await client.query<{
    id: string;
    checksumSha256: string;
  }>(
    `select id, checksum_sha256 as "checksumSha256"
     from meta.dataset_version
     where source_id = $1::uuid and version_label = $2`,
    [registry.sourceId, manifest.versionLabel],
  );
  const existing = existingVersion.rows[0];
  if (
    existing !== undefined &&
    (existing.id !== manifest.datasetVersionId ||
      existing.checksumSha256 !== manifest.snapshot.sha256)
  ) {
    throw new Error(
      'Dataset version label conflicts with an existing immutable snapshot',
    );
  }
  if (existing === undefined) {
    await client.query(
      `insert into meta.dataset_version (
        id, source_id, version_label, checksum_sha256, retrieved_at,
        effective_from, effective_to, raw_path_ref, manifest_path,
        validation_status, metadata_json
      ) values (
        $1::uuid, $2::uuid, $3, $4, $5::timestamptz,
        $6::timestamptz, $7::timestamptz, $8, $9, $10, $11::jsonb
      )`,
      [
        manifest.datasetVersionId,
        registry.sourceId,
        manifest.versionLabel,
        manifest.snapshot.sha256,
        manifest.snapshot.retrievedAt,
        manifest.serviceCoverage.effectiveFrom === null
          ? null
          : `${manifest.serviceCoverage.effectiveFrom}T00:00:00Z`,
        manifest.serviceCoverage.effectiveTo === null
          ? null
          : `${manifest.serviceCoverage.effectiveTo}T23:59:59Z`,
        manifest.snapshot.rawPathRef,
        registry.currentManifest,
        manifest.validation.status,
        JSON.stringify({
          filesPresent: feed.report.filesPresent,
          counts: feed.report.metrics,
          coverage: feed.report.coverage,
          validator: feed.report.validator,
          externalValidatorStatus: manifest.validation.externalValidatorStatus,
        }),
      ],
    );
  }
}

async function insertCanonicalRows(
  client: PoolClient,
  manifest: TransJakartaManifest,
  feed: NormalizedGtfsFeed,
): Promise<void> {
  const versionId = manifest.datasetVersionId;
  await batchInsert(
    client,
    `insert into transit.operator (
      id, dataset_version_id, external_id, code, name, mode_group
    )`,
    feed.operators.map((row) => [
      row.id,
      versionId,
      row.externalId,
      row.code,
      row.name,
      row.modeGroup,
    ]),
  );

  const mobilityRows: unknown[][] = [];
  for (const row of feed.stations)
    mobilityRows.push([row.mobilityEntityId, 'STATION', versionId]);
  for (const row of feed.stops)
    mobilityRows.push([row.mobilityEntityId, 'STOP', versionId]);
  for (const row of feed.routes)
    mobilityRows.push([row.mobilityEntityId, 'ROUTE', versionId]);
  for (const row of feed.transfers)
    mobilityRows.push([row.mobilityEntityId, 'TRANSFER', versionId]);
  for (const row of feed.transitSegments)
    mobilityRows.push([row.mobilityEntityId, 'TRANSIT_SEGMENT', versionId]);
  await batchInsert(
    client,
    'insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)',
    mobilityRows,
  );

  await batchInsert(
    client,
    `insert into transit.station (
      id, mobility_entity_id, dataset_version_id, external_id, name,
      station_type, parent_station_id, geom
    )`,
    feed.stations.map((row) => [
      row.id,
      row.mobilityEntityId,
      versionId,
      row.externalId,
      row.name,
      row.stationType,
      row.parentStationId,
      pointWkt(row.coordinate),
    ]),
    (offset) =>
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, ` +
      `$${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::uuid, ` +
      `ST_GeomFromText($${offset + 8}, 4326))`,
  );

  await batchInsert(
    client,
    `insert into transit.stop (
      id, mobility_entity_id, dataset_version_id, station_id,
      external_id, name, geom
    )`,
    feed.stops.map((row) => [
      row.id,
      row.mobilityEntityId,
      versionId,
      row.stationId,
      row.externalId,
      row.name,
      pointWkt(row.coordinate),
    ]),
    (offset) =>
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, ` +
      `$${offset + 4}::uuid, $${offset + 5}, $${offset + 6}, ` +
      `ST_GeomFromText($${offset + 7}, 4326))`,
  );

  await batchInsert(
    client,
    `insert into transit.route (
      id, mobility_entity_id, dataset_version_id, operator_id,
      external_id, short_name, long_name, mode, description, source_url,
      color, text_color, sort_order, gtfs_route_type
    )`,
    feed.routes.map((row) => [
      row.id,
      row.mobilityEntityId,
      versionId,
      row.operatorId,
      row.externalId,
      row.shortName,
      row.longName,
      row.mode,
      row.description,
      row.sourceUrl,
      row.color,
      row.textColor,
      row.sortOrder,
      row.gtfsRouteType,
    ]),
  );

  await batchInsert(
    client,
    `insert into transit.service_calendar (
      id, dataset_version_id, operator_id, service_code, start_date, end_date,
      monday, tuesday, wednesday, thursday, friday, saturday, sunday
    )`,
    feed.serviceCalendars.map((row) => [
      row.id,
      versionId,
      row.operatorId,
      row.serviceCode,
      row.startDate,
      row.endDate,
      ...row.weekdays,
    ]),
  );

  await batchInsert(
    client,
    'insert into transit.transit_shape (id, dataset_version_id, external_id, geom)',
    feed.shapes.map((row) => [
      row.id,
      versionId,
      row.externalId,
      lineWkt(row.points),
    ]),
    (offset) =>
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}, ` +
      `ST_GeomFromText($${offset + 4}, 4326))`,
  );

  await batchInsert(
    client,
    `insert into transit.trip (
      id, dataset_version_id, route_id, service_calendar_id,
      transit_shape_id, external_id, direction_id, headsign
    )`,
    feed.trips.map((row) => [
      row.id,
      versionId,
      row.routeId,
      row.serviceCalendarId,
      row.transitShapeId,
      row.externalId,
      row.directionId,
      row.headsign,
    ]),
  );

  await batchInsert(
    client,
    `insert into transit.stop_time (
      id, dataset_version_id, trip_id, stop_id, stop_sequence,
      arrival_seconds, departure_seconds, pickup_type, dropoff_type
    )`,
    feed.stopTimes.map((row) => [
      row.id,
      versionId,
      row.tripId,
      row.stopId,
      row.stopSequence,
      row.arrivalSeconds,
      row.departureSeconds,
      row.pickupType,
      row.dropoffType,
    ]),
  );

  await batchInsert(
    client,
    `insert into transit.trip_frequency (
      id, dataset_version_id, trip_id, start_seconds, end_seconds,
      headway_seconds, exact_times
    )`,
    feed.tripFrequencies.map((row) => [
      row.id,
      versionId,
      row.tripId,
      row.startSeconds,
      row.endSeconds,
      row.headwaySeconds,
      row.exactTimes,
    ]),
  );

  await batchInsert(
    client,
    `insert into transit.transfer (
      id, mobility_entity_id, dataset_version_id,
      from_stop_id, from_station_id, to_stop_id, to_station_id,
      transfer_type, min_transfer_seconds, walking_distance_m, geom,
      validation_status
    )`,
    feed.transfers.map((row) => [
      row.id,
      row.mobilityEntityId,
      versionId,
      row.fromStopId,
      row.fromStationId,
      row.toStopId,
      row.toStationId,
      row.transferType,
      row.minTransferSeconds,
      null,
      lineWkt(row.points),
      'VALIDATED',
    ]),
    (offset) =>
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, ` +
      `$${offset + 4}::uuid, $${offset + 5}::uuid, $${offset + 6}::uuid, ` +
      `$${offset + 7}::uuid, $${offset + 8}, $${offset + 9}, $${offset + 10}, ` +
      `ST_GeomFromText($${offset + 11}, 4326), $${offset + 12})`,
  );

  await batchInsert(
    client,
    `insert into transit.transit_segment (
      id, mobility_entity_id, dataset_version_id, route_id,
      from_stop_id, to_stop_id, direction_id, geom
    )`,
    feed.transitSegments.map((row) => [
      row.id,
      row.mobilityEntityId,
      versionId,
      row.routeId,
      row.fromStopId,
      row.toStopId,
      row.directionId,
      lineWkt(row.points),
    ]),
    (offset) =>
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, ` +
      `$${offset + 4}::uuid, $${offset + 5}::uuid, $${offset + 6}::uuid, ` +
      `$${offset + 7}, ST_GeomFromText($${offset + 8}, 4326))`,
  );

  await batchInsert(
    client,
    `insert into transit.trip_segment_traversal (
      id, dataset_version_id, transit_segment_id, trip_id, route_id,
      from_stop_id, to_stop_id, transit_shape_id, direction_id,
      segment_sequence, geom
    )`,
    feed.tripSegmentTraversals.map((row) => [
      row.id,
      versionId,
      row.transitSegmentId,
      row.tripId,
      row.routeId,
      row.fromStopId,
      row.toStopId,
      row.transitShapeId,
      row.directionId,
      row.segmentSequence,
      lineWkt(row.points),
    ]),
    (offset) =>
      `($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, ` +
      `$${offset + 4}::uuid, $${offset + 5}::uuid, $${offset + 6}::uuid, ` +
      `$${offset + 7}::uuid, $${offset + 8}::uuid, $${offset + 9}, ` +
      `$${offset + 10}, ST_GeomFromText($${offset + 11}, 4326))`,
  );
}

async function deleteCanonicalRows(
  client: PoolClient,
  datasetVersionId: string,
): Promise<void> {
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
    await client.query(
      `delete from ${table} where dataset_version_id = $1::uuid`,
      [datasetVersionId],
    );
  }
  await client.query(
    `delete from twin.mobility_entity
     where creation_dataset_version_id = $1::uuid`,
    [datasetVersionId],
  );
}

export async function ingestGtfsFeed(
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
  feed: NormalizedGtfsFeed,
): Promise<IngestionResult> {
  const pool = new Pool(getDatabaseConfig());
  const client = await pool.connect();
  let ingestionRunId: string | null = null;
  let advisoryLockHeld = false;
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [
      manifest.datasetVersionId,
    ]);
    advisoryLockHeld = true;
    await client.query('begin');
    await registerProvenance(client, registry, manifest, feed);
    const prior = await client.query<{
      id: string;
      recordsRead: string;
      recordsWritten: string;
      recordsRejected: string;
    }>(
      `select id,
        records_read::text as "recordsRead",
        records_written::text as "recordsWritten",
        records_rejected::text as "recordsRejected"
       from meta.ingestion_run
       where dataset_version_id = $1::uuid
         and status = 'SUCCEEDED'
         and pipeline_version = $2
       order by completed_at desc, id
       limit 1`,
      [manifest.datasetVersionId, GTFS_PIPELINE_VERSION],
    );
    const completed = prior.rows[0];
    if (completed !== undefined) {
      await client.query('commit');
      return {
        status: 'ALREADY_IMPORTED',
        ingestionRunId: completed.id,
        datasetVersionId: manifest.datasetVersionId,
        recordsRead: Number(completed.recordsRead),
        recordsWritten: Number(completed.recordsWritten),
        recordsRejected: Number(completed.recordsRejected),
      };
    }
    const replaced = await client.query<{ id: string }>(
      `select id from meta.ingestion_run
       where dataset_version_id = $1::uuid and status = 'SUCCEEDED'
       order by completed_at desc, id
       limit 1`,
      [manifest.datasetVersionId],
    );
    ingestionRunId = randomUUID();
    await client.query(
      `insert into meta.ingestion_run (
        id, dataset_version_id, started_at, status, records_read,
        records_written, records_rejected, pipeline_version,
        replaces_ingestion_run_id
      ) values ($1::uuid, $2::uuid, now(), 'RUNNING', $3, 0, $4, $5, $6::uuid)`,
      [
        ingestionRunId,
        manifest.datasetVersionId,
        feed.report.metrics.recordsRead,
        feed.report.metrics.rowsRejected,
        GTFS_PIPELINE_VERSION,
        replaced.rows[0]?.id ?? null,
      ],
    );
    await client.query('commit');

    const written =
      feed.report.metrics.recordsRead - feed.report.metrics.rowsRejected;
    await client.query('begin');
    if (replaced.rows[0] !== undefined) {
      await deleteCanonicalRows(client, manifest.datasetVersionId);
    }
    await insertCanonicalRows(client, manifest, feed);
    await client.query(
      `update meta.ingestion_run
       set status = 'SUCCEEDED', completed_at = now(), records_written = $2
       where id = $1::uuid`,
      [ingestionRunId, written],
    );
    await client.query('commit');
    return {
      status: 'COMPLETED',
      ingestionRunId,
      datasetVersionId: manifest.datasetVersionId,
      recordsRead: feed.report.metrics.recordsRead,
      recordsWritten: written,
      recordsRejected: feed.report.metrics.rowsRejected,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (ingestionRunId !== null) {
      const message =
        error instanceof Error ? error.message : 'Unknown ingestion failure';
      await client
        .query(
          `update meta.ingestion_run
           set status = 'FAILED', completed_at = now(), records_written = 0,
               error_summary = $2
           where id = $1::uuid and status = 'RUNNING'`,
          [ingestionRunId, message.slice(0, 2000)],
        )
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (advisoryLockHeld) {
      await client
        .query('select pg_advisory_unlock(hashtextextended($1, 0))', [
          manifest.datasetVersionId,
        ])
        .catch(() => undefined);
    }
    client.release();
    await pool.end();
  }
}

export async function getCanonicalCounts(
  datasetVersionId: string,
): Promise<CanonicalCounts> {
  const pool = new Pool(getDatabaseConfig());
  try {
    const result = await pool.query<Record<string, string>>(
      `select
        (select count(*) from transit.operator where dataset_version_id = $1::uuid)::text as operators,
        (select count(*) from transit.route where dataset_version_id = $1::uuid)::text as routes,
        (select count(*) from transit.station where dataset_version_id = $1::uuid)::text as stations,
        (select count(*) from transit.stop where dataset_version_id = $1::uuid)::text as stops,
        (select count(*) from transit.service_calendar where dataset_version_id = $1::uuid)::text as "serviceCalendars",
        '0'::text as "serviceExceptions",
        (select count(*) from transit.trip_frequency where dataset_version_id = $1::uuid)::text as "tripFrequencies",
        (select count(*) from transit.transit_shape where dataset_version_id = $1::uuid)::text as shapes,
        (select count(*) from transit.trip where dataset_version_id = $1::uuid)::text as trips,
        (select count(*) from transit.stop_time where dataset_version_id = $1::uuid)::text as "stopTimes",
        (select count(*) from transit.transfer where dataset_version_id = $1::uuid)::text as transfers,
        (select count(*) from transit.transit_segment where dataset_version_id = $1::uuid)::text as "transitSegments",
        (select count(*) from transit.trip_segment_traversal where dataset_version_id = $1::uuid)::text as "tripSegmentTraversals",
        (select count(*) from twin.mobility_entity where creation_dataset_version_id = $1::uuid)::text as "mobilityEntities",
        (
          (select count(*) from transit.station where dataset_version_id = $1::uuid and (ST_IsEmpty(geom) or not ST_IsValid(geom))) +
          (select count(*) from transit.stop where dataset_version_id = $1::uuid and (ST_IsEmpty(geom) or not ST_IsValid(geom))) +
          (select count(*) from transit.transit_shape where dataset_version_id = $1::uuid and (ST_IsEmpty(geom) or not ST_IsValid(geom))) +
          (select count(*) from transit.transfer where dataset_version_id = $1::uuid and geom is not null and (ST_IsEmpty(geom) or not ST_IsValid(geom))) +
          (select count(*) from transit.transit_segment where dataset_version_id = $1::uuid and (ST_IsEmpty(geom) or not ST_IsValid(geom)))
          + (select count(*) from transit.trip_segment_traversal where dataset_version_id = $1::uuid and (ST_IsEmpty(geom) or not ST_IsValid(geom)))
        )::text as "invalidGeometries"`,
      [datasetVersionId],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new Error('Canonical count query returned no row');
    return {
      operators: Number(row['operators']),
      routes: Number(row['routes']),
      stations: Number(row['stations']),
      stops: Number(row['stops']),
      serviceCalendars: Number(row['serviceCalendars']),
      serviceExceptions: Number(row['serviceExceptions']),
      tripFrequencies: Number(row['tripFrequencies']),
      shapes: Number(row['shapes']),
      trips: Number(row['trips']),
      stopTimes: Number(row['stopTimes']),
      transfers: Number(row['transfers']),
      transitSegments: Number(row['transitSegments']),
      tripSegmentTraversals: Number(row['tripSegmentTraversals']),
      mobilityEntities: Number(row['mobilityEntities']),
      invalidGeometries: Number(row['invalidGeometries']),
    };
  } finally {
    await pool.end();
  }
}
