import type {
  RecoveryAcceptance,
  RecoveryImpact,
  RecoveryProposal,
} from '../domain/recovery.js';

export const RECOVERY_REPOSITORY = Symbol('RECOVERY_REPOSITORY');

export type AcceptRecoveryInput = Readonly<{
  recoveryId: string;
  ownerRef: string;
  idempotencyKey: string;
  /** Current journey progress revision the caller last observed (freshness gate). */
  progressRevision: number;
  /** Candidate that must remain free of currently unavailable canonical entities. */
  acceptedJourney: RecoveryProposal['proposedJourney'];
  acceptedJourneyFingerprint: string;
  acceptedAt: string;
}>;

export interface RecoveryRepositoryPort {
  findByIdempotency(
    ownerRef: string,
    idempotencyKey: string,
  ): Promise<RecoveryProposal | null>;
  getCurrentImpact(
    impactId: string,
    journeyId: string,
    ownerRef: string,
  ): Promise<RecoveryImpact | null>;
  save(
    proposal: RecoveryProposal,
    idempotencyKey: string,
  ): Promise<RecoveryProposal>;
  get(recoveryId: string, ownerRef: string): Promise<RecoveryProposal>;
  /**
   * Atomically persists acceptance lineage and advances the active-journey
   * current-itinerary pointer. Locks the journey/progress/recovery rows, so a
   * concurrent progress update or duplicate acceptance cannot interleave.
   */
  accept(input: AcceptRecoveryInput): Promise<RecoveryAcceptance>;
  findAcceptance(
    recoveryId: string,
    ownerRef: string,
  ): Promise<RecoveryAcceptance | null>;
  findAcceptanceByIdempotency(
    ownerRef: string,
    idempotencyKey: string,
  ): Promise<RecoveryAcceptance | null>;
}
