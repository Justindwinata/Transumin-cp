import type { DevicePosition } from './map-geometry';

export type NavMode =
  | 'PREPARING'
  | 'WALK_TO_BOARDING_STOP'
  | 'WAIT_FOR_TRANSIT'
  | 'ON_TRANSIT_CONFIRMED'
  | 'ALIGHTING_PENDING'
  | 'WALK_TRANSFER'
  | 'WALK_TO_DESTINATION'
  | 'ARRIVED'
  | 'NAVIGATION_UNAVAILABLE';

export const NAV_MODE = {
  PREPARING: 'PREPARING',
  WALK_TO_BOARDING_STOP: 'WALK_TO_BOARDING_STOP',
  WAIT_FOR_TRANSIT: 'WAIT_FOR_TRANSIT',
  ON_TRANSIT_CONFIRMED: 'ON_TRANSIT_CONFIRMED',
  ALIGHTING_PENDING: 'ALIGHTING_PENDING',
  WALK_TRANSFER: 'WALK_TRANSFER',
  WALK_TO_DESTINATION: 'WALK_TO_DESTINATION',
  ARRIVED: 'ARRIVED',
  NAVIGATION_UNAVAILABLE: 'NAVIGATION_UNAVAILABLE',
} as const;

export const OFF_ROUTE_TOLERANCE_M = 120;
export const OFF_ROUTE_CONFIRM_SAMPLES = 3;
export const OFF_ROUTE_HISTORY = 8;
export const NAVIGATION_ACCURACY_M = 30;
export const NAVIGATION_STALE_MS = 30_000;
export const ROUTE_PROXIMITY_M = 45;
export const MAX_WALK_SPEED_MPS = 3;
export const JITTER_TOLERANCE_M = 12;
export const TURN_PASS_MARGIN_M = 10;
export const RELIABLE_FIXES_REQUIRED = 2;
export const MAX_FIX_GAP_S = 30;
const EARTH_RADIUS_M = 6_371_000;

export type PathPoint = Readonly<{ latitude: number; longitude: number }>;

export type WalkingStepLike = Readonly<{
  latitude: number;
  longitude: number;
  distance_meters: number;
  relative_direction: string | null;
  absolute_direction: string | null;
  street_name: string | null;
  bogus_name: boolean;
  area: boolean;
  stay_on: boolean;
}>;

export type SegmentLike = Readonly<{
  sequence: number;
  mode: string;
  from: Readonly<{
    name: string;
    latitude?: number | null;
    longitude?: number | null;
  }>;
  to: Readonly<{
    name: string;
    latitude?: number | null;
    longitude?: number | null;
  }>;
  route_short_name?: string | null;
  distance_meters?: number;
  geometry: Readonly<{ type: string; coordinates: readonly number[][] }> | null;
  walking_steps?: readonly WalkingStepLike[];
}>;

export type BoardingState = Readonly<{ boarded: boolean; alighted: boolean }>;

export type PreparedPath = Readonly<{
  points: readonly PathPoint[];
  cumulative: readonly number[];
  length: number;
}>;

export type ProjectedPosition = Readonly<{
  alongMeters: number;
  crossTrackMeters: number;
  segmentIndex: number;
}>;

export type PreparedManeuver = Readonly<{
  instruction: string;
  alongMeters: number;
  distanceMeters: number;
  relativeDirection: string;
  streetName: string | null;
}>;

export type WalkNavigation = Readonly<{
  evidence: 'OTP_DERIVED_MANEUVER' | 'SCHEMATIC_GEOMETRY';
  identity: string;
  path: PreparedPath;
  maneuvers: readonly PreparedManeuver[];
  reason: string | null;
}>;

export type NavigationFix = Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
}>;

export type WalkProgress = Readonly<{
  maneuverIndex: number;
  reliableFixes: number;
  alongMeters: number | null;
  lastTimestamp: number | null;
  status: 'ACQUIRING' | 'TRACKING' | 'PAUSED' | 'UNCERTAIN';
  needsManualReposition?: boolean;
}>;

/** Sole source for both direction validation and Indonesian instruction text. */
const DIRECTION_LABELS: Readonly<Record<string, (target: string) => string>> = {
  DEPART: (target) => `Mulai berjalan${target}`,
  CONTINUE: (target) => `Lanjut lurus${target}`,
  LEFT: (target) => `Belok kiri${target}`,
  RIGHT: (target) => `Belok kanan${target}`,
  SLIGHTLY_LEFT: (target) => `Ambil sedikit ke kiri${target}`,
  SLIGHTLY_RIGHT: (target) => `Ambil sedikit ke kanan${target}`,
  HARD_LEFT: (target) => `Belok tajam ke kiri${target}`,
  HARD_RIGHT: (target) => `Belok tajam ke kanan${target}`,
  UTURN_LEFT: (target) => `Putar balik ke kiri${target}`,
  UTURN_RIGHT: (target) => `Putar balik ke kanan${target}`,
  CIRCLE_CLOCKWISE: (target) => `Masuk bundaran searah jarum jam${target}`,
  CIRCLE_COUNTERCLOCKWISE: (target) =>
    `Masuk bundaran berlawanan arah jarum jam${target}`,
  ELEVATOR: () => 'Gunakan lift',
  ENTER_STATION: () => 'Masuk stasiun',
  EXIT_STATION: () => 'Keluar stasiun',
  FOLLOW_SIGNS: (target) => `Ikuti petunjuk${target}`,
};

/** Own-key only: `toString`/`__proto__` must never resolve as a direction. */
export function directionLabel(
  direction: string | null | undefined,
): ((target: string) => string) | null {
  return typeof direction === 'string' &&
    Object.hasOwn(DIRECTION_LABELS, direction)
    ? DIRECTION_LABELS[direction]!
    : null;
}

export const OTP_RELATIVE_DIRECTIONS: readonly string[] = Object.freeze(
  Object.keys(DIRECTION_LABELS).filter((key) =>
    Object.hasOwn(DIRECTION_LABELS, key),
  ),
);

export function destinationMeters(from: PathPoint, to: PathPoint): number {
  const rad = Math.PI / 180;
  const aLat = from.latitude * rad;
  const bLat = to.latitude * rad;
  const dLat = bLat - aLat;
  const dLon = (to.longitude - from.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validPoint(point: { latitude: unknown; longitude: unknown }): boolean {
  return (
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

export function pathPoints(segment: SegmentLike | null): PathPoint[] | null {
  const coordinates = segment?.geometry?.coordinates;
  if (
    segment?.geometry?.type !== 'LineString' ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.length > 10_000
  )
    return null;
  const points: PathPoint[] = [];
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2) return null;
    const [longitude, latitude] = coordinate;
    if (!validPoint({ latitude, longitude })) return null;
    const previous = points.at(-1);
    if (
      !previous ||
      previous.latitude !== latitude ||
      previous.longitude !== longitude
    )
      points.push({ latitude: latitude!, longitude: longitude! });
  }
  return points.length >= 2 ? points : null;
}

/** Cumulative haversine lengths; rejects non-finite or zero-length segments. */
export function preparePath(points: readonly PathPoint[]): PreparedPath | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    if (!validPoint(points[index - 1]!) || !validPoint(points[index]!))
      return null;
    const length = destinationMeters(points[index - 1]!, points[index]!);
    if (!Number.isFinite(length) || length <= 0) return null;
    cumulative.push(cumulative[index - 1]! + length);
  }
  return { points, cumulative, length: cumulative.at(-1)! };
}

function localXY(point: PathPoint, origin: PathPoint): [number, number] {
  const rad = Math.PI / 180;
  return [
    (point.longitude - origin.longitude) *
      rad *
      EARTH_RADIUS_M *
      Math.cos(((point.latitude + origin.latitude) * rad) / 2),
    (point.latitude - origin.latitude) * rad * EARTH_RADIUS_M,
  ];
}

/** Segment projection; expectedAlong disambiguates self-crossing and parallel returns. */
export function projectOnPath(
  point: PathPoint,
  path: PreparedPath,
  expectedAlong?: number,
): ProjectedPosition | null {
  if (!validPoint(point)) return null;
  let best: (ProjectedPosition & { score: number }) | null = null;
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const start = path.points[index]!;
    const end = path.points[index + 1]!;
    const [px, py] = localXY(point, start);
    const [ex, ey] = localXY(end, start);
    const squared = ex * ex + ey * ey;
    if (squared === 0) continue;
    const fraction = Math.max(0, Math.min(1, (px * ex + py * ey) / squared));
    const crossTrackMeters = Math.hypot(px - fraction * ex, py - fraction * ey);
    const alongMeters =
      path.cumulative[index]! +
      fraction * (path.cumulative[index + 1]! - path.cumulative[index]!);
    const score =
      crossTrackMeters +
      (expectedAlong === undefined
        ? 0
        : Math.abs(alongMeters - expectedAlong) * 0.35);
    if (!best || score < best.score)
      best = { alongMeters, crossTrackMeters, segmentIndex: index, score };
  }
  return best
    ? {
        alongMeters: best.alongMeters,
        crossTrackMeters: best.crossTrackMeters,
        segmentIndex: best.segmentIndex,
      }
    : null;
}

export function distanceToPathMeters(
  point: PathPoint,
  points: PathPoint[] | null,
): number | null {
  const path = points && preparePath(points);
  return path ? (projectOnPath(point, path)?.crossTrackMeters ?? null) : null;
}

export function remainingPathMeters(
  startIndex: number,
  points: PathPoint[] | null,
): number | null {
  const path = points && preparePath(points);
  return path &&
    Number.isInteger(startIndex) &&
    startIndex >= 0 &&
    startIndex < points!.length
    ? path.length - path.cumulative[startIndex]!
    : null;
}

export function nearestPathIndex(
  point: PathPoint,
  points: PathPoint[] | null,
): number | null {
  if (!points?.length) return null;
  let best = Infinity;
  let result = 0;
  points.forEach((candidate, index) => {
    const distance = destinationMeters(point, candidate);
    if (distance < best) {
      best = distance;
      result = index;
    }
  });
  return result;
}

export function nextVertexDistanceMeters(
  point: PathPoint,
  points: PathPoint[] | null,
): number | null {
  const index = nearestPathIndex(point, points);
  if (index === null || !points || index + 1 >= points.length - 1) return null;
  return destinationMeters(point, points[index + 1]!);
}

function endpointPoint(endpoint: SegmentLike['from']): PathPoint | null {
  return typeof endpoint.latitude === 'number' &&
    typeof endpoint.longitude === 'number' &&
    validPoint({ latitude: endpoint.latitude, longitude: endpoint.longitude })
    ? { latitude: endpoint.latitude, longitude: endpoint.longitude }
    : null;
}

function directionInstruction(
  direction: string,
  street: string | null,
): string {
  const label = directionLabel(direction);
  return label ? label(street ? ` ke ${street}` : '') : 'Lanjutkan berjalan';
}

/** FNV-1a; concise DOM-safe identity instead of dumping full geometry JSON. */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function walkGeometryIdentity(segment: SegmentLike): string {
  const coordinates = segment.geometry?.coordinates ?? [];
  return `${segment.sequence}.${shortHash(
    JSON.stringify([coordinates, segment.walking_steps ?? []]),
  )}`;
}

function schematic(
  segment: SegmentLike,
  path: PreparedPath,
  reason: string,
): WalkNavigation {
  return {
    evidence: 'SCHEMATIC_GEOMETRY',
    identity: walkGeometryIdentity(segment),
    path,
    maneuvers: [],
    reason,
  };
}

/**
 * OTP maneuver series. Any unsupported direction, area, malformed coordinate, or
 * inconsistent interval rejects the entire series to schematic fallback: partial
 * maneuvers are never shown. Provenance stays OTP_DERIVED_MANEUVER, not validated.
 */
export function prepareWalkNavigation(
  segment: SegmentLike,
): WalkNavigation | null {
  if (segment.mode !== 'WALK') return null;
  const points = pathPoints(segment);
  const path = points && preparePath(points);
  if (!path) return null;
  const steps = segment.walking_steps ?? [];
  if (steps.length === 0)
    return schematic(segment, path, 'Langkah belok OTP tidak tersedia.');
  const start = endpointPoint(segment.from);
  const end = endpointPoint(segment.to);
  if (
    (start && destinationMeters(start, path.points[0]!) > 120) ||
    (end && destinationMeters(end, path.points.at(-1)!) > 120)
  )
    return schematic(
      segment,
      path,
      'Ujung geometri tidak konsisten dengan bagian perjalanan.',
    );

  const maneuvers: PreparedManeuver[] = [];
  let expected = 0;
  for (const [index, step] of steps.entries()) {
    if (
      !step ||
      !validPoint({ latitude: step.latitude, longitude: step.longitude }) ||
      (step.street_name !== null && typeof step.street_name !== 'string') ||
      !Number.isFinite(step.distance_meters) ||
      step.distance_meters < 0 ||
      !step.relative_direction ||
      !directionLabel(step.relative_direction) ||
      step.area
    )
      return schematic(
        segment,
        path,
        'Seri langkah OTP memuat nilai yang tidak didukung.',
      );
    if ((index === 0) !== (step.relative_direction === 'DEPART'))
      return schematic(
        segment,
        path,
        'Urutan arah langkah OTP tidak konsisten.',
      );
    const projected = projectOnPath(step, path, expected);
    if (!projected || projected.crossTrackMeters > ROUTE_PROXIMITY_M)
      return schematic(
        segment,
        path,
        'Posisi langkah OTP tidak konsisten dengan geometri.',
      );
    const prior = maneuvers.at(-1) ?? null;
    if (prior) {
      const actualInterval = projected.alongMeters - prior.alongMeters;
      if (
        actualInterval < -JITTER_TOLERANCE_M ||
        Math.abs(actualInterval - prior.distanceMeters) >
          Math.max(45, prior.distanceMeters * 0.45)
      )
        return schematic(
          segment,
          path,
          'Jarak antarlangkah OTP tidak konsisten dengan geometri.',
        );
    } else if (projected.alongMeters > 100) {
      return schematic(
        segment,
        path,
        'Langkah awal OTP tidak dekat awal geometri.',
      );
    }
    const street = step.bogus_name ? null : step.street_name?.trim() || null;
    maneuvers.push({
      instruction: directionInstruction(step.relative_direction, street),
      alongMeters: projected.alongMeters,
      distanceMeters: step.distance_meters,
      relativeDirection: step.relative_direction,
      streetName: street,
    });
    expected = projected.alongMeters + step.distance_meters;
  }
  const final = maneuvers.at(-1)!;
  if (
    Math.abs(path.length - final.alongMeters - final.distanceMeters) >
      Math.max(60, final.distanceMeters * 0.45) ||
    Math.abs(
      path.length -
        maneuvers.reduce((sum, item) => sum + item.distanceMeters, 0),
    ) > Math.max(100, path.length * 0.25)
  )
    return schematic(
      segment,
      path,
      'Jarak akhir langkah OTP tidak konsisten dengan geometri.',
    );
  return {
    evidence: 'OTP_DERIVED_MANEUVER',
    identity: walkGeometryIdentity(segment),
    path,
    maneuvers,
    reason: null,
  };
}

export function navigationScopeKey(
  journeyId: string,
  acceptedRecoveryId: string | null | undefined,
  segment: SegmentLike,
): string {
  return `${journeyId}:${acceptedRecoveryId ?? 'ORIGINAL'}:${walkGeometryIdentity(segment)}`;
}

export function initialWalkProgress(): WalkProgress {
  return {
    maneuverIndex: 0,
    reliableFixes: 0,
    alongMeters: null,
    lastTimestamp: null,
    status: 'ACQUIRING',
    needsManualReposition: false,
  };
}

function fixAccepted(
  fix: NavigationFix | null,
  state: WalkProgress,
  now: number,
): boolean {
  return Boolean(
    fix &&
    validPoint(fix) &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy! >= 0 &&
    fix.accuracy! <= NAVIGATION_ACCURACY_M &&
    Number.isFinite(fix.timestamp) &&
    fix.timestamp >= 0 &&
    Number.isFinite(now) &&
    fix.timestamp <= now &&
    now - fix.timestamp < NAVIGATION_STALE_MS &&
    (state.lastTimestamp === null || fix.timestamp > state.lastTimestamp),
  );
}

/**
 * Pure state machine. Progress only on fresh, accurate, on-route, monotonic fixes:
 * two consecutive reliable fixes are required, at most one maneuver per update, and
 * advancement needs passing the current maneuver with hysteresis plus real movement.
 */
export function updateWalkProgress(
  navigation: WalkNavigation,
  state: WalkProgress,
  fix: NavigationFix | null,
  now: number,
  paused = false,
): WalkProgress {
  if (paused)
    return {
      ...state,
      reliableFixes: 0,
      alongMeters: null,
      lastTimestamp: null,
      status: 'PAUSED',
    };
  if (
    fix &&
    fix.timestamp === state.lastTimestamp &&
    Number.isFinite(now) &&
    now - fix.timestamp < NAVIGATION_STALE_MS
  )
    return state;
  if (
    navigation.evidence !== 'OTP_DERIVED_MANEUVER' ||
    !fixAccepted(fix, state, now)
  )
    return {
      ...state,
      reliableFixes: 0,
      status: 'UNCERTAIN',
      needsManualReposition: state.needsManualReposition,
    };
  const sample = fix!;
  const projected = projectOnPath(
    sample,
    navigation.path,
    state.alongMeters ?? navigation.maneuvers[state.maneuverIndex]?.alongMeters,
  );
  if (
    !projected ||
    projected.crossTrackMeters > ROUTE_PROXIMITY_M + sample.accuracy!
  )
    return {
      ...state,
      reliableFixes: 0,
      alongMeters: null,
      status: 'UNCERTAIN',
    };
  if (state.alongMeters !== null && state.lastTimestamp !== null) {
    const elapsedSeconds = (sample.timestamp - state.lastTimestamp) / 1000;
    const maximumJump =
      Math.min(MAX_FIX_GAP_S, elapsedSeconds) * MAX_WALK_SPEED_MPS +
      sample.accuracy! +
      JITTER_TOLERANCE_M;
    if (projected.alongMeters - state.alongMeters > maximumJump)
      // Clearing alongMeters lets the next accepted fix reacquire at its own
      // projection instead of being compared against the rejected stale anchor.
      return {
        ...state,
        reliableFixes: 0,
        alongMeters: null,
        status: 'UNCERTAIN',
      };
  }
  const reliableFixes = Math.min(
    RELIABLE_FIXES_REQUIRED,
    state.reliableFixes + 1,
  );
  const elapsedSeconds =
    state.lastTimestamp === null
      ? 0
      : Math.min(
          MAX_FIX_GAP_S,
          (sample.timestamp - state.lastTimestamp) / 1000,
        );
  const alongMeters =
    state.alongMeters === null
      ? projected.alongMeters
      : Math.max(
          state.alongMeters - JITTER_TOLERANCE_M,
          Math.min(
            projected.alongMeters,
            state.alongMeters +
              elapsedSeconds * MAX_WALK_SPEED_MPS +
              sample.accuracy!,
          ),
        );
  const next = navigation.maneuvers[state.maneuverIndex + 1];
  const needsManualReposition = Boolean(
    state.needsManualReposition ||
    (state.alongMeters === null &&
      next &&
      projected.alongMeters >= next.alongMeters + TURN_PASS_MARGIN_M),
  );
  if (reliableFixes < RELIABLE_FIXES_REQUIRED)
    return {
      ...state,
      reliableFixes,
      alongMeters,
      lastTimestamp: sample.timestamp,
      status: 'ACQUIRING',
      needsManualReposition,
    };
  let maneuverIndex = state.maneuverIndex;
  if (
    !needsManualReposition &&
    next &&
    state.alongMeters !== null &&
    state.alongMeters < next.alongMeters + TURN_PASS_MARGIN_M &&
    alongMeters >= next.alongMeters + TURN_PASS_MARGIN_M &&
    alongMeters - state.alongMeters > 1
  )
    maneuverIndex += 1;
  return {
    maneuverIndex,
    reliableFixes: RELIABLE_FIXES_REQUIRED,
    alongMeters,
    lastTimestamp: sample.timestamp,
    status: 'TRACKING',
    needsManualReposition,
  };
}

export function manuallyAdvanceManeuver(
  navigation: WalkNavigation,
  state: WalkProgress,
): WalkProgress {
  return {
    ...initialWalkProgress(),
    maneuverIndex: Math.min(
      Math.max(0, navigation.maneuvers.length - 1),
      state.maneuverIndex + 1,
    ),
  };
}

export function navigationMode(
  segments: readonly SegmentLike[],
  completedCount: number,
  boarding: BoardingState,
): NavMode {
  if (completedCount >= segments.length) return 'ARRIVED';
  const leg = segments[completedCount];
  if (!leg) return 'NAVIGATION_UNAVAILABLE';
  if (leg.mode === 'WALK') {
    const laterTransit = segments
      .slice(completedCount + 1)
      .some((item) => item.mode !== 'WALK');
    if (laterTransit && completedCount === 0) return 'WALK_TO_BOARDING_STOP';
    if (completedCount < segments.length - 1) return 'WALK_TRANSFER';
    return 'WALK_TO_DESTINATION';
  }
  if (boarding.boarded) {
    if (boarding.alighted) return 'ALIGHTING_PENDING';
    return 'ON_TRANSIT_CONFIRMED';
  }
  return 'WAIT_FOR_TRANSIT';
}

export function isWalkingMode(mode: NavMode): boolean {
  return (
    mode === 'WALK_TO_BOARDING_STOP' ||
    mode === 'WALK_TRANSFER' ||
    mode === 'WALK_TO_DESTINATION'
  );
}

export function isOffRoute(
  history: readonly { distance: number | null }[],
  points: PathPoint[] | null,
  sampleCount = OFF_ROUTE_CONFIRM_SAMPLES,
  toleranceMeters = OFF_ROUTE_TOLERANCE_M,
): boolean {
  if (!points || points.length < 2 || history.length < sampleCount)
    return false;
  return history
    .slice(-sampleCount)
    .every(
      (sample) =>
        sample.distance !== null && sample.distance >= toleranceMeters,
    );
}

export type Guidance = Readonly<{
  mode: NavMode;
  title: string;
  detail: string;
  provenance:
    | 'OTP_DERIVED_MANEUVER'
    | 'SCHEMATIC_GEOMETRY'
    | 'CONFIRMED_STATE'
    | 'SCHEDULE_LABEL'
    | 'NO_DEVICE';
  nextInstruction: string | null;
  nextDistanceMeters: number | null;
  remainingMeters: number | null;
  destination: string | null;
  progressStatus: WalkProgress['status'] | null;
}>;

function emptyRouteGuidance(
  mode: NavMode,
  destination: string,
  detail: string,
): Guidance {
  return {
    mode,
    title: `Jalan kaki menuju ${destination}`,
    detail,
    provenance: 'SCHEMATIC_GEOMETRY',
    nextInstruction: null,
    nextDistanceMeters: null,
    remainingMeters: null,
    destination,
    progressStatus: null,
  };
}

/** Walking guidance never derives metrics from an untrusted raw sample. */
function walkingGuidance(
  leg: SegmentLike,
  mode: NavMode,
  progress?: WalkProgress,
): Guidance {
  const destination = leg.to.name || 'tujuan';
  const navigation = prepareWalkNavigation(leg);
  const needsReposition = Boolean(progress?.needsManualReposition);
  if (!navigation)
    return emptyRouteGuidance(
      mode,
      destination,
      'Geometri rute tidak tersedia. Lanjutkan secara manual.',
    );
  const trustedAlong =
    !needsReposition &&
    progress?.status === 'TRACKING' &&
    progress.alongMeters !== null
      ? progress.alongMeters
      : null;
  if (navigation.evidence === 'SCHEMATIC_GEOMETRY')
    return {
      mode,
      title: `Jalan kaki menuju ${destination}`,
      detail: `${navigation.reason ?? 'Langkah belok tidak tersedia'} Panduan skematik, bukan petunjuk belok tervalidasi.`,
      provenance: 'SCHEMATIC_GEOMETRY',
      nextInstruction: null,
      nextDistanceMeters: null,
      remainingMeters:
        trustedAlong === null
          ? null
          : Math.max(0, navigation.path.length - trustedAlong),
      destination,
      progressStatus: progress?.status ?? null,
    };
  const index = progress
    ? Math.min(progress.maneuverIndex, navigation.maneuvers.length - 1)
    : 0;
  const maneuver = navigation.maneuvers[index]!;
  const next = navigation.maneuvers[index + 1] ?? null;
  const remainingMeters =
    trustedAlong === null
      ? navigation.path.length
      : Math.max(0, navigation.path.length - trustedAlong);
  const nextDistanceMeters = next
    ? trustedAlong === null
      ? next.alongMeters
      : Math.max(0, next.alongMeters - trustedAlong)
    : Math.max(0, remainingMeters);
  return {
    mode,
    title: needsReposition ? 'Reposisi diperlukan' : maneuver.instruction,
    detail: needsReposition
      ? 'Posisi awal berada jauh di depan langkah aktif. Gunakan Manuver berikutnya untuk menyesuaikan petunjuk secara manual; jarak GPS belum dipercaya.'
      : trustedAlong === null
        ? 'Jarak diukur dari awal geometri rencana, bukan dari posisi perangkat Anda (perbaikan GPS belum andal).'
        : 'Jarak diukur sepanjang geometri rute dari posisi perangkat yang andal.',
    provenance: 'OTP_DERIVED_MANEUVER',
    nextInstruction: next?.instruction ?? null,
    nextDistanceMeters,
    remainingMeters,
    destination,
    progressStatus: progress?.status ?? null,
  };
}

export function nextGuidance(
  legs: readonly SegmentLike[],
  completedCount: number,
  boarding: BoardingState,
  progress?: WalkProgress,
): Guidance | null {
  if (completedCount >= legs.length)
    return {
      mode: 'ARRIVED',
      title: 'Perjalanan selesai',
      detail: 'Anda sudah tiba di tujuan.',
      provenance: 'CONFIRMED_STATE',
      nextInstruction: null,
      nextDistanceMeters: null,
      remainingMeters: 0,
      destination: null,
      progressStatus: progress?.status ?? null,
    };
  const leg = legs[completedCount];
  if (!leg)
    return {
      mode: 'NAVIGATION_UNAVAILABLE',
      title: 'Navigasi tidak tersedia',
      detail:
        'Panduan tidak dapat dibuat dari rencana ini. Gunakan penandaan manual.',
      provenance: 'NO_DEVICE',
      nextInstruction: null,
      nextDistanceMeters: null,
      remainingMeters: null,
      destination: null,
      progressStatus: null,
    };
  if (leg.mode === 'WALK') {
    const mode = navigationMode(legs, completedCount, boarding);
    return walkingGuidance(leg, mode, progress);
  }
  const serviceNames: Record<string, string> = {
    TRANSJAKARTA: 'TransJakarta',
    MIKROTRANS: 'Mikrotrans',
    KRL: 'KRL',
    MRT_JAKARTA: 'MRT Jakarta',
    LRT_JAKARTA: 'LRT Jakarta',
    LRT_JABODEBEK: 'LRT Jabodebek',
  };
  const owner =
    leg.route_short_name?.trim() && leg.route_short_name !== leg.mode
      ? leg.route_short_name.trim()
      : (serviceNames[leg.mode] ?? 'transportasi umum');
  const base = {
    nextInstruction: null,
    nextDistanceMeters: null,
    remainingMeters: null,
    destination: leg.to.name,
    progressStatus: null,
  } as const;
  if (boarding.boarded) {
    if (boarding.alighted)
      return {
        ...base,
        mode: 'ALIGHTING_PENDING',
        title: 'Turun sudah dikonfirmasi',
        detail: `Anda sudah menandai turun di ${leg.to.name}. Tekan Lanjutkan Perjalanan untuk tahap berikutnya.`,
        provenance: 'SCHEDULE_LABEL',
      };
    return {
      ...base,
      mode: 'ON_TRANSIT_CONFIRMED',
      title: `Sudah naik ${owner}`,
      detail: `Turun di ${leg.to.name} lalu konfirmasi turun.`,
      provenance: 'SCHEDULE_LABEL',
    };
  }
  return {
    ...base,
    mode: 'WAIT_FOR_TRANSIT',
    destination: leg.from.name,
    title: `Menunggu ${owner}`,
    detail: `Berjalan ke ${leg.from.name} dan konfirmasi naik di sana.`,
    provenance: 'SCHEDULE_LABEL',
  };
}

export function modeNavLabel(mode: NavMode): string {
  return {
    PREPARING: 'Menyiapkan navigasi',
    WALK_TO_BOARDING_STOP: 'Jalan menuju halte',
    WALK_TRANSFER: 'Jalan untuk pindah',
    WALK_TO_DESTINATION: 'Jalan menuju tujuan',
    WAIT_FOR_TRANSIT: 'Menunggu transportasi',
    ON_TRANSIT_CONFIRMED: 'Di dalam perjalanan',
    ALIGHTING_PENDING: 'Turun terkonfirmasi',
    ARRIVED: 'Tiba',
    NAVIGATION_UNAVAILABLE: 'Navigasi tidak tersedia',
  }[mode];
}

export function devicePositionFromSample(
  sample: Pick<DevicePosition, 'latitude' | 'longitude'> | null,
): { latitude: number; longitude: number } | null {
  return sample
    ? { latitude: sample.latitude, longitude: sample.longitude }
    : null;
}
