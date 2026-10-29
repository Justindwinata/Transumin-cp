import { createHash } from 'node:crypto';

import {
  OPERATIONAL_EVIDENCE_TYPES,
  OPERATIONAL_INCIDENT_TYPES,
  OPERATIONAL_MODES,
  OPERATIONAL_SOURCE_CLASSIFICATIONS,
  OPERATIONAL_STATES,
  type OperationalEvidenceType,
  type OperationalIncidentType,
  type OperationalMode,
  type OperationalObservation,
  type OperationalSourceClassification,
  type OperationalState,
  type SourceAuthority,
  type SourceChannel,
} from './operational-data.js';

/**
 * SCX-FR-003 / SCX-FR-005 hazard evidence and append-only incident lifecycle.
 * Hazard records carry geometry/time/source only and never assert a transport
 * condition; operational consequences reach `twin.mobility_state` solely through
 * validated `OperationalObservation` projection.
 */

/** Controlled source classes. Only the runtime-operable subset may be ingested. */
export const HAZARD_SOURCE_CLASSES = [
  'SIMULATED',
  'MANUAL_VERIFIED',
  'ADMIN_FIELD_REVIEW',
  'GTFS_RT',
  'AUTHORIZED_OPERATOR_API',
] as const;

export type HazardSourceClass = (typeof HAZARD_SOURCE_CLASSES)[number];

/**
 * Runtime-operable classes of X1-A. GTFS_RT and AUTHORIZED_OPERATOR_API remain
 * representable (documented contract boundary) but fail closed at ingestion
 * until an authorized feed and entity mapping exist.
 */
export const RUNTIME_OPERABLE_SOURCE_CLASSES: readonly HazardSourceClass[] = [
  'SIMULATED',
  'MANUAL_VERIFIED',
  'ADMIN_FIELD_REVIEW',
];

export function isRuntimeOperableSourceClass(
  sourceClass: HazardSourceClass,
): boolean {
  return RUNTIME_OPERABLE_SOURCE_CLASSES.includes(sourceClass);
}

/** Append-only lifecycle states. No update/delete path exists. */
export const INCIDENT_LIFECYCLE_STATUSES = [
  'INGESTED_UNVERIFIED',
  'VERIFIED_ACTIVE',
  'RESOLVED',
  'RETRACTED',
] as const;

export type IncidentLifecycleStatus =
  (typeof INCIDENT_LIFECYCLE_STATUSES)[number];

/** Terminal lifecycle states never contribute to effective Twin state. */
export const TERMINAL_LIFECYCLE_STATUSES: readonly IncidentLifecycleStatus[] = [
  'RESOLVED',
  'RETRACTED',
];

export function isTerminalLifecycleStatus(
  status: IncidentLifecycleStatus,
): boolean {
  return TERMINAL_LIFECYCLE_STATUSES.includes(status);
}

export type BoundedGeometryPolicy = Readonly<{
  maxCoordinates: number;
  maxAreaDegreesSquared: number;
}>;

export type IncidentEvidenceInput = Readonly<{
  incidentId: string;
  incidentType: OperationalIncidentType;
  affectedEntityIds: readonly string[];
  affectedModes: readonly OperationalMode[];
  operationalState: OperationalState;
  sourceClass: HazardSourceClass;
  sourceId: string;
  sourceAuthority: SourceAuthority;
  sourceChannel: SourceChannel;
  evidenceType: OperationalEvidenceType;
  sourceClassification: OperationalSourceClassification;
  observedAt: string;
  effectiveFrom: string;
  expiresAt: string;
  receivedAt: string;
  reason: string;
  provenanceRef: string;
  rawReference: string;
  supportingHazardEventId: string | null;
}>;

export const INCIDENT_EVIDENCE_SCHEMA_VERSION = 'X1A-V1';

/**
 * Deterministic identity of one evidence record. Re-ingesting the same evidence
 * yields the same key and therefore no duplicate observation or impact.
 */
export function incidentEvidenceIdentity(input: IncidentEvidenceInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: INCIDENT_EVIDENCE_SCHEMA_VERSION,
        incidentId: input.incidentId,
        incidentType: input.incidentType,
        affectedEntityIds: [...input.affectedEntityIds].sort(),
        affectedModes: [...input.affectedModes].sort(),
        operationalState: input.operationalState,
        sourceClass: input.sourceClass,
        sourceId: input.sourceId,
        sourceAuthority: input.sourceAuthority,
        sourceChannel: input.sourceChannel,
        evidenceType: input.evidenceType,
        sourceClassification: input.sourceClassification,
        observedAt: input.observedAt,
        effectiveFrom: input.effectiveFrom,
        expiresAt: input.expiresAt,
        receivedAt: input.receivedAt,
        reason: input.reason,
        provenanceRef: input.provenanceRef,
        rawReference: input.rawReference,
        supportingHazardEventId: input.supportingHazardEventId,
      }),
    )
    .digest('hex');
}

export function validateIncidentEvidence(
  input: IncidentEvidenceInput,
): readonly string[] {
  const errors: string[] = [];
  if (!OPERATIONAL_INCIDENT_TYPES.includes(input.incidentType))
    errors.push('incidentType is unsupported');
  if (!OPERATIONAL_STATES.includes(input.operationalState))
    errors.push('operationalState is unsupported');
  if (!OPERATIONAL_EVIDENCE_TYPES.includes(input.evidenceType))
    errors.push('evidenceType is unsupported');
  if (!OPERATIONAL_SOURCE_CLASSIFICATIONS.includes(input.sourceClassification))
    errors.push('sourceClassification is unsupported');
  if (!HAZARD_SOURCE_CLASSES.includes(input.sourceClass))
    errors.push('sourceClass is unsupported');
  if (!isRuntimeOperableSourceClass(input.sourceClass))
    errors.push(
      `sourceClass ${input.sourceClass} has no permitted runtime ingestion path and must fail closed`,
    );
  if (
    !Array.isArray(input.affectedEntityIds) ||
    input.affectedEntityIds.length === 0
  )
    errors.push('at least one affected canonical entity is required');
  if (!Array.isArray(input.affectedModes) || input.affectedModes.length === 0)
    errors.push('at least one affected mode is required');
  if (
    Array.isArray(input.affectedModes) &&
    input.affectedModes.includes('WALKING')
  )
    errors.push('WALKING is not a supported incident entity mode');
  if (['FLOOD', 'WEATHER_DISRUPTION'].includes(input.incidentType))
    errors.push('hazards cannot be operational incidents');
  if (
    input.sourceClass === 'SIMULATED' &&
    (input.evidenceType !== 'SIMULATED' ||
      input.sourceAuthority !== 'SIMULATION' ||
      input.sourceChannel !== 'CONTROLLED_SIMULATION')
  )
    errors.push('SIMULATED source requires controlled simulation evidence');
  if (
    input.sourceClass === 'MANUAL_VERIFIED' &&
    (input.evidenceType !== 'OBSERVED' ||
      input.sourceAuthority !== 'OFFICIAL_OPERATOR_CONFIRMED' ||
      input.sourceChannel !== 'OPERATOR_CONFIRMED')
  )
    errors.push(
      'MANUAL_VERIFIED requires operator-confirmed observed evidence',
    );
  if (
    input.sourceClass === 'ADMIN_FIELD_REVIEW' &&
    (input.evidenceType !== 'OBSERVED' ||
      input.sourceAuthority !== 'ADMIN_FIELD_REVIEW' ||
      input.sourceChannel !== 'ADMIN_REVIEW')
  )
    errors.push('ADMIN_FIELD_REVIEW requires admin-reviewed observed evidence');
  if (
    input.sourceClass !== 'ADMIN_FIELD_REVIEW' &&
    (input.sourceAuthority === 'ADMIN_FIELD_REVIEW' ||
      input.sourceChannel === 'ADMIN_REVIEW')
  )
    errors.push('Admin authority/channel requires ADMIN_FIELD_REVIEW class');
  if (input.sourceClass === 'ADMIN_FIELD_REVIEW') {
    const observedAt = Date.parse(input.observedAt);
    const receivedAt = Date.parse(input.receivedAt);
    const startAt = Date.parse(input.effectiveFrom);
    const expiryAt = Date.parse(input.expiresAt);
    if (receivedAt - observedAt > 30 * 60_000 || observedAt > receivedAt)
      errors.push(
        'Admin field observation must be within 30 minutes of review',
      );
    if (
      startAt !== receivedAt ||
      expiryAt - startAt < 5 * 60_000 ||
      expiryAt - startAt > 60 * 60_000
    )
      errors.push(
        'Admin field restriction must start at review and last 5–60 minutes',
      );
  }
  if (input.operationalState === 'AVAILABLE')
    errors.push('incident cannot assert AVAILABLE as a resolution');
  if (
    Array.isArray(input.affectedModes) &&
    input.affectedModes.some((mode) => !OPERATIONAL_MODES.includes(mode))
  )
    errors.push('affectedModes contains an unsupported mode');
  if (
    Array.isArray(input.affectedEntityIds) &&
    input.affectedEntityIds.some(
      (id) => typeof id !== 'string' || id.trim() === '',
    )
  )
    errors.push('affectedEntityIds contains an empty identifier');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(input.incidentId) ||
    !uuid.test(input.sourceId) ||
    (input.supportingHazardEventId !== null &&
      !uuid.test(input.supportingHazardEventId)) ||
    (Array.isArray(input.affectedEntityIds) &&
      input.affectedEntityIds.some((id) => !uuid.test(id)))
  )
    errors.push('incident, source, hazard and entity IDs must be UUIDs');
  if (input.reason.trim() === '') errors.push('reason is required');
  if (input.provenanceRef.trim() === '')
    errors.push('provenanceRef is required');
  if (input.rawReference.trim() === '') errors.push('rawReference is required');
  if (
    input.operationalState === 'UNAVAILABLE' &&
    input.evidenceType === 'SIMULATED' &&
    input.sourceAuthority !== 'SIMULATION'
  )
    errors.push('SIMULATED closure requires SIMULATION source authority');

  const observed = Date.parse(input.observedAt);
  const effectiveFrom = Date.parse(input.effectiveFrom);
  const received = Date.parse(input.receivedAt);
  const expires = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(effectiveFrom) ||
    !Number.isFinite(received) ||
    !Number.isFinite(expires)
  ) {
    errors.push(
      'observedAt, effectiveFrom, receivedAt, and expiresAt must be valid ISO-8601 timestamps',
    );
  } else if (effectiveFrom >= expires) {
    errors.push('effectiveFrom must be strictly earlier than expiresAt');
  } else if (received < observed) {
    errors.push('receivedAt must not precede observedAt');
  }
  return errors;
}

export type PersistedIncidentProjection = Readonly<{
  observationId: string;
  incidentId: string;
  lifecycleStatus: IncidentLifecycleStatus;
  sourceClass: HazardSourceClass;
  observedAt: string;
  receivedAt: string;
  updatedAt: string;
  expiresAt: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  provenanceRef: string;
  operationalState: OperationalState;
  evidenceType: OperationalEvidenceType;
}>;

export type IncidentBlockingRow = Readonly<{
  lifecycleStatus: IncidentLifecycleStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  expiresAt: string;
}>;

/**
 * Blocking is true only for a verified-active incident whose effective window
 * contains `asOf`. UNKNOWN / unverified / future / expired / resolved / retracted
 * never block. Effective-from is inclusive, expires-at is exclusive.
 */
export function incidentBlocksAt(
  row: IncidentBlockingRow,
  asOf: Date,
): boolean {
  if (row.lifecycleStatus !== 'VERIFIED_ACTIVE') return false;
  const instant = asOf.getTime();
  if (instant < Date.parse(row.effectiveFrom)) return false;
  if (instant >= Date.parse(row.expiresAt)) return false;
  if (row.effectiveTo !== null && instant >= Date.parse(row.effectiveTo))
    return false;
  return true;
}

type PolygonCoordinates = readonly (readonly (readonly number[])[])[];

export type IncidentGeometryValidation = Readonly<{
  valid: boolean;
  ringCount: number;
  coordinateCount: number;
  reason: string | null;
}>;

function ringAreaSquared(ring: readonly (readonly number[])[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const position of ring) {
    const [x, y] = position;
    if (typeof x !== 'number' || typeof y !== 'number') return Number.NaN;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return (maxX - minX) * (maxY - minY);
}

/**
 * Bounded, finite geometry validation for hazard evidence. Rejects non-finite
 * coordinates, malformed rings, empty/degenerate rings, and envelopes that
 * exceed the configured degree bounding box.
 */
export function validateBoundedHazardGeometry(
  geometry: Readonly<{
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
  }>,
  policy: BoundedGeometryPolicy,
): IncidentGeometryValidation {
  const polygons: readonly PolygonCoordinates[] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as PolygonCoordinates]
      : (geometry.coordinates as readonly PolygonCoordinates[]);
  if (!Array.isArray(polygons) || polygons.length === 0)
    return {
      valid: false,
      ringCount: 0,
      coordinateCount: 0,
      reason: 'geometry must contain at least one polygon',
    };

  let ringCount = 0;
  let coordinateCount = 0;
  let totalEnvelope = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0)
      return {
        valid: false,
        ringCount,
        coordinateCount,
        reason: 'polygon must contain at least one ring',
      };
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4)
        return {
          valid: false,
          ringCount,
          coordinateCount,
          reason: 'each ring needs at least four positions',
        };
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (
        !Array.isArray(first) ||
        !Array.isArray(last) ||
        first[0] !== last[0] ||
        first[1] !== last[1]
      )
        return {
          valid: false,
          ringCount,
          coordinateCount,
          reason: 'rings must be explicitly closed',
        };
      const area = ringAreaSquared(ring);
      if (!Number.isFinite(area) || area <= 0)
        return {
          valid: false,
          ringCount,
          coordinateCount,
          reason: 'rings must be finite and non-degenerate',
        };
      ringCount += 1;
      coordinateCount += ring.length;
      totalEnvelope += area;
      if (coordinateCount > policy.maxCoordinates)
        return {
          valid: false,
          ringCount,
          coordinateCount,
          reason: 'geometry exceeds the coordinate complexity bound',
        };
    }
  }
  if (totalEnvelope > policy.maxAreaDegreesSquared)
    return {
      valid: false,
      ringCount,
      coordinateCount,
      reason: 'geometry envelope exceeds the bounded study-area policy',
    };
  return { valid: true, ringCount, coordinateCount, reason: null };
}

export type IncidentEvidencePlan = Readonly<{
  identity: string;
  observation: OperationalObservation;
  lifecycleStatus: IncidentLifecycleStatus;
}>;
