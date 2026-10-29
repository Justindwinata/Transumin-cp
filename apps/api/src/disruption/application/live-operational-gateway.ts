import { Inject, Injectable } from '@nestjs/common';

import { MOBILITY_STATE_PORT } from '../../mobility-twin/application/mobility-state.port.js';
import type { MobilityStatePort } from '../../mobility-twin/application/mobility-state.port.js';
import { OperationalContractValidator } from '../../operational-data/application/operational-contract-validator.js';
import type { OperationalSourceAdapter } from '../../operational-data/application/operational-source.port.js';
import type { OperationalObservation } from '../../operational-data/domain/operational-data.js';
import { OperationalEventBus } from './operational-event-bus.js';
import { OPERATIONAL_ENTITY_RESOLVER } from './operational-entity-resolver.port.js';
import type { OperationalEntityResolverPort } from './operational-entity-resolver.port.js';

export type GatewayIngestResult = Readonly<{
  inserted: number;
  duplicates: number;
  projectedEntities: readonly string[];
  unresolvedReferences: readonly string[];
}>;

@Injectable()
export class LiveOperationalGateway {
  constructor(
    @Inject(MOBILITY_STATE_PORT)
    private readonly states: MobilityStatePort,
    @Inject(OPERATIONAL_ENTITY_RESOLVER)
    private readonly entities: OperationalEntityResolverPort,
    @Inject(OperationalContractValidator)
    private readonly validator: OperationalContractValidator,
    @Inject(OperationalEventBus)
    private readonly events: OperationalEventBus,
  ) {}

  async ingestSource(
    source: OperationalSourceAdapter,
    receivedAt = new Date(),
  ): Promise<GatewayIngestResult> {
    const observations = await source.fetchObservations({ receivedAt });
    return this.ingestObservations(observations, receivedAt);
  }

  async ingestObservations(
    observations: readonly OperationalObservation[],
    asOf = new Date(),
  ): Promise<GatewayIngestResult> {
    let inserted = 0;
    let duplicates = 0;
    const projected = new Set<string>();
    const unresolved = new Set<string>();
    for (const observation of observations) {
      this.validator.assertValid(observation);
      const resolved = new Set<string>();
      for (const reference of observation.affectedEntityRefs) {
        const resolution = await this.entities.resolve(reference);
        if (resolution.status === 'RESOLVED' && resolution.entityId)
          resolved.add(resolution.entityId);
        else unresolved.add(reference);
      }
      const targets: readonly (string | null)[] =
        resolved.size > 0 ? [...resolved] : [null];
      for (const entityId of targets) {
        const before = entityId
          ? await this.states.getCurrentState(entityId)
          : null;
        const result = await this.states.persistObservation(
          observation,
          entityId,
        );
        if (result.status === 'ALREADY_PERSISTED') {
          duplicates += 1;
          continue;
        }
        inserted += 1;
        this.events.publish({
          type: 'operational.observation.received',
          entityId,
          incidentId: observation.incidentId,
          observationId: observation.observationId,
          evidenceType: observation.evidenceType,
          operationalState: observation.operationalState,
          sourceId: observation.provenance.sourceId,
          metadata: { confidence_status: observation.confidenceStatus },
        });
        if (!entityId) continue;
        const after = await this.states.projectState(entityId, asOf);
        projected.add(entityId);
        if (before?.operationalState !== after.operationalState)
          this.events.publish({
            type: 'operational.state.changed',
            entityId,
            incidentId: observation.incidentId,
            observationId: observation.observationId,
            evidenceType: after.evidenceType,
            operationalState: after.operationalState,
            sourceId: after.sourceId,
            metadata: {
              previous_state: before?.operationalState ?? 'UNKNOWN',
              freshness: after.freshnessStatus,
            },
          });
      }
    }
    return {
      inserted,
      duplicates,
      projectedEntities: [...projected].sort(),
      unresolvedReferences: [...unresolved].sort(),
    };
  }
}
