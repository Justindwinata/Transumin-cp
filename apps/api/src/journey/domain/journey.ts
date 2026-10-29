import type { ProductMode } from '../../routing-data/domain/otp-input.js';

export type JourneyPreference =
  'BALANCED' | 'FASTEST' | 'FEWEST_TRANSFERS' | 'LEAST_WALKING';

export type JourneyTimingPrecision =
  | 'EXACT_SCHEDULE'
  | 'FREQUENCY_DERIVED'
  | 'SOURCE_GTFS_WITH_FREQUENCIES'
  | 'ESTIMATED';

export type GeoPoint = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type JourneyGeometry = Readonly<{
  type: 'LineString';
  coordinates: readonly (readonly [number, number])[];
}>;

export type JourneyWalkingStep = Readonly<{
  latitude: number;
  longitude: number;
  distanceMeters: number;
  relativeDirection: string | null;
  absoluteDirection: string | null;
  streetName: string | null;
  bogusName: boolean;
  area: boolean;
  stayOn: boolean;
}>;

export type JourneyPlanRequest = Readonly<{
  origin: GeoPoint;
  destination: GeoPoint;
  departureAt: string;
  networkSnapshotId: string;
  preference: JourneyPreference;
  allowedModes?: readonly ProductMode[];
  maximumAlternatives?: number;
}>;

export type RouterEntityReference = Readonly<{
  otpEntityId: string;
  entityType: 'STOP' | 'ROUTE';
  name: string | null;
}>;

export type CanonicalEntityBinding = Readonly<{
  otpEntityId: string;
  productMode: ProductMode;
  entityType: 'STOP' | 'STATION' | 'ROUTE';
  canonicalEntityId: string;
  mobilityEntityId: string | null;
  resolutionMethod:
    | 'EXACT_SOURCE_REFERENCE'
    | 'OPERATOR_SCOPED_EXACT_ALIAS'
    | 'OPERATOR_SCOPED_EXACT_SOURCE_POINT'
    | 'CONTROLLED_ROUTING_IDENTITY';
  provenanceRef: string;
}>;

export type JourneyOperationalFlag = Readonly<{
  mobilityEntityId: string;
  operationalState: 'DEGRADED' | 'DISRUPTED';
  evidenceType: string | null;
  freshnessStatus: string;
  provenanceRef: string | null;
}>;

export type JourneyLeg = Readonly<{
  sequence: number;
  mode: ProductMode;
  otpMode: string;
  from: Readonly<{
    name: string;
    otpStopId: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>;
  to: Readonly<{
    name: string;
    otpStopId: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>;
  intermediateStops: readonly Readonly<{
    name: string;
    otpStopId: string;
    latitude?: number | null;
    longitude?: number | null;
  }>[];
  startAt: string;
  endAt: string;
  durationSeconds: number;
  distanceMeters: number;
  routeId: string | null;
  routeShortName: string | null;
  tripId: string | null;
  serviceDate: string | null;
  timingPrecision: JourneyTimingPrecision;
  geometry?: JourneyGeometry | null;
  /**
   * OTP-derived walk maneuvers. Provenance: OTP walk steps over the historical
   * OSM/GTFS graph snapshot — directional hints, not independently validated
   * live pedestrian navigation.
   */
  walkingSteps?: readonly JourneyWalkingStep[];
  entityBindings: readonly CanonicalEntityBinding[];
  operationalFlags: readonly JourneyOperationalFlag[];
}>;

export type RoutingContext = Readonly<{
  provider: 'OTP';
  providerVersion: '2.10.0';
  routingSnapshotId: string;
  routingManifestSha256: string;
  graphSha256: string;
  networkSnapshotId: string;
  networkSnapshotHash: string;
  mobilityProjectionVersion: string;
  plannedAt: string;
  commonServiceDate: string;
  timezone: 'Asia/Jakarta';
  attemptCount: number;
  excludedRouteIds: readonly string[];
}>;

export type JourneyAlternative = Readonly<{
  journeyId: string;
  origin: GeoPoint;
  destination: GeoPoint;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  transferCount: number;
  walkingDistanceMeters: number;
  legs: readonly JourneyLeg[];
  fareStatus: 'UNKNOWN';
  routingContext: RoutingContext;
}>;

export type JourneyCandidateRejection = Readonly<{
  attempt: number;
  routeIds: readonly string[];
  blockedEntityIds: readonly string[];
  reason: 'CURRENT_UNAVAILABLE_CANONICAL_ENTITY';
}>;

export type JourneyPlanResult = Readonly<{
  alternatives: readonly JourneyAlternative[];
  rejectedCandidateCount: number;
  candidateRejections?: readonly JourneyCandidateRejection[];
  stateValidationMilliseconds: number;
  routingMilliseconds: number;
  totalMilliseconds: number;
  strategy: 'INITIAL_PLAN' | 'FULL_REPLAN';
}>;

export type JourneyRoutingErrorCode =
  | 'NO_ROUTE'
  | 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'
  | 'ORIGIN_UNRESOLVED'
  | 'DESTINATION_UNRESOLVED'
  | 'ROUTER_UNAVAILABLE'
  | 'INVALID_TIME'
  | 'DATASET_NOT_READY'
  | 'IDENTITY_UNRESOLVED';

export class JourneyRoutingError extends Error {
  constructor(
    readonly code: JourneyRoutingErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'JourneyRoutingError';
  }
}
