import type { WalkingGraph } from '../domain/spatial.types.js';

export interface GraphQuality {
  readonly nodes: number;
  readonly edges: number;
  readonly connectedComponents: number;
  readonly largestComponentNodes: number;
  readonly isolatedNodes: number;
  readonly danglingNodes: number;
  readonly duplicateEdges: number;
  readonly zeroLengthEdges: number;
  readonly selfLoops: number;
}

export function auditWalkingGraph(graph: WalkingGraph): GraphQuality {
  const adjacency = new Map<string, Set<string>>();
  const edgeKeys = new Set<string>();
  let duplicateEdges = 0;
  let zeroLengthEdges = 0;
  let selfLoops = 0;
  for (const node of graph.nodes) adjacency.set(node.id, new Set());
  for (const edge of graph.edges) {
    if (edge.lengthM <= 0) zeroLengthEdges += 1;
    if (edge.fromNodeId === edge.toNodeId) selfLoops += 1;
    const key = `${edge.fromNodeId}:${edge.toNodeId}:${edge.sourceWayId}:${edge.segmentSequence}`;
    if (edgeKeys.has(key)) duplicateEdges += 1;
    edgeKeys.add(key);
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  const visited = new Set<string>();
  let connectedComponents = 0;
  let largestComponentNodes = 0;
  for (const nodeId of adjacency.keys()) {
    if (visited.has(nodeId)) continue;
    connectedComponents += 1;
    let componentNodes = 0;
    const stack = [nodeId];
    visited.add(nodeId);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      componentNodes += 1;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    largestComponentNodes = Math.max(largestComponentNodes, componentNodes);
  }
  const degrees = [...adjacency.values()].map((neighbors) => neighbors.size);
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    connectedComponents,
    largestComponentNodes,
    isolatedNodes: degrees.filter((degree) => degree === 0).length,
    danglingNodes: degrees.filter((degree) => degree === 1).length,
    duplicateEdges,
    zeroLengthEdges,
    selfLoops,
  };
}
