import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { DijkstraWalkingPath } from './application/dijkstra-walking-path.js';
import { resolveEndpoint } from './application/endpoint-resolver.js';
import { EntityReferenceResolver } from './application/entity-reference-resolver.js';
import { geodesicDistanceM } from './application/geometry.js';
import { normalizeAlias } from './domain/spatial-identity.js';
import type {
  EntityAliasRecord,
  EntityReferenceRecord,
  OSMWay,
  WalkingEdge,
} from './domain/spatial.types.js';
import { evaluateWalkability } from './osm/walkability.js';
import { readRailTopologyFromOpl } from './osm/rail-topology-reader.js';

function way(tags: Record<string, string>): OSMWay {
  return { id: '1', refs: ['1', '2'], tags };
}

function edge(
  fromNodeId: string,
  toNodeId: string,
  lengthM: number,
): WalkingEdge {
  return {
    id: `${fromNodeId}-${toNodeId}`,
    mobilityEntityId: `entity-${fromNodeId}-${toNodeId}`,
    fromNodeId,
    toNodeId,
    sourceWayId: '1',
    segmentSequence: 0,
    direction: 'FORWARD',
    lengthM,
    accessClassification: 'ALLOWED',
    highwayClass: 'footway',
    bridge: null,
    tunnel: null,
    geometry: [
      { longitude: 106.8, latitude: -6.2 },
      { longitude: 106.81, latitude: -6.2 },
    ],
    tags: {},
  };
}

describe('Phase 2A spatial domain', () => {
  it('filters pedestrian ways and honors explicit access restrictions', () => {
    assert.equal(
      evaluateWalkability(way({ highway: 'footway' })).included,
      true,
    );
    assert.equal(
      evaluateWalkability(way({ highway: 'motorway' })).included,
      false,
    );
    assert.equal(
      evaluateWalkability(way({ highway: 'residential', access: 'private' }))
        .included,
      false,
    );
    assert.equal(
      evaluateWalkability(
        way({ highway: 'residential', access: 'private', foot: 'yes' }),
      ).included,
      true,
    );
    assert.deepEqual(
      evaluateWalkability(way({ highway: 'path', 'oneway:foot': 'yes' }))
        .reverse,
      false,
    );
  });

  it('selects verified entrances first and refuses an unsafe snap', () => {
    const origin = { longitude: 106.8, latitude: -6.2 };
    const candidates = [
      {
        networkNodeId: 'pedestrian',
        kind: 'PEDESTRIAN' as const,
        longitude: 106.8001,
        latitude: -6.2,
      },
      {
        networkNodeId: 'entrance',
        kind: 'ENTRANCE' as const,
        longitude: 106.8002,
        latitude: -6.2,
      },
    ];
    assert.deepEqual(
      resolveEndpoint(origin, candidates, {
        entranceM: 50,
        pedestrianM: 20,
        fallbackM: 100,
      }).method,
      'VERIFIED_ENTRANCE',
    );
    assert.deepEqual(
      resolveEndpoint(
        origin,
        [
          {
            networkNodeId: 'far',
            kind: 'PEDESTRIAN',
            longitude: 107,
            latitude: -6.2,
          },
        ],
        { entranceM: 50, pedestrianM: 20, fallbackM: 100 },
      ),
      { status: 'UNRESOLVED', method: 'NONE' },
    );
  });

  it('keeps source and operator scope when resolving exact references and aliases', () => {
    const references: EntityReferenceRecord[] = [
      {
        sourceKey: 'official-a',
        operatorKey: 'A',
        externalReference: 'ST01',
        referenceType: 'OFFICIAL_ID',
        canonicalEntityId: 'entity-a',
      },
      {
        sourceKey: 'official-b',
        operatorKey: 'B',
        externalReference: 'ST01',
        referenceType: 'OFFICIAL_ID',
        canonicalEntityId: 'entity-b',
      },
    ];
    const aliases: EntityAliasRecord[] = [
      {
        sourceKey: 'official-a',
        operatorKey: 'A',
        alias: 'Central',
        normalizedAlias: normalizeAlias('Central'),
        canonicalEntityId: 'entity-a',
      },
      {
        sourceKey: 'official-a',
        operatorKey: 'A',
        alias: 'Central',
        normalizedAlias: normalizeAlias('Central'),
        canonicalEntityId: 'entity-c',
      },
    ];
    const resolver = new EntityReferenceResolver(references, aliases);
    assert.deepEqual(
      resolver.resolve({
        sourceKey: 'official-a',
        operatorKey: 'A',
        value: 'ST01',
      }),
      {
        status: 'RESOLVED',
        canonicalEntityId: 'entity-a',
        method: 'EXACT_REFERENCE',
      },
    );
    assert.deepEqual(
      resolver.resolve({
        sourceKey: 'official-b',
        operatorKey: 'B',
        value: 'ST01',
      }),
      {
        status: 'RESOLVED',
        canonicalEntityId: 'entity-b',
        method: 'EXACT_REFERENCE',
      },
    );
    assert.equal(
      resolver.resolve({
        sourceKey: 'official-a',
        operatorKey: 'A',
        value: 'Central',
      }).status,
      'AMBIGUOUS',
    );
    assert.deepEqual(
      resolver.resolve({
        sourceKey: 'official-a',
        operatorKey: 'A',
        value: 'Unknown',
      }),
      { status: 'UNRESOLVED' },
    );
  });

  it('calculates deterministic geodesic candidates and shortest walking paths', () => {
    assert.ok(
      geodesicDistanceM(
        { longitude: 106.8, latitude: -6.2 },
        { longitude: 106.801, latitude: -6.2 },
      ) > 100,
    );
    const graph = new DijkstraWalkingPath([
      edge('a', 'b', 100),
      edge('b', 'c', 120),
      edge('a', 'c', 400),
    ]);
    assert.deepEqual(graph.shortestPath('a', 'c'), {
      status: 'CONNECTED',
      distanceM: 220,
      nodeIds: ['a', 'b', 'c'],
    });
    assert.equal(graph.shortestPath('a', 'c', 200).status, 'DISCONNECTED');
    assert.equal(graph.shortestPath('missing', 'c').status, 'UNRESOLVED');
  });

  it('keeps OSM rail ways as topology geometry rather than scheduled service edges', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rail-topology-'));
    const fixture = path.join(directory, 'rail.opl');
    try {
      await writeFile(
        fixture,
        [
          'n1 x106.8 y-6.2 Tname=Alpha,railway=station,operator=PT%20MRT%20Jakarta',
          'n2 x106.81 y-6.21 Tname=Beta,railway=station,operator=PT%20MRT%20Jakarta',
          'w10 Nn1,n2 Trailway=subway,operator=PT%20MRT%20Jakarta',
        ].join('\n'),
      );
      const result = await readRailTopologyFromOpl(fixture, 'fixture-version');
      assert.equal(result.stations.length, 2);
      assert.equal(result.edges.length, 1);
      assert.equal(result.edges[0]?.externalWayId, 'way/10');
      assert.equal(result.edges[0]?.railClass, 'SUBWAY');
      assert.equal('tripId' in (result.edges[0] ?? {}), false);
      assert.equal('schedule' in (result.edges[0] ?? {}), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
