import { createHash } from 'node:crypto';

import type { OperationalObservation } from '../../operational-data/domain/operational-data.js';
import { OperationalConflictResolutionService } from '../../operational-data/application/conflict-resolution.service.js';
import { FreshnessEvaluator } from '../../operational-data/application/freshness-evaluator.js';
import { OperationalContractValidator } from '../../operational-data/application/operational-contract-validator.js';
import { SourcePriorityComparator } from '../../operational-data/application/source-priority.js';
import type {
  EffectiveMobilityState,
  PersistedOperationalObservation,
  TwinFreshnessStatus,
} from '../domain/mobility-twin.js';

export const MOBILITY_TWIN_PROJECTION_VERSION = 'PHASE_2B_V1';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function detailedFreshness(
  observation: OperationalObservation,
  asOf: Date,
): TwinFreshnessStatus {
  const start = Date.parse(observation.observedAt);
  const expiry = Date.parse(observation.expiresAt);
  const current = asOf.getTime();
  if (current < start) return 'NOT_YET_VALID';
  if (current >= expiry) return 'EXPIRED';
  const ratio = (expiry - current) / Math.max(expiry - start, 1);
  if (ratio <= 0.2) return 'STALE';
  if (ratio <= 0.5) return 'AGING';
  return 'FRESH';
}

export class EffectiveStateProjector {
  private readonly conflict: OperationalConflictResolutionService;

  constructor(
    validator = new OperationalContractValidator(),
    freshness = new FreshnessEvaluator(),
    priority = new SourcePriorityComparator(),
  ) {
    this.conflict = new OperationalConflictResolutionService(
      freshness,
      priority,
      validator,
    );
  }

  project(
    mobilityEntityId: string,
    observations: readonly PersistedOperationalObservation[],
    asOf: Date,
  ): EffectiveMobilityState {
    const scoped = observations.filter(
      (observation) => observation.mobilityEntityId === mobilityEntityId,
    );
    const resolution = this.conflict.resolve(scoped, asOf);
    const selected = resolution.selectedObservation;
    const state = selected?.operationalState ?? 'UNKNOWN';
    const freshnessStatus = selected
      ? detailedFreshness(selected, asOf)
      : 'UNKNOWN';
    return {
      mobilityEntityId,
      operationalState: state,
      evidenceType: selected?.evidenceType ?? null,
      freshnessStatus,
      observationId: selected?.observationId ?? null,
      sourceId: selected?.provenance.sourceId ?? null,
      observedAt: selected?.observedAt ?? null,
      expiresAt: selected?.expiresAt ?? null,
      confidenceStatus: selected?.confidenceStatus ?? null,
      confidence: selected?.confidence ?? null,
      provenanceRef: selected?.provenance.lineageReference ?? null,
      stateAsOf: asOf.toISOString(),
      projectionVersion: MOBILITY_TWIN_PROJECTION_VERSION,
      reason:
        selected?.reason ?? 'No fresh evidence establishes current state.',
    };
  }

  fingerprint(state: EffectiveMobilityState): string {
    return hash({
      entity: state.mobilityEntityId,
      operationalState: state.operationalState,
      evidenceType: state.evidenceType,
      freshnessStatus: state.freshnessStatus,
      observationId: state.observationId,
      sourceId: state.sourceId,
      observedAt: state.observedAt,
      expiresAt: state.expiresAt,
      stateAsOf: state.stateAsOf,
      projectionVersion: state.projectionVersion,
    });
  }

  transitionFingerprint(
    entityId: string,
    previousState: string | null,
    state: EffectiveMobilityState,
  ): string {
    return hash({
      entityId,
      previousState,
      newState: state.operationalState,
      effectiveAt: state.stateAsOf,
      observationId: state.observationId,
      projectionVersion: state.projectionVersion,
    });
  }
}
