export interface WalkingPathResult {
  readonly status: 'CONNECTED' | 'DISCONNECTED' | 'UNRESOLVED';
  readonly distanceM: number | null;
  readonly nodeIds: readonly string[];
}

export interface WalkingPathPort {
  shortestPath(
    fromNodeId: string,
    toNodeId: string,
    maximumDistanceM?: number,
  ): WalkingPathResult;
}
