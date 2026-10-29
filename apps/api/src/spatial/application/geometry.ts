import type { Coordinate } from '../domain/spatial.types.js';

const EARTH_RADIUS_M = 6_371_008.8;

export function geodesicDistanceM(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const dLatitude = (b.latitude - a.latitude) * radians;
  const dLongitude = (b.longitude - a.longitude) * radians;
  const latitudeA = a.latitude * radians;
  const latitudeB = b.latitude * radians;
  const value =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(value)));
}
