import type { AccessClassification, OSMWay } from '../domain/spatial.types.js';

const WALKABLE_HIGHWAYS = new Set([
  'bridleway',
  'busway',
  'corridor',
  'crossing',
  'cycleway',
  'footway',
  'living_street',
  'path',
  'pedestrian',
  'primary',
  'primary_link',
  'residential',
  'road',
  'secondary',
  'secondary_link',
  'service',
  'steps',
  'tertiary',
  'tertiary_link',
  'track',
  'unclassified',
]);

const DENIED = new Set(['no', 'private']);
const EXPLICIT_ALLOWED = new Set([
  'yes',
  'designated',
  'permissive',
  'destination',
]);

export interface WalkabilityDecision {
  readonly included: boolean;
  readonly accessClassification: AccessClassification;
  readonly forward: boolean;
  readonly reverse: boolean;
  readonly reason: string;
}

export function evaluateWalkability(way: OSMWay): WalkabilityDecision {
  const highway = way.tags.highway;
  if (highway === undefined || !WALKABLE_HIGHWAYS.has(highway)) {
    return {
      included: false,
      accessClassification: 'UNKNOWN',
      forward: false,
      reverse: false,
      reason: 'HIGHWAY_NOT_WALKABLE',
    };
  }
  const foot = way.tags.foot;
  const generalAccess = way.tags.access;
  if (foot !== undefined && DENIED.has(foot)) {
    return {
      included: false,
      accessClassification: 'UNKNOWN',
      forward: false,
      reverse: false,
      reason: 'FOOT_DENIED',
    };
  }
  if (
    foot === undefined &&
    generalAccess !== undefined &&
    DENIED.has(generalAccess)
  ) {
    return {
      included: false,
      accessClassification: 'UNKNOWN',
      forward: false,
      reverse: false,
      reason: 'ACCESS_DENIED',
    };
  }
  const accessClassification: AccessClassification =
    way.tags['access:conditional'] !== undefined ||
    way.tags['foot:conditional'] !== undefined
      ? 'CONDITIONAL'
      : foot !== undefined && EXPLICIT_ALLOWED.has(foot)
        ? 'ALLOWED'
        : 'UNKNOWN';
  const pedestrianOneWay = way.tags['oneway:foot'];
  const forward =
    way.tags['foot:forward'] !== 'no' && pedestrianOneWay !== '-1';
  const reverse =
    way.tags['foot:backward'] !== 'no' && pedestrianOneWay !== 'yes';
  return {
    included: forward || reverse,
    accessClassification,
    forward,
    reverse,
    reason: 'INCLUDED',
  };
}
