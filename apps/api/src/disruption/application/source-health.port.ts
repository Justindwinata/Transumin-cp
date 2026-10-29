import type { SourceHealth } from '../domain/operational-events.js';

export const SOURCE_HEALTH_PORT = Symbol('SOURCE_HEALTH_PORT');

export interface SourceHealthPort {
  recordSuccess(sourceId: string, checkedAt: Date): Promise<SourceHealth>;
  recordFailure(
    sourceId: string,
    checkedAt: Date,
    errorSummary: string,
  ): Promise<SourceHealth>;
  get(sourceId: string): Promise<SourceHealth | null>;
}
