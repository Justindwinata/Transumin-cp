import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { filter, firstValueFrom, take, timeout } from 'rxjs';
import { sql } from 'kysely';

import { LiveOperationalGateway } from '../disruption/application/live-operational-gateway.js';
import { OperationalEventBus } from '../disruption/application/operational-event-bus.js';
import { KyselyOperationalEntityResolver } from '../disruption/infrastructure/kysely-operational-entity-resolver.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';
import {
  ActiveJourneyService,
  activeJourneyInstanceId,
} from './application/active-journey.service.js';
import { JourneyImpactService } from './application/journey-impact.service.js';
import type { JourneyAlternative, JourneyLeg } from './domain/journey.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';

const ids = {
  source: randomUUID(),
  version: randomUUID(),
  snapshot: randomUUID(),
  affectedEntity: randomUUID(),
  unrelatedEntity: randomUUID(),
  journeyA: randomUUID(),
  journeyB: randomUUID(),
  journeyC: randomUUID(),
  observation: randomUUID(),
  incident: randomUUID(),
  operationalSource: randomUUID(),
} as const;
const activeIds = {
  journeyA: activeJourneyInstanceId('session-a', ids.journeyA),
  journeyB: activeJourneyInstanceId('session-b', ids.journeyB),
  journeyC: activeJourneyInstanceId('session-c', ids.journeyC),
  journeyD: activeJourneyInstanceId('session-d', ids.journeyA),
} as const;
const database = createDatabase();
const validator = new OperationalContractValidator();
const states = new KyselyMobilityStateRepository(database, validator);
const repository = new KyselyActiveJourneyRepository(database);
const journeys = new ActiveJourneyService(repository);
const events = new OperationalEventBus();
const impacts = new JourneyImpactService(repository, states, events);
const gateway = new LiveOperationalGateway(
  states,
  new KyselyOperationalEntityResolver(database),
  validator,
  events,
);

describe('RUN 5A persistent active-journey targeting', () => {
  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    await sql`
      insert into meta.dataset_source (
        id, source_key, name, provider, source_type, verification_status
      ) values (
        ${ids.source}::uuid, ${`phase5a-fixture-${ids.source}`}, 'Phase 5A fixture',
        'Test', 'SYNTHETIC_TEST', 'VERIFIED'
      )
    `.execute(database);
    await sql`
      insert into meta.dataset_version (
        id, source_id, version_label, checksum_sha256, retrieved_at,
        raw_path_ref, manifest_path, validation_status
      ) values (
        ${ids.version}::uuid, ${ids.source}::uuid, 'phase5a-fixture', ${'a'.repeat(64)},
        now(), 'fixture:SIMULATED', 'fixture:SIMULATED', 'VALID'
      )
    `.execute(database);
    await sql`
      insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
      values
        (${ids.affectedEntity}::uuid, 'ROUTE', ${ids.version}::uuid),
        (${ids.unrelatedEntity}::uuid, 'ROUTE', ${ids.version}::uuid)
    `.execute(database);
    await sql`
      insert into twin.network_snapshot (
        id, transit_dataset_version_id, spatial_dataset_version_id,
        processing_version, state_cutoff_at, configuration_json, manifest_ref,
        content_hash, status, finalized_at
      ) values (
        ${ids.snapshot}::uuid, ${ids.version}::uuid, ${ids.version}::uuid,
        'PHASE_5A_TEST', now(), '{}'::jsonb, 'fixture:SIMULATED',
        ${'b'.repeat(64)}, 'FINALIZED', now()
      )
    `.execute(database);
    impacts.onModuleInit();
  });

  after(async () => {
    impacts.onModuleDestroy();
    // Immutable evidence remains until invocation-owned scratch DB disposal.
    // Never disable integrity triggers to clean up test records.
    await database.destroy();
  });

  it('persists immutable plans/progress and targets only active dependent journeys', async () => {
    const activatedAt = new Date().toISOString();
    const planA = plan(ids.journeyA, [ids.unrelatedEntity, ids.affectedEntity]);
    const planB = plan(ids.journeyB, [ids.unrelatedEntity]);
    const planC = plan(ids.journeyC, [ids.affectedEntity]);
    const started = performance.now();
    const activeA = await journeys.activate({
      ownerRef: 'session-a',
      selectedJourney: planA,
      activatedAt,
    });
    const activationMs = performance.now() - started;
    await journeys.activate({
      ownerRef: 'session-b',
      selectedJourney: planB,
      activatedAt,
    });
    await journeys.activate({
      ownerRef: 'session-c',
      selectedJourney: planC,
      activatedAt,
    });
    const activeD = await journeys.activate({
      ownerRef: 'session-d',
      selectedJourney: planA,
      activatedAt,
    });
    const repeated = await journeys.activate({
      ownerRef: 'session-a',
      selectedJourney: planA,
      activatedAt,
    });
    assert.equal(repeated.planFingerprint, activeA.planFingerprint);
    assert.equal(repeated.journeyId, activeA.journeyId);
    assert.notEqual(activeD.journeyId, activeA.journeyId);
    assert.equal(
      activeD.originalPlan.journeyId,
      activeA.originalPlan.journeyId,
    );
    const routingIdentities = await sql<{
      id: string;
      routingJourneyId: string;
    }>`
      select id, routing_journey_id as "routingJourneyId"
      from journey.journey_plan where routing_journey_id=${ids.journeyA}::uuid
      order by id
    `.execute(database);
    assert.deepEqual(
      routingIdentities.rows.map((row) => row.id).sort(),
      [activeA.journeyId, activeD.journeyId].sort(),
    );
    await assert.rejects(journeys.get(activeD.journeyId, 'session-a'));
    assert.equal(activeA.dependencies.length, 2);

    await journeys.confirmBoarding({
      journeyId: activeIds.journeyA,
      ownerRef: 'session-a',
      legSequence: 0,
      confirmedAt: activatedAt,
    });
    await journeys.confirmAlighting({
      journeyId: activeIds.journeyA,
      ownerRef: 'session-a',
      legSequence: 0,
      confirmedAt: activatedAt,
    });
    const progressed = await journeys.updateProgress({
      journeyId: activeIds.journeyA,
      ownerRef: 'session-a',
      completedLegCount: 1,
      currentLegSequence: 1,
      recordedAt: new Date(Date.parse(activatedAt) + 1000).toISOString(),
    });
    assert.equal(progressed.progress.completedLegCount, 1);
    assert.deepEqual(progressed.originalPlan, planA);
    assert.equal(
      (await journeys.get(activeD.journeyId, 'session-d')).progress
        .completedLegCount,
      0,
    );

    const targetedDelivery = firstValueFrom(
      events.streamJourney(activeIds.journeyA, 'session-a').pipe(
        filter((event) => event.type === 'journey.alert.created'),
        take(1),
        timeout(5000),
      ),
    );
    const secondOwnerDelivery = firstValueFrom(
      events.streamJourney(activeIds.journeyD, 'session-d').pipe(
        filter((event) => event.type === 'journey.alert.created'),
        take(1),
        timeout(5000),
      ),
    );
    const ingestStarted = performance.now();
    const ingest = await gateway.ingestObservations(
      [simulatedUnavailable(ids.affectedEntity)],
      new Date(),
    );
    await impacts.whenIdle();
    const impactMs = performance.now() - ingestStarted;
    const delivered = await targetedDelivery;
    const deliveredToSecondOwner = await secondOwnerDelivery;
    assert.equal(ingest.projectedEntities[0], ids.affectedEntity);
    assert.equal(delivered.audienceJourneyId, activeIds.journeyA);
    assert.equal(delivered.audienceOwnerRef, 'session-a');
    assert.equal(deliveredToSecondOwner.audienceJourneyId, activeIds.journeyD);
    assert.equal(deliveredToSecondOwner.audienceOwnerRef, 'session-d');

    const [alertsA, alertsB, alertsC, alertsD] = await Promise.all([
      journeys.listAlerts(activeIds.journeyA, 'session-a'),
      journeys.listAlerts(activeIds.journeyB, 'session-b'),
      journeys.listAlerts(activeIds.journeyC, 'session-c'),
      journeys.listAlerts(activeIds.journeyD, 'session-d'),
    ]);
    assert.equal(alertsA.length, 1);
    assert.equal(alertsB.length, 0);
    assert.equal(alertsC.length, 1);
    assert.equal(alertsD.length, 1);
    await assert.rejects(journeys.listAlerts(activeIds.journeyD, 'session-a'));
    assert.equal(alertsA[0]?.alertType, 'BLOCKING');
    assert.equal(alertsA[0]?.evidenceType, 'SIMULATED');
    assert.deepEqual(alertsA[0]?.affectedLegSequences, [1]);

    await gateway.ingestObservations(
      [simulatedUnavailable(ids.affectedEntity)],
      new Date(),
    );
    await impacts.whenIdle();
    assert.equal(
      (await journeys.listAlerts(activeIds.journeyA, 'session-a')).length,
      1,
    );

    await gateway.ingestObservations(
      [expiredUnavailable(ids.unrelatedEntity)],
      new Date(),
    );
    await impacts.whenIdle();
    assert.equal(
      (await journeys.listAlerts(activeIds.journeyB, 'session-b')).length,
      0,
    );

    await gateway.ingestObservations(
      [unknownObservation(ids.unrelatedEntity)],
      new Date(),
    );
    await impacts.whenIdle();
    assert.equal(
      (await journeys.listAlerts(activeIds.journeyB, 'session-b')).length,
      0,
    );

    const eventAudiences = events
      .snapshot('journey.alert.created')
      .map((event) => event.audienceJourneyId)
      .sort();
    assert.deepEqual(
      eventAudiences,
      [activeIds.journeyA, activeIds.journeyC, activeIds.journeyD].sort(),
    );

    await gateway.ingestObservations(
      [simulatedState(ids.affectedEntity, 'RECOVERING')],
      new Date(),
    );
    await impacts.whenIdle();
    const recoveringAlerts = await journeys.listAlerts(
      activeIds.journeyA,
      'session-a',
    );
    assert.equal(recoveringAlerts.length, 2);
    assert.equal(recoveringAlerts[1]?.alertType, 'RECOVERY_UPDATE');
    assert.notEqual(recoveringAlerts[0]?.resolvedAt, null);

    await gateway.ingestObservations(
      [simulatedState(ids.affectedEntity, 'DEGRADED')],
      new Date(),
    );
    await impacts.whenIdle();
    const degradedAlerts = await journeys.listAlerts(
      activeIds.journeyA,
      'session-a',
    );
    assert.equal(degradedAlerts.length, 3);
    assert.equal(degradedAlerts[2]?.alertType, 'DISRUPTION');

    await gateway.ingestObservations(
      [simulatedState(ids.affectedEntity, 'DISRUPTED')],
      new Date(),
    );
    await impacts.whenIdle();
    const disruptedAlerts = await journeys.listAlerts(
      activeIds.journeyA,
      'session-a',
    );
    assert.equal(disruptedAlerts.length, 4);
    assert.equal(disruptedAlerts[3]?.alertType, 'DISRUPTION');

    await journeys.confirmBoarding({
      journeyId: activeIds.journeyB,
      ownerRef: 'session-b',
      legSequence: 0,
      confirmedAt: new Date(Date.parse(activatedAt) + 1000).toISOString(),
    });
    await journeys.confirmAlighting({
      journeyId: activeIds.journeyB,
      ownerRef: 'session-b',
      legSequence: 0,
      confirmedAt: new Date(Date.parse(activatedAt) + 1000).toISOString(),
    });
    const completed = await journeys.updateProgress({
      journeyId: activeIds.journeyB,
      ownerRef: 'session-b',
      completedLegCount: 1,
      currentLegSequence: null,
      recordedAt: new Date(Date.parse(activatedAt) + 2000).toISOString(),
    });
    assert.equal(completed.lifecycleStatus, 'COMPLETED');
    assert.deepEqual(completed.originalPlan, planB);
    await journeys.confirmBoarding({
      journeyId: activeIds.journeyD,
      ownerRef: 'session-d',
      legSequence: 0,
      confirmedAt: new Date(Date.parse(activatedAt) + 1000).toISOString(),
    });
    await journeys.confirmAlighting({
      journeyId: activeIds.journeyD,
      ownerRef: 'session-d',
      legSequence: 0,
      confirmedAt: new Date(Date.parse(activatedAt) + 1000).toISOString(),
    });
    await journeys.updateProgress({
      journeyId: activeIds.journeyD,
      ownerRef: 'session-d',
      completedLegCount: 1,
      currentLegSequence: 1,
      recordedAt: new Date(Date.parse(activatedAt) + 2000).toISOString(),
    });

    const impactsBeforeCompletedOnlyChange = await sql<{ count: number }>`
      select count(*)::int as count from journey.journey_impact
      where mobility_entity_id=${ids.unrelatedEntity}::uuid
    `.execute(database);
    await gateway.ingestObservations(
      [newUnavailable(ids.unrelatedEntity)],
      new Date(),
    );
    await impacts.whenIdle();
    const impactsAfterCompletedOnlyChange = await sql<{ count: number }>`
      select count(*)::int as count from journey.journey_impact
      where mobility_entity_id=${ids.unrelatedEntity}::uuid
    `.execute(database);
    assert.equal(
      impactsAfterCompletedOnlyChange.rows[0]?.count,
      impactsBeforeCompletedOnlyChange.rows[0]?.count,
    );
    assert.equal(
      (await journeys.listAlerts(activeIds.journeyB, 'session-b')).length,
      0,
    );
    assert.ok(activationMs >= 0);
    assert.ok(impactMs >= 0);
  });
});

function plan(
  journeyId: string,
  entities: readonly string[],
): JourneyAlternative {
  const legs = entities.map((entityId, sequence) => leg(entityId, sequence));
  return {
    journeyId,
    origin: { latitude: -6.2, longitude: 106.8 },
    destination: { latitude: -6.3, longitude: 106.9 },
    startAt: legs[0]!.startAt,
    endAt: legs.at(-1)!.endAt,
    durationSeconds: entities.length * 600,
    transferCount: Math.max(0, entities.length - 1),
    walkingDistanceMeters: 0,
    fareStatus: 'UNKNOWN',
    legs,
    routingContext: {
      provider: 'OTP',
      providerVersion: '2.10.0',
      routingSnapshotId: 'phase4b-a-router-input-20261002-v2',
      routingManifestSha256: 'c'.repeat(64),
      graphSha256: 'd'.repeat(64),
      networkSnapshotId: ids.snapshot,
      networkSnapshotHash: 'b'.repeat(64),
      mobilityProjectionVersion: 'PHASE_2B_V1',
      plannedAt: '2026-10-03T07:00:00.000Z',
      commonServiceDate: '2026-10-03',
      timezone: 'Asia/Jakarta',
      attemptCount: 1,
      excludedRouteIds: [],
    },
  };
}

function leg(entityId: string, sequence: number): JourneyLeg {
  const start = new Date(
    Date.parse('2026-10-03T07:00:00.000Z') + sequence * 600_000,
  );
  const end = new Date(start.getTime() + 600_000);
  return {
    sequence,
    mode: 'MRT_JAKARTA',
    otpMode: 'SUBWAY',
    from: {
      name: `A${sequence}`,
      otpStopId: null,
      latitude: -6.2 - sequence * 0.01,
      longitude: 106.8 + sequence * 0.01,
    },
    to: {
      name: `B${sequence}`,
      otpStopId: null,
      latitude: -6.21 - sequence * 0.01,
      longitude: 106.81 + sequence * 0.01,
    },
    intermediateStops: [],
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationSeconds: 600,
    distanceMeters: 1000,
    routeId: `route-${sequence}`,
    routeShortName: 'MRT',
    tripId: `trip-${sequence}`,
    serviceDate: '2026-10-03',
    timingPrecision: 'FREQUENCY_DERIVED',
    entityBindings: [
      {
        otpEntityId: `route-${sequence}`,
        productMode: 'MRT_JAKARTA',
        entityType: 'ROUTE',
        canonicalEntityId: entityId,
        mobilityEntityId: entityId,
        resolutionMethod: 'EXACT_SOURCE_REFERENCE',
        provenanceRef: 'fixture:SIMULATED',
      },
    ],
    operationalFlags: [],
  };
}

function simulatedUnavailable(entityId: string): OperationalObservation {
  const received = new Date();
  return {
    observationId: ids.observation,
    incidentId: ids.incident,
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityRefs: [`CANONICAL:${entityId}`],
    affectedModes: ['MRT_JAKARTA'],
    operationalState: 'UNAVAILABLE',
    evidenceType: 'SIMULATED',
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    impactBasis: 'CONTROLLED_SIMULATION',
    observedAt: new Date(received.getTime() - 1000).toISOString(),
    receivedAt: received.toISOString(),
    updatedAt: received.toISOString(),
    expiresAt: new Date(received.getTime() + 3_600_000).toISOString(),
    reason: 'Controlled RUN 5A targeting fixture.',
    confidenceStatus: 'SIMULATED',
    confidence: 1,
    provenance: {
      sourceId: ids.operationalSource,
      sourceClassification: 'UNKNOWN',
      rawReference: 'fixture:SIMULATED:phase5a',
      lineageReference: 'fixture:SIMULATED:phase5a',
      retrievedAt: received.toISOString(),
    },
    sourceAttributes: { fixture: true },
  };
}

function expiredUnavailable(entityId: string): OperationalObservation {
  const observation = simulatedUnavailable(entityId);
  const now = Date.now();
  return {
    ...observation,
    observationId: randomUUID(),
    incidentId: randomUUID(),
    observedAt: new Date(now - 7_200_000).toISOString(),
    receivedAt: new Date(now - 7_199_000).toISOString(),
    updatedAt: new Date(now - 7_199_000).toISOString(),
    expiresAt: new Date(now - 3_600_000).toISOString(),
    provenance: {
      ...observation.provenance,
      retrievedAt: new Date(now - 7_199_000).toISOString(),
    },
  };
}

function unknownObservation(entityId: string): OperationalObservation {
  const observation = simulatedUnavailable(entityId);
  return {
    ...observation,
    observationId: randomUUID(),
    incidentId: randomUUID(),
    operationalState: 'UNKNOWN',
    reason: 'Controlled RUN 5A UNKNOWN-state negative fixture.',
  };
}

function simulatedState(
  entityId: string,
  operationalState: 'DEGRADED' | 'DISRUPTED' | 'RECOVERING',
): OperationalObservation {
  const observation = simulatedUnavailable(entityId);
  return {
    ...observation,
    observationId: randomUUID(),
    incidentId: randomUUID(),
    operationalState,
    reason: `Controlled RUN 5A ${operationalState} policy fixture.`,
  };
}

function newUnavailable(entityId: string): OperationalObservation {
  const observation = simulatedUnavailable(entityId);
  return {
    ...observation,
    observationId: randomUUID(),
    incidentId: randomUUID(),
    reason: 'Controlled completed-dependency relevance fixture.',
  };
}
