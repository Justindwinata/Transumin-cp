export type MapCoordinate = Readonly<{ latitude: number; longitude: number }>;

export type DevicePosition = Readonly<{
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number | null;
  timestamp?: number;
}>;

const EARTH_METERS_PER_DEGREE_LATITUDE = 111_320;
const RING_VERTICES = 48;

export function isValidMapCoordinate(
  candidate: { latitude: unknown; longitude: unknown } | null | undefined,
): candidate is MapCoordinate {
  if (!candidate) return false;
  const { latitude, longitude } = candidate;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

export function isValidDevicePosition(
  candidate: DevicePosition | null | undefined,
): candidate is DevicePosition {
  if (!isValidMapCoordinate(candidate)) return false;
  const { accuracy, heading } = candidate;
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))
    return false;
  if (heading !== undefined && heading !== null)
    return Number.isFinite(heading) && heading >= 0 && heading < 360;
  return true;
}

/** Approximate geodesic circle ring in [lng, lat]; null when inputs are unusable. */
export function deviceAccuracyRing(
  position: MapCoordinate,
  accuracyMeters: number,
): [number, number][] | null {
  if (
    !isValidMapCoordinate(position) ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters <= 0
  )
    return null;
  const latDegrees = accuracyMeters / EARTH_METERS_PER_DEGREE_LATITUDE;
  const lngDegrees =
    latDegrees / Math.max(Math.cos((position.latitude * Math.PI) / 180), 1e-6);
  const ring: [number, number][] = [];
  for (let index = 0; index <= RING_VERTICES; index += 1) {
    const angle = (index / RING_VERTICES) * 2 * Math.PI;
    ring.push([
      position.longitude + lngDegrees * Math.cos(angle),
      position.latitude + latDegrees * Math.sin(angle),
    ]);
  }
  return ring;
}

/** Heading wedge ring (center → arc → center) in [lng, lat]; null when heading unusable. */
export function deviceHeadingWedge(
  position: MapCoordinate,
  headingDegrees: number | null | undefined,
  lengthMeters: number,
  spreadDegrees = 30,
): [number, number][] | null {
  if (
    !isValidMapCoordinate(position) ||
    headingDegrees === null ||
    headingDegrees === undefined ||
    !Number.isFinite(headingDegrees) ||
    headingDegrees < 0 ||
    headingDegrees >= 360 ||
    !Number.isFinite(lengthMeters) ||
    lengthMeters <= 0
  )
    return null;
  const latDegrees = lengthMeters / EARTH_METERS_PER_DEGREE_LATITUDE;
  const lngDegrees =
    latDegrees / Math.max(Math.cos((position.latitude * Math.PI) / 180), 1e-6);
  const ring: [number, number][] = [[position.longitude, position.latitude]];
  const steps = 8;
  for (let index = 0; index <= steps; index += 1) {
    const angle =
      ((headingDegrees - spreadDegrees + (2 * spreadDegrees * index) / steps) *
        Math.PI) /
      180;
    ring.push([
      position.longitude + lngDegrees * Math.sin(angle),
      position.latitude + latDegrees * Math.cos(angle),
    ]);
  }
  ring.push([position.longitude, position.latitude]);
  return ring;
}

export function mapGeometryPoints(
  coordinates: readonly number[][],
): [number, number][] {
  if (
    coordinates.length < 2 ||
    coordinates.length > 10_000 ||
    coordinates.some(
      (point) =>
        point.length !== 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]!) > 180 ||
        Math.abs(point[1]!) > 90,
    )
  )
    return [];
  // Reject the entire leg: filtering bad points would bridge unsupported gaps.
  return coordinates.map((point) => [point[0]!, point[1]!]);
}
