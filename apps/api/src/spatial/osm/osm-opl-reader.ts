import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { geodesicDistanceM } from '../application/geometry.js';
import { stableUuid } from '../domain/spatial-identity.js';
import type {
  NetworkNode,
  OSMWay,
  WalkingEdge,
  WalkingGraph,
} from '../domain/spatial.types.js';
import { evaluateWalkability } from './walkability.js';

interface OplNode {
  readonly id: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly tags: Record<string, string>;
}

function decodeOpl(value: string): string {
  return value
    .replace(/%20%?/g, ' ')
    .replace(/%2c%?/gi, ',')
    .replace(/%3d%?/gi, '=')
    .replace(/%25%?/gi, '%')
    .replace(/%28/gi, '(')
    .replace(/%29/gi, ')')
    .replace(/%2f/gi, '/');
}

function parseTags(token: string | undefined): Record<string, string> {
  if (token === undefined || token === 'T') return {};
  return Object.fromEntries(
    token
      .slice(1)
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=');
        return separator < 0
          ? [decodeOpl(entry), '']
          : [
              decodeOpl(entry.slice(0, separator)),
              decodeOpl(entry.slice(separator + 1)),
            ];
      }),
  );
}

async function forEachLine(
  filePath: string,
  consume: (line: string) => void,
): Promise<void> {
  const lines = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) consume(line);
}

function tokens(line: string): string[] {
  return line.split(' ');
}
function findToken(
  parts: readonly string[],
  prefix: string,
): string | undefined {
  return parts.find((part) => part.startsWith(prefix));
}
function booleanTag(value: string | undefined): boolean | null {
  return value === undefined
    ? null
    : value === 'yes' || value === 'true' || value === '1';
}
function relevantWayTags(
  tags: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const keys = [
    'highway',
    'foot',
    'access',
    'service',
    'pedestrian',
    'motor_vehicle',
    'bridge',
    'tunnel',
    'oneway:foot',
    'foot:forward',
    'foot:backward',
    'foot:conditional',
    'access:conditional',
  ];
  return Object.fromEntries(
    keys.flatMap((key) => (tags[key] === undefined ? [] : [[key, tags[key]]])),
  );
}
function nodeKind(tags: Readonly<Record<string, string>>): NetworkNode['kind'] {
  if (tags.railway === 'subway_entrance' || tags.entrance !== undefined)
    return 'ENTRANCE';
  if (
    tags.public_transport !== undefined ||
    tags.railway === 'station' ||
    tags.highway === 'bus_stop'
  )
    return 'TRANSIT_ACCESS';
  if (tags.highway === 'crossing' || tags.crossing !== undefined)
    return 'CROSSING';
  return 'PEDESTRIAN';
}

export async function buildWalkingGraphFromOpl(
  filePath: string,
  datasetVersionId: string,
): Promise<WalkingGraph> {
  const ways: OSMWay[] = [];
  const referencedNodeIds = new Set<string>();
  const junctionNodeIds = new Set<string>();
  const endpointNodeIds = new Set<string>();
  let sourceWayCount = 0;
  let rejectedWayCount = 0;
  await forEachLine(filePath, (line) => {
    if (!line.startsWith('w')) return;
    sourceWayCount += 1;
    const parts = tokens(line);
    const referenceToken = findToken(parts, 'N');
    const way: OSMWay = {
      id: (parts[0] as string).slice(1),
      refs:
        referenceToken === undefined
          ? []
          : referenceToken
              .slice(1)
              .split(',')
              .map((value) => value.replace(/^n/, '')),
      tags: parseTags(findToken(parts, 'T')),
    };
    if (!evaluateWalkability(way).included || way.refs.length < 2) {
      rejectedWayCount += 1;
      return;
    }
    ways.push(way);
    endpointNodeIds.add(way.refs[0] as string);
    endpointNodeIds.add(way.refs[way.refs.length - 1] as string);
    for (const reference of way.refs) {
      if (referencedNodeIds.has(reference)) junctionNodeIds.add(reference);
      referencedNodeIds.add(reference);
    }
  });

  const coordinates = new Map<string, OplNode>();
  let sourceNodeCount = 0;
  await forEachLine(filePath, (line) => {
    if (!line.startsWith('n')) return;
    sourceNodeCount += 1;
    const firstSpace = line.indexOf(' ');
    const id = line.slice(1, firstSpace < 0 ? undefined : firstSpace);
    if (!referencedNodeIds.has(id)) return;
    const parts = tokens(line);
    const x = findToken(parts, 'x');
    const y = findToken(parts, 'y');
    if (x === undefined || y === undefined) return;
    const longitude = Number(x.slice(1));
    const latitude = Number(y.slice(1));
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    coordinates.set(id, {
      id,
      longitude,
      latitude,
      tags: parseTags(findToken(parts, 'T')),
    });
  });

  const retainedNodeIds = new Set([...junctionNodeIds, ...endpointNodeIds]);
  for (const node of coordinates.values()) {
    if (nodeKind(node.tags) !== 'PEDESTRIAN') retainedNodeIds.add(node.id);
  }
  const nodeUuidByExternal = new Map<string, string>();
  const nodes = [...coordinates.values()]
    .filter((node) => retainedNodeIds.has(node.id))
    .map((node): NetworkNode => {
      const id = stableUuid(
        'spatial-network-node',
        `${datasetVersionId}:${node.id}`,
      );
      nodeUuidByExternal.set(node.id, id);
      return {
        id,
        externalId: node.id,
        longitude: node.longitude,
        latitude: node.latitude,
        kind: nodeKind(node.tags),
        tags: node.tags,
      };
    });

  const edges: WalkingEdge[] = [];
  let missingNodeReferenceCount = 0;
  for (const way of ways) {
    const decision = evaluateWalkability(way);
    const retainedIndexes = way.refs
      .map((reference, index) => (retainedNodeIds.has(reference) ? index : -1))
      .filter((index) => index >= 0);
    for (
      let sequence = 0;
      sequence < retainedIndexes.length - 1;
      sequence += 1
    ) {
      const start = retainedIndexes[sequence] as number;
      const end = retainedIndexes[sequence + 1] as number;
      const geometry = way.refs
        .slice(start, end + 1)
        .map((reference) => coordinates.get(reference));
      const from = geometry[0];
      const to = geometry[geometry.length - 1];
      const fromId = nodeUuidByExternal.get(way.refs[start] as string);
      const toId = nodeUuidByExternal.get(way.refs[end] as string);
      if (
        geometry.some((point) => point === undefined) ||
        from === undefined ||
        to === undefined ||
        fromId === undefined ||
        toId === undefined
      ) {
        missingNodeReferenceCount += 1;
        continue;
      }
      let lengthM = 0;
      for (let index = 0; index < geometry.length - 1; index += 1)
        lengthM += geodesicDistanceM(
          geometry[index] as OplNode,
          geometry[index + 1] as OplNode,
        );
      if (!Number.isFinite(lengthM) || lengthM <= 0 || fromId === toId)
        continue;
      const shared = {
        sourceWayId: way.id,
        segmentSequence: sequence,
        lengthM,
        accessClassification: decision.accessClassification,
        highwayClass: way.tags.highway ?? 'unknown',
        bridge: booleanTag(way.tags.bridge),
        tunnel: booleanTag(way.tags.tunnel),
        tags: relevantWayTags(way.tags),
      } as const;
      if (decision.forward) {
        const identity = `${datasetVersionId}:${way.id}:${sequence}:FORWARD`;
        edges.push({
          ...shared,
          id: stableUuid('spatial-walking-edge', identity),
          mobilityEntityId: stableUuid('spatial-walking-edge-entity', identity),
          fromNodeId: fromId,
          toNodeId: toId,
          direction: 'FORWARD',
          geometry: geometry as readonly OplNode[],
        });
      }
      if (decision.reverse) {
        const identity = `${datasetVersionId}:${way.id}:${sequence}:REVERSE`;
        edges.push({
          ...shared,
          id: stableUuid('spatial-walking-edge', identity),
          mobilityEntityId: stableUuid('spatial-walking-edge-entity', identity),
          fromNodeId: toId,
          toNodeId: fromId,
          direction: 'REVERSE',
          geometry: [...geometry].reverse() as readonly OplNode[],
        });
      }
    }
  }
  return {
    nodes,
    edges,
    sourceNodeCount,
    sourceWayCount,
    rejectedWayCount,
    missingNodeReferenceCount,
  };
}
