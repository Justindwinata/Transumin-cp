import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { configureApplication } from '../application.js';
import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../mobility-twin/application/mobility-state.port.js';
import type { EffectiveMobilityState } from '../mobility-twin/domain/mobility-twin.js';
import {
  JOURNEY_ROUTING_PORT,
  type JourneyRoutingPort,
} from './application/journey-routing.port.js';
import { JourneyPlannerService } from './application/journey-planner.service.js';
import {
  fingerprintJourneyPlan,
  normalizeJourneyPlanForResearch,
} from './application/journey-research-fingerprint.js';
import {
  ROUTING_IDENTITY_PORT,
  type RoutingIdentityPort,
} from './application/routing-identity.port.js';
import type {
  CanonicalEntityBinding,
  JourneyLeg,
  JourneyPlanRequest,
} from './domain/journey.js';
import { JourneyRoutingError } from './domain/journey.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const evidencePath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-4B-B-JOURNEY-ACCEPTANCE-EVIDENCE.json',
);
const networkSnapshotId = '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f';

type MatrixCase = Readonly<{
  id: string;
  origin: JourneyPlanRequest['origin'];
  destination: JourneyPlanRequest['destination'];
  departureAt: string;
  requiredModes: readonly string[];
}>;

const matrix: readonly MatrixCase[] = [
  {
    id: 'KRL_WALK_MRT',
    origin: { latitude: -6.5942887, longitude: 106.7907695 },
    destination: { latitude: -6.2892744, longitude: 106.7749355 },
    departureAt: '2026-10-02T04:00:00+07:00',
    requiredModes: ['KRL', 'WALK', 'MRT_JAKARTA'],
  },
  {
    id: 'TRANSJAKARTA_WALK_MRT',
    origin: { latitude: -6.13679, longitude: 106.8149 },
    destination: { latitude: -6.2924511, longitude: 106.7924644 },
    departureAt: '2026-10-02T06:00:00+07:00',
    requiredModes: ['TRANSJAKARTA', 'WALK', 'MRT_JAKARTA'],
  },
  {
    id: 'MIKROTRANS_TRANSJAKARTA',
    origin: { latitude: -6.108205, longitude: 106.89982 },
    destination: { latitude: -6.205627, longitude: 106.822295 },
    departureAt: '2026-10-02T08:00:00+07:00',
    requiredModes: ['MIKROTRANS', 'TRANSJAKARTA'],
  },
  {
    id: 'LRT_JAKARTA_CROSS_MODE',
    origin: { latitude: -6.1574335, longitude: 106.9142078 },
    destination: { latitude: -6.2924511, longitude: 106.7924644 },
    departureAt: '2026-10-02T06:00:00+07:00',
    requiredModes: ['LRT_JAKARTA', 'WALK', 'MRT_JAKARTA'],
  },
  {
    id: 'LRT_JABODEBEK_CROSS_MODE',
    origin: { latitude: -6.3738926, longitude: 106.8956698 },
    destination: { latitude: -6.2924511, longitude: 106.7924644 },
    departureAt: '2026-10-02T06:00:00+07:00',
    requiredModes: ['LRT_JABODEBEK', 'WALK', 'MRT_JAKARTA'],
  },
];

async function run(): Promise<object> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    const address = app.getHttpServer().address() as { port: number };
    const apiBase = `http://127.0.0.1:${address.port}/api/v1`;
    const planner = app.get(JourneyPlannerService);
    const router = app.get<JourneyRoutingPort>(JOURNEY_ROUTING_PORT);
    const identities = app.get<RoutingIdentityPort>(ROUTING_IDENTITY_PORT);
    const mobility = app.get<MobilityStatePort>(MOBILITY_STATE_PORT);
    const results: Array<{
      caseId: string;
      status: 'PASS';
      od: object;
      departureAt: string;
      journeyId: string;
      modeSequence: string;
      transitServices: Array<{
        mode: string;
        routeId: string | null;
        timingPrecision: string;
        entityClasses: string[];
        allStateBearing: boolean;
      }>;
      walkingDistanceMeters: number;
      identityBindings: number;
      httpMilliseconds: number;
      apiPlanning: object | undefined;
    }> = [];
    let alternativesEvidence: object | null = null;

    for (const item of matrix) {
      const started = performance.now();
      const response = await fetch(`${apiBase}/journeys/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toApiRequest(item)),
      });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok) {
        try {
          await planner.plan(toDomainRequest(item));
        } catch (cause) {
          throw new Error(
            `${item.id}: HTTP ${response.status} ${JSON.stringify(body)}; cause=${cause instanceof Error ? cause.stack : String(cause)}`,
            { cause },
          );
        }
        throw new Error(
          `${item.id}: HTTP ${response.status} ${JSON.stringify(body)}`,
        );
      }
      const alternatives = body.data ?? [];
      const accepted = alternatives.find((alternative) =>
        item.requiredModes.every((mode) =>
          alternative.segments.some((segment) => segment.mode === mode),
        ),
      );
      if (accepted === undefined)
        throw new Error(
          `${item.id}: required modes absent; got ${alternatives
            .map((alternative) => modeSequence(alternative))
            .join(' | ')}`,
        );
      assertAcceptedJourney(item, accepted);
      if (alternatives.length > 1 && alternativesEvidence === null) {
        const fingerprints = alternatives.map(materialFingerprint);
        if (new Set(fingerprints).size > 1)
          alternativesEvidence = {
            caseId: item.id,
            count: alternatives.length,
            fingerprints,
            distinction: alternatives.map((alternative) => ({
              modeSequence: modeSequence(alternative),
              durationSeconds: alternative.duration_seconds,
              transferCount: alternative.transfer_count,
              walkingDistanceMeters: alternative.walking_distance_meters,
            })),
          };
      }
      results.push({
        caseId: item.id,
        status: 'PASS',
        od: { origin: item.origin, destination: item.destination },
        departureAt: item.departureAt,
        journeyId: accepted.journey_id,
        modeSequence: modeSequence(accepted),
        transitServices: accepted.segments
          .filter((segment) => segment.mode !== 'WALK')
          .map((segment) => ({
            mode: segment.mode,
            routeId: segment.route_id,
            timingPrecision: segment.timing_precision,
            entityClasses: [
              ...new Set(
                segment.entity_bindings.map((binding) => binding.entity_type),
              ),
            ].sort(),
            allStateBearing: segment.entity_bindings.every(
              (binding) => binding.mobility_entity_id !== null,
            ),
          })),
        walkingDistanceMeters: accepted.walking_distance_meters,
        identityBindings: accepted.segments.flatMap(
          (segment) => segment.entity_bindings,
        ).length,
        httpMilliseconds: round(performance.now() - started),
        apiPlanning: body.meta?.planning,
      });
    }

    if (alternativesEvidence === null)
      throw new Error('No materially distinct Journey API alternatives found.');

    const directRequest = toDomainRequest(matrix[2] as MatrixCase);
    const snapshot = await mobility.getSnapshot(networkSnapshotId);
    const firstRouterCandidate = (
      await router.planJourney({
        ...directRequest,
        attempt: 1,
        excludedRouteIds: [],
      })
    )[0];
    if (firstRouterCandidate === undefined)
      throw new Error(
        'Router returned no candidate for controlled blocking case.',
      );
    const firstResolvedLegs = await identities.resolveLegs(
      firstRouterCandidate.legs,
      snapshot,
    );
    const boundedRouter = firstCandidateOnInitialAttempt(router);
    const routeBlocking = await proveBlockedAlternate(
      'ROUTE',
      firstResolvedLegs,
      boundedRouter,
      identities,
      mobility,
      directRequest,
    );
    const nonRouteBlocking = await proveBlockedAlternate(
      'STATION',
      firstResolvedLegs,
      boundedRouter,
      identities,
      mobility,
      directRequest,
    );

    const noRoutePlanner = controlledPlanner(router, identities, mobility, {
      kind: 'ALL',
      entityIds: [],
      state: 'UNAVAILABLE',
      freshness: 'FRESH',
    });
    let noRoute: { code: string; milliseconds: number } | null = null;
    const noRouteStarted = performance.now();
    try {
      await noRoutePlanner.plan(directRequest);
    } catch (error) {
      if (
        error instanceof JourneyRoutingError &&
        error.code === 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'
      )
        noRoute = {
          code: error.code,
          milliseconds: round(performance.now() - noRouteStarted),
        };
      else throw error;
    }
    if (noRoute === null)
      throw new Error('All-blocked scenario did not return typed no-route.');

    const unknown = await controlledPlanner(router, identities, mobility, {
      kind: 'ALL',
      entityIds: [],
      state: 'UNKNOWN',
      freshness: 'UNKNOWN',
    }).plan(directRequest);
    const expired = await controlledPlanner(router, identities, mobility, {
      kind: 'ALL',
      entityIds: [],
      state: 'UNAVAILABLE',
      freshness: 'EXPIRED',
    }).plan(directRequest);
    if (unknown.alternatives.length === 0 || expired.alternatives.length === 0)
      throw new Error(
        'UNKNOWN or EXPIRED evidence incorrectly blocked routing.',
      );

    const fullReplanStarted = performance.now();
    const fullReplans = [];
    for (let runNumber = 0; runNumber < 3; runNumber += 1)
      fullReplans.push(await planner.fullReplan(directRequest));
    const fullReplanMilliseconds = performance.now() - fullReplanStarted;
    const normalizedReplans = fullReplans.map(normalizeJourneyPlanForResearch);
    const fingerprints = fullReplans.map(fingerprintJourneyPlan);
    const normalizedPayloads = normalizedReplans.map((item) =>
      JSON.stringify(item),
    );
    if (
      new Set(fingerprints).size !== 1 ||
      new Set(normalizedPayloads).size !== 1
    )
      throw new Error(
        'FULL REPLAN normalized planning content is not deterministic.',
      );
    const alternativeOrderings = normalizedReplans.map((item) =>
      item.alternatives.map(stableHash),
    );
    const metrics = fullReplans.map((item) =>
      item.alternatives.map((alternative) => ({
        durationSeconds: alternative.durationSeconds,
        transferCount: alternative.transferCount,
        walkingDistanceMeters: alternative.walkingDistanceMeters,
        startAt: alternative.startAt,
        endAt: alternative.endAt,
      })),
    );
    if (
      new Set(alternativeOrderings.map((item) => JSON.stringify(item))).size !==
        1 ||
      new Set(metrics.map((item) => JSON.stringify(item))).size !== 1
    )
      throw new Error('FULL REPLAN alternative ordering or metrics changed.');

    const modeCoverage = new Set(
      results.flatMap((item) =>
        item.transitServices.map((service) => service.mode),
      ),
    );
    for (const mode of [
      'TRANSJAKARTA',
      'MIKROTRANS',
      'KRL',
      'MRT_JAKARTA',
      'LRT_JAKARTA',
      'LRT_JABODEBEK',
    ])
      if (!modeCoverage.has(mode))
        throw new Error(`Identity coverage missing ${mode}`);

    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      evidenceSemantics:
        'REAL_OTP_AND_CANONICAL_DATA_WITH_EXPLICIT_SIMULATED_STATE_SCENARIOS',
      environment: {
        otp: await router.routerHealth(),
        routingSnapshot: router.routingSnapshot(),
        networkSnapshotId,
        timezone: 'Asia/Jakarta',
        representativeServiceDate: '2026-10-02',
      },
      realHttpJourneyApiMatrix: results,
      identityBridge: {
        invariant:
          'OTP source entity -> canonical transit entity -> twin.mobility_entity',
        modeCoverage: Object.fromEntries(
          [...modeCoverage].sort().map((mode) => [
            mode,
            results
              .flatMap((item) => item.transitServices)
              .filter((service) => service.mode === mode)
              .map((service) => ({
                entityClasses: service.entityClasses,
                allStateBearing: service.allStateBearing,
              }))[0],
          ]),
        ),
        unmappedBehavior: 'IDENTITY_UNRESOLVED',
      },
      alternatives: alternativesEvidence,
      controlledOperationalState: {
        evidenceType: 'SIMULATED',
        routeBlocking,
        nonRouteBlocking,
        noRoute,
        unknownNonBlocking: unknown.alternatives.length > 0,
        expiredUnavailableNonBlocking: expired.alternatives.length > 0,
        baseStateMutated: false,
      },
      fullReplan: {
        strategy: fullReplans[0]?.strategy,
        runCount: fullReplans.length,
        normalizedFingerprint: fingerprints[0],
        fingerprints,
        normalizedPayloadEquality: true,
        alternativeOrderingEquality: true,
        alternativeOrderings: alternativeOrderings[0],
        metricEquality: true,
        metrics: metrics[0],
        excludedNondeterministicFields: [
          'journeyId',
          'plannedAt',
          'requestId',
          'runtime timings',
        ],
        totalMilliseconds: round(fullReplanMilliseconds),
      },
      phase5Started: false,
      status: 'PASS',
    };
  } finally {
    await app.close();
  }
}

type ApiAlternative = Readonly<{
  journey_id: string;
  duration_seconds: number;
  transfer_count: number;
  walking_distance_meters: number;
  fare_status: string;
  segments: readonly Readonly<{
    mode: string;
    route_id: string | null;
    timing_precision: string;
    distance_meters: number;
    entity_bindings: readonly Readonly<{
      canonical_entity_id: string;
      mobility_entity_id: string | null;
      entity_type: string;
    }>[];
  }>[];
}>;
type ApiResponse = Readonly<{
  data?: readonly ApiAlternative[];
  meta?: { planning?: object };
  error?: object;
}>;

function toApiRequest(item: MatrixCase) {
  return {
    origin: item.origin,
    destination: item.destination,
    departure_at: item.departureAt,
    network_snapshot_id: networkSnapshotId,
    preference: 'BALANCED',
  };
}

function toDomainRequest(item: MatrixCase): JourneyPlanRequest {
  return {
    origin: item.origin,
    destination: item.destination,
    departureAt: item.departureAt,
    networkSnapshotId,
    preference: 'BALANCED',
    maximumAlternatives: 3,
  };
}

function assertAcceptedJourney(
  item: MatrixCase,
  journey: ApiAlternative,
): void {
  if (journey.fare_status !== 'UNKNOWN')
    throw new Error(`${item.id}: fare fabricated`);
  if (journey.walking_distance_meters <= 0)
    throw new Error(`${item.id}: walking path has no routed distance`);
  for (const segment of journey.segments) {
    if (segment.mode !== 'WALK' && segment.entity_bindings.length === 0)
      throw new Error(
        `${item.id}: unmapped operationally relevant transit leg`,
      );
    if (
      segment.mode !== 'WALK' &&
      segment.entity_bindings.some(
        (binding) => binding.mobility_entity_id === null,
      )
    )
      throw new Error(`${item.id}: canonical identity has no Twin binding`);
    if (
      ['MRT_JAKARTA', 'LRT_JAKARTA', 'LRT_JABODEBEK'].includes(segment.mode) &&
      segment.timing_precision === 'EXACT_SCHEDULE'
    )
      throw new Error(
        `${item.id}: frequency-derived service overstated as exact`,
      );
  }
}

function modeSequence(journey: ApiAlternative): string {
  return journey.segments.map((segment) => segment.mode).join('>');
}

function materialFingerprint(journey: ApiAlternative): string {
  return JSON.stringify({
    modes: modeSequence(journey),
    routes: journey.segments.map((segment) => segment.route_id),
    duration: journey.duration_seconds,
    transfers: journey.transfer_count,
    walking: Math.round(journey.walking_distance_meters),
  });
}

async function proveBlockedAlternate(
  entityType: 'ROUTE' | 'STATION',
  firstResolvedLegs: readonly JourneyLeg[],
  router: JourneyRoutingPort,
  identities: RoutingIdentityPort,
  mobility: MobilityStatePort,
  request: JourneyPlanRequest,
): Promise<object> {
  const candidates = [
    ...new Map(
      firstResolvedLegs
        .flatMap((leg) => leg.entityBindings)
        .filter(
          (
            binding,
          ): binding is CanonicalEntityBinding & {
            mobilityEntityId: string;
          } =>
            binding.entityType === entityType &&
            binding.mobilityEntityId !== null,
        )
        .map((binding) => [binding.mobilityEntityId, binding]),
    ).values(),
  ].sort((left, right) => left.otpEntityId.localeCompare(right.otpEntityId));
  for (const binding of candidates) {
    const started = performance.now();
    try {
      const result = await controlledPlanner(router, identities, mobility, {
        kind: 'TARGET',
        entityIds: [binding.mobilityEntityId],
        state: 'UNAVAILABLE',
        freshness: 'FRESH',
      }).plan(request);
      const acceptedAttempt = Math.max(
        ...result.alternatives.map((item) => item.routingContext.attemptCount),
      );
      const leaked = result.alternatives.some((alternative) =>
        alternative.legs.some((leg) =>
          leg.entityBindings.some(
            (candidateBinding) =>
              candidateBinding.mobilityEntityId === binding.mobilityEntityId,
          ),
        ),
      );
      if (result.rejectedCandidateCount > 0 && acceptedAttempt === 2 && !leaked)
        return {
          entityType,
          blockedEntityId: binding.mobilityEntityId,
          blockedOtpEntityId: binding.otpEntityId,
          canonicalEntityId: binding.canonicalEntityId,
          provenanceRef: binding.provenanceRef,
          rejectedCandidateCount: result.rejectedCandidateCount,
          acceptedAttempt,
          alternateExcludesBlockedEntity: true,
          acceptedModeSequences: result.alternatives.map((item) =>
            item.legs.map((leg) => leg.mode).join('>'),
          ),
          milliseconds: round(performance.now() - started),
        };
    } catch (error) {
      if (
        !(error instanceof JourneyRoutingError) ||
        error.code !== 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'
      )
        throw error;
    }
  }
  throw new Error(
    `No ${entityType} candidate produced a valid bounded alternate without the blocked canonical entity.`,
  );
}

function stableHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

type ControlledRule = Readonly<{
  kind: 'ALL' | 'TARGET';
  entityIds: readonly string[];
  state: EffectiveMobilityState['operationalState'];
  freshness: EffectiveMobilityState['freshnessStatus'];
}>;

function firstCandidateOnInitialAttempt(
  base: JourneyRoutingPort,
): JourneyRoutingPort {
  return {
    async planJourney(request) {
      const candidates = await base.planJourney(request);
      return request.attempt === 1 ? candidates.slice(0, 1) : candidates;
    },
    routerHealth: () => base.routerHealth(),
    routingSnapshot: () => base.routingSnapshot(),
  };
}

function controlledPlanner(
  router: JourneyRoutingPort,
  identities: RoutingIdentityPort,
  base: MobilityStatePort,
  rule: ControlledRule,
): JourneyPlannerService {
  const controlled = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'getStates')
        return async (entityIds: readonly string[]) => {
          const actual = await target.getStates(entityIds);
          const actualById = new Map(
            actual.map((state) => [state.mobilityEntityId, state]),
          );
          return entityIds.map((entityId) =>
            rule.kind === 'ALL' || rule.entityIds.includes(entityId)
              ? controlledState(entityId, rule)
              : (actualById.get(entityId) ??
                controlledState(entityId, {
                  kind: 'TARGET',
                  entityIds: [],
                  state: 'UNKNOWN',
                  freshness: 'UNKNOWN',
                })),
          );
        };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as MobilityStatePort;
  return new JourneyPlannerService(router, identities, controlled);
}

function controlledState(
  entityId: string,
  rule: ControlledRule,
): EffectiveMobilityState {
  return {
    mobilityEntityId: entityId,
    operationalState: rule.state,
    evidenceType: 'SIMULATED',
    freshnessStatus: rule.freshness,
    observationId: `simulated:${entityId}`,
    sourceId: 'phase-4b-b-controlled-acceptance',
    observedAt: '2026-10-02T00:00:00.000Z',
    expiresAt:
      rule.freshness === 'EXPIRED'
        ? '2026-10-02T00:01:00.000Z'
        : '2026-10-03T00:00:00.000Z',
    confidenceStatus: 'CONFIRMED',
    confidence: 1,
    provenanceRef:
      'data/manifests/PHASE-4B-B-JOURNEY-ACCEPTANCE-EVIDENCE.json#controlled-scenario',
    stateAsOf: '2026-10-02T01:00:00.000Z',
    projectionVersion: 'phase-4b-b-controlled-v1',
    reason: 'Controlled acceptance evidence; never represented as LIVE.',
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

const command = process.argv[2] ?? 'verify';
try {
  const evidence = await run();
  if (command === 'record')
    await writeFile(
      evidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
}
