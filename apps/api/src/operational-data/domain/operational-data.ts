export const OPERATIONAL_EVIDENCE_TYPES = [
  'SCHEDULED',
  'OBSERVED',
  'LIVE',
  'FORECAST',
  'SIMULATED',
  'ESTIMATED',
] as const;

export type OperationalEvidenceType =
  (typeof OPERATIONAL_EVIDENCE_TYPES)[number];

export const OPERATIONAL_STATES = [
  'AVAILABLE',
  'DEGRADED',
  'DISRUPTED',
  'UNAVAILABLE',
  'RECOVERING',
  'UNKNOWN',
] as const;

export type OperationalState = (typeof OPERATIONAL_STATES)[number];

export const OPERATIONAL_INCIDENT_TYPES = [
  'FLOOD',
  'STATION_CLOSURE',
  'STOP_CLOSURE',
  'SERVICE_SUSPENSION',
  'SERVICE_TRUNCATION',
  'ROUTE_DIVERSION',
  'INFRASTRUCTURE_FAILURE',
  'WEATHER_DISRUPTION',
  'MANUAL_OPERATOR_INCIDENT',
  'OTHER',
] as const;

export type OperationalIncidentType =
  (typeof OPERATIONAL_INCIDENT_TYPES)[number];

export const OPERATIONAL_MODES = [
  'TRANSJAKARTA',
  'MIKROTRANS',
  'KRL',
  'MRT_JAKARTA',
  'LRT_JAKARTA',
  'LRT_JABODEBEK',
  'WALKING',
] as const;

export type OperationalMode = (typeof OPERATIONAL_MODES)[number];

export const OPERATIONAL_SOURCE_CLASSIFICATIONS = [
  'VERIFIED_PUBLIC_API',
  'VERIFIED_PUBLIC_FEED',
  'VERIFIED_PUBLIC_INFORMATION',
  'PARTNERSHIP_REQUIRED',
  'AUTOMATION_RESTRICTED',
  'NOT_AVAILABLE',
  'UNKNOWN',
] as const;

export type OperationalSourceClassification =
  (typeof OPERATIONAL_SOURCE_CLASSIFICATIONS)[number];

export const SOURCE_AUTHORITIES = [
  'OFFICIAL_MACHINE',
  'OFFICIAL_OPERATOR_CONFIRMED',
  'OFFICIAL_PUBLIC_UPDATE',
  'VERIFIED_GOVERNMENT_OR_DISRUPTION',
  'CROWDSOURCED_OBSERVATION',
  'ADMIN_FIELD_REVIEW',
  'FORECAST',
  'SIMULATION',
] as const;

export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

export const SOURCE_CHANNELS = [
  'MACHINE_FEED',
  'OPERATOR_CONFIRMED',
  'PUBLIC_INFORMATION',
  'ENVIRONMENTAL_OBSERVATION',
  'CROWDSOURCED',
  'ADMIN_REVIEW',
  'FORECAST_MODEL',
  'CONTROLLED_SIMULATION',
  'AI_EXTRACTED_CANDIDATE',
] as const;

export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const IMPACT_BASES = [
  'DIRECT_OPERATIONAL_REPORT',
  'OPERATOR_CONFIRMED',
  'ENVIRONMENTAL_INDICATOR',
  'FORECAST_INDICATOR',
  'CONTROLLED_SIMULATION',
] as const;

export type ImpactBasis = (typeof IMPACT_BASES)[number];

export const CONFIDENCE_STATUSES = [
  'CONFIRMED',
  'SOURCE_REPORTED',
  'EXTRACTED_CANDIDATE',
  'UNVERIFIED',
  'SIMULATED',
] as const;

export type ConfidenceStatus = (typeof CONFIDENCE_STATUSES)[number];

export type OperationalProvenanceRef = Readonly<{
  sourceId: string;
  sourceClassification: OperationalSourceClassification;
  rawReference: string;
  lineageReference: string;
  retrievedAt: string;
}>;

export type OperationalObservation = Readonly<{
  observationId: string;
  incidentId: string;
  incidentType: OperationalIncidentType;
  affectedEntityRefs: readonly string[];
  affectedModes: readonly OperationalMode[];
  operationalState: OperationalState;
  evidenceType: OperationalEvidenceType;
  sourceAuthority: SourceAuthority;
  sourceChannel: SourceChannel;
  impactBasis: ImpactBasis;
  observedAt: string;
  receivedAt: string;
  updatedAt: string;
  expiresAt: string;
  reason: string;
  confidenceStatus: ConfidenceStatus;
  confidence: number | null;
  provenance: OperationalProvenanceRef;
  sourceAttributes: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type OperationalIncidentCandidate = OperationalObservation &
  Readonly<{
    candidateStatus: 'VALIDATED' | 'REQUIRES_REVIEW' | 'REJECTED';
  }>;

export type OperationalSourceMetadata = Readonly<{
  sourceId: string;
  sourceKey: string;
  publisher: string;
  classification: OperationalSourceClassification;
  authority: SourceAuthority;
  canonicalUrl: string;
  documented: boolean;
  authenticationRequired: boolean;
  automationPermitted: boolean;
  rightsStatus: 'PERMITTED' | 'PROHIBITED' | 'UNKNOWN';
}>;
