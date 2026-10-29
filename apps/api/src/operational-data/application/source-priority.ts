import { Injectable } from '@nestjs/common';

import type {
  OperationalObservation,
  SourceAuthority,
} from '../domain/operational-data.js';

export const SOURCE_PRIORITY: Readonly<Record<SourceAuthority, number>> = {
  OFFICIAL_MACHINE: 700,
  OFFICIAL_OPERATOR_CONFIRMED: 600,
  OFFICIAL_PUBLIC_UPDATE: 500,
  VERIFIED_GOVERNMENT_OR_DISRUPTION: 400,
  CROWDSOURCED_OBSERVATION: 300,
  ADMIN_FIELD_REVIEW: 350,
  FORECAST: 200,
  SIMULATION: 100,
};

@Injectable()
export class SourcePriorityComparator {
  compare(left: OperationalObservation, right: OperationalObservation): number {
    const authority =
      SOURCE_PRIORITY[right.sourceAuthority] -
      SOURCE_PRIORITY[left.sourceAuthority];
    if (authority !== 0) return authority;
    const observed = Date.parse(right.observedAt) - Date.parse(left.observedAt);
    if (observed !== 0) return observed;
    const received = Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
    if (received !== 0) return received;
    return left.observationId.localeCompare(right.observationId);
  }
}
