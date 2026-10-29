import { createHash } from 'node:crypto';

import type { OperationalState } from '../../operational-data/domain/operational-data.js';

export const SCENARIO_ACTION_TYPES = [
  'SET_AVAILABILITY',
  'BLOCK_ENTITY',
  'DEGRADE_ENTITY',
  'RESTORE_ENTITY',
] as const;

export type ScenarioActionType = (typeof SCENARIO_ACTION_TYPES)[number];

export type ScenarioAction = Readonly<{
  actionId: string;
  mobilityEntityId: string;
  actionType: ScenarioActionType;
  availability: OperationalState | null;
  reason: string;
}>;

export type ScenarioOverride = Readonly<{
  mobilityEntityId: string;
  baseState: OperationalState;
  overrideState: OperationalState;
  evidenceType: 'SIMULATED';
  actionId: string;
  reason: string;
}>;

export type NetworkEdge = Readonly<{
  mobilityEntityId: string;
  fromNodeId: string;
  toNodeId: string;
  state: OperationalState;
}>;

export type ConnectivityMetrics = Readonly<{
  components: number;
  isolatedNodes: number;
  traversableEdges: number;
  blockedEdges: number;
}>;

export function overrideState(
  baseState: OperationalState,
  action: ScenarioAction,
): ScenarioOverride {
  let value: OperationalState;
  switch (action.actionType) {
    case 'SET_AVAILABILITY':
      if (action.availability === null)
        throw new Error('SET_AVAILABILITY requires availability');
      value = action.availability;
      break;
    case 'BLOCK_ENTITY':
      value = 'UNAVAILABLE';
      break;
    case 'DEGRADE_ENTITY':
      value = 'DEGRADED';
      break;
    case 'RESTORE_ENTITY':
      value = 'AVAILABLE';
      break;
  }
  return {
    mobilityEntityId: action.mobilityEntityId,
    baseState,
    overrideState: value,
    evidenceType: 'SIMULATED',
    actionId: action.actionId,
    reason: action.reason,
  };
}

export function isTraversable(state: OperationalState): boolean {
  return state !== 'UNAVAILABLE';
}

export function analyzeConnectivity(
  edges: readonly NetworkEdge[],
): ConnectivityMetrics {
  const nodes = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  let traversableEdges = 0;
  let blockedEdges = 0;
  for (const edge of edges) {
    nodes.add(edge.fromNodeId);
    nodes.add(edge.toNodeId);
    if (!isTraversable(edge.state)) {
      blockedEdges += 1;
      continue;
    }
    traversableEdges += 1;
    const from = adjacency.get(edge.fromNodeId) ?? new Set<string>();
    const to = adjacency.get(edge.toNodeId) ?? new Set<string>();
    from.add(edge.toNodeId);
    to.add(edge.fromNodeId);
    adjacency.set(edge.fromNodeId, from);
    adjacency.set(edge.toNodeId, to);
  }
  let components = 0;
  let isolatedNodes = 0;
  const visited = new Set<string>();
  for (const node of [...nodes].sort()) {
    if (visited.has(node)) continue;
    components += 1;
    const neighbors = adjacency.get(node);
    if (!neighbors || neighbors.size === 0) isolatedNodes += 1;
    const queue = [node];
    visited.add(node);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }
  return { components, isolatedNodes, traversableEdges, blockedEdges };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function deterministicHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
