import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { parse } from 'csv-parse/sync';
import yazl from 'yazl';

import { readRailTopologyFromOpl } from '../spatial/osm/rail-topology-reader.js';
import { readGtfsArchive } from '../transit/gtfs/gtfs-archive.js';
import { validateGtfsArchive } from '../transit/gtfs/gtfs-validator.js';
import type { ControlledRoutingRepresentation } from './domain/controlled-routing.js';
import {
  FEED_PRODUCT_MODE,
  namespaceId,
  serviceCalendarApplies,
  validateServiceDatePolicies,
  type FeedKey,
  type ServiceDatePolicy,
} from './domain/otp-input.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configPath = path.join(
  repositoryRoot,
  'data/registry/phase4b-router-input-config.json',
);
const outputRoot = path.join(
  repositoryRoot,
  'data/processed/routing/phase4b-a',
);
const inputDirectory = path.join(outputRoot, 'input');
const fixedZipTime = new Date('1980-01-01T00:00:00.000Z');

interface ArtifactRef {
  readonly path: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly sourceSnapshotId?: string;
}

interface InputConfig {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly generatedAt: string;
  readonly timezone: 'Asia/Jakarta';
  readonly transjakartaArchive: ArtifactRef & { readonly sourceId: string };
  readonly controlledRailSnapshot: ArtifactRef & { readonly sha256: string };
  readonly railTopologyOpl: ArtifactRef & { readonly sourceSnapshotId: string };
  readonly osm: ArtifactRef & {
    readonly bytes: number;
    readonly sha256: string;
    readonly sourceSnapshotId: string;
    readonly license: string;
  };
  readonly serviceDates: readonly ServiceDatePolicy[];
  readonly coordinateOverrides?: Readonly<
    Record<
      string,
      Readonly<Record<string, Coordinate & { readonly reason: string }>>
    >
  >;
}

interface CsvRow {
  readonly [column: string]: string;
}

interface ControlledSnapshot {
  readonly representations: readonly ControlledRoutingRepresentation[];
}

interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
  readonly sourceReference: string;
}

interface FeedResult {
  readonly feedKey: FeedKey;
  readonly productMode: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly timingPrecision: string;
  readonly representativeDate: string;
}

function absolute(relativePath: string): string {
  return path.join(repositoryRoot, relativePath);
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function assertArtifact(artifact: ArtifactRef): Promise<void> {
  const filePath = absolute(artifact.path);
  const metadata = await stat(filePath);
  if (artifact.bytes !== undefined && metadata.size !== artifact.bytes)
    throw new Error(`${artifact.path}: byte-size mismatch`);
  if (
    artifact.sha256 !== undefined &&
    (await sha256(filePath)) !== artifact.sha256
  )
    throw new Error(`${artifact.path}: checksum mismatch`);
}

function parseCsv(text: string): CsvRow[] {
  return parse(text, {
    bom: true,
    columns: true,
    relaxColumnCount: false,
    skipEmptyLines: true,
  }) as CsvRow[];
}

function csvValue(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: readonly Readonly<Record<string, unknown>>[]): string {
  if (rows.length === 0) throw new Error('Cannot write CSV without rows');
  const columns = Object.keys(rows[0] as object);
  return `${columns.join(',')}\n${rows
    .map((row) => columns.map((column) => csvValue(row[column])).join(','))
    .join('\n')}\n`;
}

async function writeZip(
  filePath: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const archive = new yazl.ZipFile();
  for (const name of Object.keys(files).sort()) {
    archive.addBuffer(Buffer.from(files[name] as string, 'utf8'), name, {
      mtime: fixedZipTime,
      mode: 0o100644,
      compress: true,
    });
  }
  const complete = new Promise<void>((resolve, reject) => {
    archive.outputStream
      .pipe(createWriteStream(filePath, { mode: 0o600 }))
      .once('close', resolve)
      .once('error', reject);
  });
  archive.end();
  await complete;
}

function prefixed(feed: FeedKey, entity: string, value: string): string {
  return value === '' ? '' : namespaceId(feed, entity, value);
}

function remapRow(
  row: CsvRow,
  feed: FeedKey,
  mappings: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      mappings[column] === undefined
        ? value
        : prefixed(feed, mappings[column] as string, value),
    ]),
  );
}

async function buildTransjakartaFeed(
  config: InputConfig,
  feed: 'tj' | 'mikro',
): Promise<FeedResult> {
  const archive = await readGtfsArchive(
    absolute(config.transjakartaArchive.path),
  );
  const rows = (name: string): CsvRow[] => {
    const entry = archive.entries.get(name);
    if (entry === undefined) throw new Error(`Official GTFS missing ${name}`);
    return parseCsv(entry.text);
  };
  const allRoutes = rows('routes.txt');
  const routes = allRoutes.filter((route) =>
    feed === 'mikro'
      ? route.route_desc === 'Mikrotrans'
      : route.route_desc !== 'Mikrotrans',
  );
  const routeIds = new Set(routes.map((route) => route.route_id));
  const trips = rows('trips.txt').filter((trip) => routeIds.has(trip.route_id));
  const tripIds = new Set(trips.map((trip) => trip.trip_id));
  const stopTimes = rows('stop_times.txt').filter((row) =>
    tripIds.has(row.trip_id),
  );
  const stopIds = new Set(stopTimes.map((row) => row.stop_id));
  const allStops = rows('stops.txt');
  let changed = true;
  while (changed) {
    changed = false;
    for (const stop of allStops) {
      if (
        stopIds.has(stop.stop_id) &&
        stop.parent_station !== '' &&
        !stopIds.has(stop.parent_station)
      ) {
        stopIds.add(stop.parent_station);
        changed = true;
      }
    }
  }
  const stops = allStops.filter((stop) => stopIds.has(stop.stop_id));
  const serviceIds = new Set(trips.map((trip) => trip.service_id));
  const shapeIds = new Set(trips.map((trip) => trip.shape_id).filter(Boolean));
  const calendars = rows('calendar.txt').filter((row) =>
    serviceIds.has(row.service_id),
  );
  const shapes = rows('shapes.txt').filter((row) => shapeIds.has(row.shape_id));
  const frequencies = rows('frequencies.txt').filter((row) =>
    tripIds.has(row.trip_id),
  );
  const transfers = rows('transfers.txt').filter(
    (row) => stopIds.has(row.from_stop_id) && stopIds.has(row.to_stop_id),
  );
  const agencies = rows('agency.txt');
  const output: Record<string, string> = {
    'agency.txt': csv(
      agencies.map((row) => ({
        ...remapRow(row, feed, { agency_id: 'agency' }),
        agency_timezone: 'Asia/Jakarta',
      })),
    ),
    'calendar.txt': csv(
      calendars.map((row) => remapRow(row, feed, { service_id: 'service' })),
    ),
    'feed_info.txt': csv([
      {
        feed_publisher_name: `TRANSUM-IN deterministic derivative: ${FEED_PRODUCT_MODE[feed]}`,
        feed_publisher_url: 'https://transjakarta.co.id/',
        feed_lang: 'id',
        feed_start_date: '20260929',
        feed_end_date: '20271231',
        feed_version: config.transjakartaArchive.sha256,
      },
    ]),
    'routes.txt': csv(
      routes.map((row) =>
        remapRow(row, feed, { agency_id: 'agency', route_id: 'route' }),
      ),
    ),
    'shapes.txt': csv(
      shapes.map((row) => remapRow(row, feed, { shape_id: 'shape' })),
    ),
    'stop_times.txt': csv(
      stopTimes.map((row) =>
        remapRow(row, feed, { stop_id: 'stop', trip_id: 'trip' }),
      ),
    ),
    'stops.txt': csv(
      stops.map((row) =>
        remapRow(row, feed, { stop_id: 'stop', parent_station: 'stop' }),
      ),
    ),
    'trips.txt': csv(
      trips.map((row) =>
        remapRow(row, feed, {
          route_id: 'route',
          service_id: 'service',
          trip_id: 'trip',
          shape_id: 'shape',
        }),
      ),
    ),
  };
  if (frequencies.length > 0)
    output['frequencies.txt'] = csv(
      frequencies.map((row) => remapRow(row, feed, { trip_id: 'trip' })),
    );
  if (transfers.length > 0)
    output['transfers.txt'] = csv(
      transfers.map((row) =>
        remapRow(row, feed, {
          from_stop_id: 'stop',
          to_stop_id: 'stop',
          from_route_id: 'route',
          to_route_id: 'route',
          from_trip_id: 'trip',
          to_trip_id: 'trip',
        }),
      ),
    );
  const file = `${feed}.gtfs.zip`;
  const filePath = path.join(inputDirectory, file);
  await writeZip(filePath, output);
  const policy = config.serviceDates.find((item) => item.feedKey === feed);
  if (policy === undefined) throw new Error(`Missing temporal policy: ${feed}`);
  return {
    feedKey: feed,
    productMode: FEED_PRODUCT_MODE[feed],
    file,
    sha256: await sha256(filePath),
    bytes: (await stat(filePath)).size,
    counts: {
      agencies: agencies.length,
      routes: routes.length,
      trips: trips.length,
      stopTimes: stopTimes.length,
      stops: stops.length,
      shapes: shapeIds.size,
      frequencies: frequencies.length,
    },
    timingPrecision:
      frequencies.length > 0 ? 'SOURCE_GTFS_WITH_FREQUENCIES' : 'SOURCE_GTFS',
    representativeDate: policy.representativeDate,
  };
}

function decodeOpl(value: string): string {
  return value
    .replace(/%20%?/g, ' ')
    .replace(/%2c%?/gi, ',')
    .replace(/%28%?/gi, '(')
    .replace(/%29%?/gi, ')');
}

function parseOplTags(token: string): Record<string, string> {
  if (token === 'T') return {};
  return Object.fromEntries(
    token
      .slice(1)
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf('=');
        return index < 0
          ? [decodeOpl(entry), '']
          : [
              decodeOpl(entry.slice(0, index)),
              decodeOpl(entry.slice(index + 1)),
            ];
      }),
  );
}

async function readReferencedRailCoordinates(
  filePath: string,
): Promise<Map<string, Coordinate>> {
  const result = new Map<string, Coordinate>();
  const lines = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.startsWith('n')) continue;
    const parts = line.split(' ');
    const x = parts.find((part) => part.startsWith('x'));
    const y = parts.find((part) => part.startsWith('y'));
    const tagsToken = parts.find((part) => part.startsWith('T'));
    if (x === undefined || y === undefined || tagsToken === undefined) continue;
    const tags = parseOplTags(tagsToken);
    const reference = tags['railway:ref'] ?? tags.ref;
    if (reference === undefined) continue;
    const candidate = {
      longitude: Number(x.slice(1)),
      latitude: Number(y.slice(1)),
      sourceReference: `osm:node/${(parts[0] as string).slice(1)}`,
    };
    if (tags.public_transport === 'station' || !result.has(reference))
      result.set(reference, candidate);
  }
  return result;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('id-ID')
    .replaceAll('bank syariah indonesia', 'bni')
    .replaceAll('grab', '')
    .replaceAll('bni', '')
    .replaceAll('mastercard', '')
    .replaceAll('indomaret', '')
    .replaceAll('tuku', '')
    .replaceAll('visa', '')
    .replaceAll('headquarters', '')
    .replaceAll('summarecon mall', '')
    .replaceAll('bank bjb', '')
    .replace(/[^a-z0-9]+/g, '');
}

function secondsToGtfs(value: number): string {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function dateCompact(value: string): string {
  return value.replaceAll('-', '');
}

async function buildRailFeed(
  config: InputConfig,
  representation: ControlledRoutingRepresentation,
  coordinatesByReference: ReadonlyMap<string, Coordinate>,
): Promise<FeedResult> {
  const feedByMode = {
    KRL: 'krl',
    MRT_JAKARTA: 'mrt',
    LRT_JAKARTA: 'lrtj',
    LRT_JABODEBEK: 'lrtjb',
  } as const;
  const feed = feedByMode[representation.mode];
  const topology = await readRailTopologyFromOpl(
    absolute(config.railTopologyOpl.path),
    config.railTopologyOpl.sourceSnapshotId,
  );
  const topologyStations = topology.stations.filter(
    (station) => station.operatorKey === representation.mode,
  );
  const byName = new Map(
    topologyStations.map((station) => [
      normalizeName(station.name),
      {
        latitude: station.latitude,
        longitude: station.longitude,
        sourceReference: `osm:${station.externalId}`,
      },
    ]),
  );
  const stationName = new Map<string, string>();
  if (representation.mode === 'KRL') {
    const configDocument = JSON.parse(
      await readFile(
        absolute('data/registry/phase4ar-controlled-routing-config.json'),
        'utf8',
      ),
    ) as { krl: { stationNames: Record<string, string> } };
    const referencedStops = new Set(
      (representation.exactTrips ?? []).flatMap((trip) =>
        trip.stopTimes
          .filter((stopTime) => stopTime.timeSeconds !== null)
          .map((stopTime) => stopTime.stopId),
      ),
    );
    for (const [id, name] of Object.entries(configDocument.krl.stationNames))
      if (referencedStops.has(id)) stationName.set(id, name);
  } else {
    for (const pattern of representation.frequencyPatterns ?? [])
      for (const stop of pattern.stops) stationName.set(stop.id, stop.name);
  }
  const stops = [...stationName]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, name]) => {
      const coordinate =
        config.coordinateOverrides?.[representation.mode]?.[id] ??
        (representation.mode === 'KRL'
          ? coordinatesByReference.get(id)
          : undefined) ??
        byName.get(normalizeName(name));
      if (coordinate === undefined)
        throw new Error(
          `${representation.mode}: no Phase-2 OSM coordinate for ${id} (${name})`,
        );
      return {
        stop_id: namespaceId(feed, 'stop', id),
        stop_name: name,
        stop_lat: coordinate.latitude,
        stop_lon: coordinate.longitude,
        location_type: 0,
        wheelchair_boarding: 0,
        tnx_original_id: id,
        tnx_source_reference: coordinate.sourceReference,
      };
    });
  const policy = config.serviceDates.find((item) => item.feedKey === feed);
  if (policy === undefined) throw new Error(`Missing temporal policy: ${feed}`);
  const serviceDate = dateCompact(policy.representativeDate);
  const representativeDay = new Date(
    `${policy.representativeDate}T12:00:00Z`,
  ).getUTCDay();
  const routes: Array<Record<string, unknown>> = [];
  const trips: Array<Record<string, unknown>> = [];
  const stopTimes: Array<Record<string, unknown>> = [];
  const frequencies: Array<Record<string, unknown>> = [];
  const serviceIds = new Set<string>();

  if (representation.precision === 'EXACT_SCHEDULE') {
    const routeIds = new Set<string>();
    for (const sourceTrip of representation.exactTrips ?? []) {
      if (
        !serviceCalendarApplies(sourceTrip.serviceCalendar, representativeDay)
      )
        continue;
      const routeOriginal = sourceTrip.relation;
      const routeId = namespaceId(feed, 'route', routeOriginal);
      if (!routeIds.has(routeId)) {
        routeIds.add(routeId);
        routes.push({
          route_id: routeId,
          agency_id: namespaceId(feed, 'agency', representation.mode),
          route_short_name: sourceTrip.relation,
          route_long_name: `KRL ${sourceTrip.relation}`,
          route_type: 2,
          tnx_product_mode: FEED_PRODUCT_MODE[feed],
          tnx_original_id: routeOriginal,
        });
      }
      const serviceOriginal = sourceTrip.serviceCalendar;
      const serviceId = namespaceId(feed, 'service', serviceOriginal);
      const tripId = namespaceId(feed, 'trip', sourceTrip.serviceId);
      trips.push({
        route_id: routeId,
        service_id: serviceId,
        trip_id: tripId,
        trip_headsign: sourceTrip.relation,
        direction_id: 0,
        tnx_product_mode: FEED_PRODUCT_MODE[feed],
        tnx_original_id: sourceTrip.serviceId,
      });
      sourceTrip.stopTimes.forEach((stopTime, index) => {
        if (stopTime.timeSeconds === null) return;
        stopTimes.push({
          trip_id: tripId,
          arrival_time: secondsToGtfs(stopTime.timeSeconds),
          departure_time: secondsToGtfs(stopTime.timeSeconds),
          stop_id: namespaceId(feed, 'stop', stopTime.stopId),
          stop_sequence: index + 1,
          pickup_type: stopTime.passThrough ? 1 : 0,
          drop_off_type: stopTime.passThrough ? 1 : 0,
        });
      });
    }
    for (const serviceCalendar of new Set(
      (representation.exactTrips ?? []).map((trip) => trip.serviceCalendar),
    ))
      serviceIds.add(namespaceId(feed, 'service', serviceCalendar));
  } else {
    const routeId = namespaceId(feed, 'route', representation.mode);
    routes.push({
      route_id: routeId,
      agency_id: namespaceId(feed, 'agency', representation.mode),
      route_short_name: representation.mode,
      route_long_name: representation.mode.replaceAll('_', ' '),
      route_type: representation.mode === 'MRT_JAKARTA' ? 1 : 0,
      tnx_product_mode: FEED_PRODUCT_MODE[feed],
      tnx_original_id: representation.mode,
    });
    for (const pattern of representation.frequencyPatterns ?? []) {
      const windowCalendars = new Set(
        pattern.windows.map((window) => window.serviceCalendar),
      );
      for (const calendar of windowCalendars) {
        if (!serviceCalendarApplies(calendar, representativeDay)) continue;
        const serviceId = namespaceId(feed, 'service', calendar);
        const tripOriginal = `${pattern.id}:${calendar}`;
        const tripId = namespaceId(feed, 'trip', tripOriginal);
        trips.push({
          route_id: routeId,
          service_id: serviceId,
          trip_id: tripId,
          trip_headsign: pattern.direction,
          direction_id:
            pattern.id.includes('westbound') ||
            pattern.id.includes('southbound') ||
            pattern.id.includes('outbound')
              ? 1
              : 0,
          tnx_product_mode: FEED_PRODUCT_MODE[feed],
          tnx_original_id: tripOriginal,
          tnx_timing_precision: representation.precision,
        });
        pattern.stops.forEach((stop, index) => {
          const seconds = Math.round(
            (pattern.endToEndSeconds * index) / (pattern.stops.length - 1),
          );
          stopTimes.push({
            trip_id: tripId,
            arrival_time: secondsToGtfs(seconds),
            departure_time: secondsToGtfs(seconds),
            stop_id: namespaceId(feed, 'stop', stop.id),
            stop_sequence: index + 1,
            pickup_type: stop.boardingAllowed === false ? 1 : 0,
            drop_off_type: stop.boardingAllowed === false ? 1 : 0,
          });
        });
        for (const window of pattern.windows.filter(
          (item) => item.serviceCalendar === calendar,
        ))
          frequencies.push({
            trip_id: tripId,
            start_time: secondsToGtfs(window.startSeconds),
            end_time: secondsToGtfs(window.endSeconds),
            headway_secs: window.headwaySeconds,
            exact_times: 0,
          });
        serviceIds.add(serviceId);
      }
    }
  }
  const calendarRows = [...serviceIds].sort().map((serviceId) => ({
    service_id: serviceId,
    monday: representativeDay === 1 ? 1 : 0,
    tuesday: representativeDay === 2 ? 1 : 0,
    wednesday: representativeDay === 3 ? 1 : 0,
    thursday: representativeDay === 4 ? 1 : 0,
    friday: representativeDay === 5 ? 1 : 0,
    saturday: representativeDay === 6 ? 1 : 0,
    sunday: representativeDay === 0 ? 1 : 0,
    start_date: serviceDate,
    end_date: serviceDate,
  }));
  const files: Record<string, string> = {
    'agency.txt': csv([
      {
        agency_id: namespaceId(feed, 'agency', representation.mode),
        agency_name: `${representation.mode.replaceAll('_', ' ')} controlled research routing`,
        agency_url: 'https://github.com/opentripplanner/OpenTripPlanner',
        agency_timezone: 'Asia/Jakarta',
        agency_lang: 'id',
      },
    ]),
    'calendar.txt': csv(calendarRows),
    'feed_info.txt': csv([
      {
        feed_publisher_name:
          'TRANSUM-IN controlled noncommercial research derivative',
        feed_publisher_url:
          'https://github.com/opentripplanner/OpenTripPlanner',
        feed_lang: 'id',
        feed_start_date: serviceDate,
        feed_end_date: serviceDate,
        feed_version: `${representation.sourceId}:${representation.sourceChecksum}`,
      },
    ]),
    'routes.txt': csv(routes),
    'stops.txt': csv(stops),
    'stop_times.txt': csv(stopTimes),
    'trips.txt': csv(trips),
  };
  if (frequencies.length > 0) files['frequencies.txt'] = csv(frequencies);
  const file = `${feed}.gtfs.zip`;
  const filePath = path.join(inputDirectory, file);
  await writeZip(filePath, files);
  return {
    feedKey: feed,
    productMode: FEED_PRODUCT_MODE[feed],
    file,
    sha256: await sha256(filePath),
    bytes: (await stat(filePath)).size,
    counts: {
      routes: routes.length,
      trips: trips.length,
      stopTimes: stopTimes.length,
      stops: stops.length,
      frequencies: frequencies.length,
      serviceDates: calendarRows.length,
    },
    timingPrecision: representation.precision,
    representativeDate: policy.representativeDate,
  };
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'prepare' && process.argv[2] !== 'validate')
    throw new Error('Expected command: prepare or validate');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as InputConfig;
  if (config.schemaVersion !== 1)
    throw new Error('Unsupported router-input config');
  const policyErrors = validateServiceDatePolicies(config.serviceDates);
  if (policyErrors.length > 0) throw new Error(policyErrors.join('; '));
  await Promise.all([
    assertArtifact(config.transjakartaArchive),
    assertArtifact(config.controlledRailSnapshot),
    assertArtifact(config.railTopologyOpl),
    assertArtifact(config.osm),
  ]);
  await mkdir(inputDirectory, { recursive: true });
  const controlled = JSON.parse(
    await readFile(absolute(config.controlledRailSnapshot.path), 'utf8'),
  ) as ControlledSnapshot;
  const referencedCoordinates = await readReferencedRailCoordinates(
    absolute(config.railTopologyOpl.path),
  );
  const feeds: FeedResult[] = [];
  feeds.push(await buildTransjakartaFeed(config, 'tj'));
  feeds.push(await buildTransjakartaFeed(config, 'mikro'));
  for (const representation of controlled.representations)
    feeds.push(
      await buildRailFeed(config, representation, referencedCoordinates),
    );
  feeds.sort((a, b) => a.feedKey.localeCompare(b.feedKey));
  const osmFile = 'phase2a-spatial.osm.pbf';
  await copyFile(absolute(config.osm.path), path.join(inputDirectory, osmFile));
  await writeFile(
    path.join(inputDirectory, 'build-config.json'),
    `${JSON.stringify(
      {
        transitServiceStart: '2025-12-13',
        transitServiceEnd: '2026-10-03',
        osmCacheDataInMem: true,
        areaVisibility: false,
        platformEntriesLinking: false,
        maxDataImportIssuesPerFile: 100,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(inputDirectory, 'router-config.json'), '{}\n');
  const manifest = {
    schemaVersion: 1,
    snapshotId: config.snapshotId,
    generatedAt: config.generatedAt,
    timezone: config.timezone,
    namespaceStrategy:
      'tnx:<feed-key>:<entity-type>:<percent-encoded-original-id>',
    originalIdRecovery:
      'decode the suffix after the first three colon-delimited components',
    modeMapping: FEED_PRODUCT_MODE,
    serviceDates: config.serviceDates,
    osm: {
      file: osmFile,
      sha256: await sha256(path.join(inputDirectory, osmFile)),
      bytes: (await stat(path.join(inputDirectory, osmFile))).size,
      sourceSnapshotId: config.osm.sourceSnapshotId,
      license: config.osm.license,
    },
    feeds,
    validation: await (async () => {
      const globalDefinitions = new Set<string>();
      const feedResults: Array<Record<string, unknown>> = [];
      let definitionsTotal = 0;
      let collisions = 0;
      let orphanReferences = 0;
      let duplicateOrConflictingSourceIds = 0;
      for (const feed of feeds) {
        const archive = await readGtfsArchive(
          path.join(inputDirectory, feed.file),
        );
        const validation = validateGtfsArchive(archive).report;
        if (validation.status === 'INVALID')
          throw new Error(
            `${feed.feedKey}: generated GTFS invalid: ${validation.issues
              .filter((issue) => issue.severity === 'ERROR')
              .map((issue) => issue.code)
              .join(', ')}`,
          );
        const definitionFiles: ReadonlyArray<
          readonly [string, string, string]
        > = [
          ['agency.txt', 'agency_id', 'agency'],
          ['routes.txt', 'route_id', 'route'],
          ['trips.txt', 'trip_id', 'trip'],
          ['stops.txt', 'stop_id', 'stop'],
          ['calendar.txt', 'service_id', 'service'],
        ];
        let definitionCount = 0;
        for (const [file, column, entity] of definitionFiles) {
          const entry = archive.entries.get(file);
          if (entry === undefined) continue;
          for (const row of parseCsv(entry.text)) {
            const id = row[column];
            if (id === undefined)
              throw new Error(`${feed.feedKey}:${file}: missing ${column}`);
            if (!id.startsWith(`tnx:${feed.feedKey}:${entity}:`))
              throw new Error(
                `${feed.feedKey}:${file}: non-namespaced ${column}`,
              );
            if (globalDefinitions.has(id)) collisions += 1;
            else globalDefinitions.add(id);
            definitionCount += 1;
          }
        }
        definitionsTotal += definitionCount;
        orphanReferences += validation.metrics.orphanRecords;
        duplicateOrConflictingSourceIds += validation.metrics.duplicateIds;
        feedResults.push({
          feedKey: feed.feedKey,
          status: validation.status,
          errors: 0,
          warnings: validation.issues
            .filter((issue) => issue.severity === 'WARNING')
            .reduce((sum, issue) => sum + issue.count, 0),
          orphanRecords: validation.metrics.orphanRecords,
          duplicateIds: validation.metrics.duplicateIds,
          definitionsChecked: definitionCount,
        });
      }
      if (collisions > 0)
        throw new Error(`Global namespace collisions: ${collisions}`);
      return {
        gtfs: feedResults,
        definitionsTotal,
        uniqueNamespacedIds: globalDefinitions.size,
        collisions,
        orphanReferences,
        duplicateOrConflictingSourceIds,
        globalDefinitionsChecked: globalDefinitions.size,
        timezone: 'Asia/Jakarta',
        referentialErrors: orphanReferences,
      };
    })(),
    rights: {
      tj: 'CC-BY-4.0_SOURCE_DERIVATIVE',
      mikro: 'CC-BY-4.0_SOURCE_DERIVATIVE',
      krl: 'LOCAL_NONCOMMERCIAL_RESEARCH_ONLY_NO_REDISTRIBUTION',
      mrt: 'LOCAL_NONCOMMERCIAL_RESEARCH_ONLY_NO_REDISTRIBUTION',
      lrtj: 'LOCAL_NONCOMMERCIAL_RESEARCH_ONLY_NO_REDISTRIBUTION',
      lrtjb: 'LOCAL_NONCOMMERCIAL_RESEARCH_ONLY_NO_REDISTRIBUTION',
    },
    fare: 'UNKNOWN',
  };
  const manifestPath = path.join(outputRoot, 'router-input-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  const trackedManifestPath = absolute(
    'data/manifests/PHASE-4B-A-ROUTER-INPUT.json',
  );
  await writeFile(
    trackedManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      status: 'VALIDATED',
      manifest: path.relative(repositoryRoot, manifestPath),
      trackedManifest: path.relative(repositoryRoot, trackedManifestPath),
      manifestSha256: await sha256(manifestPath),
      feeds,
      osm: manifest.osm,
    })}\n`,
  );
}

await main();
