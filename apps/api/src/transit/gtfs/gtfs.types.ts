export type GtfsRow = Readonly<Record<string, string>>;

export type GtfsFileName =
  | 'agency.txt'
  | 'calendar.txt'
  | 'calendar_dates.txt'
  | 'fare_attributes.txt'
  | 'fare_rules.txt'
  | 'feed_info.txt'
  | 'frequencies.txt'
  | 'routes.txt'
  | 'shapes.txt'
  | 'stop_times.txt'
  | 'stops.txt'
  | 'ticketing_deep_links.txt'
  | 'ticketing_identifiers.txt'
  | 'transfers.txt'
  | 'trips.txt';

export type InventoryClassification =
  | 'USED'
  | 'VALIDATED_BUT_NOT_INGESTED'
  | 'UNSUPPORTED_OPTIONAL'
  | 'MISSING_REQUIRED'
  | 'NOT_PRESENT_OR_NOT_APPLICABLE';

export interface GtfsArchiveEntry {
  readonly name: string;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly text: string;
}

export interface GtfsArchive {
  readonly entries: ReadonlyMap<string, GtfsArchiveEntry>;
  readonly archiveBytes: number;
}

export interface GtfsIssue {
  readonly severity: 'ERROR' | 'WARNING';
  readonly category:
    | 'ARCHIVE'
    | 'SCHEMA'
    | 'REFERENTIAL_INTEGRITY'
    | 'TIME'
    | 'GEOGRAPHY'
    | 'HIERARCHY'
    | 'SERVICE'
    | 'QUALITY';
  readonly code: string;
  readonly count: number;
  readonly message: string;
  readonly file?: string;
  readonly sampleRows?: readonly number[];
}

export interface GtfsInventoryItem {
  readonly file: string;
  readonly classification: InventoryClassification;
  readonly rows: number | null;
  readonly reason: string;
}

export interface GtfsValidationMetrics {
  readonly agencies: number;
  readonly routes: number;
  readonly stations: number;
  readonly stops: number;
  readonly trips: number;
  readonly stopTimes: number;
  readonly shapePoints: number;
  readonly shapes: number;
  readonly transfers: number;
  readonly serviceCalendars: number;
  readonly serviceExceptions: number;
  readonly frequencies: number;
  readonly logicalTransitSegments: number;
  readonly tripSegmentTraversals: number;
  readonly mobilityEntities: number;
  readonly recordsRead: number;
  readonly rowsRejected: number;
  readonly gtfsTimesOver24Hours: number;
  readonly nullOrInvalidGeometries: number;
  readonly orphanRecords: number;
  readonly duplicateIds: number;
  readonly suspiciousDuplicateEntities: number;
  readonly unusedStops: number;
  readonly unusedServiceCalendars: number;
  readonly minServiceDate: string | null;
  readonly maxServiceDate: string | null;
}

export interface GtfsCoverageReport {
  readonly classificationBasis: 'GTFS_ROUTE_DESC';
  readonly routeDescriptionCounts: Readonly<Record<string, number>>;
  readonly brt: {
    readonly status: 'EVIDENCED' | 'NOT_EVIDENCED';
    readonly routes: number;
  };
  readonly nonBrtOrFeeder: {
    readonly status: 'EVIDENCED' | 'UNKNOWN';
    readonly routes: number;
    readonly evidenceValues: readonly string[];
  };
  readonly mikrotrans: {
    readonly status: 'EVIDENCED' | 'NOT_EVIDENCED';
    readonly routes: number;
  };
  readonly otherCategories: Readonly<Record<string, number>>;
}

export interface GtfsValidationReport {
  readonly validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1';
  readonly status: 'VALID' | 'WARNING' | 'INVALID';
  readonly archiveBytes: number;
  readonly filesPresent: readonly string[];
  readonly inventory: readonly GtfsInventoryItem[];
  readonly metrics: GtfsValidationMetrics;
  readonly coverage: GtfsCoverageReport;
  readonly issues: readonly GtfsIssue[];
}

export interface ParsedGtfsFeed {
  readonly rowsByFile: ReadonlyMap<string, readonly GtfsRow[]>;
  readonly report: GtfsValidationReport;
}

export interface TransJakartaRegistry {
  readonly schemaVersion: 1;
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly datasetName: string;
  readonly publisher: string;
  readonly publicationPage: string;
  readonly officialDownloadUrl: string;
  readonly accessMethod: 'HTTPS_DOWNLOAD';
  readonly license: {
    readonly name: 'CC BY 4.0';
    readonly url: string;
    readonly evidenceUrl: string;
    readonly attributionRequirement: string;
    readonly redistributionImplication: string;
  };
  readonly verification: {
    readonly status: 'VERIFIED';
    readonly verifiedAt: string;
    readonly evidence: readonly string[];
    readonly corroboration: readonly string[];
  };
  readonly currentManifest: string;
}

export interface TransJakartaManifest {
  readonly schemaVersion: 1;
  readonly datasetSourceId: string;
  readonly datasetVersionId: string;
  readonly sourceKey: string;
  readonly versionLabel: string;
  readonly source: {
    readonly publisher: string;
    readonly publicationPage: string;
    readonly requestedDownloadUrl: string;
    readonly resolvedDownloadUrl: string;
    readonly accessMethod: 'HTTPS_DOWNLOAD';
    readonly httpStatus: 200;
    readonly contentType: 'application/zip';
    readonly licenseName: 'CC BY 4.0';
    readonly licenseUrl: string;
    readonly licenseEvidenceUrl: string;
  };
  readonly snapshot: {
    readonly retrievedAt: string;
    readonly archiveFilename: string;
    readonly rawPathRef: string;
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly serviceCoverage: {
    readonly effectiveFrom: string | null;
    readonly effectiveTo: string | null;
  };
  readonly validation: {
    readonly status: 'VALID' | 'WARNING';
    readonly validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1';
    readonly qualityReportPath: string;
    readonly externalValidatorStatus: 'PASS' | 'NOT_VERIFIED';
    readonly externalValidatorNote: string;
  };
}

export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface NormalizedOperator {
  readonly id: string;
  readonly externalId: string;
  readonly code: string;
  readonly name: string;
  readonly modeGroup: string;
}

export interface NormalizedStation {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly externalId: string;
  readonly name: string;
  readonly stationType: string;
  readonly parentStationId: string | null;
  readonly coordinate: Coordinate;
}

export interface NormalizedStop {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly stationId: string | null;
  readonly externalId: string;
  readonly name: string;
  readonly coordinate: Coordinate;
}

export interface NormalizedRoute {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly operatorId: string;
  readonly externalId: string;
  readonly shortName: string | null;
  readonly longName: string | null;
  readonly mode: string;
  readonly description: string | null;
  readonly sourceUrl: string | null;
  readonly color: string | null;
  readonly textColor: string | null;
  readonly sortOrder: number | null;
  readonly gtfsRouteType: number;
}

export interface NormalizedServiceCalendar {
  readonly id: string;
  readonly operatorId: string;
  readonly serviceCode: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly weekdays: readonly [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
  ];
}

export interface NormalizedShape {
  readonly id: string;
  readonly externalId: string;
  readonly points: readonly Coordinate[];
}

export interface NormalizedTrip {
  readonly id: string;
  readonly routeId: string;
  readonly serviceCalendarId: string;
  readonly transitShapeId: string | null;
  readonly externalId: string;
  readonly directionId: 0 | 1 | null;
  readonly headsign: string | null;
}

export interface NormalizedStopTime {
  readonly id: string;
  readonly tripId: string;
  readonly stopId: string;
  readonly stopSequence: number;
  readonly arrivalSeconds: number;
  readonly departureSeconds: number;
  readonly pickupType: number | null;
  readonly dropoffType: number | null;
}

export interface NormalizedTripFrequency {
  readonly id: string;
  readonly tripId: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly headwaySeconds: number;
  readonly exactTimes: boolean;
}

export interface NormalizedTransfer {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly fromStopId: string | null;
  readonly fromStationId: string | null;
  readonly toStopId: string | null;
  readonly toStationId: string | null;
  readonly transferType: string;
  readonly minTransferSeconds: number | null;
  readonly points: readonly Coordinate[];
}

export interface NormalizedTransitSegment {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly routeId: string;
  readonly fromStopId: string;
  readonly toStopId: string;
  readonly directionId: 0 | 1;
  readonly points: readonly Coordinate[];
}

export interface NormalizedTripSegmentTraversal {
  readonly id: string;
  readonly transitSegmentId: string;
  readonly tripId: string;
  readonly routeId: string;
  readonly fromStopId: string;
  readonly toStopId: string;
  readonly transitShapeId: string | null;
  readonly directionId: 0 | 1;
  readonly segmentSequence: number;
  readonly points: readonly Coordinate[];
}

export interface NormalizedGtfsFeed {
  readonly operators: readonly NormalizedOperator[];
  readonly stations: readonly NormalizedStation[];
  readonly stops: readonly NormalizedStop[];
  readonly routes: readonly NormalizedRoute[];
  readonly serviceCalendars: readonly NormalizedServiceCalendar[];
  readonly shapes: readonly NormalizedShape[];
  readonly trips: readonly NormalizedTrip[];
  readonly stopTimes: readonly NormalizedStopTime[];
  readonly tripFrequencies: readonly NormalizedTripFrequency[];
  readonly transfers: readonly NormalizedTransfer[];
  readonly transitSegments: readonly NormalizedTransitSegment[];
  readonly tripSegmentTraversals: readonly NormalizedTripSegmentTraversal[];
  readonly report: GtfsValidationReport;
}
