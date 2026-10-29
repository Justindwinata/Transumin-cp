import { parse } from 'csv-parse/sync';

import type {
  GtfsArchive,
  GtfsCoverageReport,
  GtfsInventoryItem,
  GtfsIssue,
  GtfsRow,
  GtfsValidationMetrics,
  GtfsValidationReport,
  ParsedGtfsFeed,
} from './gtfs.types.js';

const REQUIRED_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
] as const;

const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'agency.txt': ['agency_name', 'agency_url', 'agency_timezone'],
  'calendar.txt': [
    'service_id',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'start_date',
    'end_date',
  ],
  'calendar_dates.txt': ['service_id', 'date', 'exception_type'],
  'feed_info.txt': ['feed_publisher_name', 'feed_publisher_url', 'feed_lang'],
  'frequencies.txt': ['trip_id', 'start_time', 'end_time', 'headway_secs'],
  'routes.txt': [
    'route_id',
    'route_short_name',
    'route_long_name',
    'route_type',
  ],
  'shapes.txt': [
    'shape_id',
    'shape_pt_lat',
    'shape_pt_lon',
    'shape_pt_sequence',
  ],
  'stop_times.txt': [
    'trip_id',
    'arrival_time',
    'departure_time',
    'stop_id',
    'stop_sequence',
  ],
  'stops.txt': ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
  'transfers.txt': ['from_stop_id', 'to_stop_id', 'transfer_type'],
  'trips.txt': ['route_id', 'service_id', 'trip_id'],
};

const STANDARD_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'shapes.txt',
  'transfers.txt',
  'feed_info.txt',
  'frequencies.txt',
] as const;

const USED_FILES = new Set([
  'agency.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'frequencies.txt',
  'routes.txt',
  'shapes.txt',
  'stop_times.txt',
  'stops.txt',
  'transfers.txt',
  'trips.txt',
]);

const VALIDATED_ONLY_FILES = new Set(['feed_info.txt']);

interface MutableIssue {
  severity: 'ERROR' | 'WARNING';
  category: GtfsIssue['category'];
  code: string;
  count: number;
  message: string;
  file?: string;
  sampleRows: number[];
}

class IssueCollector {
  readonly #issues = new Map<string, MutableIssue>();

  add(
    severity: MutableIssue['severity'],
    category: MutableIssue['category'],
    code: string,
    message: string,
    options: { file?: string; row?: number; count?: number } = {},
  ): void {
    const key = `${severity}:${category}:${code}:${options.file ?? ''}`;
    const existing = this.#issues.get(key);
    if (existing !== undefined) {
      existing.count += options.count ?? 1;
      if (options.row !== undefined && existing.sampleRows.length < 10) {
        existing.sampleRows.push(options.row);
      }
      return;
    }
    this.#issues.set(key, {
      severity,
      category,
      code,
      count: options.count ?? 1,
      message,
      ...(options.file === undefined ? {} : { file: options.file }),
      sampleRows: options.row === undefined ? [] : [options.row],
    });
  }

  list(): readonly GtfsIssue[] {
    return [...this.#issues.values()]
      .map(({ sampleRows, ...issue }) => ({
        ...issue,
        ...(sampleRows.length === 0 ? {} : { sampleRows }),
      }))
      .sort((left, right) =>
        `${left.severity}:${left.code}:${left.file ?? ''}`.localeCompare(
          `${right.severity}:${right.code}:${right.file ?? ''}`,
        ),
      );
  }
}

function blankMetrics(): GtfsValidationMetrics {
  return {
    agencies: 0,
    routes: 0,
    stations: 0,
    stops: 0,
    trips: 0,
    stopTimes: 0,
    shapePoints: 0,
    shapes: 0,
    transfers: 0,
    serviceCalendars: 0,
    serviceExceptions: 0,
    frequencies: 0,
    logicalTransitSegments: 0,
    tripSegmentTraversals: 0,
    mobilityEntities: 0,
    recordsRead: 0,
    rowsRejected: 0,
    gtfsTimesOver24Hours: 0,
    nullOrInvalidGeometries: 0,
    orphanRecords: 0,
    duplicateIds: 0,
    suspiciousDuplicateEntities: 0,
    unusedStops: 0,
    unusedServiceCalendars: 0,
    minServiceDate: null,
    maxServiceDate: null,
  };
}

function blankCoverage(): GtfsCoverageReport {
  return {
    classificationBasis: 'GTFS_ROUTE_DESC',
    routeDescriptionCounts: {},
    brt: { status: 'NOT_EVIDENCED', routes: 0 },
    nonBrtOrFeeder: { status: 'UNKNOWN', routes: 0, evidenceValues: [] },
    mikrotrans: { status: 'NOT_EVIDENCED', routes: 0 },
    otherCategories: {},
  };
}

function parseCsvFile(
  file: string,
  text: string,
  issues: IssueCollector,
): readonly GtfsRow[] {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    }) as string[][];
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown CSV error';
    issues.add(
      'ERROR',
      'ARCHIVE',
      'CSV_UNREADABLE',
      `CSV parsing failed: ${detail}`,
      { file },
    );
    return [];
  }
  const header = records[0];
  if (header === undefined || header.length === 0) {
    issues.add('ERROR', 'SCHEMA', 'EMPTY_FILE', 'File has no CSV header.', {
      file,
    });
    return [];
  }
  const duplicates = header.filter(
    (column, index) => header.indexOf(column) !== index,
  );
  if (duplicates.length > 0) {
    issues.add(
      'ERROR',
      'SCHEMA',
      'DUPLICATE_COLUMNS',
      `CSV header contains duplicate columns: ${[...new Set(duplicates)].join(', ')}`,
      { file, count: new Set(duplicates).size },
    );
  }
  const rows: GtfsRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const values = records[index];
    if (values === undefined) continue;
    const row: Record<string, string> = {};
    for (let column = 0; column < header.length; column += 1) {
      const name = header[column];
      if (name !== undefined) row[name] = values[column] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function getRows(
  rowsByFile: ReadonlyMap<string, readonly GtfsRow[]>,
  file: string,
): readonly GtfsRow[] {
  return rowsByFile.get(file) ?? [];
}

function requiredValue(
  row: GtfsRow,
  field: string,
  file: string,
  rowNumber: number,
  issues: IssueCollector,
): string {
  const value = row[field]?.trim() ?? '';
  if (value === '') {
    issues.add(
      'ERROR',
      'SCHEMA',
      `EMPTY_${field.toUpperCase()}`,
      `Required value ${field} is empty.`,
      { file, row: rowNumber },
    );
  }
  return value;
}

function strictInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseGtfsTime(value: string): number | null {
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isSafeInteger)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

export function parseGtfsDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function duplicateCount(rows: readonly GtfsRow[], field: string): number {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[field]?.trim() ?? '';
    if (value !== '') counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const count of counts.values()) duplicates += Math.max(0, count - 1);
  return duplicates;
}

function inventoryFor(
  filesPresent: readonly string[],
  rowsByFile: ReadonlyMap<string, readonly GtfsRow[]>,
): readonly GtfsInventoryItem[] {
  const present = new Set(filesPresent);
  const ordered = [
    ...STANDARD_FILES,
    ...filesPresent.filter((file) => !STANDARD_FILES.includes(file as never)),
  ];
  return [...new Set(ordered)].map((file) => {
    if (!present.has(file)) {
      const required = REQUIRED_FILES.includes(
        file as (typeof REQUIRED_FILES)[number],
      );
      const calendarRequired =
        (file === 'calendar.txt' || file === 'calendar_dates.txt') &&
        !present.has('calendar.txt') &&
        !present.has('calendar_dates.txt');
      return {
        file,
        classification:
          required || calendarRequired
            ? 'MISSING_REQUIRED'
            : 'NOT_PRESENT_OR_NOT_APPLICABLE',
        rows: null,
        reason:
          required || calendarRequired
            ? 'Required for this canonical ingestion.'
            : 'Optional GTFS file is not present.',
      };
    }
    if (USED_FILES.has(file)) {
      return {
        file,
        classification: 'USED',
        rows: getRows(rowsByFile, file).length,
        reason: 'Validated and mapped into the canonical transit model.',
      };
    }
    if (VALIDATED_ONLY_FILES.has(file)) {
      return {
        file,
        classification: 'VALIDATED_BUT_NOT_INGESTED',
        rows: getRows(rowsByFile, file).length,
        reason:
          'Validated as a secondary GTFS input; no canonical table currently requires it.',
      };
    }
    return {
      file,
      classification: 'UNSUPPORTED_OPTIONAL',
      rows: getRows(rowsByFile, file).length,
      reason:
        'Optional extension retained in the immutable archive but outside the canonical scope.',
    };
  });
}

function buildCoverage(routes: readonly GtfsRow[]): GtfsCoverageReport {
  const routeDescriptionCounts: Record<string, number> = {};
  for (const route of routes) {
    const description = route['route_desc']?.trim() || 'UNSPECIFIED';
    routeDescriptionCounts[description] =
      (routeDescriptionCounts[description] ?? 0) + 1;
  }
  const brt = routeDescriptionCounts['BRT'] ?? 0;
  const mikrotrans = routeDescriptionCounts['Mikrotrans'] ?? 0;
  const feederEvidence = ['Angkutan Umum Integrasi'];
  const nonBrt = feederEvidence.reduce(
    (count, value) => count + (routeDescriptionCounts[value] ?? 0),
    0,
  );
  const otherCategories = Object.fromEntries(
    Object.entries(routeDescriptionCounts)
      .filter(
        ([value]) =>
          !['BRT', 'Mikrotrans', ...feederEvidence, 'UNSPECIFIED'].includes(
            value,
          ),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    classificationBasis: 'GTFS_ROUTE_DESC',
    routeDescriptionCounts: Object.fromEntries(
      Object.entries(routeDescriptionCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    brt: { status: brt > 0 ? 'EVIDENCED' : 'NOT_EVIDENCED', routes: brt },
    nonBrtOrFeeder: {
      status: nonBrt > 0 ? 'EVIDENCED' : 'UNKNOWN',
      routes: nonBrt,
      evidenceValues: nonBrt > 0 ? feederEvidence : [],
    },
    mikrotrans: {
      status: mikrotrans > 0 ? 'EVIDENCED' : 'NOT_EVIDENCED',
      routes: mikrotrans,
    },
    otherCategories,
  };
}

export function validateGtfsArchive(archive: GtfsArchive): ParsedGtfsFeed {
  const issues = new IssueCollector();
  const filesPresent = [...archive.entries.keys()].sort();
  const rowsByFile = new Map<string, readonly GtfsRow[]>();

  for (const file of filesPresent) {
    const entry = archive.entries.get(file);
    if (entry !== undefined) {
      rowsByFile.set(file, parseCsvFile(file, entry.text, issues));
    }
  }

  for (const file of REQUIRED_FILES) {
    if (!archive.entries.has(file)) {
      issues.add(
        'ERROR',
        'ARCHIVE',
        'MISSING_REQUIRED_FILE',
        'Required GTFS file is absent.',
        {
          file,
        },
      );
    }
  }
  if (
    !archive.entries.has('calendar.txt') &&
    !archive.entries.has('calendar_dates.txt')
  ) {
    issues.add(
      'ERROR',
      'ARCHIVE',
      'MISSING_SERVICE_FILE',
      'Either calendar.txt or calendar_dates.txt must be present.',
    );
  }
  if (archive.entries.has('calendar_dates.txt')) {
    issues.add(
      'ERROR',
      'SERVICE',
      'SERVICE_EXCEPTIONS_REQUIRE_SCHEMA',
      'calendar_dates.txt requires the canonical service-exception model before ingestion.',
      {
        file: 'calendar_dates.txt',
        count: getRows(rowsByFile, 'calendar_dates.txt').length,
      },
    );
  }

  for (const [file, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const entry = archive.entries.get(file);
    if (entry === undefined) continue;
    let header: readonly string[];
    try {
      const parsed = parse(entry.text, {
        bom: true,
        to_line: 1,
        relax_column_count: false,
      }) as string[][];
      header = parsed[0] ?? [];
    } catch {
      continue;
    }
    for (const column of requiredColumns) {
      if (!header.includes(column)) {
        issues.add(
          'ERROR',
          'SCHEMA',
          'MISSING_REQUIRED_COLUMN',
          `Required column ${column} is absent.`,
          { file },
        );
      }
    }
  }

  const agencies = getRows(rowsByFile, 'agency.txt');
  const routes = getRows(rowsByFile, 'routes.txt');
  const stops = getRows(rowsByFile, 'stops.txt');
  const trips = getRows(rowsByFile, 'trips.txt');
  const stopTimes = getRows(rowsByFile, 'stop_times.txt');
  const calendars = getRows(rowsByFile, 'calendar.txt');
  const calendarDates = getRows(rowsByFile, 'calendar_dates.txt');
  const shapePoints = getRows(rowsByFile, 'shapes.txt');
  const transfers = getRows(rowsByFile, 'transfers.txt');
  const frequencies = getRows(rowsByFile, 'frequencies.txt');

  const duplicateSpecs = [
    ['agency.txt', agencies, 'agency_id'],
    ['routes.txt', routes, 'route_id'],
    ['stops.txt', stops, 'stop_id'],
    ['trips.txt', trips, 'trip_id'],
    ['calendar.txt', calendars, 'service_id'],
  ] as const;
  let duplicateIds = 0;
  for (const [file, rows, field] of duplicateSpecs) {
    const count = duplicateCount(rows, field);
    duplicateIds += count;
    if (count > 0) {
      issues.add(
        'ERROR',
        'SCHEMA',
        'DUPLICATE_ID',
        `Duplicate ${field} values found.`,
        {
          file,
          count,
        },
      );
    }
  }

  const agencyIds = new Set(
    agencies.map((row) => row['agency_id']?.trim() ?? ''),
  );
  const routeIds = new Set(routes.map((row) => row['route_id']?.trim() ?? ''));
  const stopIds = new Set(stops.map((row) => row['stop_id']?.trim() ?? ''));
  const tripIds = new Set(trips.map((row) => row['trip_id']?.trim() ?? ''));
  const calendarIds = new Set(
    calendars.map((row) => row['service_id']?.trim() ?? ''),
  );
  for (const row of calendarDates)
    calendarIds.add(row['service_id']?.trim() ?? '');
  const shapeIds = new Set(
    shapePoints.map((row) => row['shape_id']?.trim() ?? ''),
  );
  let orphanRecords = 0;

  agencies.forEach((row, index) => {
    requiredValue(row, 'agency_name', 'agency.txt', index + 2, issues);
    requiredValue(row, 'agency_url', 'agency.txt', index + 2, issues);
    requiredValue(row, 'agency_timezone', 'agency.txt', index + 2, issues);
  });
  if (agencies.length > 1 && agencyIds.has('')) {
    issues.add(
      'ERROR',
      'SCHEMA',
      'AGENCY_ID_REQUIRED',
      'agency_id is required when multiple agencies are present.',
      { file: 'agency.txt' },
    );
  }
  if (agencies.length > 1) {
    issues.add(
      'ERROR',
      'SERVICE',
      'MULTI_AGENCY_CALENDAR_MAPPING_UNSUPPORTED',
      'Phase 1B canonical service calendars require an unambiguous single operator.',
      { file: 'agency.txt', count: agencies.length },
    );
  }

  routes.forEach((row, index) => {
    const rowNumber = index + 2;
    requiredValue(row, 'route_id', 'routes.txt', rowNumber, issues);
    if (!(row['route_short_name']?.trim() || row['route_long_name']?.trim())) {
      issues.add(
        'ERROR',
        'SCHEMA',
        'ROUTE_NAME_MISSING',
        'Both route names are empty.',
        {
          file: 'routes.txt',
          row: rowNumber,
        },
      );
    }
    const routeType = strictInteger(row['route_type']?.trim() ?? '');
    if (routeType === null || routeType < 0) {
      issues.add(
        'ERROR',
        'SCHEMA',
        'INVALID_ROUTE_TYPE',
        'route_type is invalid.',
        {
          file: 'routes.txt',
          row: rowNumber,
        },
      );
    }
    const agencyId = row['agency_id']?.trim() ?? '';
    const resolvedAgencyId =
      agencyId || (agencies.length === 1 ? [...agencyIds][0] : undefined);
    if (resolvedAgencyId === undefined || !agencyIds.has(resolvedAgencyId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'ROUTE_AGENCY_ORPHAN',
        'Route references an unknown agency.',
        { file: 'routes.txt', row: rowNumber },
      );
    }
  });

  const stopLocationTypes = new Map<string, number>();
  let stationsCount = 0;
  let stopsCount = 0;
  let invalidGeometryCount = 0;
  stops.forEach((row, index) => {
    const rowNumber = index + 2;
    const stopId = requiredValue(
      row,
      'stop_id',
      'stops.txt',
      rowNumber,
      issues,
    );
    requiredValue(row, 'stop_name', 'stops.txt', rowNumber, issues);
    const rawType = row['location_type']?.trim() ?? '';
    const locationType = rawType === '' ? 0 : strictInteger(rawType);
    if (locationType !== 0 && locationType !== 1) {
      issues.add(
        'ERROR',
        'HIERARCHY',
        'UNSUPPORTED_LOCATION_TYPE',
        'Phase 1B supports GTFS stops (0) and stations (1) only.',
        { file: 'stops.txt', row: rowNumber },
      );
    } else {
      if (locationType === 1) stationsCount += 1;
      else stopsCount += 1;
      stopLocationTypes.set(stopId, locationType);
    }
    const latitude = Number(row['stop_lat']);
    const longitude = Number(row['stop_lon']);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      invalidGeometryCount += 1;
      issues.add(
        'ERROR',
        'GEOGRAPHY',
        'INVALID_STOP_COORDINATE',
        'Stop coordinate is missing or outside WGS84 bounds.',
        { file: 'stops.txt', row: rowNumber },
      );
    }
  });
  stops.forEach((row, index) => {
    const parentId = row['parent_station']?.trim() ?? '';
    if (parentId === '') return;
    if (!stopIds.has(parentId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'HIERARCHY',
        'PARENT_STATION_ORPHAN',
        'parent_station references an unknown stop_id.',
        { file: 'stops.txt', row: index + 2 },
      );
    } else if (stopLocationTypes.get(parentId) !== 1) {
      issues.add(
        'ERROR',
        'HIERARCHY',
        'PARENT_NOT_STATION',
        'parent_station must reference location_type=1.',
        { file: 'stops.txt', row: index + 2 },
      );
    }
  });

  let minServiceDate: string | null = null;
  let maxServiceDate: string | null = null;
  calendars.forEach((row, index) => {
    const rowNumber = index + 2;
    requiredValue(row, 'service_id', 'calendar.txt', rowNumber, issues);
    const startDate = parseGtfsDate(row['start_date']?.trim() ?? '');
    const endDate = parseGtfsDate(row['end_date']?.trim() ?? '');
    if (startDate === null || endDate === null || endDate < startDate) {
      issues.add(
        'ERROR',
        'SERVICE',
        'INVALID_SERVICE_DATE_RANGE',
        'Service calendar dates are invalid or reversed.',
        { file: 'calendar.txt', row: rowNumber },
      );
    } else {
      minServiceDate =
        minServiceDate === null || startDate < minServiceDate
          ? startDate
          : minServiceDate;
      maxServiceDate =
        maxServiceDate === null || endDate > maxServiceDate
          ? endDate
          : maxServiceDate;
    }
    for (const day of [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]) {
      if (row[day] !== '0' && row[day] !== '1') {
        issues.add(
          'ERROR',
          'SERVICE',
          'INVALID_WEEKDAY_FLAG',
          'Weekday flags must be 0 or 1.',
          { file: 'calendar.txt', row: rowNumber },
        );
      }
    }
  });

  const tripRowsById = new Map<string, GtfsRow>();
  trips.forEach((row, index) => {
    const rowNumber = index + 2;
    const tripId = requiredValue(
      row,
      'trip_id',
      'trips.txt',
      rowNumber,
      issues,
    );
    tripRowsById.set(tripId, row);
    const routeId = requiredValue(
      row,
      'route_id',
      'trips.txt',
      rowNumber,
      issues,
    );
    const serviceId = requiredValue(
      row,
      'service_id',
      'trips.txt',
      rowNumber,
      issues,
    );
    if (!routeIds.has(routeId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRIP_ROUTE_ORPHAN',
        'Trip references an unknown route.',
        {
          file: 'trips.txt',
          row: rowNumber,
        },
      );
    }
    if (!calendarIds.has(serviceId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRIP_SERVICE_ORPHAN',
        'Trip references an unknown service.',
        {
          file: 'trips.txt',
          row: rowNumber,
        },
      );
    }
    const shapeId = row['shape_id']?.trim() ?? '';
    if (shapeId !== '' && !shapeIds.has(shapeId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRIP_SHAPE_ORPHAN',
        'Trip references an unknown shape.',
        {
          file: 'trips.txt',
          row: rowNumber,
        },
      );
    }
    const direction = row['direction_id']?.trim() ?? '';
    if (direction !== '0' && direction !== '1') {
      issues.add(
        'ERROR',
        'SCHEMA',
        'DIRECTION_REQUIRED_FOR_SEGMENTS',
        'direction_id must be 0 or 1 to derive canonical trip segments.',
        { file: 'trips.txt', row: rowNumber },
      );
    }
  });

  const stopTimesByTrip = new Map<string, GtfsRow[]>();
  const stopTimeSequenceKeys = new Set<string>();
  let gtfsTimesOver24Hours = 0;
  stopTimes.forEach((row, index) => {
    const rowNumber = index + 2;
    const tripId = requiredValue(
      row,
      'trip_id',
      'stop_times.txt',
      rowNumber,
      issues,
    );
    const stopId = requiredValue(
      row,
      'stop_id',
      'stop_times.txt',
      rowNumber,
      issues,
    );
    if (!tripIds.has(tripId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'STOP_TIME_TRIP_ORPHAN',
        'Stop time references an unknown trip.',
        {
          file: 'stop_times.txt',
          row: rowNumber,
        },
      );
    }
    if (!stopIds.has(stopId) || stopLocationTypes.get(stopId) !== 0) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'STOP_TIME_STOP_ORPHAN',
        'Stop time must reference a location_type=0 stop.',
        {
          file: 'stop_times.txt',
          row: rowNumber,
        },
      );
    }
    const sequence = strictInteger(row['stop_sequence']?.trim() ?? '');
    if (sequence === null || sequence < 0) {
      issues.add(
        'ERROR',
        'TIME',
        'INVALID_STOP_SEQUENCE',
        'stop_sequence must be a non-negative integer.',
        {
          file: 'stop_times.txt',
          row: rowNumber,
        },
      );
    } else {
      const key = `${tripId}\u0000${sequence}`;
      if (stopTimeSequenceKeys.has(key)) {
        duplicateIds += 1;
        issues.add(
          'ERROR',
          'SCHEMA',
          'DUPLICATE_STOP_SEQUENCE',
          'A trip has a duplicate stop_sequence.',
          {
            file: 'stop_times.txt',
            row: rowNumber,
          },
        );
      }
      stopTimeSequenceKeys.add(key);
    }
    const arrival = parseGtfsTime(row['arrival_time']?.trim() ?? '');
    const departure = parseGtfsTime(row['departure_time']?.trim() ?? '');
    if (arrival === null || departure === null || departure < arrival) {
      issues.add(
        'ERROR',
        'TIME',
        'INVALID_STOP_TIME',
        'Arrival/departure time is invalid or departure precedes arrival.',
        {
          file: 'stop_times.txt',
          row: rowNumber,
        },
      );
    } else if (arrival >= 86_400 || departure >= 86_400) {
      gtfsTimesOver24Hours += 1;
    }
    const rows = stopTimesByTrip.get(tripId) ?? [];
    rows.push(row);
    stopTimesByTrip.set(tripId, rows);
  });

  let tripSegmentTraversals = 0;
  const logicalSegmentKeys = new Set<string>();
  const tripById = new Map(
    trips.map((row) => [row['trip_id']?.trim() ?? '', row]),
  );
  for (const [tripId, rows] of stopTimesByTrip) {
    rows.sort(
      (left, right) =>
        (strictInteger(left['stop_sequence'] ?? '') ?? 0) -
        (strictInteger(right['stop_sequence'] ?? '') ?? 0),
    );
    tripSegmentTraversals += Math.max(0, rows.length - 1);
    const trip = tripById.get(tripId);
    for (let index = 0; index < rows.length - 1; index += 1) {
      const from = rows[index]?.['stop_id']?.trim() ?? '';
      const to = rows[index + 1]?.['stop_id']?.trim() ?? '';
      logicalSegmentKeys.add(
        [
          trip?.['route_id']?.trim() ?? '',
          trip?.['direction_id']?.trim() ?? '',
          from,
          to,
        ].join('\u0000'),
      );
    }
    let previousSequence = -1;
    let previousDeparture = -1;
    rows.forEach((row) => {
      const sequence = strictInteger(row['stop_sequence'] ?? '') ?? -1;
      const arrival = parseGtfsTime(row['arrival_time'] ?? '') ?? -1;
      const departure = parseGtfsTime(row['departure_time'] ?? '') ?? -1;
      if (sequence <= previousSequence) {
        issues.add(
          'ERROR',
          'TIME',
          'NON_INCREASING_STOP_SEQUENCE',
          'Trip stop_sequence values are not strictly increasing.',
          {
            file: 'stop_times.txt',
          },
        );
      }
      if (arrival < previousDeparture) {
        issues.add(
          'ERROR',
          'TIME',
          'NON_MONOTONIC_TRIP_TIME',
          `Trip ${tripId} moves backward in time.`,
          {
            file: 'stop_times.txt',
          },
        );
      }
      previousSequence = sequence;
      previousDeparture = departure;
    });
  }
  for (const tripId of tripIds) {
    if (!stopTimesByTrip.has(tripId)) {
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRIP_WITHOUT_STOP_TIMES',
        'Trip has no stop-time records.',
        {
          file: 'trips.txt',
        },
      );
    }
  }

  const shapeRowsById = new Map<string, GtfsRow[]>();
  shapePoints.forEach((row, index) => {
    const rowNumber = index + 2;
    const shapeId = requiredValue(
      row,
      'shape_id',
      'shapes.txt',
      rowNumber,
      issues,
    );
    const latitude = Number(row['shape_pt_lat']);
    const longitude = Number(row['shape_pt_lon']);
    const sequence = strictInteger(row['shape_pt_sequence']?.trim() ?? '');
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      invalidGeometryCount += 1;
      issues.add(
        'ERROR',
        'GEOGRAPHY',
        'INVALID_SHAPE_COORDINATE',
        'Shape point is outside WGS84 bounds.',
        {
          file: 'shapes.txt',
          row: rowNumber,
        },
      );
    }
    if (sequence === null || sequence < 0) {
      issues.add(
        'ERROR',
        'GEOGRAPHY',
        'INVALID_SHAPE_SEQUENCE',
        'shape_pt_sequence is invalid.',
        {
          file: 'shapes.txt',
          row: rowNumber,
        },
      );
    }
    const rows = shapeRowsById.get(shapeId) ?? [];
    rows.push(row);
    shapeRowsById.set(shapeId, rows);
  });
  for (const rows of shapeRowsById.values()) {
    rows.sort(
      (left, right) =>
        (strictInteger(left['shape_pt_sequence'] ?? '') ?? 0) -
        (strictInteger(right['shape_pt_sequence'] ?? '') ?? 0),
    );
    const sequences = new Set(rows.map((row) => row['shape_pt_sequence']));
    const distinctCoordinates = new Set(
      rows.map((row) => `${row['shape_pt_lat']},${row['shape_pt_lon']}`),
    );
    if (sequences.size !== rows.length) {
      duplicateIds += rows.length - sequences.size;
      issues.add(
        'ERROR',
        'GEOGRAPHY',
        'DUPLICATE_SHAPE_SEQUENCE',
        'Shape has duplicate sequence values.',
        {
          file: 'shapes.txt',
          count: rows.length - sequences.size,
        },
      );
    }
    if (distinctCoordinates.size < 2) {
      invalidGeometryCount += 1;
      issues.add(
        'ERROR',
        'GEOGRAPHY',
        'EMPTY_OR_DEGENERATE_SHAPE',
        'Shape cannot form a LineString.',
        {
          file: 'shapes.txt',
        },
      );
    }
  }

  transfers.forEach((row, index) => {
    const rowNumber = index + 2;
    const from = requiredValue(
      row,
      'from_stop_id',
      'transfers.txt',
      rowNumber,
      issues,
    );
    const to = requiredValue(
      row,
      'to_stop_id',
      'transfers.txt',
      rowNumber,
      issues,
    );
    if (
      !stopIds.has(from) ||
      ![0, 1].includes(stopLocationTypes.get(from) ?? -1)
    ) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRANSFER_FROM_ORPHAN',
        'Transfer source is not a canonical stop or station.',
        { file: 'transfers.txt', row: rowNumber },
      );
    }
    if (!stopIds.has(to) || ![0, 1].includes(stopLocationTypes.get(to) ?? -1)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRANSFER_TO_ORPHAN',
        'Transfer destination is not a canonical stop or station.',
        { file: 'transfers.txt', row: rowNumber },
      );
    }
    if (from === to) {
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'TRANSFER_SELF_REFERENCE',
        'Transfer endpoints must differ.',
        {
          file: 'transfers.txt',
          row: rowNumber,
        },
      );
    }
    const transferType = strictInteger(row['transfer_type']?.trim() ?? '');
    if (transferType === null || transferType < 0 || transferType > 5) {
      issues.add(
        'ERROR',
        'SCHEMA',
        'INVALID_TRANSFER_TYPE',
        'transfer_type is outside the GTFS range.',
        {
          file: 'transfers.txt',
          row: rowNumber,
        },
      );
    }
  });

  frequencies.forEach((row, index) => {
    const rowNumber = index + 2;
    const tripId = requiredValue(
      row,
      'trip_id',
      'frequencies.txt',
      rowNumber,
      issues,
    );
    if (!tripIds.has(tripId)) {
      orphanRecords += 1;
      issues.add(
        'ERROR',
        'REFERENTIAL_INTEGRITY',
        'FREQUENCY_TRIP_ORPHAN',
        'Frequency references an unknown trip.',
        {
          file: 'frequencies.txt',
          row: rowNumber,
        },
      );
    }
    const start = parseGtfsTime(row['start_time']?.trim() ?? '');
    const end = parseGtfsTime(row['end_time']?.trim() ?? '');
    const headway = strictInteger(row['headway_secs']?.trim() ?? '');
    const exactTimesValue = row['exact_times']?.trim() ?? '';
    if (
      start === null ||
      end === null ||
      end <= start ||
      headway === null ||
      headway <= 0
    ) {
      issues.add(
        'ERROR',
        'TIME',
        'INVALID_FREQUENCY',
        'Frequency interval/headway is invalid.',
        {
          file: 'frequencies.txt',
          row: rowNumber,
        },
      );
    }
    if (!['', '0', '1'].includes(exactTimesValue)) {
      issues.add(
        'ERROR',
        'SCHEMA',
        'INVALID_FREQUENCY_EXACT_TIMES',
        'exact_times must be empty, 0, or 1.',
        { file: 'frequencies.txt', row: rowNumber },
      );
    }
  });

  const usedStopIds = new Set(
    stopTimes.map((row) => row['stop_id']?.trim() ?? ''),
  );
  const unusedStops = stops.filter(
    (row) =>
      (row['location_type']?.trim() || '0') === '0' &&
      !usedStopIds.has(row['stop_id']?.trim() ?? ''),
  ).length;
  if (unusedStops > 0) {
    issues.add(
      'WARNING',
      'QUALITY',
      'UNUSED_STOPS',
      'Canonical stops are not referenced by stop_times.',
      {
        file: 'stops.txt',
        count: unusedStops,
      },
    );
  }
  const usedServices = new Set(
    trips.map((row) => row['service_id']?.trim() ?? ''),
  );
  const unusedServiceCalendars = calendars.filter(
    (row) => !usedServices.has(row['service_id']?.trim() ?? ''),
  ).length;
  if (unusedServiceCalendars > 0) {
    issues.add(
      'WARNING',
      'QUALITY',
      'UNUSED_SERVICE_CALENDARS',
      'Service calendars are not referenced by trips.',
      {
        file: 'calendar.txt',
        count: unusedServiceCalendars,
      },
    );
  }
  const signatureCounts = new Map<string, number>();
  for (const row of stops) {
    const signature = `${row['stop_name']}\u0000${row['stop_lat']}\u0000${row['stop_lon']}`;
    signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
  }
  let suspiciousDuplicateEntities = 0;
  for (const count of signatureCounts.values()) {
    suspiciousDuplicateEntities += Math.max(0, count - 1);
  }
  if (suspiciousDuplicateEntities > 0) {
    issues.add(
      'WARNING',
      'QUALITY',
      'SUSPICIOUS_DUPLICATE_STOP_SIGNATURES',
      'Distinct stop IDs share the same name and coordinates; source IDs are preserved.',
      { file: 'stops.txt', count: suspiciousDuplicateEntities },
    );
  }

  const recordsRead = [...USED_FILES].reduce(
    (count, file) => count + getRows(rowsByFile, file).length,
    0,
  );
  const currentIssues = issues.list();
  const rowsRejected = currentIssues
    .filter((issue) => issue.severity === 'ERROR')
    .reduce((count, issue) => count + issue.count, 0);
  const metrics: GtfsValidationMetrics = {
    agencies: agencies.length,
    routes: routes.length,
    stations: stationsCount,
    stops: stopsCount,
    trips: trips.length,
    stopTimes: stopTimes.length,
    shapePoints: shapePoints.length,
    shapes: shapeRowsById.size,
    transfers: transfers.length,
    serviceCalendars: calendars.length,
    serviceExceptions: calendarDates.length,
    frequencies: frequencies.length,
    logicalTransitSegments: logicalSegmentKeys.size,
    tripSegmentTraversals,
    mobilityEntities:
      stationsCount +
      stopsCount +
      routes.length +
      transfers.length +
      logicalSegmentKeys.size,
    recordsRead,
    rowsRejected,
    gtfsTimesOver24Hours,
    nullOrInvalidGeometries: invalidGeometryCount,
    orphanRecords,
    duplicateIds,
    suspiciousDuplicateEntities,
    unusedStops,
    unusedServiceCalendars,
    minServiceDate,
    maxServiceDate,
  };
  const status = currentIssues.some((issue) => issue.severity === 'ERROR')
    ? 'INVALID'
    : currentIssues.some((issue) => issue.severity === 'WARNING')
      ? 'WARNING'
      : 'VALID';
  const report: GtfsValidationReport = {
    validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1',
    status,
    archiveBytes: archive.archiveBytes,
    filesPresent,
    inventory: inventoryFor(filesPresent, rowsByFile),
    metrics,
    coverage: buildCoverage(routes),
    issues: currentIssues,
  };
  return { rowsByFile, report };
}

export function validateGtfsTextFiles(
  files: Readonly<Record<string, string>>,
): ParsedGtfsFeed {
  const entries = new Map(
    Object.entries(files).map(([name, text]) => [
      name,
      {
        name,
        compressedBytes: Buffer.byteLength(text),
        uncompressedBytes: Buffer.byteLength(text),
        text,
      },
    ]),
  );
  const archiveBytes = [...entries.values()].reduce(
    (total, entry) => total + entry.uncompressedBytes,
    0,
  );
  return validateGtfsArchive({ entries, archiveBytes });
}

export function invalidArchiveReport(
  archiveBytes: number,
  message: string,
): GtfsValidationReport {
  return {
    validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1',
    status: 'INVALID',
    archiveBytes,
    filesPresent: [],
    inventory: [],
    metrics: blankMetrics(),
    coverage: blankCoverage(),
    issues: [
      {
        severity: 'ERROR',
        category: 'ARCHIVE',
        code: 'ARCHIVE_UNREADABLE',
        count: 1,
        message,
      },
    ],
  };
}
