import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Inject, Injectable } from '@nestjs/common';

import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../../mobility-twin/application/mobility-state.port.js';
import type { EffectiveMobilityState } from '../../mobility-twin/domain/mobility-twin.js';
import {
  type JourneyAlternative,
  type JourneyCandidateRejection,
  type JourneyLeg,
  type JourneyPlanRequest,
  type JourneyPlanResult,
  JourneyRoutingError,
} from '../domain/journey.js';
import {
  JOURNEY_ROUTING_PORT,
  type JourneyRoutingPort,
} from './journey-routing.port.js';
import {
  ROUTING_IDENTITY_PORT,
  type RoutingIdentityPort,
} from './routing-identity.port.js';

const MAX_ROUTER_ATTEMPTS = 2;

@Injectable()
export class JourneyPlannerService {
  constructor(
    @Inject(JOURNEY_ROUTING_PORT)
    private readonly router: JourneyRoutingPort,
    @Inject(ROUTING_IDENTITY_PORT)
    private readonly identities: RoutingIdentityPort,
    @Inject(MOBILITY_STATE_PORT)
    private readonly mobilityState: MobilityStatePort,
  ) {}

  async plan(request: JourneyPlanRequest): Promise<JourneyPlanResult> {
    return this.execute(request, 'INITIAL_PLAN');
  }

  async fullReplan(request: JourneyPlanRequest): Promise<JourneyPlanResult> {
    return this.execute(request, 'FULL_REPLAN');
  }

  async health() {
    return this.router.routerHealth();
  }

  async validateOperationalState(legs: readonly JourneyLeg[]): Promise<{
    blockedEntityIds: readonly string[];
    stateByEntity: ReadonlyMap<string, EffectiveMobilityState>;
  }> {
    assertCanonicalStateBindings(legs);
    return this.validateState(legs);
  }

  private async execute(
    request: JourneyPlanRequest,
    strategy: JourneyPlanResult['strategy'],
  ): Promise<JourneyPlanResult> {
    const totalStarted = performance.now();
    const snapshot = await this.mobilityState.getSnapshot(
      request.networkSnapshotId,
    );
    if (snapshot.status !== 'FINALIZED')
      throw new JourneyRoutingError(
        'DATASET_NOT_READY',
        'Network snapshot is not finalized.',
      );

    const excludedRoutes = new Set<string>();
    const accepted: JourneyAlternative[] = [];
    const acceptedFingerprints = new Set<string>();
    let rejectedCandidateCount = 0;
    const candidateRejections: JourneyCandidateRejection[] = [];
    let stateValidationMilliseconds = 0;
    let routingMilliseconds = 0;

    for (let attempt = 1; attempt <= MAX_ROUTER_ATTEMPTS; attempt += 1) {
      const routingStarted = performance.now();
      const candidates = await this.router.planJourney({
        ...request,
        excludedRouteIds: [...excludedRoutes].sort(),
        attempt,
      });
      routingMilliseconds += performance.now() - routingStarted;
      if (candidates.length === 0 && attempt === 1)
        throw new JourneyRoutingError(
          'NO_ROUTE',
          'Router returned no journey.',
        );

      for (const candidate of candidates) {
        const identityResolvedLegs = await this.identities.resolveLegs(
          candidate.legs,
          snapshot,
        );
        assertCanonicalStateBindings(identityResolvedLegs);
        const validationStarted = performance.now();
        const validation = await this.validateState(identityResolvedLegs);
        stateValidationMilliseconds += performance.now() - validationStarted;
        if (validation.blockedEntityIds.length > 0) {
          rejectedCandidateCount += 1;
          candidateRejections.push({
            attempt,
            routeIds: identityResolvedLegs
              .map((leg) => leg.routeId)
              .filter((value): value is string => value !== null)
              .sort(),
            blockedEntityIds: [...validation.blockedEntityIds].sort(),
            reason: 'CURRENT_UNAVAILABLE_CANONICAL_ENTITY',
          });
          for (const routeId of identityResolvedLegs
            .filter((leg) =>
              leg.entityBindings.some(
                (binding) =>
                  binding.mobilityEntityId !== null &&
                  validation.blockedEntityIds.includes(
                    binding.mobilityEntityId,
                  ),
              ),
            )
            .map((leg) => leg.routeId)
            .filter((value): value is string => value !== null))
            excludedRoutes.add(routeId);
          continue;
        }

        const legs = identityResolvedLegs.map((leg) => ({
          ...leg,
          operationalFlags: leg.entityBindings
            .map((binding) =>
              binding.mobilityEntityId === null
                ? undefined
                : validation.stateByEntity.get(binding.mobilityEntityId),
            )
            .filter(
              (state): state is EffectiveMobilityState =>
                state !== undefined &&
                (state.operationalState === 'DEGRADED' ||
                  state.operationalState === 'DISRUPTED'),
            )
            .map((state) => ({
              mobilityEntityId: state.mobilityEntityId,
              operationalState: state.operationalState as
                'DEGRADED' | 'DISRUPTED',
              evidenceType: state.evidenceType,
              freshnessStatus: state.freshnessStatus,
              provenanceRef: state.provenanceRef,
            })),
        }));
        const fingerprint = meaningfulFingerprint(legs);
        if (acceptedFingerprints.has(fingerprint)) continue;
        acceptedFingerprints.add(fingerprint);
        accepted.push({
          ...candidate,
          journeyId: deterministicJourneyId(request, legs, strategy),
          legs,
          routingContext: {
            ...candidate.routingContext,
            networkSnapshotId: snapshot.snapshotId,
            networkSnapshotHash: snapshot.contentHash,
            mobilityProjectionVersion: snapshot.processingVersion,
            attemptCount: attempt,
            excludedRouteIds: [...excludedRoutes].sort(),
          },
        });
      }

      // A walk-only fallback must not prevent the bounded outage retry from
      // finding transit after excluding the actually affected service.
      const hasTransit = accepted.some((candidate) =>
        candidate.legs.some((leg) => leg.mode !== 'WALK'),
      );
      if (
        accepted.length >= (request.maximumAlternatives ?? 3) &&
        (hasTransit || excludedRoutes.size === 0)
      )
        break;
      if (excludedRoutes.size === 0) break;
    }

    if (accepted.length === 0)
      throw new JourneyRoutingError(
        'NO_VALID_ROUTE_AFTER_STATE_VALIDATION',
        'Every routed candidate is blocked by current authoritative state.',
        {
          rejectedCandidateCount,
          candidateRejections,
          excludedRouteIds: [...excludedRoutes].sort(),
          maximumAttempts: MAX_ROUTER_ATTEMPTS,
        },
      );

    return {
      alternatives: selectDecisionAlternatives(
        rankAlternatives(
          eligibleJourneyAlternatives(accepted),
          request.preference,
        ),
        request.maximumAlternatives ?? 3,
      ),
      rejectedCandidateCount,
      candidateRejections,
      stateValidationMilliseconds: round(stateValidationMilliseconds),
      routingMilliseconds: round(routingMilliseconds),
      totalMilliseconds: round(performance.now() - totalStarted),
      strategy,
    };
  }

  private async validateState(legs: readonly JourneyLeg[]): Promise<{
    blockedEntityIds: readonly string[];
    stateByEntity: ReadonlyMap<string, EffectiveMobilityState>;
  }> {
    const entityIds = [
      ...new Set(
        legs.flatMap((leg) =>
          leg.entityBindings.flatMap((binding) =>
            binding.mobilityEntityId === null ? [] : [binding.mobilityEntityId],
          ),
        ),
      ),
    ].sort();
    const states = await this.mobilityState.getStates(entityIds);
    const stateByEntity = new Map(
      states.map((state) => [state.mobilityEntityId, state]),
    );
    return {
      blockedEntityIds: states
        .filter(
          (state) =>
            state.operationalState === 'UNAVAILABLE' &&
            state.freshnessStatus !== 'EXPIRED' &&
            state.freshnessStatus !== 'NOT_YET_VALID',
        )
        .map((state) => state.mobilityEntityId)
        .sort(),
      stateByEntity,
    };
  }
}

export function assertCanonicalStateBindings(
  legs: readonly JourneyLeg[],
): void {
  for (const leg of legs) {
    if (leg.mode === 'WALK') continue;
    const expectedOtpIds = [
      ...(leg.from.otpStopId === null ? [] : [leg.from.otpStopId]),
      ...leg.intermediateStops.map((stop) => stop.otpStopId),
      ...(leg.to.otpStopId === null ? [] : [leg.to.otpStopId]),
      ...(leg.routeId === null ? [] : [leg.routeId]),
    ];
    const byOtpId = new Map(
      leg.entityBindings.map((binding) => [binding.otpEntityId, binding]),
    );
    for (const otpEntityId of expectedOtpIds) {
      const binding = byOtpId.get(otpEntityId);
      if (binding === undefined || binding.mobilityEntityId === null)
        throw new JourneyRoutingError(
          'IDENTITY_UNRESOLVED',
          `Router entity ${otpEntityId} has no canonical state-bearing identity.`,
          { otpEntityId, productMode: leg.mode },
        );
    }
  }
}

function meaningfulFingerprint(legs: readonly JourneyLeg[]): string {
  return JSON.stringify(
    legs.map((leg) => ({
      mode: leg.mode,
      routeId: leg.routeId,
      from: leg.from.otpStopId ?? leg.from.name,
      to: leg.to.otpStopId ?? leg.to.name,
    })),
  );
}

function deterministicJourneyId(
  request: JourneyPlanRequest,
  legs: readonly JourneyLeg[],
  strategy: JourneyPlanResult['strategy'],
): string {
  const bytes = createHash('sha256')
    .update(
      JSON.stringify({
        origin: request.origin,
        destination: request.destination,
        departureAt: request.departureAt,
        networkSnapshotId: request.networkSnapshotId,
        strategy,
        legs: meaningfulFingerprint(legs),
      }),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function rankAlternatives(
  alternatives: readonly JourneyAlternative[],
  preference: JourneyPlanRequest['preference'],
): JourneyAlternative[] {
  if (alternatives.length === 0) return [];
  // Normalize across the full accepted set, before limiting returned alternatives.
  const normalizeDuration = minMax(
    alternatives.map((item) => item.durationSeconds),
  );
  const normalizeWalking = minMax(
    alternatives.map((item) => item.walkingDistanceMeters),
  );
  const normalizeTransfers = minMax(
    alternatives.map((item) => item.transferCount),
  );
  return alternatives
    .map((alternative) => ({
      alternative,
      score:
        preference === 'BALANCED'
          ? 0.5 * normalizeDuration(alternative.durationSeconds) +
            0.3 * normalizeWalking(alternative.walkingDistanceMeters) +
            0.2 * normalizeTransfers(alternative.transferCount)
          : preference === 'FASTEST'
            ? alternative.durationSeconds
            : preference === 'LEAST_WALKING'
              ? alternative.walkingDistanceMeters
              : alternative.transferCount,
    }))
    .sort((left, right) => {
      // Ascending ties: score, duration, walking, transfers, then journeyId.
      const a = left.alternative;
      const b = right.alternative;
      return (
        left.score - right.score ||
        a.durationSeconds - b.durationSeconds ||
        a.walkingDistanceMeters - b.walkingDistanceMeters ||
        a.transferCount - b.transferCount ||
        (a.journeyId < b.journeyId ? -1 : a.journeyId > b.journeyId ? 1 : 0)
      );
    })
    .map(({ alternative }) => alternative);
}

function minMax(values: readonly number[]): (value: number) => number {
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  return (value) => (range === 0 ? 0 : (value - min) / range);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

/** Keep the ranking winner, then offer different transit/boarding combinations.
 * Departure variants of the same combination are not separate decisions.
 * No route is invented to fill the requested number of alternatives.
 */
export function selectDecisionAlternatives(
  ranked: readonly JourneyAlternative[],
  limit: number,
): JourneyAlternative[] {
  const seen = new Set<string>();
  const result: JourneyAlternative[] = [];
  for (const candidate of ranked) {
    const signature = JSON.stringify(
      candidate.legs
        .filter((leg) => leg.mode !== 'WALK')
        .map((leg) => ({
          mode: leg.mode,
          // Rail service labels can differ while the passenger rides the same
          // station-to-station corridor. Keep the metric winner of that path.
          route: leg.mode === 'KRL' ? null : leg.routeId,
          corridor:
            leg.mode === 'KRL'
              ? leg.intermediateStops.map((stop) => stop.otpStopId)
              : null,
          from:
            leg.mode === 'KRL' ? (leg.from.otpStopId ?? leg.from.name) : null,
          to: leg.mode === 'KRL' ? (leg.to.otpStopId ?? leg.to.name) : null,
        })),
    );
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

/** Public-transport choice policy: an all-walk option is useful when faster
 * than transit, or as the only available fallback. A slower all-walk journey
 * must not win FEWEST_TRANSFERS merely because it contains zero vehicles.
 */
export function eligibleJourneyAlternatives(
  candidates: readonly JourneyAlternative[],
): JourneyAlternative[] {
  const transit = candidates.filter((c) =>
    c.legs.some((leg) => leg.mode !== 'WALK'),
  );
  if (!transit.length) return [...candidates];
  const fastestTransit = Math.min(...transit.map((c) => c.durationSeconds));
  return candidates.filter(
    (c) =>
      c.legs.some((leg) => leg.mode !== 'WALK') ||
      c.durationSeconds <= fastestTransit,
  );
}
