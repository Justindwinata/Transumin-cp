import type { JourneyAlternative } from './journey.js';

export type ActiveJourneyLifecycle = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type JourneyProgress = Readonly<{
  completedLegCount: number;
  currentLegSequence: number | null;
  method: 'CONTROLLED_MANUAL';
  recordedAt: string;
  revision: number;
  /** Explicit passenger confirmation only. Never derived from device GPS. */
  boardingConfirmedLegSequence: number | null;
  boardingConfirmedAt: string | null;
  alightingConfirmedLegSequence: number | null;
  alightingConfirmedAt: string | null;
}>;

export type JourneyDependency = Readonly<{
  dependencyId: string;
  journeyId: string;
  legSequence: number;
  mobilityEntityId: string;
  canonicalEntityId: string;
  entityType: 'STOP' | 'STATION' | 'ROUTE';
  productMode: string;
  provenanceRef: string;
}>;

export type ActiveJourney = Readonly<{
  journeyId: string;
  ownerRef: string;
  lifecycleStatus: ActiveJourneyLifecycle;
  planFingerprint: string;
  originalPlan: JourneyAlternative;
  /** Current route; after acceptance combines immutable completed history and rebased accepted suffix. */
  currentPlan?: JourneyAlternative;
  acceptedRecoveryId?: string | null;
  acceptedBeforeLegCount?: number | null;
  activatedAt: string;
  completedAt: string | null;
  progress: JourneyProgress;
  dependencies: readonly JourneyDependency[];
}>;

export type JourneyAlert = Readonly<{
  alertId: string;
  impactId: string;
  journeyId: string;
  ownerRef: string;
  alertType: 'BLOCKING' | 'DISRUPTION' | 'RECOVERY_UPDATE';
  message: string;
  mobilityEntityId: string;
  affectedLegSequences: readonly number[];
  operationalState: 'UNAVAILABLE' | 'DEGRADED' | 'DISRUPTED' | 'RECOVERING';
  evidenceType: string | null;
  freshnessStatus: string;
  observationId: string | null;
  sourceId: string | null;
  observedAt: string | null;
  receivedAt: string | null;
  expiresAt: string | null;
  provenanceRef: string | null;
  projectionVersion: string;
  createdAt: string;
  resolvedAt: string | null;
}>;

export class ActiveJourneyError extends Error {
  constructor(
    readonly code:
      | 'JOURNEY_NOT_FOUND'
      | 'OWNER_SCOPE_MISMATCH'
      | 'ACTIVATION_CONFLICT'
      | 'INVALID_PROGRESS'
      | 'INVALID_BOARDING'
      | 'JOURNEY_NOT_ACTIVE'
      | 'STALE_ROUTE',
    message: string,
  ) {
    super(message);
    this.name = 'ActiveJourneyError';
  }
}
