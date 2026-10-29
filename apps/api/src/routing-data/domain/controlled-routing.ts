export type RoutingMode =
  'KRL' | 'MRT_JAKARTA' | 'LRT_JAKARTA' | 'LRT_JABODEBEK';

export type TimingPrecision = 'EXACT_SCHEDULE' | 'FREQUENCY_DERIVED';

export interface RoutingStop {
  readonly id: string;
  readonly name: string;
  readonly boardingAllowed?: boolean;
}

export interface ExactStopTime {
  readonly stopId: string;
  readonly timeSeconds: number | null;
  readonly passThrough: boolean;
}

export interface ExactRoutingTrip {
  readonly serviceId: string;
  readonly relation: string;
  readonly serviceCalendar: 'DAILY' | 'WEEKDAY';
  readonly stopTimes: readonly ExactStopTime[];
}

export interface FrequencyWindow {
  readonly serviceCalendar: 'DAILY' | 'WEEKDAY' | 'WEEKEND';
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly headwaySeconds: number;
}

export interface FrequencyRoutingPattern {
  readonly id: string;
  readonly direction: string;
  readonly stops: readonly RoutingStop[];
  readonly endToEndSeconds: number;
  readonly windows: readonly FrequencyWindow[];
  readonly travelTimeBasis:
    | 'OFFICIAL_END_TO_END_WITH_SPATIAL_INTERPOLATION'
    | 'OFFICIAL_END_TO_END_WITH_UNIFORM_INTERPOLATION';
}

export interface ControlledRoutingRepresentation {
  readonly mode: RoutingMode;
  readonly sourceId: string;
  readonly sourceChecksum: string;
  readonly sourceRetrievedAt: string;
  readonly sourceApplicability?: {
    readonly timezone: 'Asia/Jakarta';
    readonly effectiveFrom: string;
    readonly effectiveTo?: string;
    readonly sourceUrl: string;
  };
  readonly precision: TimingPrecision;
  readonly exactTrips?: readonly ExactRoutingTrip[];
  readonly frequencyPatterns?: readonly FrequencyRoutingPattern[];
}

export interface RoutingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly tripCount: number;
  readonly frequencyPatternCount: number;
  readonly stopTimeCount: number;
}

export function parseClockTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) throw new Error(`Invalid clock time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 47 || minutes > 59)
    throw new Error(`Invalid clock time: ${value}`);
  return hours * 3600 + minutes * 60;
}

export function makeMonotonicTimes(
  values: readonly (string | null)[],
): readonly (number | null)[] {
  let dayOffset = 0;
  let previous: number | null = null;
  return values.map((value) => {
    if (value === null) return null;
    let parsed = parseClockTime(value) + dayOffset;
    if (previous !== null && parsed < previous) {
      dayOffset += 24 * 3600;
      parsed += 24 * 3600;
    }
    previous = parsed;
    return parsed;
  });
}

export function validateControlledRoutingRepresentation(
  representation: ControlledRoutingRepresentation,
): RoutingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exactTrips = representation.exactTrips ?? [];
  const patterns = representation.frequencyPatterns ?? [];
  const serviceIds = new Set<string>();
  let stopTimeCount = 0;

  if (representation.precision === 'EXACT_SCHEDULE' && exactTrips.length === 0)
    errors.push('EXACT_SCHEDULE requires at least one exact trip');
  if (representation.precision === 'FREQUENCY_DERIVED' && patterns.length === 0)
    errors.push('FREQUENCY_DERIVED requires at least one frequency pattern');

  for (const trip of exactTrips) {
    if (serviceIds.has(trip.serviceId))
      errors.push(`Duplicate service ID: ${trip.serviceId}`);
    serviceIds.add(trip.serviceId);
    if (trip.stopTimes.length < 2)
      errors.push(`Trip ${trip.serviceId} has fewer than two stop times`);
    let previous: number | null = null;
    for (const stopTime of trip.stopTimes) {
      stopTimeCount += 1;
      if (stopTime.timeSeconds === null) continue;
      if (previous !== null && stopTime.timeSeconds < previous)
        errors.push(`Trip ${trip.serviceId} is not temporally ordered`);
      previous = stopTime.timeSeconds;
    }
  }

  for (const pattern of patterns) {
    if (pattern.stops.length < 2)
      errors.push(`Pattern ${pattern.id} has fewer than two stops`);
    if (
      new Set(pattern.stops.map((stop) => stop.id)).size !==
      pattern.stops.length
    )
      errors.push(`Pattern ${pattern.id} contains duplicate stop IDs`);
    if (pattern.endToEndSeconds <= 0)
      errors.push(`Pattern ${pattern.id} has invalid end-to-end duration`);
    if (pattern.stops.some((stop) => stop.boardingAllowed === false))
      warnings.push(`Pattern ${pattern.id} contains pass-through stations`);
    for (const window of pattern.windows) {
      if (window.endSeconds <= window.startSeconds)
        errors.push(`Pattern ${pattern.id} contains an invalid service window`);
      if (window.headwaySeconds <= 0)
        errors.push(`Pattern ${pattern.id} contains an invalid headway`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    tripCount: exactTrips.length,
    frequencyPatternCount: patterns.length,
    stopTimeCount,
  };
}
