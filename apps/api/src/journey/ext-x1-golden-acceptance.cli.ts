import assert from 'node:assert/strict';

import { sql } from 'kysely';

import { DisruptionIntelligenceService } from '../disruption/application/disruption-intelligence.service.js';
import { OperationalEventBus } from '../disruption/application/operational-event-bus.js';
import { KyselyIncidentLifecycleRepository } from '../disruption/infrastructure/kysely-incident-lifecycle.repository.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import type { MobilityStatePort } from '../mobility-twin/application/mobility-state.port.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import { OperationalIncidentService } from '../operational-data/application/operational-incident.service.js';
import type { IncidentEvidenceInput } from '../operational-data/domain/hazard-incident.js';
import {
  ActiveJourneyService,
  activeJourneyInstanceId,
} from './application/active-journey.service.js';
import { JourneyImpactService } from './application/journey-impact.service.js';
import { JourneyPlannerService } from './application/journey-planner.service.js';
import type { JourneyRoutingPort } from './application/journey-routing.port.js';
import { fingerprintJourneyPlan } from './application/journey-research-fingerprint.js';
import type {
  JourneyAlternative,
  JourneyPlanRequest,
  JourneyPlanResult,
} from './domain/journey.js';
import { JourneyRoutingError } from './domain/journey.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';
import { KyselyRoutingIdentityBridge } from './infrastructure/kysely-routing-identity.bridge.js';
import { OtpJourneyRoutingAdapter } from './infrastructure/otp-journey-routing.adapter.js';

const DATABASE_NAME = 'transum_in_nexus_ext_x1';
const SNAPSHOT_ID = '07d3393e-e7f4-5708-b467-807406c25a10';
const SNAPSHOT_HASH =
  '5609b00c9f700ce5fe77fe11bc9a3368711d0b6deb520131ef0b46f5de9cd111';
const ROUTE_6H = 'c95bde93-682f-5742-ab1f-3b0f653ecbae';
const KUNINGAN = '72c80913-9833-53ac-8ab4-4cb103517ac4';
const ROUTE_6H_OTP = '5:tnx:tj:route:6H';
const SOURCE_ID = 'e0e9bda7-4649-48c6-a64a-ebf421f48e61';
const EXPECTED_GRAPH_HASH =
  'ad9fdd3ea0308dcf033f51b43e027dd3ffa10166ef130f9512e3a9e643331574';
const EXPECTED_ROUTING_MANIFEST_HASH =
  '1f493716d20ad5ffa2e3628ece67f2511235f2abfacef4cd7b2b2af9f73dfb77';
const AS_OF = new Date('2026-10-02T08:30:00+07:00');
/** P1/P2 share one reproducible replay instant so only the incident state differs. */
const PLANNER_BLOCKED_AT = new Date('2026-10-02T08:36:00+07:00');
const PLANNER_CLEARED_AT = new Date('2026-10-02T08:42:00+07:00');
const OWNER_A = 'ext-x1-golden-owner-a';
const OWNER_B = 'ext-x1-golden-owner-b';
const PLAN_A = '10000000-0000-5000-8000-000000000001';
const PLAN_B = '10000000-0000-5000-8000-000000000002';
const ACTIVE_A = activeJourneyInstanceId(OWNER_A, PLAN_A);
const ACTIVE_B = activeJourneyInstanceId(OWNER_B, PLAN_B);
const INCIDENTS = {
  unverified: '20000000-0000-5000-8000-000000000001',
  future: '20000000-0000-5000-8000-000000000002',
  expired: '20000000-0000-5000-8000-000000000003',
  unknown: '20000000-0000-5000-8000-000000000004',
  resolved: '20000000-0000-5000-8000-000000000005',
  retracted: '20000000-0000-5000-8000-000000000006',
  blockerA: '20000000-0000-5000-8000-000000000007',
  blockerB: '20000000-0000-5000-8000-000000000008',
} as const;
const GOLDEN_REQUEST: JourneyPlanRequest = {
  origin: { latitude: -6.174612, longitude: 106.8304 },
  destination: { latitude: -6.278404, longitude: 106.82972 },
  departureAt: '2026-10-02T08:00:00+07:00',
  networkSnapshotId: SNAPSHOT_ID,
  preference: 'BALANCED',
  maximumAlternatives: 12,
};

const database = createDatabase();
const validator = new OperationalContractValidator();
const states = new KyselyMobilityStateRepository(database, validator);
const activeRepository = new KyselyActiveJourneyRepository(database);
const activeJourneys = new ActiveJourneyService(activeRepository);
const events = new OperationalEventBus();
const impacts = new JourneyImpactService(activeRepository, states, events);
const lifecycle = new KyselyIncidentLifecycleRepository(
  database,
  new OperationalIncidentService(validator),
  states,
  events,
);
const intelligence = new DisruptionIntelligenceService(database);
const router = new OtpJourneyRoutingAdapter();
const identities = new KyselyRoutingIdentityBridge(database);

async function run(): Promise<object> {
  assert.equal(process.env.EXT_X1_GOLDEN_TEST_ONLY, '1');
  const databaseName = await sql<{
    name: string;
  }>`select current_database() as name`.execute(database);
  assert.equal(databaseName.rows[0]?.name, DATABASE_NAME);
  await cleanup();
  impacts.onModuleInit();
  try {
    const snapshot = await states.getSnapshot(SNAPSHOT_ID);
    assert.equal(snapshot.status, 'FINALIZED');
    assert.equal(snapshot.contentHash, SNAPSHOT_HASH);
    assert.equal(
      snapshot.processingVersion,
      'EXT_X1_CONTROLLED_TEST_BRIDGE_V1',
    );
    assert.deepEqual(await entityTypes([ROUTE_6H, KUNINGAN]), [
      'ROUTE',
      'STOP',
    ]);

    const health = await router.routerHealth();
    assert.equal(health.status, 'AVAILABLE');
    const routingSnapshot = router.routingSnapshot();
    assert.equal(routingSnapshot.graphSha256, EXPECTED_GRAPH_HASH);
    assert.equal(
      routingSnapshot.manifestSha256,
      EXPECTED_ROUTING_MANIFEST_HASH,
    );

    const rawCandidates = await router.planJourney({
      ...GOLDEN_REQUEST,
      attempt: 1,
      excludedRouteIds: [],
    });
    const rawSelected = rawCandidates.find(
      (candidate) =>
        candidate.legs.map((leg) => leg.mode).join('>') ===
          'WALK>TRANSJAKARTA>WALK' &&
        candidate.legs.some(
          (leg) =>
            leg.routeId === '5:tnx:tj:route:6H' &&
            leg.intermediateStops.some(
              (stop) => stop.otpStopId === '5:tnx:tj:stop:G00283',
            ),
        ),
    );
    assert.ok(rawSelected, 'Real OTP golden 6H-via-Kuningan candidate missing');
    const resolvedLegs = await identities.resolveLegs(
      rawSelected.legs,
      snapshot,
    );
    assert.equal(bindingId(resolvedLegs, ROUTE_6H_OTP), ROUTE_6H);
    assert.equal(bindingId(resolvedLegs, '5:tnx:tj:stop:G00283'), KUNINGAN);
    const selected: JourneyAlternative = {
      ...rawSelected,
      journeyId: PLAN_A,
      legs: resolvedLegs,
      routingContext: {
        ...rawSelected.routingContext,
        networkSnapshotHash: snapshot.contentHash,
        mobilityProjectionVersion: snapshot.processingVersion,
      },
    };
    const selectedResult: JourneyPlanResult = {
      alternatives: [selected],
      rejectedCandidateCount: 0,
      stateValidationMilliseconds: 0,
      routingMilliseconds: 0,
      totalMilliseconds: 0,
      strategy: 'INITIAL_PLAN',
    };
    const runtimeFingerprint = fingerprintJourneyPlan(selectedResult);
    assert.match(runtimeFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(
      fingerprintJourneyPlan({ ...selectedResult, totalMilliseconds: 999 }),
      runtimeFingerprint,
    );

    const rawOwnerB = rawCandidates.find(
      (candidate) =>
        candidate.legs.some((leg) => leg.mode !== 'WALK') &&
        candidate.legs.every((leg) => leg.routeId !== ROUTE_6H_OTP),
    );
    assert.ok(
      rawOwnerB,
      'Real OTP alternative without route 6H missing for owner B',
    );
    const resolvedOwnerBLegs = await identities.resolveLegs(
      rawOwnerB.legs,
      snapshot,
    );
    assert.equal(bindingId(resolvedOwnerBLegs, ROUTE_6H_OTP), undefined);
    assert.ok(
      resolvedOwnerBLegs
        .flatMap((leg) => leg.entityBindings)
        .every((binding) => binding.canonicalEntityId !== ROUTE_6H),
      'Owner B real OTP alternative must not bind canonical route 6H',
    );
    const ownerBRoute = ownerBTransitRoute(rawOwnerB);
    const ownerBPlan: JourneyAlternative = {
      ...rawOwnerB,
      journeyId: PLAN_B,
      legs: resolvedOwnerBLegs,
      routingContext: {
        ...rawOwnerB.routingContext,
        networkSnapshotHash: snapshot.contentHash,
        mobilityProjectionVersion: snapshot.processingVersion,
      },
    };
    assert.ok(
      ownerBPlan.legs.some((leg) => leg.mode !== 'WALK'),
      'Owner B candidate must include transit legs',
    );
    const ownerBRuntimeFingerprint = fingerprintJourneyPlan({
      ...selectedResult,
      alternatives: [ownerBPlan],
    });
    assert.match(ownerBRuntimeFingerprint, /^[0-9a-f]{64}$/);
    assert.notEqual(ownerBRuntimeFingerprint, runtimeFingerprint);
    await activeJourneys.activate({
      ownerRef: OWNER_A,
      selectedJourney: selected,
      activatedAt: '2026-10-02T08:00:00+07:00',
    });
    await activeJourneys.activate({
      ownerRef: OWNER_B,
      selectedJourney: ownerBPlan,
      activatedAt: '2026-10-02T08:00:00+07:00',
    });
    assert.ok(
      (await activeJourneys.get(ACTIVE_A, OWNER_A)).dependencies.some(
        (item) => item.mobilityEntityId === ROUTE_6H,
      ),
    );
    assert.ok(
      !(await activeJourneys.get(ACTIVE_B, OWNER_B)).dependencies.some(
        (item) => item.mobilityEntityId === ROUTE_6H,
      ),
    );

    const controls: Record<string, unknown> = {};
    await intelligence.createControlledEvent({
      incidentType: 'FLOOD',
      sourceId: SOURCE_ID,
      evidenceType: 'SIMULATED',
      operationalState: 'UNKNOWN',
      observedAt: '2026-10-02T08:00:00+07:00',
      effectiveFrom: '2026-10-02T08:00:00+07:00',
      effectiveTo: '2026-10-02T14:00:00+07:00',
      expiresAt: '2026-10-02T14:00:00+07:00',
      receivedAt: '2026-10-02T08:00:00+07:00',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [106.8323, -6.2297],
            [106.8342, -6.2297],
            [106.8342, -6.2279],
            [106.8323, -6.2279],
            [106.8323, -6.2297],
          ],
        ],
      },
      reason: 'CONTROLLED SIMULATED Kuningan hazard-only exposure.',
      provenanceRef: 'acceptance:CONTROLLED:SIMULATED:hazard',
      rawReference: 'acceptance:CONTROLLED:SIMULATED:hazard',
      sourceClassification: 'NOT_AVAILABLE',
    });
    await impacts.whenIdle();
    controls.hazardOnly = await assertStateAndAlertCount('UNKNOWN', 0);

    await lifecycle.ingest(
      evidence(INCIDENTS.unverified, 'UNAVAILABLE'),
      'UNVERIFIED',
      AS_OF,
    );
    await impacts.whenIdle();
    controls.unverified = await assertStateAndAlertCount('UNKNOWN', 0);

    await lifecycle.ingest(
      evidence(INCIDENTS.future, 'UNAVAILABLE', {
        effectiveFrom: '2026-10-02T10:00:00+07:00',
        expiresAt: '2026-10-02T14:00:00+07:00',
      }),
      'VERIFIED',
      AS_OF,
    );
    await impacts.whenIdle();
    controls.future = await assertStateAndAlertCount('UNKNOWN', 0);

    await lifecycle.ingest(
      evidence(INCIDENTS.expired, 'UNAVAILABLE', {
        observedAt: '2026-10-02T05:00:00+07:00',
        effectiveFrom: '2026-10-02T05:00:00+07:00',
        expiresAt: '2026-10-02T07:00:00+07:00',
      }),
      'VERIFIED',
      AS_OF,
    );
    await impacts.whenIdle();
    controls.expired = await assertStateAndAlertCount('UNKNOWN', 0);

    await lifecycle.ingest(
      evidence(INCIDENTS.unknown, 'UNKNOWN'),
      'VERIFIED',
      AS_OF,
    );
    await impacts.whenIdle();
    controls.unknown = await assertStateAndAlertCount('UNKNOWN', 0);

    await lifecycle.ingest(
      evidence(INCIDENTS.resolved, 'UNAVAILABLE'),
      'VERIFIED',
      AS_OF,
    );
    await impacts.whenIdle();
    await lifecycle.transition({
      incidentId: INCIDENTS.resolved,
      toStatus: 'RESOLVED',
      changedAt: '2026-10-02T08:31:00+07:00',
      reason: 'CONTROLLED SIMULATED resolved control.',
      provenanceRef: 'acceptance:CONTROLLED:SIMULATED:resolved',
    });
    await impacts.whenIdle();
    controls.resolved = await assertStateAndAlertCount(
      'UNKNOWN',
      1,
      new Date('2026-10-02T08:32:00+07:00'),
    );

    await lifecycle.ingest(
      evidence(INCIDENTS.retracted, 'UNAVAILABLE'),
      'VERIFIED',
      AS_OF,
    );
    await impacts.whenIdle();
    await lifecycle.transition({
      incidentId: INCIDENTS.retracted,
      toStatus: 'RETRACTED',
      changedAt: '2026-10-02T08:34:00+07:00',
      reason: 'CONTROLLED SIMULATED retracted control.',
      provenanceRef: 'acceptance:CONTROLLED:SIMULATED:retracted',
    });
    await impacts.whenIdle();
    controls.retracted = await assertStateAndAlertCount(
      'UNKNOWN',
      2,
      new Date('2026-10-02T08:35:00+07:00'),
    );

    // P1 — full persisted plan() BEFORE any effective blocker exists, at the
    // same reproducible replay instant used by P2. Real OTP, real canonical
    // identity resolution, no persisted incident is yet active at 08:36.
    const normalPlan = await (
      await plannerAt(PLANNER_BLOCKED_AT)
    ).plan(GOLDEN_REQUEST);
    const normal6H = normalPlan.alternatives.find((alt) =>
      legsBind6H(alt.legs),
    );
    assert.ok(
      normal6H,
      'P1 normal full-plan must return a canonical route-6H alternative',
    );
    assert.equal(normalPlan.strategy, 'INITIAL_PLAN');
    assert.equal(normalPlan.rejectedCandidateCount, 0);
    assert.equal(
      normalPlan.alternatives.every(
        (alt) =>
          alt.routingContext.provider === 'OTP' &&
          alt.routingContext.graphSha256 === EXPECTED_GRAPH_HASH &&
          alt.routingContext.networkSnapshotHash === SNAPSHOT_HASH,
      ),
      true,
    );
    const normalFingerprint = fingerprintJourneyPlan(normalPlan);
    assert.equal(
      fingerprintJourneyPlan({ ...normalPlan, totalMilliseconds: 424242 }),
      normalFingerprint,
    );
    controls.fullPlannerNormal = {
      status: 'PASS',
      asOf: PLANNER_BLOCKED_AT.toISOString(),
      request: GOLDEN_REQUEST,
      runtimeFingerprint: normalFingerprint,
      alternatives: normalPlan.alternatives.length,
      route6HJourneyId: normal6H.journeyId,
      route6HModes: normal6H.legs.map((leg) => leg.mode),
      route6HTripId: normal6H.legs.find((leg) => leg.tripId !== null)?.tripId,
      usesRoute6H: true,
    };

    const blockerA = evidence(INCIDENTS.blockerA, 'UNAVAILABLE', {
      observedAt: '2026-10-02T08:35:00+07:00',
      effectiveFrom: '2026-10-02T08:35:00+07:00',
      receivedAt: '2026-10-02T08:35:00+07:00',
    });
    const inserted = await lifecycle.ingest(
      blockerA,
      'VERIFIED',
      new Date('2026-10-02T08:36:00+07:00'),
    );
    await impacts.whenIdle();
    assert.equal(inserted.status, 'INSERTED');
    const duplicate = await lifecycle.ingest(
      blockerA,
      'VERIFIED',
      new Date('2026-10-02T08:36:00+07:00'),
    );
    await impacts.whenIdle();
    assert.equal(duplicate.status, 'ALREADY_PERSISTED');
    const alertsAfterA = await activeJourneys.listAlerts(ACTIVE_A, OWNER_A);
    assert.equal(alertsAfterA.length, 3);
    assert.equal(
      alertsAfterA.filter((item) => item.resolvedAt === null).length,
      1,
    );
    assert.equal(alertsAfterA.at(-1)?.alertType, 'BLOCKING');
    assert.equal(alertsAfterA.at(-1)?.evidenceType, 'SIMULATED');
    assert.equal(
      (await activeJourneys.listAlerts(ACTIVE_B, OWNER_B)).length,
      0,
    );

    const blockerValidationAt = PLANNER_BLOCKED_AT;
    const blockerReplay = await states.replayState(
      ROUTE_6H,
      blockerValidationAt,
    );
    assert.equal(blockerReplay.operationalState, 'UNAVAILABLE');
    assert.deepEqual(inserted.observationIds, [blockerReplay.observationId]);
    const explicitBlockedPlanner = new JourneyPlannerService(
      router,
      identities,
      asOfMobility(states, blockerValidationAt),
    );
    const blocked =
      await explicitBlockedPlanner.validateOperationalState(resolvedLegs);
    assert.ok(blocked.blockedEntityIds.includes(ROUTE_6H));
    controls.blockedValidation = {
      status: 'PASS',
      observationId: String(blockerReplay.observationId ?? ''),
      asOf: blockerValidationAt.toISOString(),
      blockedEntityIds: blocked.blockedEntityIds,
    };

    // P2 — full persisted plan() under the SAME replay instant and request.
    const blockedPlan = await (
      await plannerAt(blockerValidationAt)
    ).plan(GOLDEN_REQUEST);
    assert.ok(
      blockedPlan.alternatives.length > 0,
      'Blocked plan must still return valid unaffected alternatives',
    );
    assert.ok(
      blockedPlan.alternatives.every((alt) => !legsBind6H(alt.legs)),
      'Blocked full-plan returned an alternative that still binds canonical route 6H',
    );
    assert.ok(
      blockedPlan.alternatives.every(
        (alt) =>
          alt.routingContext.provider === 'OTP' &&
          alt.routingContext.graphSha256 === EXPECTED_GRAPH_HASH,
      ),
      'Blocked plan alternatives must originate from the manifested real OTP graph',
    );
    const blockedRejection = (blockedPlan.candidateRejections ?? []).find(
      (item) => item.blockedEntityIds.includes(ROUTE_6H),
    );
    assert.ok(
      blockedRejection,
      'Full-plan canonical rejection diagnostics miss the blocking route 6H',
    );
    assert.equal(
      blockedRejection.reason,
      'CURRENT_UNAVAILABLE_CANONICAL_ENTITY',
    );
    assert.ok(blockedPlan.rejectedCandidateCount >= 1);
    controls.fullPlannerBlocked = {
      status: 'PASS',
      asOf: blockerValidationAt.toISOString(),
      request: GOLDEN_REQUEST,
      alternatives: blockedPlan.alternatives.length,
      rejectedCandidateCount: blockedPlan.rejectedCandidateCount,
      blockedEntityIds: blockedRejection.blockedEntityIds,
      blockedRouteIds: blockedRejection.routeIds,
      usesRoute6H: false,
    };

    controls.duplicate = {
      status: 'PASS',
      observationIds: duplicate.observationIds,
      first: inserted.status,
      duplicate: duplicate.status,
      activeBlockingAlerts: 1,
    };

    const blockerB = await lifecycle.ingest(
      evidence(INCIDENTS.blockerB, 'UNAVAILABLE', {
        observedAt: '2026-10-02T08:37:00+07:00',
        effectiveFrom: '2026-10-02T08:37:00+07:00',
        receivedAt: '2026-10-02T08:37:00+07:00',
      }),
      'VERIFIED',
      new Date('2026-10-02T08:38:00+07:00'),
    );
    await impacts.whenIdle();
    await lifecycle.transition({
      incidentId: INCIDENTS.blockerA,
      toStatus: 'RESOLVED',
      changedAt: '2026-10-02T08:39:00+07:00',
      reason: 'CONTROLLED SIMULATED blocker A resolved.',
      provenanceRef: 'acceptance:CONTROLLED:SIMULATED:blocker-a-resolved',
    });
    await impacts.whenIdle();
    const stillBlocked = await states.replayState(
      ROUTE_6H,
      new Date('2026-10-02T08:40:00+07:00'),
    );
    assert.equal(stillBlocked.operationalState, 'UNAVAILABLE');
    // The surviving effective blocker must be incident B, not the resolved A.
    assert.deepEqual(stillBlocked.observationId, blockerB.observationIds[0]);
    const alertsAfterResolveA = await activeJourneys.listAlerts(
      ACTIVE_A,
      OWNER_A,
    );
    assert.equal(
      alertsAfterResolveA.filter((item) => item.resolvedAt === null).length,
      1,
      'Resolving A must not clear the passenger impact still caused by B',
    );
    assert.equal(
      (await activeJourneys.listAlerts(ACTIVE_B, OWNER_B)).length,
      0,
      'Owner B must remain isolated from the route-6H multi-blocker impact',
    );
    controls.independentBlockers = {
      status: 'PASS',
      afterResolveA: stillBlocked.operationalState,
      survivingIncident: 'blockerB',
      survivingObservationId: String(stillBlocked.observationId ?? ''),
      totalAlerts: alertsAfterResolveA.length,
      unresolvedAfterResolveA: alertsAfterResolveA.filter(
        (item) => item.resolvedAt === null,
      ).length,
      ownerBAlerts: 0,
    };

    await lifecycle.transition({
      incidentId: INCIDENTS.blockerB,
      toStatus: 'RESOLVED',
      changedAt: '2026-10-02T08:41:00+07:00',
      reason: 'CONTROLLED SIMULATED blocker B resolved.',
      provenanceRef: 'acceptance:CONTROLLED:SIMULATED:blocker-b-resolved',
    });
    await impacts.whenIdle();
    const cleared = await states.replayState(
      ROUTE_6H,
      new Date('2026-10-02T08:42:00+07:00'),
    );
    assert.equal(cleared.operationalState, 'UNKNOWN');
    const finalAlerts = await activeJourneys.listAlerts(ACTIVE_A, OWNER_A);
    assert.equal(finalAlerts.length, 3);
    assert.ok(finalAlerts.every((item) => item.resolvedAt !== null));
    controls.finalResolution = {
      status: 'PASS',
      state: cleared.operationalState,
      retainedAlertHistory: finalAlerts.length,
      activeAlerts: 0,
    };

    // P3 — restriction removal: same request, later reproducible replay instant.
    // The same routing snapshot must return the canonical route-6H alternative.
    const restoredPlan = await (
      await plannerAt(PLANNER_CLEARED_AT)
    ).plan(GOLDEN_REQUEST);
    const restored6H = restoredPlan.alternatives.find((alt) =>
      legsBind6H(alt.legs),
    );
    assert.ok(
      restored6H,
      'P3 must restore canonical route-6H eligibility after all blockers resolve',
    );
    const restoredFingerprint = fingerprintJourneyPlan(restoredPlan);
    assert.equal(
      restoredFingerprint,
      normalFingerprint,
      'P3 plan must match P1 plan on the same snapshot and temporal context',
    );
    controls.fullPlannerRestored = {
      status: 'PASS',
      asOf: PLANNER_CLEARED_AT.toISOString(),
      request: GOLDEN_REQUEST,
      runtimeFingerprint: restoredFingerprint,
      alternatives: restoredPlan.alternatives.length,
      route6HJourneyId: restored6H.journeyId,
      usesRoute6H: true,
      matchesNormalFingerprint: true,
    };

    let typedFailure: object | null = null;
    const blockedOnlyRouter: JourneyRoutingPort = {
      planJourney: async () => [selected],
      routerHealth: () => router.routerHealth(),
      routingSnapshot: () => router.routingSnapshot(),
    };
    const allBlockedStates = controlledBlockedMobility(states, ROUTE_6H);
    try {
      await new JourneyPlannerService(
        blockedOnlyRouter,
        identities,
        allBlockedStates,
      ).plan(GOLDEN_REQUEST);
    } catch (error) {
      if (
        error instanceof JourneyRoutingError &&
        error.code === 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'
      ) {
        assert.equal(error.details.maximumAttempts, 2);
        assert.equal(error.details.rejectedCandidateCount, 2);
        typedFailure = {
          status: 'PASS',
          kind: 'CONTROLLED_OVERRIDE' as const,
          code: error.code,
          maximumAttempts: error.details.maximumAttempts,
          rejectedCandidateCount: error.details.rejectedCandidateCount,
          effectiveState: 'SIMULATED_UNAVAILABLE_ACCOUNTING_FOR_BLOCKING',
        };
      } else throw error;
    }
    assert.ok(typedFailure, 'All-invalid case did not return typed failure');
    controls.allInvalid = typedFailure;

    const counts = await evidenceCounts();
    return {
      status: 'PASS',
      evidenceSemantics: 'CONTROLLED_SIMULATED_WITH_REAL_OTP_SCHEDULED_ROUTING',
      runtimeFingerprint,
      ownerB: {
        runtimeFingerprint: ownerBRuntimeFingerprint,
        routeId: ownerBRoute,
      },
      ids: {
        snapshot: SNAPSHOT_ID,
        route6H: ROUTE_6H,
        Kuningan: KUNINGAN,
        ownerAJourney: ACTIVE_A,
        ownerBJourney: ACTIVE_B,
        incidents: INCIDENTS,
      },
      router: {
        health,
        ...routingSnapshot,
        rawAlternatives: rawCandidates.length,
      },
      selected: {
        modes: selected.legs.map((leg) => leg.mode),
        routeId: '5:tnx:tj:route:6H',
        tripId: selected.legs.find((leg) => leg.routeId !== null)?.tripId,
        startAt: selected.startAt,
        endAt: selected.endAt,
      },
      ownerBSelected: ownerBPlanSummary(ownerBPlan),
      counts,
      controls,
    };
  } finally {
    impacts.onModuleDestroy();
  }
}

function plannerAt(asOf: Date): JourneyPlannerService {
  return new JourneyPlannerService(
    router,
    identities,
    asOfMobility(states, asOf),
  );
}

function legsBind6H(legs: JourneyAlternative['legs']): boolean {
  return legs.some(
    (leg) =>
      leg.routeId === ROUTE_6H_OTP ||
      leg.entityBindings.some(
        (binding) => binding.canonicalEntityId === ROUTE_6H,
      ),
  );
}

function asOfMobility(base: MobilityStatePort, asOf: Date): MobilityStatePort {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'getStates')
        return (ids: readonly string[]) => target.replayStates(ids, asOf);
      if (property === 'getCurrentState')
        return (id: string) => target.replayState(id, asOf);
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as MobilityStatePort;
}

function controlledBlockedMobility(
  base: MobilityStatePort,
  entityId: string,
): MobilityStatePort {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'getStates')
        return async (ids: readonly string[]) =>
          ids.map((id) => ({
            mobilityEntityId: id,
            operationalState: id === entityId ? 'UNAVAILABLE' : 'UNKNOWN',
            evidenceType: 'SIMULATED',
            freshnessStatus: id === entityId ? 'FRESH' : 'UNKNOWN',
            observationId: null,
            sourceId: null,
            observedAt: null,
            expiresAt: null,
            confidenceStatus: id === entityId ? 'SIMULATED' : null,
            confidence: id === entityId ? 1 : null,
            provenanceRef: 'acceptance:CONTROLLED:SIMULATED:all-invalid',
            stateAsOf: AS_OF.toISOString(),
            projectionVersion: 'PHASE_2B_V1',
            reason: 'CONTROLLED SIMULATED all-invalid acceptance state.',
          }));
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as MobilityStatePort;
}

function bindingId(
  legs: JourneyAlternative['legs'],
  otpEntityId: string,
): string | undefined {
  return legs
    .flatMap((leg) => leg.entityBindings)
    .find((binding) => binding.otpEntityId === otpEntityId)?.canonicalEntityId;
}

function ownerBTransitRoute(candidate: JourneyAlternative): string {
  return (
    candidate.legs.find((leg) => leg.mode !== 'WALK' && Boolean(leg.routeId))
      ?.routeId ?? 'UNKNOWN'
  );
}

function ownerBPlanSummary(plan: JourneyAlternative): object {
  return {
    journeyId: plan.journeyId,
    modes: plan.legs.map((leg) => leg.mode),
    routeIds: plan.legs
      .map((leg) => leg.routeId)
      .filter((item): item is string => Boolean(item)),
    canonicalBindings:
      plan.legs.flatMap((leg) => leg.entityBindings).length > 0,
    startAt: plan.startAt,
    endAt: plan.endAt,
  };
}

function evidence(
  incidentId: string,
  operationalState: IncidentEvidenceInput['operationalState'],
  overrides: Partial<IncidentEvidenceInput> = {},
): IncidentEvidenceInput {
  return {
    incidentId,
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityIds: [ROUTE_6H],
    affectedModes: ['TRANSJAKARTA'],
    operationalState,
    sourceClass: 'SIMULATED',
    sourceId: SOURCE_ID,
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    evidenceType: 'SIMULATED',
    sourceClassification: 'NOT_AVAILABLE',
    observedAt: '2026-10-02T08:00:00+07:00',
    effectiveFrom: '2026-10-02T08:00:00+07:00',
    expiresAt: '2026-10-09T23:59:00+07:00',
    receivedAt: '2026-10-02T08:00:00+07:00',
    reason: `CONTROLLED SIMULATED golden incident ${incidentId}.`,
    provenanceRef: `acceptance:CONTROLLED:SIMULATED:${incidentId}`,
    rawReference: `acceptance:CONTROLLED:SIMULATED:${incidentId}`,
    supportingHazardEventId: null,
    ...overrides,
  };
}

async function assertStateAndAlertCount(
  expectedState: string,
  expectedAlertCount: number,
  asOf: Date = AS_OF,
): Promise<object> {
  const state = await states.replayState(ROUTE_6H, asOf);
  assert.equal(state.operationalState, expectedState);
  const alertsA = await activeJourneys.listAlerts(ACTIVE_A, OWNER_A);
  const alertsB = await activeJourneys.listAlerts(ACTIVE_B, OWNER_B);
  assert.equal(alertsA.length, expectedAlertCount);
  assert.equal(alertsB.length, 0);
  return {
    status: 'PASS',
    routeState: state.operationalState,
    ownerAAlerts: alertsA.length,
    ownerBAlerts: alertsB.length,
  };
}

async function entityTypes(ids: readonly string[]): Promise<string[]> {
  const rows = await sql<{ id: string; type: string }>`
    select id, entity_type as type from twin.mobility_entity
    where id=any(${ids}::uuid[])
    order by array_position(${ids}::uuid[], id)
  `.execute(database);
  return rows.rows.map((row) => row.type);
}

async function evidenceCounts(): Promise<object> {
  const result = await sql<{
    incidents: number;
    journal: number;
    observations: number;
    alertsA: number;
    alertsB: number;
  }>`
    select
      (select count(*)::int from disruption.operational_incident
       where id=any(${Object.values(INCIDENTS)}::uuid[])) as incidents,
      (select count(*)::int from disruption.operational_incident_journal
       where incident_id=any(${Object.values(INCIDENTS)}::uuid[])) as journal,
      (select count(*)::int from twin.operational_observation
       where incident_id=any(${Object.values(INCIDENTS)}::uuid[])) as observations,
      (select count(*)::int from journey.targeted_alert where journey_id=${ACTIVE_A}::uuid) as "alertsA",
      (select count(*)::int from journey.targeted_alert where journey_id=${ACTIVE_B}::uuid) as "alertsB"
  `.execute(database);
  return result.rows[0] ?? {};
}

async function cleanup(): Promise<void> {
  const journeyIds = [ACTIVE_A, ACTIVE_B];
  const incidentIds = Object.values(INCIDENTS);
  await sql`delete from journey.targeted_alert where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from journey.journey_impact_dependency where impact_id in (
    select id from journey.journey_impact where journey_id=any(${journeyIds}::uuid[])
  )`.execute(database);
  await sql`delete from journey.journey_impact where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from journey.journey_state_event where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from journey.journey_progress where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from journey.active_journey where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  for (const table of ['journey_dependency', 'journey_leg', 'journey_plan'])
    await sql
      .raw(`alter table journey.${table} disable trigger ${table}_immutable`)
      .execute(database);
  await sql`delete from journey.journey_dependency where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from journey.journey_leg where journey_id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from journey.journey_plan where id=any(${journeyIds}::uuid[])`.execute(
    database,
  );
  for (const table of ['journey_dependency', 'journey_leg', 'journey_plan'])
    await sql
      .raw(`alter table journey.${table} enable trigger ${table}_immutable`)
      .execute(database);

  await sql`delete from twin.mobility_state_history where mobility_entity_id=${ROUTE_6H}::uuid`.execute(
    database,
  );
  await sql`delete from twin.mobility_state where mobility_entity_id=${ROUTE_6H}::uuid`.execute(
    database,
  );
  await sql`alter table disruption.operational_incident_journal disable trigger operational_incident_journal_append_only`.execute(
    database,
  );
  await sql`delete from disruption.operational_incident_journal where incident_id=any(${incidentIds}::uuid[])`.execute(
    database,
  );
  await sql`alter table disruption.operational_incident_journal enable trigger operational_incident_journal_append_only`.execute(
    database,
  );
  await sql`alter table twin.operational_observation disable trigger operational_observation_append_only`.execute(
    database,
  );
  await sql`delete from twin.operational_observation where incident_id=any(${incidentIds}::uuid[])`.execute(
    database,
  );
  await sql`alter table twin.operational_observation enable trigger operational_observation_append_only`.execute(
    database,
  );
  await sql`delete from disruption.operational_incident_entity where incident_id=any(${incidentIds}::uuid[])`.execute(
    database,
  );
  await sql`delete from disruption.operational_incident where id=any(${incidentIds}::uuid[])`.execute(
    database,
  );

  const priorHazards = await sql<{ id: string }>`
    select id from disruption.event
    where provenance_ref='acceptance:CONTROLLED:SIMULATED:hazard'
  `.execute(database);
  const hazardIds = priorHazards.rows.map((row) => row.id);
  if (hazardIds.length > 0) {
    await sql`delete from disruption.entity_impact where impact_analysis_id in (
      select id from disruption.impact_analysis where disruption_event_id=any(${hazardIds}::uuid[])
    )`.execute(database);
    await sql`delete from disruption.impact_analysis where disruption_event_id=any(${hazardIds}::uuid[])`.execute(
      database,
    );
    await sql`delete from disruption.event where id=any(${hazardIds}::uuid[])`.execute(
      database,
    );
  }
}

try {
  const evidence = await run();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await database.destroy();
}
