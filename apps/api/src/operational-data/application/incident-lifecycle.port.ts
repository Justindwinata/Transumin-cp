import type {
  IncidentEvidenceInput,
  IncidentLifecycleStatus,
  PersistedIncidentProjection,
} from '../domain/hazard-incident.js';
import type { IncidentVerification } from './operational-incident.service.js';

export const INCIDENT_LIFECYCLE_PORT = Symbol('INCIDENT_LIFECYCLE_PORT');

export type IncidentIngestResult = Readonly<{
  incidentId: string;
  evidenceIdentity: string;
  status: 'INSERTED' | 'ALREADY_PERSISTED';
  observationIds: readonly string[];
  projectedEntityIds: readonly string[];
}>;

export type IncidentTerminalTransitionInput = Readonly<{
  incidentId: string;
  toStatus: Extract<IncidentLifecycleStatus, 'RESOLVED' | 'RETRACTED'>;
  changedAt: string;
  reason: string;
  provenanceRef: string;
}>;

export interface IncidentLifecyclePort {
  ingest(
    input: IncidentEvidenceInput,
    verification: IncidentVerification,
    asOf?: Date,
  ): Promise<IncidentIngestResult>;
  transition(
    input: IncidentTerminalTransitionInput,
  ): Promise<PersistedIncidentProjection>;
  get(incidentId: string): Promise<PersistedIncidentProjection | null>;
}
