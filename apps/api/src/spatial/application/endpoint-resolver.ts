import type {
  Coordinate,
  EndpointCandidate,
  EndpointResolution,
} from '../domain/spatial.types.js';
import { geodesicDistanceM } from './geometry.js';

export interface EndpointThresholds {
  readonly entranceM: number;
  readonly pedestrianM: number;
  readonly fallbackM: number;
}

export function resolveEndpoint(
  origin: Coordinate,
  candidates: readonly EndpointCandidate[],
  thresholds: EndpointThresholds,
): EndpointResolution {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      distanceM: geodesicDistanceM(origin, candidate),
    }))
    .sort(
      (a, b) =>
        a.distanceM - b.distanceM ||
        a.candidate.networkNodeId.localeCompare(b.candidate.networkNodeId),
    );
  const entrance = ranked.find(
    (item) =>
      (item.candidate.kind === 'ENTRANCE' ||
        item.candidate.kind === 'TRANSIT_ACCESS') &&
      item.distanceM <= thresholds.entranceM,
  );
  if (entrance !== undefined)
    return {
      status: 'RESOLVED',
      method: 'VERIFIED_ENTRANCE',
      networkNodeId: entrance.candidate.networkNodeId,
      distanceM: entrance.distanceM,
    };
  const pedestrian = ranked.find(
    (item) => item.distanceM <= thresholds.pedestrianM,
  );
  if (pedestrian !== undefined)
    return {
      status: 'RESOLVED',
      method: 'NEAREST_PEDESTRIAN_NODE',
      networkNodeId: pedestrian.candidate.networkNodeId,
      distanceM: pedestrian.distanceM,
    };
  const fallback = ranked.find(
    (item) => item.distanceM <= thresholds.fallbackM,
  );
  if (fallback !== undefined)
    return {
      status: 'FALLBACK',
      method: 'STATION_CENTROID',
      networkNodeId: fallback.candidate.networkNodeId,
      distanceM: fallback.distanceM,
    };
  return { status: 'UNRESOLVED', method: 'NONE' };
}
