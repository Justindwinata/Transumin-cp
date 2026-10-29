import { Injectable } from '@nestjs/common';

import type { OperationalObservation } from '../domain/operational-data.js';

export type FreshnessStatus = 'NOT_YET_VALID' | 'FRESH' | 'EXPIRED';

@Injectable()
export class FreshnessEvaluator {
  evaluate(observation: OperationalObservation, asOf: Date): FreshnessStatus {
    const instant = asOf.getTime();
    if (instant < Date.parse(observation.observedAt)) return 'NOT_YET_VALID';
    if (instant >= Date.parse(observation.expiresAt)) return 'EXPIRED';
    return 'FRESH';
  }
}
