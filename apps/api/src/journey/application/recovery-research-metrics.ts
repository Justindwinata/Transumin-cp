import type { JourneyLeg } from '../domain/journey.js';

// One stable, canonical leg representation is shared by both research methods.
// UI labels, request IDs, and transient operational flags do not alter a plan.
export function normalizedRecoveryLeg(leg: JourneyLeg): string {
  const canonical = (otpId: string | null) =>
    leg.entityBindings.find((binding) => binding.otpEntityId === otpId)
      ?.canonicalEntityId ?? null;
  return JSON.stringify({
    mode: leg.mode,
    from: canonical(leg.from.otpStopId) ?? [
      leg.from.latitude,
      leg.from.longitude,
    ],
    to: canonical(leg.to.otpStopId) ?? [leg.to.latitude, leg.to.longitude],
    route:
      canonical(leg.routeId) ??
      leg.entityBindings.find((binding) => binding.entityType === 'ROUTE')
        ?.canonicalEntityId ??
      leg.routeId,
    trip: leg.tripId,
    serviceDate: leg.serviceDate,
    startAt: leg.startAt,
    endAt: leg.endAt,
    timingPrecision: leg.timingPrecision,
    walking: leg.mode === 'WALK',
  });
}

export function planChangeCount(
  original: readonly JourneyLeg[],
  candidate: readonly JourneyLeg[],
): number {
  const left = original.map(normalizedRecoveryLeg);
  const right = candidate.map(normalizedRecoveryLeg);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1)
      current.push(
        Math.min(
          previous[column]! + 1,
          current[column - 1]! + 1,
          previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
        ),
      );
    previous = current;
  }
  return previous[right.length]!;
}

export function preservedFutureLegCount(
  original: readonly JourneyLeg[],
  candidate: readonly JourneyLeg[],
): number {
  const left = original.map(normalizedRecoveryLeg);
  const right = candidate.map(normalizedRecoveryLeg);
  const previous = Array<number>(right.length + 1).fill(0);
  for (const leg of left) {
    let diagonal = 0;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]!;
      previous[column] =
        leg === right[column - 1]
          ? diagonal + 1
          : Math.max(above, previous[column - 1]!);
      diagonal = above;
    }
  }
  return previous[right.length]!;
}
