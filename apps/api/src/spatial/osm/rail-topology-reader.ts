import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { stableUuid } from '../domain/spatial-identity.js';
import type { Coordinate } from '../domain/spatial.types.js';

export type RailOperator =
  'KRL' | 'MRT_JAKARTA' | 'LRT_JAKARTA' | 'LRT_JABODEBEK';

export interface RailTopologyStation extends Coordinate {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly operatorKey: RailOperator;
  readonly externalId: string;
  readonly name: string;
}

export interface RailTopologyEdge {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly operatorKey: RailOperator;
  readonly externalWayId: string;
  readonly railClass: 'RAIL' | 'SUBWAY' | 'LIGHT_RAIL';
  readonly geometry: readonly Coordinate[];
  readonly tags: Readonly<Record<string, string>>;
}

function decode(value: string): string {
  return value
    .replace(/%20%?/g, ' ')
    .replace(/%2c%?/gi, ',')
    .replace(/%28%?/gi, '(')
    .replace(/%29%?/gi, ')');
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
          ? [decode(entry), '']
          : [
              decode(entry.slice(0, separator)),
              decode(entry.slice(separator + 1)),
            ];
      }),
  );
}
function classify(tags: Readonly<Record<string, string>>): RailOperator | null {
  const evidence = Object.values(tags).join(' ').toLocaleLowerCase('en');
  if (evidence.includes('lrt jabodebek')) return 'LRT_JABODEBEK';
  if (evidence.includes('lrt jakarta') || evidence.includes('pt lrt jakarta'))
    return 'LRT_JAKARTA';
  if (evidence.includes('mrt jakarta') || evidence.includes('pt mrt jakarta'))
    return 'MRT_JAKARTA';
  if (
    evidence.includes('kai commuter') ||
    evidence.includes('kereta commuter indonesia')
  )
    return 'KRL';
  return null;
}
function railClass(
  value: string | undefined,
): RailTopologyEdge['railClass'] | null {
  if (value === 'rail') return 'RAIL';
  if (value === 'subway') return 'SUBWAY';
  if (value === 'light_rail') return 'LIGHT_RAIL';
  return null;
}

export async function readRailTopologyFromOpl(
  filePath: string,
  datasetVersionId: string,
): Promise<{
  stations: readonly RailTopologyStation[];
  edges: readonly RailTopologyEdge[];
}> {
  const nodes = new Map<
    string,
    { coordinate: Coordinate; tags: Record<string, string> }
  >();
  const ways: Array<{
    id: string;
    refs: string[];
    tags: Record<string, string>;
    operatorKey: RailOperator;
    railClass: RailTopologyEdge['railClass'];
  }> = [];
  const lines = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    const parts = line.split(' ');
    const tagToken = parts.find((part) => part.startsWith('T'));
    const tags = parseTags(tagToken);
    if (line.startsWith('n')) {
      const x = parts.find((part) => part.startsWith('x'));
      const y = parts.find((part) => part.startsWith('y'));
      if (x !== undefined && y !== undefined)
        nodes.set((parts[0] as string).slice(1), {
          coordinate: {
            longitude: Number(x.slice(1)),
            latitude: Number(y.slice(1)),
          },
          tags,
        });
    } else if (line.startsWith('w')) {
      const operatorKey = classify(tags);
      const classifiedRail = railClass(tags.railway);
      const refs = parts.find((part) => part.startsWith('N'));
      if (operatorKey !== null && classifiedRail !== null && refs !== undefined)
        ways.push({
          id: (parts[0] as string).slice(1),
          refs: refs
            .slice(1)
            .split(',')
            .map((ref) => ref.replace(/^n/, '')),
          tags,
          operatorKey,
          railClass: classifiedRail,
        });
    }
  }
  const stations: RailTopologyStation[] = [];
  for (const [externalId, node] of nodes) {
    const operatorKey = classify(node.tags);
    if (
      operatorKey === null ||
      node.tags.name === undefined ||
      !(
        node.tags.public_transport === 'station' ||
        ['station', 'halt', 'tram_stop'].includes(node.tags.railway ?? '')
      )
    )
      continue;
    const identity = `${datasetVersionId}:${operatorKey}:node:${externalId}`;
    stations.push({
      id: stableUuid('rail-topology-station', identity),
      mobilityEntityId: stableUuid('rail-topology-station-entity', identity),
      operatorKey,
      externalId: `node/${externalId}`,
      name: node.tags.name,
      ...node.coordinate,
    });
  }
  const edges: RailTopologyEdge[] = [];
  for (const way of ways) {
    const geometry = way.refs
      .map((ref) => nodes.get(ref)?.coordinate)
      .filter((point): point is Coordinate => point !== undefined);
    if (geometry.length < 2) continue;
    const identity = `${datasetVersionId}:${way.operatorKey}:way:${way.id}`;
    edges.push({
      id: stableUuid('rail-topology-edge', identity),
      mobilityEntityId: stableUuid('rail-topology-edge-entity', identity),
      operatorKey: way.operatorKey,
      externalWayId: `way/${way.id}`,
      railClass: way.railClass,
      geometry,
      tags: way.tags,
    });
  }
  return { stations, edges };
}
