import type { MobilityStateHistoryRecord } from '../../mobility-twin/domain/mobility-twin.js';
import type { EffectiveMobilityState } from '../../mobility-twin/domain/mobility-twin.js';
import type {
  ActiveJourney,
  JourneyAlert,
  JourneyDependency,
} from '../domain/active-journey.js';
import type { JourneyAlternative } from '../domain/journey.js';

export const ACTIVE_JOURNEY_REPOSITORY = Symbol('ACTIVE_JOURNEY_REPOSITORY');

export type ActivateJourneyInput = Readonly<{
  journeyId: string;
  ownerRef: string;
  selectedJourney: JourneyAlternative;
  planFingerprint: string;
  dependencies: readonly Omit<JourneyDependency, 'dependencyId'>[];
  activatedAt: string;
  idempotencyKey?: string;
  requestFingerprint?: string;
}>;

export type ProgressUpdateInput = Readonly<{
  journeyId: string;
  ownerRef: string;
  completedLegCount: number;
  currentLegSequence: number | null;
  recordedAt: string;
  acceptedRecoveryId?: string | null;
}>;

export type ImpactProcessingResult = Readonly<{
  affectedJourneyIds: readonly string[];
  alerts: readonly JourneyAlert[];
  duplicateCount: number;
}>;

export interface ActiveJourneyRepositoryPort {
  activate(input: ActivateJourneyInput): Promise<ActiveJourney>;
  get(journeyId: string, ownerRef: string): Promise<ActiveJourney>;
  updateProgress(input: ProgressUpdateInput): Promise<ActiveJourney>;
  confirmBoarding(
    input: Readonly<{
      journeyId: string;
      ownerRef: string;
      legSequence: number;
      confirmedAt: string;
      acceptedRecoveryId?: string | null;
    }>,
  ): Promise<ActiveJourney>;
  confirmAlighting(
    input: Readonly<{
      journeyId: string;
      ownerRef: string;
      legSequence: number;
      confirmedAt: string;
      acceptedRecoveryId?: string | null;
    }>,
  ): Promise<ActiveJourney>;
  listAlerts(
    journeyId: string,
    ownerRef: string,
  ): Promise<readonly JourneyAlert[]>;
  processTransition(
    history: MobilityStateHistoryRecord,
    state: EffectiveMobilityState,
  ): Promise<ImpactProcessingResult>;
}
