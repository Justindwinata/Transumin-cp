import { createHash } from 'node:crypto';

import type {
  Coordinate,
  GtfsRow,
  NormalizedGtfsFeed,
  NormalizedTransitSegment,
  NormalizedTripSegmentTraversal,
  ParsedGtfsFeed,
  TransJakartaManifest,
} from './gtfs.types.js';
import { parseGtfsDate, parseGtfsTime } from './gtfs-validator.js';

export function deterministicUuid(...parts: readonly string[]): string {
  const hex = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 32);
  const characters = hex.split('');
  characters[12] = '5';
  const variant = Number.parseInt(characters[16] ?? '0', 16);
  characters[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = characters.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function rows(feed: ParsedGtfsFeed, file: string): readonly GtfsRow[] {
  return feed.rowsByFile.get(file) ?? [];
}

function nullable(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function integerOrNull(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : Number(trimmed);
}

function coordinate(
  row: GtfsRow,
  latitudeKey: string,
  longitudeKey: string,
): Coordinate {
  return {
    latitude: Number(row[latitudeKey]),
    longitude: Number(row[longitudeKey]),
  };
}

function squaredDistance(left: Coordinate, right: Coordinate): number {
  const latitude = left.latitude - right.latitude;
  const longitude = left.longitude - right.longitude;
  return latitude * latitude + longitude * longitude;
}

function nearestIndex(
  points: readonly Coordinate[],
  target: Coordinate,
  startIndex: number,
): number {
  if (points.length === 0) return -1;
  const start = Math.min(Math.max(0, startIndex), points.length - 1);
  let selected = start;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (let index = start; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const distance = squaredDistance(point, target);
    if (distance < selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  }
  return selected;
}

function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

function segmentPoints(
  from: Coordinate,
  to: Coordinate,
  shape: readonly Coordinate[] | undefined,
  fromShapeIndex: number,
  toShapeIndex: number,
): readonly Coordinate[] {
  const candidates = [
    from,
    ...(shape === undefined ||
    fromShapeIndex < 0 ||
    toShapeIndex <= fromShapeIndex
      ? []
      : shape.slice(fromShapeIndex + 1, toShapeIndex + 1)),
    to,
  ];
  const points: Coordinate[] = [];
  for (const point of candidates) {
    const previous = points.at(-1);
    if (previous === undefined || !sameCoordinate(previous, point))
      points.push(point);
  }
  if (
    new Set(points.map((point) => `${point.longitude},${point.latitude}`))
      .size < 2
  ) {
    throw new Error(
      'Unable to derive a non-degenerate segment geometry from source coordinates',
    );
  }
  return points;
}

export function normalizeGtfsFeed(
  parsed: ParsedGtfsFeed,
  manifest: TransJakartaManifest,
): NormalizedGtfsFeed {
  if (parsed.report.status === 'INVALID') {
    throw new Error('Cannot normalize an invalid GTFS feed');
  }
  const versionId = manifest.datasetVersionId;
  const agencyRows = rows(parsed, 'agency.txt');
  const routeRows = rows(parsed, 'routes.txt');
  const stopRows = rows(parsed, 'stops.txt');
  const calendarRows = rows(parsed, 'calendar.txt');
  const shapeRows = rows(parsed, 'shapes.txt');
  const tripRows = rows(parsed, 'trips.txt');
  const stopTimeRows = rows(parsed, 'stop_times.txt');
  const frequencyRows = rows(parsed, 'frequencies.txt');
  const transferRows = rows(parsed, 'transfers.txt');

  const agencyExternalIds = agencyRows.map(
    (row, index) => row['agency_id']?.trim() || `GTFS_AGENCY_${index + 1}`,
  );
  const operatorIdByExternal = new Map<string, string>();
  const operators = agencyRows.map((row, index) => {
    const externalId = agencyExternalIds[index] ?? `GTFS_AGENCY_${index + 1}`;
    const id = deterministicUuid(versionId, 'operator', externalId);
    operatorIdByExternal.set(externalId, id);
    return {
      id,
      externalId,
      code: externalId,
      name: row['agency_name']?.trim() ?? '',
      modeGroup: 'BUS',
    };
  });
  const onlyOperatorId = operators.length === 1 ? operators[0]?.id : undefined;

  const stationIdByExternal = new Map<string, string>();
  const stationCoordinateByExternal = new Map<string, Coordinate>();
  for (const row of stopRows) {
    if ((row['location_type']?.trim() || '0') === '1') {
      const externalId = row['stop_id']?.trim() ?? '';
      stationIdByExternal.set(
        externalId,
        deterministicUuid(versionId, 'station', externalId),
      );
    }
  }
  const stations = stopRows
    .filter((row) => (row['location_type']?.trim() || '0') === '1')
    .map((row) => {
      const externalId = row['stop_id']?.trim() ?? '';
      const id = stationIdByExternal.get(externalId);
      if (id === undefined)
        throw new Error(`Missing normalized station ID: ${externalId}`);
      const parentExternal = row['parent_station']?.trim() ?? '';
      const point = coordinate(row, 'stop_lat', 'stop_lon');
      stationCoordinateByExternal.set(externalId, point);
      return {
        id,
        mobilityEntityId: deterministicUuid(
          versionId,
          'mobility',
          'station',
          externalId,
        ),
        externalId,
        name: row['stop_name']?.trim() ?? '',
        stationType: 'GTFS_LOCATION_TYPE_1',
        parentStationId:
          parentExternal === ''
            ? null
            : (stationIdByExternal.get(parentExternal) ?? null),
        coordinate: point,
      };
    });

  const stopIdByExternal = new Map<string, string>();
  const stopCoordinateByExternal = new Map<string, Coordinate>();
  const stops = stopRows
    .filter((row) => (row['location_type']?.trim() || '0') === '0')
    .map((row) => {
      const externalId = row['stop_id']?.trim() ?? '';
      const id = deterministicUuid(versionId, 'stop', externalId);
      const point = coordinate(row, 'stop_lat', 'stop_lon');
      stopIdByExternal.set(externalId, id);
      stopCoordinateByExternal.set(externalId, point);
      const parentExternal = row['parent_station']?.trim() ?? '';
      return {
        id,
        mobilityEntityId: deterministicUuid(
          versionId,
          'mobility',
          'stop',
          externalId,
        ),
        stationId:
          parentExternal === ''
            ? null
            : (stationIdByExternal.get(parentExternal) ?? null),
        externalId,
        name: row['stop_name']?.trim() ?? '',
        coordinate: point,
      };
    });

  const routeIdByExternal = new Map<string, string>();
  const routes = routeRows.map((row) => {
    const externalId = row['route_id']?.trim() ?? '';
    const agencyExternal = row['agency_id']?.trim() ?? '';
    const operatorId =
      operatorIdByExternal.get(agencyExternal) ?? onlyOperatorId;
    if (operatorId === undefined) {
      throw new Error(`Unable to resolve operator for route ${externalId}`);
    }
    const id = deterministicUuid(versionId, 'route', externalId);
    routeIdByExternal.set(externalId, id);
    const gtfsRouteType = Number(row['route_type']);
    return {
      id,
      mobilityEntityId: deterministicUuid(
        versionId,
        'mobility',
        'route',
        externalId,
      ),
      operatorId,
      externalId,
      shortName: nullable(row['route_short_name']),
      longName: nullable(row['route_long_name']),
      mode: `GTFS_ROUTE_TYPE_${gtfsRouteType}`,
      description: nullable(row['route_desc']),
      sourceUrl: nullable(row['route_url']),
      color: nullable(row['route_color']),
      textColor: nullable(row['route_text_color']),
      sortOrder: integerOrNull(row['route_sort_order']),
      gtfsRouteType,
    };
  });

  const defaultOperatorId = operators[0]?.id;
  if (defaultOperatorId === undefined)
    throw new Error('GTFS feed has no operator');
  const serviceIdByExternal = new Map<string, string>();
  const serviceCalendars = calendarRows.map((row) => {
    const serviceCode = row['service_id']?.trim() ?? '';
    const id = deterministicUuid(versionId, 'service-calendar', serviceCode);
    serviceIdByExternal.set(serviceCode, id);
    const startDate = parseGtfsDate(row['start_date']?.trim() ?? '');
    const endDate = parseGtfsDate(row['end_date']?.trim() ?? '');
    if (startDate === null || endDate === null) {
      throw new Error(`Invalid validated service calendar ${serviceCode}`);
    }
    return {
      id,
      operatorId: defaultOperatorId,
      serviceCode,
      startDate,
      endDate,
      weekdays: [
        row['monday'] === '1',
        row['tuesday'] === '1',
        row['wednesday'] === '1',
        row['thursday'] === '1',
        row['friday'] === '1',
        row['saturday'] === '1',
        row['sunday'] === '1',
      ] as const,
    };
  });

  const sourceShapeRowsById = new Map<string, GtfsRow[]>();
  for (const row of shapeRows) {
    const externalId = row['shape_id']?.trim() ?? '';
    const values = sourceShapeRowsById.get(externalId) ?? [];
    values.push(row);
    sourceShapeRowsById.set(externalId, values);
  }
  const shapeIdByExternal = new Map<string, string>();
  const shapePointsByExternal = new Map<string, readonly Coordinate[]>();
  const shapes = [...sourceShapeRowsById.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([externalId, values]) => {
      values.sort(
        (left, right) =>
          Number(left['shape_pt_sequence']) -
          Number(right['shape_pt_sequence']),
      );
      const points = values.map((row) =>
        coordinate(row, 'shape_pt_lat', 'shape_pt_lon'),
      );
      const id = deterministicUuid(versionId, 'shape', externalId);
      shapeIdByExternal.set(externalId, id);
      shapePointsByExternal.set(externalId, points);
      return { id, externalId, points };
    });

  const tripIdByExternal = new Map<string, string>();
  const trips = tripRows.map((row) => {
    const externalId = row['trip_id']?.trim() ?? '';
    const routeExternal = row['route_id']?.trim() ?? '';
    const serviceExternal = row['service_id']?.trim() ?? '';
    const shapeExternal = row['shape_id']?.trim() ?? '';
    const id = deterministicUuid(versionId, 'trip', externalId);
    tripIdByExternal.set(externalId, id);
    const routeId = routeIdByExternal.get(routeExternal);
    const serviceCalendarId = serviceIdByExternal.get(serviceExternal);
    if (routeId === undefined || serviceCalendarId === undefined) {
      throw new Error(
        `Validated trip references unresolved canonical records: ${externalId}`,
      );
    }
    const direction = nullable(row['direction_id']);
    return {
      id,
      routeId,
      serviceCalendarId,
      transitShapeId:
        shapeExternal === ''
          ? null
          : (shapeIdByExternal.get(shapeExternal) ?? null),
      externalId,
      directionId: direction === null ? null : (Number(direction) as 0 | 1),
      headsign: nullable(row['trip_headsign']),
    };
  });

  const sourceStopTimesByTrip = new Map<string, GtfsRow[]>();
  const stopTimes = stopTimeRows.map((row) => {
    const tripExternal = row['trip_id']?.trim() ?? '';
    const stopExternal = row['stop_id']?.trim() ?? '';
    const stopSequence = Number(row['stop_sequence']);
    const tripId = tripIdByExternal.get(tripExternal);
    const stopId = stopIdByExternal.get(stopExternal);
    const arrivalSeconds = parseGtfsTime(row['arrival_time']?.trim() ?? '');
    const departureSeconds = parseGtfsTime(row['departure_time']?.trim() ?? '');
    if (
      tripId === undefined ||
      stopId === undefined ||
      arrivalSeconds === null ||
      departureSeconds === null
    ) {
      throw new Error(
        `Validated stop time cannot be normalized: ${tripExternal}/${stopSequence}`,
      );
    }
    const values = sourceStopTimesByTrip.get(tripExternal) ?? [];
    values.push(row);
    sourceStopTimesByTrip.set(tripExternal, values);
    return {
      id: deterministicUuid(
        versionId,
        'stop-time',
        tripExternal,
        String(stopSequence),
      ),
      tripId,
      stopId,
      stopSequence,
      arrivalSeconds,
      departureSeconds,
      pickupType: integerOrNull(row['pickup_type']),
      dropoffType: integerOrNull(row['drop_off_type']),
    };
  });

  const tripFrequencies = frequencyRows.map((row, index) => {
    const tripExternal = row['trip_id']?.trim() ?? '';
    const tripId = tripIdByExternal.get(tripExternal);
    const startSeconds = parseGtfsTime(row['start_time']?.trim() ?? '');
    const endSeconds = parseGtfsTime(row['end_time']?.trim() ?? '');
    const headwaySeconds = Number(row['headway_secs']);
    if (
      tripId === undefined ||
      startSeconds === null ||
      endSeconds === null ||
      !Number.isInteger(headwaySeconds)
    ) {
      throw new Error(
        `Validated frequency cannot be normalized: row ${index + 2}`,
      );
    }
    return {
      id: deterministicUuid(
        versionId,
        'trip-frequency',
        tripExternal,
        String(startSeconds),
        String(endSeconds),
      ),
      tripId,
      startSeconds,
      endSeconds,
      headwaySeconds,
      exactTimes: row['exact_times']?.trim() === '1',
    };
  });

  const transferKeyCounts = new Map<string, number>();
  const transfers = transferRows.map((row) => {
    const fromExternal = row['from_stop_id']?.trim() ?? '';
    const toExternal = row['to_stop_id']?.trim() ?? '';
    const type = row['transfer_type']?.trim() ?? '';
    const key = `${fromExternal}:${toExternal}:${type}`;
    const occurrence = (transferKeyCounts.get(key) ?? 0) + 1;
    transferKeyCounts.set(key, occurrence);
    const fromStopId = stopIdByExternal.get(fromExternal) ?? null;
    const toStopId = stopIdByExternal.get(toExternal) ?? null;
    const fromStationId = stationIdByExternal.get(fromExternal) ?? null;
    const toStationId = stationIdByExternal.get(toExternal) ?? null;
    const fromCoordinate =
      stopCoordinateByExternal.get(fromExternal) ??
      stationCoordinateByExternal.get(fromExternal);
    const toCoordinate =
      stopCoordinateByExternal.get(toExternal) ??
      stationCoordinateByExternal.get(toExternal);
    if (
      (fromStopId === null && fromStationId === null) ||
      (toStopId === null && toStationId === null) ||
      fromCoordinate === undefined ||
      toCoordinate === undefined
    ) {
      throw new Error(`Validated transfer cannot be normalized: ${key}`);
    }
    const identity = `${key}:${occurrence}`;
    return {
      id: deterministicUuid(versionId, 'transfer', identity),
      mobilityEntityId: deterministicUuid(
        versionId,
        'mobility',
        'transfer',
        identity,
      ),
      fromStopId,
      fromStationId,
      toStopId,
      toStationId,
      transferType: `GTFS_TRANSFER_TYPE_${type}`,
      minTransferSeconds: integerOrNull(row['min_transfer_time']),
      points: [fromCoordinate, toCoordinate],
    };
  });

  const tripRowByExternal = new Map(
    tripRows.map((row) => [row['trip_id']?.trim() ?? '', row]),
  );
  const transitSegmentByKey = new Map<string, NormalizedTransitSegment>();
  const tripSegmentTraversals: NormalizedTripSegmentTraversal[] = [];
  for (const [tripExternal, values] of sourceStopTimesByTrip) {
    values.sort(
      (left, right) =>
        Number(left['stop_sequence']) - Number(right['stop_sequence']),
    );
    const tripRow = tripRowByExternal.get(tripExternal);
    const tripId = tripIdByExternal.get(tripExternal);
    const routeId = routeIdByExternal.get(tripRow?.['route_id']?.trim() ?? '');
    const shapeExternal = tripRow?.['shape_id']?.trim() ?? '';
    const shape = shapePointsByExternal.get(shapeExternal);
    const transitShapeId =
      shapeExternal === ''
        ? null
        : (shapeIdByExternal.get(shapeExternal) ?? null);
    const directionId = Number(tripRow?.['direction_id']) as 0 | 1;
    if (tripId === undefined || routeId === undefined) {
      throw new Error(
        `Validated trip cannot produce segments: ${tripExternal}`,
      );
    }
    const sourceCoordinates = values.map((row) => {
      const external = row['stop_id']?.trim() ?? '';
      const point = stopCoordinateByExternal.get(external);
      if (point === undefined)
        throw new Error(`Unknown segment stop: ${external}`);
      return point;
    });
    const shapeIndices: number[] = [];
    let previousIndex = -1;
    for (const point of sourceCoordinates) {
      const start = previousIndex < 0 ? 0 : previousIndex + 1;
      const index =
        shape === undefined ? -1 : nearestIndex(shape, point, start);
      shapeIndices.push(index);
      previousIndex = index;
    }
    for (let index = 0; index < values.length - 1; index += 1) {
      const fromRow = values[index];
      const toRow = values[index + 1];
      const fromCoordinate = sourceCoordinates[index];
      const toCoordinate = sourceCoordinates[index + 1];
      if (
        fromRow === undefined ||
        toRow === undefined ||
        fromCoordinate === undefined ||
        toCoordinate === undefined
      ) {
        continue;
      }
      const fromExternal = fromRow['stop_id']?.trim() ?? '';
      const toExternal = toRow['stop_id']?.trim() ?? '';
      const fromStopId = stopIdByExternal.get(fromExternal);
      const toStopId = stopIdByExternal.get(toExternal);
      if (fromStopId === undefined || toStopId === undefined) {
        throw new Error(
          `Unable to resolve segment endpoints for ${tripExternal}`,
        );
      }
      const points = segmentPoints(
        fromCoordinate,
        toCoordinate,
        shape,
        shapeIndices[index] ?? -1,
        shapeIndices[index + 1] ?? -1,
      );
      const logicalKey = [
        routeId,
        String(directionId),
        fromStopId,
        toStopId,
      ].join(':');
      let logicalSegment = transitSegmentByKey.get(logicalKey);
      if (logicalSegment === undefined) {
        logicalSegment = {
          id: deterministicUuid(versionId, 'logical-segment', logicalKey),
          mobilityEntityId: deterministicUuid(
            versionId,
            'mobility',
            'logical-segment',
            logicalKey,
          ),
          routeId,
          fromStopId,
          toStopId,
          directionId,
          points,
        };
        transitSegmentByKey.set(logicalKey, logicalSegment);
      }
      const traversalIdentity = `${tripExternal}:${index}`;
      tripSegmentTraversals.push({
        id: deterministicUuid(
          versionId,
          'trip-segment-traversal',
          traversalIdentity,
        ),
        transitSegmentId: logicalSegment.id,
        tripId,
        routeId,
        fromStopId,
        toStopId,
        transitShapeId,
        directionId,
        segmentSequence: index,
        points,
      });
    }
  }

  return {
    operators,
    stations,
    stops,
    routes,
    serviceCalendars,
    shapes,
    trips,
    stopTimes,
    tripFrequencies,
    transfers,
    transitSegments: [...transitSegmentByKey.values()],
    tripSegmentTraversals,
    report: parsed.report,
  };
}
