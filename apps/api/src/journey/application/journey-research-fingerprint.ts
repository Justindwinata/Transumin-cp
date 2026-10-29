import { createHash } from 'node:crypto';

import type {
  CanonicalEntityBinding,
  JourneyAlternative,
  JourneyPlanResult,
} from '../domain/journey.js';

export type NormalizedJourneyResearchPayload = Readonly<{
  schemaVersion: 1;
  strategy: JourneyPlanResult['strategy'];
  alternatives: readonly object[];
}>;

export function normalizeJourneyPlanForResearch(
  result: JourneyPlanResult,
): NormalizedJourneyResearchPayload {
  return {
    schemaVersion: 1,
    strategy: result.strategy,
    alternatives: result.alternatives.map(normalizeAlternative),
  };
}

export function fingerprintJourneyPlan(result: JourneyPlanResult): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeJourneyPlanForResearch(result)))
    .digest('hex');
}

function normalizeAlternative(alternative: JourneyAlternative): object {
  return {
    origin: alternative.origin,
    destination: alternative.destination,
    startAt: alternative.startAt,
    endAt: alternative.endAt,
    durationSeconds: alternative.durationSeconds,
    transferCount: alternative.transferCount,
    walkingDistanceMeters: alternative.walkingDistanceMeters,
    fareStatus: alternative.fareStatus,
    legs: alternative.legs.map((leg) => ({
      sequence: leg.sequence,
      mode: leg.mode,
      otpMode: leg.otpMode,
      fromCanonicalEntityId: canonicalEndpoint(
        leg.entityBindings,
        leg.from.otpStopId,
      ),
      toCanonicalEntityId: canonicalEndpoint(
        leg.entityBindings,
        leg.to.otpStopId,
      ),
      routeCanonicalEntityId: canonicalEndpoint(
        leg.entityBindings,
        leg.routeId,
      ),
      startAt: leg.startAt,
      endAt: leg.endAt,
      durationSeconds: leg.durationSeconds,
      distanceMeters: leg.distanceMeters,
      serviceDate: leg.serviceDate,
      tripSourceId: leg.tripId,
      timingPrecision: leg.timingPrecision,
      canonicalBindings: [...leg.entityBindings]
        .sort((left, right) =>
          left.otpEntityId.localeCompare(right.otpEntityId),
        )
        .map((binding) => ({
          sourceEntityId: binding.otpEntityId,
          canonicalEntityId: binding.canonicalEntityId,
          mobilityEntityId: binding.mobilityEntityId,
          entityType: binding.entityType,
          productMode: binding.productMode,
          resolutionMethod: binding.resolutionMethod,
          provenanceRef: binding.provenanceRef,
        })),
      operationalFlags: [...leg.operationalFlags]
        .sort((left, right) =>
          left.mobilityEntityId.localeCompare(right.mobilityEntityId),
        )
        .map((flag) => ({
          mobilityEntityId: flag.mobilityEntityId,
          operationalState: flag.operationalState,
          evidenceType: flag.evidenceType,
          freshnessStatus: flag.freshnessStatus,
          provenanceRef: flag.provenanceRef,
        })),
    })),
    routingContext: {
      provider: alternative.routingContext.provider,
      providerVersion: alternative.routingContext.providerVersion,
      routingSnapshotId: alternative.routingContext.routingSnapshotId,
      routingManifestSha256: alternative.routingContext.routingManifestSha256,
      graphSha256: alternative.routingContext.graphSha256,
      networkSnapshotId: alternative.routingContext.networkSnapshotId,
      networkSnapshotHash: alternative.routingContext.networkSnapshotHash,
      mobilityProjectionVersion:
        alternative.routingContext.mobilityProjectionVersion,
      commonServiceDate: alternative.routingContext.commonServiceDate,
      timezone: alternative.routingContext.timezone,
      attemptCount: alternative.routingContext.attemptCount,
      excludedRouteIds: [...alternative.routingContext.excludedRouteIds].sort(),
    },
  };
}

function canonicalEndpoint(
  bindings: readonly CanonicalEntityBinding[],
  otpEntityId: string | null,
): string | null {
  if (otpEntityId === null) return null;
  return (
    bindings.find((binding) => binding.otpEntityId === otpEntityId)
      ?.canonicalEntityId ?? null
  );
}
