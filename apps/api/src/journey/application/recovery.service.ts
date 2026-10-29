import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Inject, Injectable } from '@nestjs/common';

import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import {
  ActiveJourneyService,
  selectedJourneyFingerprint,
} from './active-journey.service.js';
import { JourneyPlannerService } from './journey-planner.service.js';
import { fingerprintJourneyPlan } from './journey-research-fingerprint.js';
import {
  planChangeCount,
  preservedFutureLegCount,
} from './recovery-research-metrics.js';
import {
  RECOVERY_REPOSITORY,
  type RecoveryRepositoryPort,
} from './recovery.repository.port.js';
import type { ActiveJourney } from '../domain/active-journey.js';
import type {
  GeoPoint,
  JourneyAlternative,
  JourneyLeg,
  JourneyPlanRequest,
  JourneyPlanResult,
} from '../domain/journey.js';
import { JourneyRoutingError } from '../domain/journey.js';
import type {
  RecoveryAcceptance,
  RecoveryProposal,
} from '../domain/recovery.js';
import { RecoveryError } from '../domain/recovery.js';

@Injectable()
export class RecoveryService {
  constructor(
    @Inject(ActiveJourneyService)
    private readonly journeys: ActiveJourneyService,
    @Inject(JourneyPlannerService)
    private readonly planner: JourneyPlannerService,
    @Inject(RECOVERY_REPOSITORY)
    private readonly repository: RecoveryRepositoryPort,
  ) {}

  async create(input: {
    activeJourneyId: string;
    impactId: string;
    ownerRef: string;
    idempotencyKey: string;
    recoveryAt: string;
  }): Promise<RecoveryProposal> {
    const totalStarted = performance.now();
    const existing = await this.repository.findByIdempotency(
      input.ownerRef,
      input.idempotencyKey,
    );
    if (existing !== null) {
      // Receipt replay precedes current-state gates: an accepted/completed
      // request stays replayable after later progress or impact changes.
      // Same-key divergent payload (incl. progressed state revision) conflicts
      // with the recorded receipt rather than inventing a second plan row.
      if (
        existing.activeJourneyId !== input.activeJourneyId ||
        existing.impactId !== input.impactId ||
        !sameRecoveryInstant(existing.recoveryAt, input.recoveryAt)
      )
        throw new RecoveryError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key belongs to different recovery input.',
        );
      return existing;
    }
    const journey = await this.journeys.get(
      input.activeJourneyId,
      input.ownerRef,
    );
    // Capture generation before any OTP/state-validation work. Never re-read the
    // pointer when saving: this token is the proposal's source generation.
    const baseRecoveryId = journey.acceptedRecoveryId ?? null;
    const currentPlan = journey.currentPlan ?? journey.originalPlan;
    const impact = await this.repository.getCurrentImpact(
      input.impactId,
      input.activeJourneyId,
      input.ownerRef,
    );
    if (impact === null)
      throw new RecoveryError(
        'IMPACT_NOT_CURRENT',
        'Recovery requires an unresolved impact on a currently relevant journey dependency.',
      );
    if (!sameRecoveryInstant(input.recoveryAt, journey.progress.recordedAt))
      throw new RecoveryError(
        'INVALID_RECOVERY_ANCHOR',
        'Recovery time must equal the timestamp of the persisted progress revision.',
      );
    const currentJourney: ActiveJourney = {
      ...journey,
      originalPlan: currentPlan,
    };
    const anchor = recoveryAnchor(currentJourney);
    const remaining = currentPlan.legs.slice(
      journey.progress.completedLegCount,
    );
    const invalidIndex = remaining.findIndex((leg) =>
      leg.entityBindings.some(
        (binding) => binding.mobilityEntityId === impact.mobilityEntityId,
      ),
    );
    if (invalidIndex < 0)
      throw new RecoveryError(
        'IMPACT_NOT_CURRENT',
        'The triggering entity is not required by the remaining journey.',
      );

    const preservationStarted = performance.now();
    const completedLegs = currentPlan.legs.slice(
      0,
      journey.progress.completedLegCount,
    );
    const preservedLegs = remaining.slice(0, invalidIndex);
    let invalidatedLegs = remaining.slice(invalidIndex);
    const prefixValidationStarted = performance.now();
    const preservedValidation =
      await this.planner.validateOperationalState(preservedLegs);
    let proposedValidationMilliseconds =
      performance.now() - prefixValidationStarted;
    if (preservedValidation.blockedEntityIds.length > 0)
      throw new RecoveryError(
        'IMPACT_NOT_CURRENT',
        'An earlier remaining dependency is blocked; recovery must start from the earliest current impact.',
      );
    const repairEndpoint = preservedLegs.at(-1)?.to ?? anchor.endpoint;
    const repairAnchor = point(repairEndpoint, 'repair boundary');
    const recoveryRequest = requestFrom(
      repairAnchor,
      currentPlan.destination,
      preservedLegs.at(-1)?.endAt ?? input.recoveryAt,
      currentPlan,
    );
    const baselineRequest = requestFrom(
      anchor.point,
      currentPlan.destination,
      input.recoveryAt,
      currentPlan,
    );
    const preservationProcessingMilliseconds =
      performance.now() - preservationStarted;

    const baselineStarted = performance.now();
    const baselineResult = await planOrNull(this.planner, baselineRequest);
    const baselineRoutingMilliseconds = performance.now() - baselineStarted;
    const proposedStarted = performance.now();
    let repairResult: JourneyPlanResult | null = null;
    let rejoinedLegs: readonly JourneyLeg[] = [];
    let rejoinReason = 'NO_VALID_FUTURE_REJOIN';
    let proposedRouterMilliseconds = 0;
    // The earliest feasible suffix preserves the most original future structure.
    // Each attempt is bounded by the number of original remaining legs.
    for (
      let suffixIndex = invalidIndex + 1;
      suffixIndex < remaining.length;
      suffixIndex += 1
    ) {
      const suffix = remaining.slice(suffixIndex);
      const suffixValidationStarted = performance.now();
      const suffixState = await this.planner.validateOperationalState(suffix);
      proposedValidationMilliseconds +=
        performance.now() - suffixValidationStarted;
      if (suffixState.blockedEntityIds.length > 0) {
        rejoinReason = 'FUTURE_SUFFIX_OPERATIONALLY_BLOCKED';
        continue;
      }
      const suffixStart = suffix[0]!;
      if (
        Date.parse(suffixStart.startAt) <
        Date.parse(recoveryRequest.departureAt)
      ) {
        rejoinReason = 'FUTURE_SUFFIX_DEPARTED_BEFORE_REPAIR';
        continue;
      }
      const connectorStarted = performance.now();
      const connector = await planOrNull(
        this.planner,
        requestFrom(
          repairAnchor,
          point(suffixStart.from, 'rejoin boundary'),
          recoveryRequest.departureAt,
          currentPlan,
        ),
      );
      proposedRouterMilliseconds +=
        connector?.routingMilliseconds ?? performance.now() - connectorStarted;
      proposedValidationMilliseconds +=
        connector?.stateValidationMilliseconds ?? 0;
      const candidate = connector?.alternatives[0];
      if (candidate === undefined) {
        rejoinReason = 'NO_ROUTED_CONNECTION_TO_FUTURE_SUFFIX';
        continue;
      }
      if (
        Date.parse(candidate.endAt) > Date.parse(suffixStart.startAt) ||
        !sameLocation(
          candidate.destination,
          point(suffixStart.from, 'rejoin boundary'),
        ) ||
        !chronologicalAndConnected([
          ...preservedLegs,
          ...candidate.legs,
          ...suffix,
        ])
      ) {
        rejoinReason = 'ROUTED_CONNECTION_MISSES_FUTURE_SUFFIX';
        continue;
      }
      repairResult = connector;
      rejoinedLegs = suffix;
      invalidatedLegs = remaining.slice(invalidIndex, suffixIndex);
      rejoinReason = 'ROUTED_CONNECTION_REACHES_VALID_ORIGINAL_SUFFIX';
      break;
    }
    const fallbackStarted = performance.now();
    if (repairResult === null)
      repairResult = await planOrNull(this.planner, recoveryRequest);
    if (rejoinedLegs.length === 0) {
      proposedRouterMilliseconds +=
        repairResult?.routingMilliseconds ??
        performance.now() - fallbackStarted;
      proposedValidationMilliseconds +=
        repairResult?.stateValidationMilliseconds ?? 0;
    }
    const proposedRoutingMilliseconds = performance.now() - proposedStarted;

    const mergeStarted = performance.now();
    const repair = repairResult?.alternatives[0] ?? null;
    const baseline = baselineResult?.alternatives[0] ?? null;
    const proposed = repair
      ? mergeRemainingJourney(
          anchor.point,
          input.recoveryAt,
          preservedLegs,
          repair,
          rejoinedLegs,
        )
      : null;
    if (proposed !== null) {
      const finalValidationStarted = performance.now();
      const finalState = await this.planner.validateOperationalState(
        proposed.legs,
      );
      proposedValidationMilliseconds +=
        performance.now() - finalValidationStarted;
      if (finalState.blockedEntityIds.length > 0)
        throw new RecoveryError(
          'NO_RECOVERY_PATH',
          'Merged recovery contains a currently unavailable canonical entity.',
        );
    }
    const avoided =
      proposed !== null &&
      !proposed.legs.some((leg) =>
        leg.entityBindings.some(
          (binding) => binding.mobilityEntityId === impact.mobilityEntityId,
        ),
      );
    if (proposed !== null && !avoided)
      throw new RecoveryError(
        'NO_RECOVERY_PATH',
        'The repaired candidate still contains the unavailable entity.',
      );

    const proposedFingerprint = proposed
      ? fingerprint(proposed, 'STATE_AWARE_REPAIR')
      : null;
    const baselineFingerprint = baseline
      ? fingerprint(baseline, 'FULL_REPLAN')
      : null;
    const mergeMilliseconds = performance.now() - mergeStarted;
    const originalRemainingDuration = Math.max(
      0,
      Math.round(
        (Date.parse(remaining.at(-1)!.endAt) - Date.parse(input.recoveryAt)) /
          1000,
      ),
    );
    const proposedPreserved =
      proposed === null
        ? 0
        : preservedFutureLegCount(remaining, [
            ...preservedLegs,
            ...rejoinedLegs,
          ]);
    const baselinePreserved =
      baseline === null ? 0 : preservedFutureLegCount(remaining, baseline.legs);
    const proposedAvoided = proposed !== null && avoided;
    const baselineAvoided =
      baseline !== null &&
      !baseline.legs.some((leg) =>
        leg.entityBindings.some(
          (binding) => binding.mobilityEntityId === impact.mobilityEntityId,
        ),
      );
    const methodMetrics = (
      candidate: JourneyAlternative | null,
      preservedCount: number,
      avoidedEntity: boolean,
      timing: {
        totalMs: number;
        routingMs: number;
        validationMs: number;
        mergeMs?: number;
      },
    ) => ({
      recoverySuccess: candidate !== null && avoidedEntity,
      preservedLegRatio:
        remaining.length === 0 ? 0 : round(preservedCount / remaining.length),
      addedTravelTimeSeconds:
        candidate === null
          ? null
          : Math.round(
              (Date.parse(candidate.endAt) - Date.parse(input.recoveryAt)) /
                1000,
            ) - originalRemainingDuration,
      addedTransfers:
        candidate === null
          ? null
          : candidate.transferCount - transferCount(remaining),
      planChangeCount:
        candidate === null ? null : planChangeCount(remaining, candidate.legs),
      disruptedEntityAvoidance: avoidedEntity,
      timing: {
        totalMs: round(timing.totalMs),
        routingMs: round(timing.routingMs),
        validationMs: round(timing.validationMs),
        ...(timing.mergeMs === undefined
          ? {}
          : { mergeMs: round(timing.mergeMs) }),
      },
    });
    const stateAware = methodMetrics(
      proposed,
      proposedPreserved,
      proposedAvoided,
      {
        totalMs:
          preservationProcessingMilliseconds +
          proposedRoutingMilliseconds +
          mergeMilliseconds,
        routingMs: proposedRouterMilliseconds,
        validationMs: proposedValidationMilliseconds,
        mergeMs: mergeMilliseconds,
      },
    );
    const fullReplan = methodMetrics(
      baseline,
      baselinePreserved,
      baselineAvoided,
      {
        totalMs: baselineRoutingMilliseconds,
        routingMs:
          baselineResult?.routingMilliseconds ?? baselineRoutingMilliseconds,
        validationMs: baselineResult?.stateValidationMilliseconds ?? 0,
      },
    );
    const metrics = {
      recoverySuccess: proposed !== null,
      preservedLegRatio: stateAware.preservedLegRatio,
      preservedLegCount: proposedPreserved,
      eligibleRemainingLegCount: remaining.length,
      changedLegCount: invalidatedLegs.length,
      addedTravelTimeSeconds: stateAware.addedTravelTimeSeconds,
      addedTransfers:
        proposed === null
          ? null
          : proposed.transferCount - transferCount(remaining),
      planChangeCount: stateAware.planChangeCount ?? 0,
      disruptedEntityAvoidance: avoided,
      stateValidationMilliseconds: round(proposedValidationMilliseconds),
      preservationProcessingMilliseconds: round(
        preservationProcessingMilliseconds,
      ),
      proposedRoutingMilliseconds: round(proposedRoutingMilliseconds),
      baselineRoutingMilliseconds: round(baselineRoutingMilliseconds),
      totalComputationMilliseconds: round(performance.now() - totalStarted),
      stateAware,
      fullReplan,
    } as const;
    const recoveryId = stableUuid(
      'state-aware-recovery',
      `${journey.journeyId}:${impact.impactId}:${baseRecoveryId ?? 'G0'}:${journey.progress.revision}:${input.recoveryAt}:${input.idempotencyKey}`,
    );
    const proposal: RecoveryProposal = {
      recoveryId,
      activeJourneyId: journey.journeyId,
      baseRecoveryId,
      impactId: impact.impactId,
      ownerRef: journey.ownerRef,
      method: 'STATE_AWARE_REPAIR',
      status: proposed ? 'COMPLETED' : 'NO_PATH',
      progressRevision: journey.progress.revision,
      completedLegCount: journey.progress.completedLegCount,
      recoveryAnchor: { name: anchor.endpoint.name, point: anchor.point },
      recoveryAt: input.recoveryAt,
      networkSnapshotId: currentPlan.routingContext.networkSnapshotId,
      mobilityProjectionVersion: impact.projectionVersion,
      originalJourneyFingerprint: selectedJourneyFingerprint(
        journey.originalPlan,
      ),
      proposedFingerprint,
      baselineFingerprint,
      triggeringEntityId: impact.mobilityEntityId,
      stateTransitionId: impact.stateTransitionId,
      reason: proposed
        ? rejoinedLegs.length > 0
          ? 'The blocked middle portion was repaired and a valid original future suffix was rejoined.'
          : 'The unavailable future dependency invalidated the original suffix; completed history and the valid remaining prefix were retained.'
        : 'No state-valid repair path exists from the deterministic repair boundary.',
      completedLegs,
      preservedLegs,
      invalidatedLegs,
      repairedLegs: repair?.legs ?? [],
      rejoinedLegs,
      rejoinStatus:
        rejoinedLegs.length > 0
          ? 'REJOINED'
          : proposed
            ? 'SUFFIX_REPLANNED'
            : 'NO_PATH',
      rejoinReason,
      proposedJourney: proposed,
      baselineJourney: baseline,
      metrics,
    };
    return this.repository.save(proposal, input.idempotencyKey);
  }

  get(recoveryId: string, ownerRef: string): Promise<RecoveryProposal> {
    return this.repository.get(recoveryId, ownerRef);
  }

  /**
   * Owner-only acceptance of the current COMPLETED proposal. All freshness and
   * candidate revalidation runs BEFORE the transaction: server-side state calls
   * and OTP routing cannot run inside the DB transaction, while the repository
   * re-checks revision/impact under row locks before the atomic pointer write.
   */
  async accept(input: {
    recoveryId: string;
    ownerRef: string;
    idempotencyKey: string;
    progressRevision: number;
    acceptedAt: string;
  }): Promise<RecoveryAcceptance> {
    if (!Number.isInteger(input.progressRevision))
      throw new RecoveryError(
        'RECOVERY_STALE',
        'progress_revision must identify the journey revision the proposal was computed for.',
      );
    // Receipt replay precedes proposal-state and freshness gates: an already
    // accepted request is idempotent even after later progression or impact
    // lifecycle changes. Key mismatch still conflicts.
    const existing = await this.repository.findAcceptanceByIdempotency(
      input.ownerRef,
      input.idempotencyKey,
    );
    if (existing !== null) {
      if (
        existing.recoveryId !== input.recoveryId ||
        existing.acceptedProgressRevision !== input.progressRevision
      )
        throw new RecoveryError(
          'IDEMPOTENCY_CONFLICT',
          'The acceptance idempotency key belongs to a different acceptance request.',
        );
      return existing;
    }
    const proposal = await this.repository.get(
      input.recoveryId,
      input.ownerRef,
    );
    if (proposal.status !== 'COMPLETED' || proposal.proposedJourney === null)
      throw new RecoveryError(
        'RECOVERY_NOT_ACCEPTABLE',
        'Only a completed proposal with a proposed journey can be accepted.',
      );
    // Duplicate of prior success under another key conflicts, not replays:
    // prevents resurrecting a stale/expired proposal through a fresh request.
    const accepted = await this.repository.findAcceptance(
      input.recoveryId,
      input.ownerRef,
    );
    if (accepted !== null) {
      if (accepted.acceptedProgressRevision !== input.progressRevision)
        throw new RecoveryError(
          'RECOVERY_STALE',
          'The journey progressed or the proposal targets an older revision; request a fresh recovery.',
        );
      throw new RecoveryError(
        'IDEMPOTENCY_CONFLICT',
        'This recovery proposal was already accepted under a different idempotency key.',
      );
    }
    const journey = await this.journeys.get(
      proposal.activeJourneyId,
      input.ownerRef,
    );
    if (
      journey.progress.revision !== input.progressRevision ||
      journey.progress.revision !== proposal.progressRevision
    )
      throw new RecoveryError(
        'RECOVERY_STALE',
        'The journey progressed or the proposal targets an older revision; request a fresh recovery.',
      );
    const impact = await this.repository.getCurrentImpact(
      proposal.impactId,
      proposal.activeJourneyId,
      input.ownerRef,
    );
    if (
      impact === null ||
      impact.stateTransitionId !== proposal.stateTransitionId ||
      impact.mobilityEntityId !== proposal.triggeringEntityId
    )
      throw new RecoveryError(
        'RECOVERY_STALE',
        'The triggering impact is no longer current on this journey.',
      );
    const validation = await this.planner.validateOperationalState(
      proposal.proposedJourney.legs,
    );
    if (validation.blockedEntityIds.length > 0)
      throw new RecoveryError(
        'RECOVERY_CANDIDATE_BLOCKED',
        'The proposed replacement now depends on a currently unavailable canonical entity; request a fresh recovery.',
      );
    return this.repository.accept({
      recoveryId: proposal.recoveryId,
      ownerRef: proposal.ownerRef,
      idempotencyKey: input.idempotencyKey,
      progressRevision: input.progressRevision,
      acceptedJourney: proposal.proposedJourney,
      acceptedJourneyFingerprint: proposal.proposedFingerprint ?? '',
      acceptedAt: input.acceptedAt,
    });
  }

  findAcceptance(
    recoveryId: string,
    ownerRef: string,
  ): Promise<RecoveryAcceptance | null> {
    return this.repository.findAcceptance(recoveryId, ownerRef);
  }
}

async function planOrNull(
  planner: JourneyPlannerService,
  request: JourneyPlanRequest,
): Promise<JourneyPlanResult | null> {
  try {
    return await planner.fullReplan(request);
  } catch (error) {
    if (
      error instanceof JourneyRoutingError &&
      ['NO_ROUTE', 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'].includes(error.code)
    )
      return null;
    throw error;
  }
}

function recoveryAnchor(journey: ActiveJourney) {
  const endpoint =
    journey.originalPlan.legs[journey.progress.completedLegCount]?.from;
  if (endpoint === undefined)
    throw new RecoveryError(
      'INVALID_RECOVERY_ANCHOR',
      'No remaining journey boundary exists at the recorded progress revision.',
    );
  return { endpoint, point: point(endpoint, 'recovery anchor') };
}

function point(
  endpoint: JourneyLeg['from'] | JourneyLeg['to'],
  label: string,
): GeoPoint {
  if (endpoint.latitude == null || endpoint.longitude == null)
    throw new RecoveryError(
      'INVALID_RECOVERY_ANCHOR',
      `The ${label} has no verified router coordinate.`,
    );
  return { latitude: endpoint.latitude, longitude: endpoint.longitude };
}

function requestFrom(
  origin: GeoPoint,
  destination: GeoPoint,
  departureAt: string,
  journey: JourneyAlternative,
): JourneyPlanRequest {
  return {
    origin,
    destination,
    departureAt,
    networkSnapshotId: journey.routingContext.networkSnapshotId,
    preference: 'BALANCED',
    allowedModes: [...new Set(journey.legs.map((leg) => leg.mode))],
    maximumAlternatives: 1,
  };
}

function mergeRemainingJourney(
  anchor: GeoPoint,
  recoveryAt: string,
  preserved: readonly JourneyLeg[],
  repaired: JourneyAlternative,
  rejoined: readonly JourneyLeg[] = [],
): JourneyAlternative {
  const legs = [...preserved, ...repaired.legs, ...rejoined].map(
    (leg, sequence) => ({
      ...leg,
      sequence,
    }),
  );
  const endAt = legs.at(-1)?.endAt ?? recoveryAt;
  return {
    ...repaired,
    journeyId: stableUuid(
      'state-aware-recovery-journey',
      JSON.stringify(legs.map(stableLeg)),
    ),
    origin: anchor,
    startAt: recoveryAt,
    endAt,
    durationSeconds: Math.max(
      0,
      Math.round((Date.parse(endAt) - Date.parse(recoveryAt)) / 1000),
    ),
    transferCount: transferCount(legs),
    walkingDistanceMeters: legs
      .filter((leg) => leg.mode === 'WALK')
      .reduce((sum, leg) => sum + leg.distanceMeters, 0),
    legs,
  };
}

function sameLocation(a: GeoPoint, b: GeoPoint): boolean {
  // OTP can snap endpoints to the walking graph; 75 m is a conservative
  // connector tolerance, never a substitute for a routed connector.
  const radians = Math.PI / 180;
  const dLat = (a.latitude - b.latitude) * radians;
  const dLon = (a.longitude - b.longitude) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))) <= 75;
}

function chronologicalAndConnected(legs: readonly JourneyLeg[]): boolean {
  for (let index = 1; index < legs.length; index += 1) {
    const prior = legs[index - 1]!;
    const next = legs[index]!;
    if (Date.parse(prior.endAt) > Date.parse(next.startAt)) return false;
    if (
      !sameLocation(
        point(prior.to, 'leg endpoint'),
        point(next.from, 'leg origin'),
      )
    )
      return false;
  }
  return true;
}

function fingerprint(
  alternative: JourneyAlternative,
  strategy: JourneyPlanResult['strategy'] | 'STATE_AWARE_REPAIR',
): string {
  const base = fingerprintJourneyPlan({
    alternatives: [alternative],
    rejectedCandidateCount: 0,
    stateValidationMilliseconds: 0,
    routingMilliseconds: 0,
    totalMilliseconds: 0,
    strategy: strategy === 'STATE_AWARE_REPAIR' ? 'FULL_REPLAN' : strategy,
  });
  return strategy === 'STATE_AWARE_REPAIR'
    ? createHash('sha256').update(`STATE_AWARE_REPAIR:${base}`).digest('hex')
    : base;
}

function stableLeg(leg: JourneyLeg) {
  return {
    mode: leg.mode,
    from: leg.from.otpStopId,
    to: leg.to.otpStopId,
    routeId: leg.routeId,
    tripId: leg.tripId,
    startAt: leg.startAt,
    endAt: leg.endAt,
  };
}

function transferCount(legs: readonly JourneyLeg[]): number {
  return Math.max(0, legs.filter((leg) => leg.mode !== 'WALK').length - 1);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sameRecoveryInstant(left: string, right: string): boolean {
  const iso =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    !iso.test(left) ||
    !iso.test(right)
  )
    return false;
  const instant = Date.parse(left);
  return Number.isFinite(instant) && instant === Date.parse(right);
}
