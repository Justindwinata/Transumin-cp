import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';

import { OperationalEventBus } from '../../disruption/application/operational-event-bus.js';
import type { OperationalStreamEvent } from '../../disruption/domain/operational-events.js';
import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../../mobility-twin/application/mobility-state.port.js';
import {
  ACTIVE_JOURNEY_REPOSITORY,
  type ActiveJourneyRepositoryPort,
  type ImpactProcessingResult,
} from './active-journey.repository.port.js';

@Injectable()
export class JourneyImpactService implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;
  private pending: Promise<void> = Promise.resolve();
  private processingError: unknown;

  constructor(
    @Inject(ACTIVE_JOURNEY_REPOSITORY)
    private readonly journeys: ActiveJourneyRepositoryPort,
    @Inject(MOBILITY_STATE_PORT)
    private readonly states: MobilityStatePort,
    @Inject(OperationalEventBus)
    private readonly events: OperationalEventBus,
  ) {}

  onModuleInit(): void {
    this.subscription = this.events.stateChanges().subscribe((event) => {
      this.pending = this.pending
        .then(async () => {
          await this.processStateChange(event);
        })
        .catch((error: unknown) => {
          this.processingError = error;
        });
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async whenIdle(): Promise<void> {
    await this.pending;
    if (this.processingError !== undefined) {
      const error = this.processingError;
      this.processingError = undefined;
      throw error;
    }
  }

  async processStateChange(
    event: OperationalStreamEvent,
  ): Promise<ImpactProcessingResult> {
    if (event.type !== 'operational.state.changed' || event.entityId === null)
      return { affectedJourneyIds: [], alerts: [], duplicateCount: 0 };
    const [state, history] = await Promise.all([
      this.states.getCurrentState(event.entityId),
      this.states.getStateHistory(event.entityId),
    ]);
    const transition = [...history]
      .reverse()
      .find(
        (item) =>
          item.newState === event.operationalState &&
          (event.observationId === null ||
            item.triggeringObservationId === event.observationId),
      );
    if (transition === undefined)
      return { affectedJourneyIds: [], alerts: [], duplicateCount: 0 };
    const result = await this.journeys.processTransition(transition, state);
    for (const alert of result.alerts)
      this.events.publish({
        type: 'journey.alert.created',
        entityId: alert.mobilityEntityId,
        incidentId: null,
        observationId: alert.observationId,
        evidenceType: state.evidenceType,
        operationalState: state.operationalState,
        sourceId: alert.sourceId,
        audienceJourneyId: alert.journeyId,
        audienceOwnerRef: alert.ownerRef,
        metadata: {
          alert_id: alert.alertId,
          impact_id: alert.impactId,
          journey_id: alert.journeyId,
          alert_type: alert.alertType,
          freshness: alert.freshnessStatus,
        },
      });
    return result;
  }
}
