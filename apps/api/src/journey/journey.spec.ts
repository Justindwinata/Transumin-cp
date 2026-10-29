import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MobilityStatePort } from '../mobility-twin/application/mobility-state.port.js';
import type {
  EffectiveMobilityState,
  NetworkSnapshot,
} from '../mobility-twin/domain/mobility-twin.js';
import {
  assertCanonicalStateBindings,
  JourneyPlannerService,
  rankAlternatives,
  selectDecisionAlternatives,
  eligibleJourneyAlternatives,
} from './application/journey-planner.service.js';
import {
  extractJourneyDependencies,
  selectedJourneyFingerprint,
} from './application/active-journey.service.js';
import {
  fingerprintJourneyPlan,
  normalizeJourneyPlanForResearch,
} from './application/journey-research-fingerprint.js';
import type { JourneyRoutingPort } from './application/journey-routing.port.js';
import type { RoutingIdentityPort } from './application/routing-identity.port.js';
import type {
  JourneyAlternative,
  JourneyLeg,
  JourneyPlanRequest,
} from './domain/journey.js';
import { JourneyRoutingError } from './domain/journey.js';
import {
  normalizeLeg,
  normalizeWalkingSteps,
  parseNamespacedId,
  OtpJourneyRoutingAdapter,
} from './infrastructure/otp-journey-routing.adapter.js';

describe('OTP manifested service-date guard', () => {
  it('rejects dates outside router manifest before OTP request', async () => {
    const adapter = new OtpJourneyRoutingAdapter();
    await assert.rejects(
      adapter.planJourney({
        origin: { latitude: -6.2, longitude: 106.8 },
        destination: { latitude: -6.21, longitude: 106.81 },
        departureAt: '2000-01-01T08:00:00+07:00',
        preference: 'BALANCED',
        allowedModes: ['TRANSJAKARTA'],
        excludedRouteIds: [],
        attempt: 1,
        networkSnapshotId: '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f',
      }),
      (error: unknown) =>
        (error as JourneyRoutingError).code === 'INVALID_TIME',
    );
  });
});

const snapshot: NetworkSnapshot = {
  snapshotId: '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f',
  transitDatasetVersionId: 'bf7e3650-6af7-5bee-b25a-26f763f7fe4c',
  spatialDatasetVersionId: 'e6aa5be0-0cf4-5e33-8581-696af9a2045f',
  processingVersion: 'PHASE_2B_V1',
  stateCutoffAt: '2026-10-02T00:00:00.000Z',
  configuration: {},
  manifestRef: 'snapshot.json',
  contentHash: 'b'.repeat(64),
  status: 'FINALIZED',
  createdAt: '2026-10-02T00:00:00.000Z',
  finalizedAt: '2026-10-02T00:00:00.000Z',
  materializedStateCount: 0,
};
const request: JourneyPlanRequest = {
  origin: { latitude: -6.2, longitude: 106.8 },
  destination: { latitude: -6.3, longitude: 106.9 },
  departureAt: '2026-10-02T08:00:00+07:00',
  networkSnapshotId: snapshot.snapshotId,
  preference: 'BALANCED',
  maximumAlternatives: 3,
};

describe('Phase 4B product journey orchestration', () => {
  it('accepts UNKNOWN, future/expired UNAVAILABLE, and fresh DEGRADED without invented delay', async () => {
    const candidate = alternative('route-a', 'entity-a');
    const planner = plannerFixture({
      attempts: [[candidate]],
      states: [
        state('entity-a', 'UNKNOWN', 'UNKNOWN'),
        state('entity-b', 'UNAVAILABLE', 'EXPIRED'),
        state('entity-c', 'DEGRADED', 'FRESH'),
        state('entity-d', 'UNAVAILABLE', 'NOT_YET_VALID'),
      ],
      extraBindings: ['entity-b', 'entity-c', 'entity-d'],
    }).planner;
    const result = await planner.plan(request);
    assert.equal(result.alternatives.length, 1);
    assert.equal(result.alternatives[0]?.durationSeconds, 600);
    assert.deepEqual(
      result.alternatives[0]?.legs[0]?.operationalFlags.map(
        (item) => item.operationalState,
      ),
      ['DEGRADED'],
    );
    assert.equal(result.alternatives[0]?.fareStatus, 'UNKNOWN');
  });

  it('does not exclude an unaffected transfer route or stop retrying at a walking fallback', async () => {
    const blocked = alternative('route-blocked', 'entity-blocked');
    const safe = alternative('route-safe', 'entity-safe');
    const mixed = {
      ...blocked,
      legs: [
        ...blocked.legs,
        ...safe.legs.map((leg) => ({ ...leg, sequence: 1 })),
      ],
    };
    const walk = {
      ...alternative('walk', 'walk'),
      journeyId: 'walk',
      durationSeconds: 3600,
      legs: blocked.legs.map((leg) => ({
        ...leg,
        mode: 'WALK' as const,
        routeId: null,
        entityBindings: [],
      })),
    };
    const fixture = plannerFixture({
      attempts: [[mixed, walk], [safe]],
      states: [
        state('entity-blocked', 'UNAVAILABLE', 'FRESH'),
        state('entity-safe', 'UNKNOWN', 'UNKNOWN'),
      ],
    });
    const planned = await fixture.planner.plan({
      ...request,
      maximumAlternatives: 1,
    });
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(fixture.calls[1]?.excludedRouteIds, ['route-blocked']);
    assert.equal(planned.alternatives[0]?.legs[0]?.routeId, 'route-safe');
  });

  it('rejects UNAVAILABLE, excludes the blocked route, and accepts a bounded retry', async () => {
    const first = alternative('route-blocked', 'entity-blocked');
    const second = alternative('route-safe', 'entity-safe');
    const fixture = plannerFixture({
      attempts: [[first], [second]],
      states: [
        state('entity-blocked', 'UNAVAILABLE', 'FRESH'),
        state('entity-safe', 'UNKNOWN', 'UNKNOWN'),
      ],
    });
    const result = await fixture.planner.plan(request);
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(fixture.calls[1]?.excludedRouteIds, ['route-blocked']);
    assert.equal(result.rejectedCandidateCount, 1);
    assert.deepEqual(result.candidateRejections, [
      {
        attempt: 1,
        routeIds: ['route-blocked'],
        blockedEntityIds: ['entity-blocked'],
        reason: 'CURRENT_UNAVAILABLE_CANONICAL_ENTITY',
      },
    ]);
    assert.equal(result.alternatives[0]?.legs[0]?.routeId, 'route-safe');
    assert.equal(result.alternatives[0]?.routingContext.attemptCount, 2);
  });

  it('blocks a canonical non-route entity and excludes it from the accepted alternate', async () => {
    const first = alternative('route-blocked', 'entity-blocked');
    const second = alternative('route-safe', 'entity-safe');
    const fixture = plannerFixture({
      attempts: [[first], [second]],
      states: [
        state('entity-blocked-from', 'UNAVAILABLE', 'FRESH'),
        state('entity-safe-from', 'UNKNOWN', 'UNKNOWN'),
      ],
    });
    const result = await fixture.planner.plan(request);
    const acceptedBindings = result.alternatives.flatMap((candidate) =>
      candidate.legs.flatMap((leg) => leg.entityBindings),
    );
    assert.equal(result.rejectedCandidateCount, 1);
    assert.equal(result.alternatives[0]?.routingContext.attemptCount, 2);
    assert.equal(
      acceptedBindings.some(
        (item) => item.mobilityEntityId === 'entity-blocked-from',
      ),
      false,
    );
  });

  it('returns a typed no-valid-route error after the bounded retry', async () => {
    const blocked = alternative('route-blocked', 'entity-blocked');
    const fixture = plannerFixture({
      attempts: [[blocked], []],
      states: [state('entity-blocked', 'UNAVAILABLE', 'FRESH')],
    });
    await assert.rejects(fixture.planner.plan(request), (error: unknown) => {
      assert.ok(error instanceof JourneyRoutingError);
      assert.equal(error.code, 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION');
      assert.deepEqual(error.details.candidateRejections, [
        {
          attempt: 1,
          routeIds: ['route-blocked'],
          blockedEntityIds: ['entity-blocked'],
          reason: 'CURRENT_UNAVAILABLE_CANONICAL_ENTITY',
        },
      ]);
      return true;
    });
    assert.equal(fixture.calls.length, 2);
  });

  it('removes cosmetic duplicates and orders meaningful alternatives deterministically', async () => {
    const slow = {
      ...alternative('route-a', 'entity-a'),
      durationSeconds: 900,
    };
    const duplicate = { ...slow, journeyId: 'provider-duplicate' };
    const fast = alternative('route-b', 'entity-b');
    const planner = plannerFixture({
      attempts: [[slow, duplicate, fast]],
      states: [
        state('entity-a', 'UNKNOWN', 'UNKNOWN'),
        state('entity-b', 'UNKNOWN', 'UNKNOWN'),
      ],
    }).planner;
    const result = await planner.plan(request);
    assert.equal(result.alternatives.length, 2);
    assert.equal(result.alternatives[0]?.legs[0]?.routeId, 'route-b');
  });

  it('keeps all six transit feed namespaces distinct for the identity bridge', () => {
    const cases = [
      ['tj', 'TRANSJAKARTA'],
      ['mikro', 'MIKROTRANS'],
      ['krl', 'KRL'],
      ['mrt', 'MRT_JAKARTA'],
      ['lrtj', 'LRT_JAKARTA'],
      ['lrtjb', 'LRT_JABODEBEK'],
    ] as const;
    for (const [feed] of cases)
      assert.deepEqual(parseNamespacedId(`8:tnx:${feed}:stop:shared-id`), {
        feedKey: feed,
        entityType: 'stop',
        originalId: 'shared-id',
      });
    assert.equal(
      new Set(cases.map(([feed]) => `tnx:${feed}:stop:shared-id`)).size,
      6,
    );
  });

  it('normalizes OTP walking legs when intermediateStops is null', () => {
    const leg = normalizeLeg(
      {
        mode: 'WALK',
        serviceDate: null,
        distance: 120,
        duration: 90,
        from: { name: 'A', lat: -6.2, lon: 106.8, stop: null },
        to: { name: 'B', lat: -6.21, lon: 106.81, stop: null },
        route: null,
        trip: null,
        intermediateStops: null,
        steps: null,
        legGeometry: null,
        start: { scheduledTime: '2026-10-02T08:00:00+07:00' },
        end: { scheduledTime: '2026-10-02T08:01:30+07:00' },
      },
      0,
    );
    assert.equal(leg.mode, 'WALK');
    assert.deepEqual(leg.intermediateStops, []);
    assert.equal(leg.from.latitude, -6.2);
  });

  it('decodes OTP leg geometry into GeoJSON [longitude, latitude] coordinates', () => {
    const leg = normalizeLeg(
      {
        mode: 'WALK',
        serviceDate: null,
        distance: 120,
        duration: 90,
        from: { name: 'A', lat: 38.5, lon: -120.2, stop: null },
        to: { name: 'B', lat: 43.252, lon: -126.453, stop: null },
        route: null,
        trip: null,
        intermediateStops: null,
        steps: null,
        legGeometry: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
        start: { scheduledTime: '2026-10-02T08:00:00+07:00' },
        end: { scheduledTime: '2026-10-02T08:01:30+07:00' },
      },
      0,
    );
    assert.deepEqual(leg.geometry, {
      type: 'LineString',
      coordinates: [
        [-120.2, 38.5],
        [-120.95, 40.7],
        [-126.453, 43.252],
      ],
    });
  });

  it('preserves OTP walk steps with OTP provenance and drops invalid coordinates', () => {
    assert.deepEqual(normalizeWalkingSteps(null), []);
    assert.deepEqual(normalizeWalkingSteps([]), []);
    const steps = normalizeWalkingSteps([
      {
        lat: -6.21,
        lon: 106.845,
        distance: 42,
        streetName: 'Jalan Sudirman',
        relativeDirection: 'RIGHT',
        absoluteDirection: 'EAST',
        area: false,
        bogusName: false,
        stayOn: true,
      },
      {
        lat: -95,
        lon: 106.8,
        distance: 5,
        streetName: 'Invalid',
        relativeDirection: 'LEFT',
        absoluteDirection: null,
        area: null,
        bogusName: null,
        stayOn: null,
      },
      {
        lat: -6.21,
        lon: 106.85,
        distance: -1,
        streetName: null,
        relativeDirection: null,
        absoluteDirection: null,
        area: null,
        bogusName: null,
        stayOn: null,
      },
    ]);
    assert.equal(steps.length, 1);
    assert.deepEqual(steps[0], {
      latitude: -6.21,
      longitude: 106.845,
      distanceMeters: 42,
      relativeDirection: 'RIGHT',
      absoluteDirection: 'EAST',
      streetName: 'Jalan Sudirman',
      bogusName: false,
      area: false,
      stayOn: true,
    });
    const leg = normalizeLeg(
      {
        mode: 'WALK',
        serviceDate: null,
        distance: 120,
        duration: 90,
        from: { name: 'A', lat: -6.2, lon: 106.8, stop: null },
        to: { name: 'B', lat: -6.21, lon: 106.81, stop: null },
        route: null,
        trip: null,
        intermediateStops: null,
        steps: [
          {
            lat: -6.2,
            lon: 106.8,
            distance: 10,
            streetName: 'Origin Street',
            relativeDirection: 'DEPART',
            absoluteDirection: null,
            area: null,
            bogusName: null,
            stayOn: null,
          },
        ],
        legGeometry: null,
        start: { scheduledTime: '2026-10-02T08:00:00+07:00' },
        end: { scheduledTime: '2026-10-02T08:01:30+07:00' },
      },
      0,
    );
    assert.equal(leg.walkingSteps?.length, 1, 'walk steps reach the contract');
    const transit = normalizeLeg(
      {
        mode: 'BUS',
        serviceDate: null,
        distance: 500,
        duration: 300,
        from: { name: 'A', lat: -6.2, lon: 106.8, stop: null },
        to: { name: 'B', lat: -6.21, lon: 106.81, stop: null },
        route: { gtfsId: '8:tnx:transjakarta:route:brt-6h', shortName: '6H' },
        trip: null,
        intermediateStops: null,
        steps: null,
        legGeometry: null,
        start: { scheduledTime: '2026-10-02T08:00:00+07:00' },
        end: { scheduledTime: '2026-10-02T08:05:00+07:00' },
      },
      1,
    );
    assert.deepEqual(
      transit.walkingSteps,
      [],
      'transit legs have no walk steps',
    );
  });

  it('keeps geometry null when OTP omits or truncates the polyline', () => {
    const base = {
      mode: 'WALK',
      serviceDate: null,
      distance: null,
      duration: null,
      from: { name: 'A', lat: -6.2, lon: 106.8, stop: null },
      to: { name: 'B', lat: -6.21, lon: 106.81, stop: null },
      route: null,
      trip: null,
      intermediateStops: null,
      steps: null,
      start: { scheduledTime: '2026-10-02T08:00:00+07:00' },
      end: { scheduledTime: '2026-10-02T08:01:30+07:00' },
    };
    assert.equal(
      normalizeLeg({ ...base, legGeometry: null }, 0).geometry,
      null,
    );
    assert.equal(
      normalizeLeg({ ...base, legGeometry: { points: '' } }, 0).geometry,
      null,
    );
    assert.equal(
      normalizeLeg({ ...base, legGeometry: { points: '_p~iF' } }, 0).geometry,
      null,
    );
    assert.equal(
      normalizeLeg({ ...base, legGeometry: { points: '~'.repeat(14) } }, 0)
        .geometry,
      null,
    );
  });

  it('fails explicitly when a transit entity lacks a canonical Twin binding', () => {
    const leg = alternative('route-a', 'entity-a').legs[0] as JourneyLeg;
    const bindings = leg.entityBindings.map((item) =>
      item.entityType === 'ROUTE' ? { ...item, mobilityEntityId: null } : item,
    );
    assert.throws(
      () =>
        assertCanonicalStateBindings([{ ...leg, entityBindings: bindings }]),
      (error: unknown) =>
        error instanceof JourneyRoutingError &&
        error.code === 'IDENTITY_UNRESOLVED',
    );
  });

  it('fingerprints normalized FULL REPLAN content, ordering, and metrics', async () => {
    const fixture = plannerFixture({
      attempts: [
        [
          alternative('route-a', 'entity-a'),
          { ...alternative('route-b', 'entity-b'), durationSeconds: 700 },
        ],
      ],
      states: [],
    });
    const first = await fixture.planner.fullReplan(request);
    const second = await fixture.planner.fullReplan(request);
    assert.deepEqual(
      normalizeJourneyPlanForResearch(first),
      normalizeJourneyPlanForResearch(second),
    );
    assert.equal(fingerprintJourneyPlan(first), fingerprintJourneyPlan(second));
    const changed = {
      ...second,
      alternatives: second.alternatives.map((item, index) =>
        index === 0
          ? { ...item, durationSeconds: item.durationSeconds + 1 }
          : item,
      ),
    };
    assert.notEqual(
      fingerprintJourneyPlan(first),
      fingerprintJourneyPlan(changed),
    );
  });
});

describe('R4-B preference-aware deterministic ranking', () => {
  const a = {
    ...alternative('route-a', 'entity-a'),
    journeyId: 'journey-a',
    durationSeconds: 600,
    walkingDistanceMeters: 2000,
    transferCount: 2,
  };
  const b = {
    ...alternative('route-b', 'entity-b'),
    journeyId: 'journey-b',
    durationSeconds: 1800,
    walkingDistanceMeters: 100,
    transferCount: 0,
  };
  const c = {
    ...alternative('route-c', 'entity-c'),
    journeyId: 'journey-c',
    durationSeconds: 1000,
    walkingDistanceMeters: 600,
    transferCount: 1,
  };

  it('ranks FASTEST, LEAST_WALKING, and FEWEST_TRANSFERS by the matching single dimension', () => {
    assert.deepEqual(
      rankAlternatives([b, c, a], 'FASTEST').map((item) => item.journeyId),
      ['journey-a', 'journey-c', 'journey-b'],
    );
    assert.deepEqual(
      rankAlternatives([a, c, b], 'LEAST_WALKING').map(
        (item) => item.journeyId,
      ),
      ['journey-b', 'journey-c', 'journey-a'],
    );
    assert.deepEqual(
      rankAlternatives([c, b, a], 'FEWEST_TRANSFERS').map(
        (item) => item.journeyId,
      ),
      ['journey-b', 'journey-c', 'journey-a'],
    );
  });

  it('ranks BALANCED by normalized weighted cost and keeps the middle option first', () => {
    // SIMULATED fixture: duration [.5], walking [.3], transfers [.2]; min-max
    // normalized across these three; zero ranges contribute 0 without mixing units.
    assert.deepEqual(
      rankAlternatives([a, b, c], 'BALANCED').map((item) => item.journeyId),
      ['journey-c', 'journey-a', 'journey-b'],
    );
  });

  it('breaks ties in score, duration, walking, transfers, then journeyId order', () => {
    const x = {
      ...alternative('route-x', 'entity-x'),
      journeyId: 'journey-x',
    };
    const y = {
      ...alternative('route-y', 'entity-y'),
      journeyId: 'journey-y',
    };
    for (const preference of [
      'BALANCED',
      'FASTEST',
      'LEAST_WALKING',
      'FEWEST_TRANSFERS',
    ] as const) {
      assert.deepEqual(rankAlternatives([y, x], preference), [x, y]);
    }
    const shorter = { ...y, durationSeconds: 1 };
    assert.deepEqual(rankAlternatives([x, shorter], 'LEAST_WALKING'), [
      shorter,
      x,
    ]);
    const lessWalking = { ...y, walkingDistanceMeters: 0 };
    const moreWalking = { ...x, walkingDistanceMeters: 100 };
    assert.deepEqual(rankAlternatives([moreWalking, lessWalking], 'FASTEST'), [
      lessWalking,
      moreWalking,
    ]);
    const moreTransfers = { ...x, transferCount: 1 };
    assert.deepEqual(rankAlternatives([moreTransfers, y], 'FASTEST'), [
      y,
      moreTransfers,
    ]);
    assert.deepEqual(rankAlternatives([], 'BALANCED'), []);
    assert.deepEqual(rankAlternatives([x], 'BALANCED'), [x]);
  });

  it('keeps normalized ranking invariant to unit scaling and input order without mutation', () => {
    const candidates = Object.freeze([a, b, c]);
    const scaled = candidates.map((item) => ({
      ...item,
      durationSeconds: item.durationSeconds * 60,
      walkingDistanceMeters: item.walkingDistanceMeters * 1000,
    }));
    const ids = (items: readonly JourneyAlternative[]) =>
      items.map((item) => item.journeyId);
    assert.deepEqual(
      ids(rankAlternatives(scaled.reverse(), 'BALANCED')),
      ids(rankAlternatives(candidates, 'BALANCED')),
    );
    assert.deepEqual(candidates, [a, b, c]);
  });
});

describe('RUN 5A active journey dependency contract', () => {
  it('produces deterministic fingerprints and deduplicated canonical dependencies', () => {
    const selected = alternative('route-a', 'entity-a');
    const duplicated: JourneyAlternative = {
      ...selected,
      legs: selected.legs.map((leg) => ({
        ...leg,
        entityBindings: [...leg.entityBindings, leg.entityBindings[0]!],
      })),
    };
    assert.equal(
      selectedJourneyFingerprint(duplicated),
      selectedJourneyFingerprint(duplicated),
    );
    const dependencies = extractJourneyDependencies(duplicated);
    assert.equal(dependencies.length, 3);
    assert.deepEqual(
      dependencies.map(
        (item) => `${item.legSequence}:${item.mobilityEntityId}`,
      ),
      [...dependencies]
        .map((item) => `${item.legSequence}:${item.mobilityEntityId}`)
        .sort(),
    );
  });

  it('rejects a selected journey whose operational entity bypasses the Twin identity bridge', () => {
    const selected = alternative('route-a', 'entity-a');
    const invalid: JourneyAlternative = {
      ...selected,
      legs: selected.legs.map((leg) => ({
        ...leg,
        entityBindings: leg.entityBindings.map((binding, index) =>
          index === 0 ? { ...binding, mobilityEntityId: null } : binding,
        ),
      })),
    };
    assert.throws(
      () => extractJourneyDependencies(invalid),
      /no state-bearing canonical identity/,
    );
  });
});

function plannerFixture(input: {
  attempts: readonly (readonly JourneyAlternative[])[];
  states: readonly EffectiveMobilityState[];
  extraBindings?: readonly string[];
}) {
  const calls: Array<{ excludedRouteIds: readonly string[] }> = [];
  const router: JourneyRoutingPort = {
    async planJourney(planRequest) {
      calls.push({ excludedRouteIds: planRequest.excludedRouteIds });
      return input.attempts[planRequest.attempt - 1] ?? [];
    },
    async routerHealth() {
      return {
        status: 'AVAILABLE',
        provider: 'OTP',
        version: '2.10.0',
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: 1,
      };
    },
    routingSnapshot() {
      return {
        snapshotId: 'router-v1',
        manifestSha256: 'a'.repeat(64),
        graphSha256: 'c'.repeat(64),
        commonServiceDate: '2026-10-02',
        timezone: 'Asia/Jakarta',
      };
    },
  };
  const identities: RoutingIdentityPort = {
    async resolveLegs(legs) {
      return legs.map((leg) => ({
        ...leg,
        entityBindings: [
          ...leg.entityBindings,
          ...(input.extraBindings ?? []).map((entityId) =>
            binding(`otp-${entityId}`, entityId, leg.mode),
          ),
        ],
      }));
    },
    async coverage() {
      return {};
    },
  };
  const stateById = new Map(
    input.states.map((item) => [item.mobilityEntityId, item]),
  );
  const mobilityState = {
    async getSnapshot() {
      return snapshot;
    },
    async getStates(ids: readonly string[]) {
      return ids.map(
        (id) => stateById.get(id) ?? state(id, 'UNKNOWN', 'UNKNOWN'),
      );
    },
  } as unknown as MobilityStatePort;
  return {
    planner: new JourneyPlannerService(router, identities, mobilityState),
    calls,
  };
}

function alternative(routeId: string, entityId: string): JourneyAlternative {
  const leg: JourneyLeg = {
    sequence: 0,
    mode: 'TRANSJAKARTA',
    otpMode: 'BUS',
    from: { name: 'A', otpStopId: 'otp-a' },
    to: { name: 'B', otpStopId: 'otp-b' },
    intermediateStops: [],
    startAt: '2026-10-02T08:00:00+07:00',
    endAt: '2026-10-02T08:10:00+07:00',
    durationSeconds: 600,
    distanceMeters: 1_000,
    routeId,
    routeShortName: 'R',
    tripId: 'trip',
    serviceDate: '2026-10-02',
    timingPrecision: 'SOURCE_GTFS_WITH_FREQUENCIES',
    entityBindings: [
      binding('otp-a', `${entityId}-from`, 'TRANSJAKARTA', 'STOP'),
      binding('otp-b', `${entityId}-to`, 'TRANSJAKARTA', 'STOP'),
      binding(routeId, entityId, 'TRANSJAKARTA', 'ROUTE'),
    ],
    operationalFlags: [],
  };
  return {
    journeyId: 'provider-id',
    origin: request.origin,
    destination: request.destination,
    startAt: leg.startAt,
    endAt: leg.endAt,
    durationSeconds: 600,
    transferCount: 0,
    walkingDistanceMeters: 0,
    legs: [leg],
    fareStatus: 'UNKNOWN',
    routingContext: {
      provider: 'OTP',
      providerVersion: '2.10.0',
      routingSnapshotId: 'router-v1',
      routingManifestSha256: 'a'.repeat(64),
      graphSha256: 'c'.repeat(64),
      networkSnapshotId: snapshot.snapshotId,
      networkSnapshotHash: 'pending',
      mobilityProjectionVersion: 'pending',
      plannedAt: '2026-10-02T01:00:00.000Z',
      commonServiceDate: '2026-10-02',
      timezone: 'Asia/Jakarta',
      attemptCount: 1,
      excludedRouteIds: [],
    },
  };
}

function binding(
  otpEntityId: string,
  entityId: string,
  productMode: JourneyLeg['mode'],
  entityType: 'STOP' | 'ROUTE' = 'STOP',
) {
  return {
    otpEntityId,
    productMode,
    entityType,
    canonicalEntityId: entityId,
    mobilityEntityId: entityId,
    resolutionMethod: 'EXACT_SOURCE_REFERENCE' as const,
    provenanceRef: 'fixture:SIMULATED',
  };
}

function state(
  entityId: string,
  operationalState: EffectiveMobilityState['operationalState'],
  freshnessStatus: EffectiveMobilityState['freshnessStatus'],
): EffectiveMobilityState {
  return {
    mobilityEntityId: entityId,
    operationalState,
    evidenceType: operationalState === 'UNKNOWN' ? null : 'SIMULATED',
    freshnessStatus,
    observationId: null,
    sourceId: null,
    observedAt: null,
    expiresAt: freshnessStatus === 'EXPIRED' ? '2026-10-01T00:00:00Z' : null,
    confidenceStatus: null,
    confidence: null,
    provenanceRef: 'fixture:SIMULATED',
    stateAsOf: '2026-10-02T00:00:00Z',
    projectionVersion: 'TEST',
    reason: 'SIMULATED test state',
  };
}

describe('Product routing portfolio V1', () => {
  it('queries distinct bounded search profiles and applies route exclusions to every profile', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{
      variables: {
        preferences: {
          street: { walk: { reluctance: number; boardCost: number } };
          transit: { transfer: { cost: number }; filters: unknown[] };
        };
        first: number;
      };
    }> = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          data: { planConnection: { edges: [], routingErrors: [] } },
        }),
        { status: 200 },
      );
    };
    try {
      await new OtpJourneyRoutingAdapter().planJourney({
        ...request,
        excludedRouteIds: ['tj:blocked-route'],
        attempt: 1,
      });
      assert.equal(calls.length, 5);
      assert.equal(
        new Set(calls.map((c) => JSON.stringify(c.variables.preferences))).size,
        5,
      );
      for (const call of calls) {
        assert.equal(call.variables.first, 12);
        assert.deepEqual(call.variables.preferences.transit.filters, [
          { exclude: [{ routes: ['tj:blocked-route'] }] },
        ]);
      }
      assert.ok(
        calls.some((c) => c.variables.preferences.street.walk.reluctance === 4),
      );
      assert.ok(
        calls.some(
          (c) => c.variables.preferences.transit.transfer.cost === 1200,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not claim a complete portfolio when one search profile fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify(
          body.variables.preferences.street.walk.reluctance === 4
            ? { errors: [{ message: 'SIMULATED profile failure' }] }
            : { data: { planConnection: { edges: [], routingErrors: [] } } },
        ),
        { status: 200 },
      );
    };
    try {
      await assert.rejects(
        new OtpJourneyRoutingAdapter().planJourney({
          ...request,
          excludedRouteIds: [],
          attempt: 1,
        }),
        (e: unknown) =>
          (e as JourneyRoutingError).code === 'ROUTER_UNAVAILABLE',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('collapses KRL service labels on the same station corridor without hiding another path', () => {
    const first = alternative('krl:depot', 'entity-a');
    const rail = {
      ...first,
      journeyId: 'rail-winner',
      legs: first.legs.map((leg) => ({ ...leg, mode: 'KRL' as const })),
    };
    const labelVariant = {
      ...rail,
      journeyId: 'rail-later-label',
      legs: rail.legs.map((leg) => ({
        ...leg,
        routeId: 'krl:bogor',
        routeShortName: 'Jakk-Boo',
      })),
    };
    const bus = { ...first, journeyId: 'bus-alternative' };
    assert.deepEqual(
      selectDecisionAlternatives([rail, labelVariant, bus], 3).map(
        (x) => x.journeyId,
      ),
      ['rail-winner', 'bus-alternative'],
    );
  });

  it('keeps the ranking winner and removes departure variants of the same transit combination', () => {
    const winner = {
      ...alternative('route-a', 'entity-a'),
      journeyId: 'winner',
    };
    const later = {
      ...winner,
      journeyId: 'same-combination-later',
      startAt: '2026-10-02T08:15:00+07:00',
    };
    const other = {
      ...alternative('route-b', 'entity-b'),
      journeyId: 'other-combination',
    };
    const boarding = {
      ...winner,
      journeyId: 'different-boarding-stop',
      legs: winner.legs.map((leg) => ({
        ...leg,
        from: { ...leg.from, otpStopId: 'otp-another-stop' },
      })),
    };
    assert.deepEqual(
      selectDecisionAlternatives([winner, later, other, boarding], 3).map(
        (x) => x.journeyId,
      ),
      ['winner', 'other-combination'],
    );
    assert.deepEqual(
      selectDecisionAlternatives([winner, later], 3).map((x) => x.journeyId),
      ['winner'],
    );
  });
});

describe('Walking-only public transport choice boundary', () => {
  it('does not let a slow walking-only journey win fewest transfers over available transit', () => {
    const transit = { ...alternative('route-a', 'entity-a'), transferCount: 1 };
    const walking = {
      ...transit,
      journeyId: 'only-walk',
      durationSeconds: 7200,
      transferCount: 0,
      legs: transit.legs.map((l) => ({
        ...l,
        mode: 'WALK' as const,
        routeId: null,
        routeShortName: null,
      })),
    };
    const eligible = eligibleJourneyAlternatives([walking, transit]);
    assert.deepEqual(eligible, [transit]);
    assert.equal(rankAlternatives(eligible, 'FEWEST_TRANSFERS')[0], transit);
    assert.deepEqual(
      eligibleJourneyAlternatives([walking]),
      [walking],
      'No transit: retain truthful walking fallback',
    );
    const short = { ...walking, durationSeconds: 300 };
    assert.deepEqual(
      eligibleJourneyAlternatives([short, transit]),
      [short, transit],
      'Retain competitive direct walk for a short trip',
    );
  });
});

describe('Concurrent preference-search lifecycle', () => {
  it('shares identical in-flight portfolios across preferences but does not retain completed results', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        JSON.stringify({
          data: { planConnection: { edges: [], routingErrors: [] } },
        }),
        { status: 200 },
      );
    };
    try {
      const adapter = new OtpJourneyRoutingAdapter();
      const base = { ...request, excludedRouteIds: [], attempt: 1 };
      await Promise.all([
        adapter.planJourney(base),
        adapter.planJourney({ ...base, preference: 'LEAST_WALKING' }),
      ]);
      assert.equal(
        calls,
        5,
        'Concurrent ranking changes duplicated network searches',
      );
      await adapter.planJourney(base);
      assert.equal(
        calls,
        10,
        'Completed cached results could hide a changed network/service outage',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
