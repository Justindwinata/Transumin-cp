export const GPS_STALE_MS = 30_000;

/**
 * Accuracy tiers for an uncertainty-aware policy (R5-A). A fix good enough for
 * map context is not automatically good enough for navigation guidance or for a
 * confident off-route claim, and vice versa. Thresholds are product policy, not
 * universal truth; they are reviewed in tests, not assumed.
 */
export const GPS_NAVIGATION_ACCURACY_M = 30;
export const GPS_MAP_ACCURACY_M = 250;

export type GpsAccuracyTier = 'NAVIGATION' | 'MAP_CONTEXT' | 'UNCERTAIN';

export function gpsAccuracyTier(accuracy: number | null): GpsAccuracyTier {
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0)
    return 'UNCERTAIN';
  if (accuracy <= GPS_NAVIGATION_ACCURACY_M) return 'NAVIGATION';
  if (accuracy <= GPS_MAP_ACCURACY_M) return 'MAP_CONTEXT';
  return 'UNCERTAIN';
}

/** True only when a fix may drive confident navigation/off-route reasoning. */
export function gpsNavigationGrade(accuracy: number | null): boolean {
  return gpsAccuracyTier(accuracy) === 'NAVIGATION';
}

export type GpsState =
  | 'GPS_OFF'
  | 'GPS_REQUESTING_PERMISSION'
  | 'GPS_TRACKING'
  | 'GPS_MAP_CONTEXT'
  | 'GPS_ACCURACY_LOW'
  | 'GPS_STALE'
  | 'GPS_PERMISSION_DENIED'
  | 'GPS_UNAVAILABLE'
  | 'GPS_ERROR'
  | 'GPS_STOPPED';

export const GPS_STATE = {
  GPS_OFF: 'GPS_OFF',
  GPS_REQUESTING_PERMISSION: 'GPS_REQUESTING_PERMISSION',
  GPS_TRACKING: 'GPS_TRACKING',
  GPS_MAP_CONTEXT: 'GPS_MAP_CONTEXT',
  GPS_ACCURACY_LOW: 'GPS_ACCURACY_LOW',
  GPS_STALE: 'GPS_STALE',
  GPS_PERMISSION_DENIED: 'GPS_PERMISSION_DENIED',
  GPS_UNAVAILABLE: 'GPS_UNAVAILABLE',
  GPS_ERROR: 'GPS_ERROR',
  GPS_STOPPED: 'GPS_STOPPED',
} as const;

export type GpsSample = Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  timestamp: number;
}>;

export function gpsErrorState(code: number): GpsState {
  if (code === 1) return 'GPS_PERMISSION_DENIED';
  if (code === 2) return 'GPS_UNAVAILABLE';
  return 'GPS_ERROR';
}

export function gpsFreshness(sample: GpsSample | null, now: number): GpsState {
  if (
    !sample ||
    !Number.isFinite(now) ||
    sample.timestamp > now ||
    now - sample.timestamp >= GPS_STALE_MS
  )
    return 'GPS_STALE';
  const tier = gpsAccuracyTier(sample.accuracy);
  // Keep valid imprecise fixes for map context; navigation consumers must call
  // gpsNavigationGrade() before progressing guidance or detecting off-route.
  if (tier === 'UNCERTAIN') return 'GPS_ACCURACY_LOW';
  return tier === 'NAVIGATION' ? 'GPS_TRACKING' : 'GPS_MAP_CONTEXT';
}

export function gpsNext(
  current: GpsSample | null,
  next: GpsSample,
  now = Date.now(),
): { sample: GpsSample | null; state: GpsState } {
  if (
    !Number.isFinite(next.latitude) ||
    Math.abs(next.latitude) > 90 ||
    !Number.isFinite(next.longitude) ||
    Math.abs(next.longitude) > 180 ||
    !Number.isFinite(next.timestamp) ||
    next.timestamp < 0 ||
    next.timestamp > now ||
    (next.accuracy !== null &&
      (!Number.isFinite(next.accuracy) || next.accuracy < 0))
  )
    return { sample: current, state: 'GPS_ERROR' };
  if (current && next.timestamp <= current.timestamp)
    return { sample: current, state: gpsFreshness(current, now) };
  const accurate = gpsNavigationGrade(next.accuracy);
  // Preserve the coordinates of this exact sensor fix. Reusing an older
  // point with a newer accuracy creates a false precision claim. Navigation
  // already filters jitter independently of the raw device marker.
  const sample = {
    ...next,
    heading:
      accurate &&
      next.heading !== null &&
      Number.isFinite(next.heading) &&
      next.heading >= 0 &&
      next.heading < 360
        ? next.heading
        : null,
  };
  return { sample, state: gpsFreshness(sample, now) };
}

export function gpsNavigationReady(
  sample: GpsSample | null,
  state: GpsState,
  now = Date.now(),
): sample is GpsSample {
  return (
    state === 'GPS_TRACKING' && gpsFreshness(sample, now) === 'GPS_TRACKING'
  );
}

export function gpsMapReady(
  sample: GpsSample | null,
  state: GpsState,
  now = Date.now(),
): sample is GpsSample {
  return (
    (state === 'GPS_TRACKING' || state === 'GPS_MAP_CONTEXT') &&
    ['GPS_TRACKING', 'GPS_MAP_CONTEXT'].includes(gpsFreshness(sample, now))
  );
}

export function distanceMeters(a: GpsSample, b: GpsSample): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
