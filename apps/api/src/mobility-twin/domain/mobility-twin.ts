import type {
  OperationalEvidenceType,
  OperationalObservation,
  OperationalState,
} from '../../operational-data/domain/operational-data.js';

export type TwinFreshnessStatus =
  'FRESH' | 'AGING' | 'STALE' | 'EXPIRED' | 'UNKNOWN' | 'NOT_YET_VALID';

export type PersistedOperationalObservation = Readonly<
  OperationalObservation & {
    mobilityEntityId: string | null;
  }
>;

export type EffectiveMobilityState = Readonly<{
  mobilityEntityId: string;
  operationalState: OperationalState;
  evidenceType: OperationalEvidenceType | null;
  freshnessStatus: TwinFreshnessStatus;
  observationId: string | null;
  sourceId: string | null;
  observedAt: string | null;
  expiresAt: string | null;
  confidenceStatus: OperationalObservation['confidenceStatus'] | null;
  confidence: number | null;
  provenanceRef: string | null;
  stateAsOf: string;
  projectionVersion: string;
  reason: string;
}>;

export type MobilityStateHistoryRecord = Readonly<{
  id: string;
  mobilityEntityId: string;
  previousState: OperationalState | null;
  newState: OperationalState;
  effectiveAt: string;
  triggeringObservationId: string | null;
  evidenceType: OperationalEvidenceType | null;
  freshnessStatus: TwinFreshnessStatus;
  sourceId: string | null;
  provenanceRef: string | null;
  reason: string;
  projectionVersion: string;
}>;

export type NetworkSnapshot = Readonly<{
  snapshotId: string;
  transitDatasetVersionId: string;
  spatialDatasetVersionId: string;
  processingVersion: string;
  stateCutoffAt: string;
  configuration: Readonly<Record<string, unknown>>;
  manifestRef: string;
  contentHash: string;
  status: 'DRAFT' | 'FINALIZED';
  createdAt: string;
  finalizedAt: string | null;
  materializedStateCount: number;
}>;

export type SnapshotCreationInput = Readonly<{
  transitDatasetVersionId: string;
  spatialDatasetVersionId: string;
  processingVersion: string;
  stateCutoffAt: Date;
  configuration: Readonly<Record<string, unknown>>;
  manifestRef: string;
}>;
