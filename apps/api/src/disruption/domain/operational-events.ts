import type {
  OperationalEvidenceType,
  OperationalState,
} from '../../operational-data/domain/operational-data.js';

export const OPERATIONAL_EVENT_TYPES = [
  'operational.observation.received',
  'operational.state.changed',
  'disruption.detected',
  'source.health.changed',
  'journey.alert.created',
  'heartbeat',
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

export type OperationalStreamEvent = Readonly<{
  id: string;
  type: OperationalEventType;
  timestamp: string;
  entityId: string | null;
  incidentId: string | null;
  observationId: string | null;
  evidenceType: OperationalEvidenceType | null;
  operationalState: OperationalState | null;
  sourceId: string | null;
  audienceJourneyId?: string | null;
  audienceOwnerRef?: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type SourceHealth = Readonly<{
  sourceId: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  errorSummary: string | null;
}>;
