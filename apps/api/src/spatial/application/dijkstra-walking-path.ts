import type { WalkingEdge } from '../domain/spatial.types.js';
import type {
  WalkingPathPort,
  WalkingPathResult,
} from './walking-path.port.js';

interface QueueEntry {
  readonly nodeId: string;
  readonly distanceM: number;
}

class MinHeap {
  private readonly values: QueueEntry[] = [];
  get length(): number {
    return this.values.length;
  }
  push(value: QueueEntry): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if ((this.values[parent]?.distanceM ?? 0) <= value.distanceM) break;
      this.values[index] = this.values[parent] as QueueEntry;
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): QueueEntry | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length === 0 || last === undefined) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child =
        right < this.values.length &&
        (this.values[right]?.distanceM ?? 0) <
          (this.values[left]?.distanceM ?? 0)
          ? right
          : left;
      if ((this.values[child]?.distanceM ?? 0) >= last.distanceM) break;
      this.values[index] = this.values[child] as QueueEntry;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

export class DijkstraWalkingPath implements WalkingPathPort {
  private readonly adjacency = new Map<
    string,
    Array<{ nodeId: string; distanceM: number }>
  >();
  private readonly knownNodes = new Set<string>();

  constructor(
    edges: readonly Pick<WalkingEdge, 'fromNodeId' | 'toNodeId' | 'lengthM'>[],
  ) {
    for (const edge of edges) {
      this.knownNodes.add(edge.fromNodeId);
      this.knownNodes.add(edge.toNodeId);
      const list = this.adjacency.get(edge.fromNodeId) ?? [];
      list.push({ nodeId: edge.toNodeId, distanceM: edge.lengthM });
      this.adjacency.set(edge.fromNodeId, list);
    }
  }

  shortestPath(
    fromNodeId: string,
    toNodeId: string,
    maximumDistanceM = Number.POSITIVE_INFINITY,
  ): WalkingPathResult {
    if (!this.knownNodes.has(fromNodeId) || !this.knownNodes.has(toNodeId)) {
      return { status: 'UNRESOLVED', distanceM: null, nodeIds: [] };
    }
    const distances = new Map([[fromNodeId, 0]]);
    const previous = new Map<string, string>();
    const queue = new MinHeap();
    queue.push({ nodeId: fromNodeId, distanceM: 0 });
    while (queue.length > 0) {
      const current = queue.pop();
      if (
        current === undefined ||
        current.distanceM !== distances.get(current.nodeId)
      )
        continue;
      if (current.distanceM > maximumDistanceM) break;
      if (current.nodeId === toNodeId) {
        const nodes = [toNodeId];
        while (nodes[0] !== fromNodeId)
          nodes.unshift(previous.get(nodes[0] as string) as string);
        return {
          status: 'CONNECTED',
          distanceM: current.distanceM,
          nodeIds: nodes,
        };
      }
      for (const edge of this.adjacency.get(current.nodeId) ?? []) {
        const candidate = current.distanceM + edge.distanceM;
        if (
          candidate <= maximumDistanceM &&
          candidate < (distances.get(edge.nodeId) ?? Number.POSITIVE_INFINITY)
        ) {
          distances.set(edge.nodeId, candidate);
          previous.set(edge.nodeId, current.nodeId);
          queue.push({ nodeId: edge.nodeId, distanceM: candidate });
        }
      }
    }
    return { status: 'DISCONNECTED', distanceM: null, nodeIds: [] };
  }
}
