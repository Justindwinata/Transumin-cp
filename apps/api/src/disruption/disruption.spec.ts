import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstValueFrom, take, toArray } from 'rxjs';

import type { MobilityStatePort } from '../mobility-twin/application/mobility-state.port.js';
import type { EffectiveMobilityState } from '../mobility-twin/domain/mobility-twin.js';
import { AiIncidentExtractionValidator } from '../operational-data/ai/ai-incident-extraction.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import type { OperationalSourceAdapter } from '../operational-data/application/operational-source.port.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';
import { AiIncidentPipeline } from './application/ai-incident-pipeline.js';
import { LiveOperationalGateway } from './application/live-operational-gateway.js';
import type { OperationalEntityResolverPort } from './application/operational-entity-resolver.port.js';
import { OperationalEventBus } from './application/operational-event-bus.js';
import { SourcePoller } from './application/source-poller.js';
import type { SourceHealthPort } from './application/source-health.port.js';
import type { SourceHealth } from './domain/operational-events.js';
import {
  analyzeConnectivity,
  deterministicHash,
  isTraversable,
  overrideState,
} from './domain/disruption-intelligence.js';
import { InternalResearchGuard } from './interface/internal-research.guard.js';

const ENTITY = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

function observation(): OperationalObservation {
  return {
    observationId: '33333333-3333-4333-8333-333333333333',
    incidentId: '44444444-4444-4444-8444-444444444444',
    incidentType: 'STATION_CLOSURE',
    affectedEntityRefs: [`CANONICAL:${ENTITY}`],
    affectedModes: ['MRT_JAKARTA'],
    operationalState: 'UNAVAILABLE',
    evidenceType: 'OBSERVED',
    sourceAuthority: 'OFFICIAL_OPERATOR_CONFIRMED',
    sourceChannel: 'OPERATOR_CONFIRMED',
    impactBasis: 'OPERATOR_CONFIRMED',
    observedAt: '2026-10-01T01:00:00.000Z',
    receivedAt: '2026-10-01T01:00:01.000Z',
    updatedAt: '2026-10-01T01:00:01.000Z',
    expiresAt: '2026-10-01T02:00:00.000Z',
    reason: 'Operator confirms station is temporarily unavailable.',
    confidenceStatus: 'CONFIRMED',
    confidence: 1,
    provenance: {
      sourceId: SOURCE,
      sourceClassification: 'PARTNERSHIP_REQUIRED',
      rawReference: 'operator-console:fixture:1',
      lineageReference: 'operator-console:fixture:1',
      retrievedAt: '2026-10-01T01:00:01.000Z',
    },
    sourceAttributes: {},
  };
}

function state(
  value: EffectiveMobilityState['operationalState'],
): EffectiveMobilityState {
  return {
    mobilityEntityId: ENTITY,
    operationalState: value,
    evidenceType: value === 'UNKNOWN' ? null : 'OBSERVED',
    freshnessStatus: value === 'UNKNOWN' ? 'UNKNOWN' : 'FRESH',
    observationId: value === 'UNKNOWN' ? null : observation().observationId,
    sourceId: value === 'UNKNOWN' ? null : SOURCE,
    observedAt: value === 'UNKNOWN' ? null : observation().observedAt,
    expiresAt: value === 'UNKNOWN' ? null : observation().expiresAt,
    confidenceStatus: value === 'UNKNOWN' ? null : 'CONFIRMED',
    confidence: value === 'UNKNOWN' ? null : 1,
    provenanceRef: value === 'UNKNOWN' ? null : 'operator-console:fixture:1',
    stateAsOf: '2026-10-01T01:00:02.000Z',
    projectionVersion: 'TEST',
    reason: 'fixture',
  };
}

class MemoryHealth implements SourceHealthPort {
  value: SourceHealth | null = null;
  async recordSuccess(sourceId: string, checkedAt: Date) {
    return (this.value = {
      sourceId,
      status: 'HEALTHY',
      lastCheckedAt: checkedAt.toISOString(),
      lastSuccessAt: checkedAt.toISOString(),
      consecutiveFailures: 0,
      errorSummary: null,
    });
  }
  async recordFailure(sourceId: string, checkedAt: Date, error: string) {
    return (this.value = {
      sourceId,
      status: 'DEGRADED',
      lastCheckedAt: checkedAt.toISOString(),
      lastSuccessAt: null,
      consecutiveFailures: 1,
      errorSummary: error,
    });
  }
  async get() {
    return this.value;
  }
}

describe('Phase 3A live operational gateway', () => {
  it('keeps internal incident and scenario mutations deny-by-default', () => {
    const previous = process.env.INTERNAL_RESEARCH_TOKEN;
    delete process.env.INTERNAL_RESEARCH_TOKEN;
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as never;

    try {
      assert.throws(
        () => new InternalResearchGuard().canActivate(context),
        /AUTH_REQUIRED/,
      );
    } finally {
      if (previous === undefined) delete process.env.INTERNAL_RESEARCH_TOKEN;
      else process.env.INTERNAL_RESEARCH_TOKEN = previous;
    }
  });

  it('validates, deduplicates, projects and emits safe events', async () => {
    let persisted = false;
    let current = state('UNKNOWN');
    const states = {
      getCurrentState: async () => current,
      persistObservation: async () => {
        if (persisted)
          return {
            observationId: observation().observationId,
            status: 'ALREADY_PERSISTED' as const,
          };
        persisted = true;
        return {
          observationId: observation().observationId,
          status: 'INSERTED' as const,
        };
      },
      projectState: async () => (current = state('UNAVAILABLE')),
    } as unknown as MobilityStatePort;
    const resolver: OperationalEntityResolverPort = {
      resolve: async () => ({ status: 'RESOLVED', entityId: ENTITY }),
    };
    const events = new OperationalEventBus();
    const gateway = new LiveOperationalGateway(
      states,
      resolver,
      new OperationalContractValidator(),
      events,
    );
    const first = await gateway.ingestObservations(
      [observation()],
      new Date('2026-10-01T01:00:02.000Z'),
    );
    const second = await gateway.ingestObservations(
      [observation()],
      new Date('2026-10-01T01:00:03.000Z'),
    );
    assert.equal(first.inserted, 1);
    assert.equal(first.projectedEntities[0], ENTITY);
    assert.equal(second.duplicates, 1);
    assert.equal(events.snapshot('operational.observation.received').length, 1);
    assert.equal(events.snapshot('operational.state.changed').length, 1);
    assert.equal(events.snapshot()[0]?.metadata.raw_payload, undefined);
  });

  it('supports replay from Last-Event-ID and a live subscriber', async () => {
    const bus = new OperationalEventBus();
    const first = bus.publish({
      type: 'source.health.changed',
      entityId: null,
      incidentId: null,
      observationId: null,
      evidenceType: null,
      operationalState: null,
      sourceId: SOURCE,
      metadata: { status: 'HEALTHY' },
    });
    bus.publish({
      type: 'operational.observation.received',
      entityId: ENTITY,
      incidentId: observation().incidentId,
      observationId: observation().observationId,
      evidenceType: 'OBSERVED',
      operationalState: 'UNAVAILABLE',
      sourceId: SOURCE,
      metadata: {},
    });
    const replayPromise = firstValueFrom(
      bus.stream(first.id).pipe(take(2), toArray()),
    );
    bus.publish({
      type: 'operational.state.changed',
      entityId: ENTITY,
      incidentId: observation().incidentId,
      observationId: observation().observationId,
      evidenceType: 'OBSERVED',
      operationalState: 'UNAVAILABLE',
      sourceId: SOURCE,
      metadata: { previous_state: 'UNKNOWN' },
    });
    const replay = await replayPromise;
    assert.deepEqual(
      replay.map((item) => item.type),
      ['operational.observation.received', 'operational.state.changed'],
    );
  });

  it('keeps targeted journey alerts out of public and unrelated owner streams', async () => {
    const bus = new OperationalEventBus();
    const scopedPromise = firstValueFrom(
      bus.streamJourney('journey-a', 'owner-a'),
    );
    bus.publish({
      type: 'journey.alert.created',
      entityId: ENTITY,
      incidentId: null,
      observationId: observation().observationId,
      evidenceType: 'SIMULATED',
      operationalState: 'UNAVAILABLE',
      sourceId: SOURCE,
      audienceJourneyId: 'journey-a',
      audienceOwnerRef: 'owner-a',
      metadata: { alert_id: 'alert-a' },
    });
    assert.equal(bus.snapshot().length, 0);
    assert.equal(bus.snapshot('journey.alert.created').length, 1);
    const scoped = await scopedPromise;
    assert.equal(scoped.metadata.alert_id, 'alert-a');
  });

  it('retries a failing source and records degradation without overlap', async () => {
    let attempts = 0;
    const source: OperationalSourceAdapter = {
      metadata: {
        sourceId: SOURCE,
        sourceKey: 'fixture',
        publisher: 'Fixture',
        classification: 'VERIFIED_PUBLIC_API',
        authority: 'OFFICIAL_MACHINE',
        canonicalUrl: 'https://example.test',
        documented: true,
        authenticationRequired: false,
        automationPermitted: true,
        rightsStatus: 'PERMITTED',
      },
      fetchObservations: async () => {
        attempts += 1;
        throw new Error('offline');
      },
    };
    const gateway = {
      ingestSource: async () => source.fetchObservations(),
    } as unknown as LiveOperationalGateway;
    const health = new MemoryHealth();
    const events = new OperationalEventBus();
    const poller = new SourcePoller(source, gateway, health, events, {
      enabled: true,
      intervalMs: 60_000,
      timeoutMs: 100,
      maxAttempts: 2,
      backoffMs: 1,
    });
    await poller.poll(new Date('2026-10-01T01:00:00.000Z'));
    assert.equal(attempts, 2);
    assert.equal(health.value?.status, 'DEGRADED');
    assert.equal(events.snapshot('source.health.changed').length, 1);
  });

  it('skips overlapping polls and times out a stalled source safely', async () => {
    let release!: () => void;
    const stalled = new Promise<readonly OperationalObservation[]>(
      (resolve) => {
        release = () => resolve([]);
      },
    );
    const source: OperationalSourceAdapter = {
      metadata: {
        sourceId: SOURCE,
        sourceKey: 'stalled-fixture',
        publisher: 'Fixture',
        classification: 'VERIFIED_PUBLIC_API',
        authority: 'OFFICIAL_MACHINE',
        canonicalUrl: 'https://example.test',
        documented: true,
        authenticationRequired: false,
        automationPermitted: true,
        rightsStatus: 'PERMITTED',
      },
      fetchObservations: async () => stalled,
    };
    const gateway = {
      ingestSource: async () => source.fetchObservations(),
    } as unknown as LiveOperationalGateway;
    const health = new MemoryHealth();
    const poller = new SourcePoller(
      source,
      gateway,
      health,
      new OperationalEventBus(),
      {
        enabled: true,
        intervalMs: 60_000,
        timeoutMs: 10,
        maxAttempts: 1,
        backoffMs: 1,
      },
    );
    const first = poller.poll(new Date('2026-10-01T01:00:00.000Z'));
    assert.equal(
      await poller.poll(new Date('2026-10-01T01:00:00.001Z')),
      'SKIPPED_OVERLAP',
    );
    assert.equal(await first, 'COMPLETED');
    assert.equal(health.value?.status, 'DEGRADED');
    assert.match(health.value?.errorSummary ?? '', /timed out/);
    release();
  });

  it('rejects an AI-inferred closure from rain-only source text', () => {
    const pipeline = new AiIncidentPipeline(
      new AiIncidentExtractionValidator(),
    );
    const result = pipeline.validate('Heavy rain around Station X', {
      incidentType: 'STATION_CLOSURE',
      affectedEntities: ['Station X'],
      affectedModes: ['MRT_JAKARTA'],
      state: 'UNAVAILABLE',
      startTime: null,
      endTime: null,
      reason: 'Heavy rain',
      sourceClaims: [
        { field: 'affected_entities', quote: 'Station X' },
        { field: 'reason', quote: 'Heavy rain' },
      ],
      unsupportedFields: ['incident_type', 'state'],
      confidence: 0.4,
    });
    assert.equal(result.status, 'REJECTED');
    assert.match(result.errors.join(' '), /unsupported fields/);
  });
});

describe('Phase 3B scenario and connectivity semantics', () => {
  it('keeps UNKNOWN traversable and blocks only explicit UNAVAILABLE edges', () => {
    assert.equal(isTraversable('UNKNOWN'), true);
    assert.equal(isTraversable('UNAVAILABLE'), false);
    const baseline = analyzeConnectivity([
      {
        mobilityEntityId: 'a',
        fromNodeId: '1',
        toNodeId: '2',
        state: 'UNKNOWN',
      },
      {
        mobilityEntityId: 'b',
        fromNodeId: '2',
        toNodeId: '3',
        state: 'AVAILABLE',
      },
    ]);
    const disrupted = analyzeConnectivity([
      {
        mobilityEntityId: 'a',
        fromNodeId: '1',
        toNodeId: '2',
        state: 'UNKNOWN',
      },
      {
        mobilityEntityId: 'b',
        fromNodeId: '2',
        toNodeId: '3',
        state: 'UNAVAILABLE',
      },
    ]);
    assert.equal(baseline.components, 1);
    assert.equal(disrupted.components, 2);
    assert.equal(disrupted.blockedEdges, 1);
  });

  it('creates SIMULATED overrides without changing the supplied base state', () => {
    const action = {
      actionId: 'action-1',
      mobilityEntityId: 'edge-1',
      actionType: 'BLOCK_ENTITY' as const,
      availability: null,
      reason: 'Controlled flood replay explicitly blocks this edge.',
    };
    const result = overrideState('UNKNOWN', action);
    assert.equal(result.baseState, 'UNKNOWN');
    assert.equal(result.overrideState, 'UNAVAILABLE');
    assert.equal(result.evidenceType, 'SIMULATED');
  });

  it('hashes replay configuration deterministically regardless of key order', () => {
    assert.equal(
      deterministicHash({ snapshot: 's', config: { a: 1, b: 2 } }),
      deterministicHash({ config: { b: 2, a: 1 }, snapshot: 's' }),
    );
  });
});
