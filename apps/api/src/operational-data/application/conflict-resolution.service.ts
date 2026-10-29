import { Inject, Injectable } from '@nestjs/common';

import type {
  OperationalObservation,
  OperationalState,
} from '../domain/operational-data.js';
import { FreshnessEvaluator } from './freshness-evaluator.js';
import { OperationalContractValidator } from './operational-contract-validator.js';
import { SourcePriorityComparator } from './source-priority.js';

export type ConflictResolution = Readonly<{
  operationalState: OperationalState;
  selectedObservation: OperationalObservation | null;
  supersededObservationIds: readonly string[];
  expiredObservationIds: readonly string[];
  reason: 'HIGHEST_AUTHORITY_FRESH_EVIDENCE' | 'NO_FRESH_EVIDENCE';
}>;

@Injectable()
export class OperationalConflictResolutionService {
  constructor(
    @Inject(FreshnessEvaluator)
    private readonly freshness: FreshnessEvaluator,
    @Inject(SourcePriorityComparator)
    private readonly priority: SourcePriorityComparator,
    @Inject(OperationalContractValidator)
    private readonly validator: OperationalContractValidator,
  ) {}

  resolve(
    observations: readonly OperationalObservation[],
    asOf: Date,
  ): ConflictResolution {
    observations.forEach((observation) =>
      this.validator.assertValid(observation),
    );
    const expired = observations.filter(
      (observation) => this.freshness.evaluate(observation, asOf) !== 'FRESH',
    );
    const fresh = observations
      .filter(
        (observation) => this.freshness.evaluate(observation, asOf) === 'FRESH',
      )
      .sort((left, right) => this.priority.compare(left, right));
    const selected = fresh[0] ?? null;
    if (selected === null) {
      return {
        operationalState: 'UNKNOWN',
        selectedObservation: null,
        supersededObservationIds: [],
        expiredObservationIds: expired.map((item) => item.observationId),
        reason: 'NO_FRESH_EVIDENCE',
      };
    }
    return {
      operationalState: selected.operationalState,
      selectedObservation: selected,
      supersededObservationIds: fresh
        .slice(1)
        .map((item) => item.observationId),
      expiredObservationIds: expired.map((item) => item.observationId),
      reason: 'HIGHEST_AUTHORITY_FRESH_EVIDENCE',
    };
  }
}
