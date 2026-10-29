import type {
  OperationalObservation,
  OperationalSourceMetadata,
} from '../domain/operational-data.js';

export const OPERATIONAL_SOURCE_ADAPTER = Symbol('OPERATIONAL_SOURCE_ADAPTER');

export type OperationalFetchContext = Readonly<{
  receivedAt?: Date;
}>;

export interface OperationalSourceAdapter {
  readonly metadata: OperationalSourceMetadata;
  fetchObservations(
    context?: OperationalFetchContext,
  ): Promise<readonly OperationalObservation[]>;
}
