import type { OperationalSourceAdapter } from '../../operational-data/application/operational-source.port.js';
import type { SourceHealth } from '../domain/operational-events.js';
import type { LiveOperationalGateway } from './live-operational-gateway.js';
import type { OperationalEventBus } from './operational-event-bus.js';
import type { SourceHealthPort } from './source-health.port.js';

export type PollingPolicy = Readonly<{
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
}>;

export class SourcePoller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly source: OperationalSourceAdapter,
    private readonly gateway: LiveOperationalGateway,
    private readonly health: SourceHealthPort,
    private readonly events: OperationalEventBus,
    private readonly policy: PollingPolicy,
  ) {
    if (policy.intervalMs < 1 || policy.timeoutMs < 1 || policy.maxAttempts < 1)
      throw new Error('Polling timing and attempt values must be positive');
  }

  start(): void {
    if (!this.policy.enabled || this.timer !== null) return;
    this.timer = setInterval(() => void this.poll(), this.policy.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(now = new Date()): Promise<'COMPLETED' | 'SKIPPED_OVERLAP'> {
    if (this.running) return 'SKIPPED_OVERLAP';
    this.running = true;
    try {
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
        try {
          await Promise.race([
            this.gateway.ingestSource(this.source, now),
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error('source poll timed out')),
                this.policy.timeoutMs,
              );
            }),
          ]);
          const status = await this.health.recordSuccess(
            this.source.metadata.sourceId,
            now,
          );
          this.publishHealth(status);
          return 'COMPLETED';
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < this.policy.maxAttempts)
            await new Promise((resolve) =>
              setTimeout(resolve, this.policy.backoffMs * attempt),
            );
        }
      }
      const status = await this.health.recordFailure(
        this.source.metadata.sourceId,
        now,
        lastError?.message ?? 'unknown source failure',
      );
      this.publishHealth(status);
      return 'COMPLETED';
    } finally {
      this.running = false;
    }
  }

  private publishHealth(status: SourceHealth): void {
    this.events.publish({
      type: 'source.health.changed',
      entityId: null,
      incidentId: null,
      observationId: null,
      evidenceType: null,
      operationalState: null,
      sourceId: status.sourceId,
      metadata: {
        status: status.status,
        consecutive_failures: status.consecutiveFailures,
        last_success_at: status.lastSuccessAt,
      },
    });
  }
}
