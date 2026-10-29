import type { GeoPoint, JourneyAlternative, JourneyLeg } from './journey.js';

export type RecoveryStatus = 'COMPLETED' | 'NO_PATH' | 'FAILED';
export type RecoveryClassification =
  'COMPLETED' | 'STILL_VALID' | 'INVALIDATED' | 'REPAIRED_REPLACED';

export type RecoveryImpact = Readonly<{
  impactId: string;
  journeyId: string;
  mobilityEntityId: string;
  stateTransitionId: string;
  operationalState: string;
  projectionVersion: string;
  provenanceRef: string | null;
}>;

export type RecoveryMetrics = Readonly<{
  recoverySuccess: boolean;
  preservedLegRatio: number;
  preservedLegCount: number;
  eligibleRemainingLegCount: number;
  changedLegCount: number;
  addedTravelTimeSeconds: number | null;
  addedTransfers: number | null;
  planChangeCount: number;
  disruptedEntityAvoidance: boolean;
  stateValidationMilliseconds: number;
  preservationProcessingMilliseconds: number;
  proposedRoutingMilliseconds: number;
  baselineRoutingMilliseconds: number;
  totalComputationMilliseconds: number;
  stateAware: RecoveryMethodMetrics;
  fullReplan: RecoveryMethodMetrics;
}>;

export type RecoveryMethodMetrics = Readonly<{
  recoverySuccess: boolean;
  preservedLegRatio: number;
  addedTravelTimeSeconds: number | null;
  addedTransfers: number | null;
  planChangeCount: number | null;
  disruptedEntityAvoidance: boolean;
  timing: Readonly<{
    totalMs: number;
    routingMs: number;
    validationMs: number;
    mergeMs?: number;
  }>;
}>;

export type RecoveryProposal = Readonly<{
  recoveryId: string;
  activeJourneyId: string;
  /** Pointer generation observed before routing/OTP work; null means original G0. */
  baseRecoveryId?: string | null;
  impactId: string;
  ownerRef: string;
  method: 'STATE_AWARE_REPAIR';
  status: RecoveryStatus;
  progressRevision: number;
  completedLegCount: number;
  recoveryAnchor: Readonly<{ name: string; point: GeoPoint }>;
  recoveryAt: string;
  networkSnapshotId: string;
  mobilityProjectionVersion: string;
  originalJourneyFingerprint: string;
  proposedFingerprint: string | null;
  baselineFingerprint: string | null;
  triggeringEntityId: string;
  stateTransitionId: string;
  reason: string;
  completedLegs: readonly JourneyLeg[];
  preservedLegs: readonly JourneyLeg[];
  invalidatedLegs: readonly JourneyLeg[];
  repairedLegs: readonly JourneyLeg[];
  rejoinedLegs: readonly JourneyLeg[];
  rejoinStatus: 'REJOINED' | 'SUFFIX_REPLANNED' | 'NO_PATH';
  rejoinReason: string;
  proposedJourney: JourneyAlternative | null;
  baselineJourney: JourneyAlternative | null;
  metrics: RecoveryMetrics;
}>;

/**
 * Additive acceptance lineage. The immutable original itinerary in
 * journey.journey_plan/original_plan_json is never rewritten; this record pins
 * the accepted replacement/continuation the traveller is now following.
 */
export type RecoveryAcceptance = Readonly<{
  recoveryId: string;
  activeJourneyId: string;
  ownerRef: string;
  /**
   * Durable generation chain: the accepted recovery this acceptance superseded
   * (the active pointer value at accept time). null links back to G0/original.
   * Immutable; never rewritten by later acceptances.
   */
  predecessorRecoveryId: string | null;
  acceptedProgressRevision: number;
  acceptedImpactId: string;
  acceptedStateTransitionId: string;
  acceptedMobilityProjectionVersion: string;
  acceptedJourneyFingerprint: string;
  acceptedJourney: JourneyAlternative;
  acceptedAt: string;
}>;

export class RecoveryError extends Error {
  constructor(
    readonly code:
      | 'RECOVERY_NOT_FOUND'
      | 'IMPACT_NOT_CURRENT'
      | 'INVALID_RECOVERY_ANCHOR'
      | 'NO_RECOVERY_PATH'
      | 'IDEMPOTENCY_CONFLICT'
      | 'RECOVERY_NOT_ACCEPTABLE'
      | 'RECOVERY_STALE'
      | 'RECOVERY_CANDIDATE_BLOCKED',
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryError';
  }
}
