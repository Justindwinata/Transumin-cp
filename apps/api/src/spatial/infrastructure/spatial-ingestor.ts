import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { getDatabaseConfig } from '../../infrastructure/database/database.config.js';
import { normalizeAlias, stableUuid } from '../domain/spatial-identity.js';
import type { WalkingGraph } from '../domain/spatial.types.js';
import type {
  RailTopologyEdge,
  RailTopologyStation,
} from '../osm/rail-topology-reader.js';
import { DijkstraWalkingPath } from '../application/dijkstra-walking-path.js';
import { geodesicDistanceM } from '../application/geometry.js';

const BATCH_SIZE = 5_000;

export interface SpatialManifest {
  readonly snapshot_id: string;
  readonly source_id: string;
  readonly dataset_version_id: string;
  readonly version_label: string;
  readonly retrieved_at: string;
  readonly source: {
    readonly provider: string;
    readonly url: string;
    readonly license: string;
    readonly license_url: string;
  };
  readonly raw: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly processing: {
    readonly opl_path: string;
    readonly opl_sha256: string;
    readonly pipeline_version: string;
  };
  readonly transit_snapshot_dependency: {
    readonly snapshot_id: string;
    readonly dataset_version_id: string;
  };
  readonly official_corroboration: Readonly<Record<string, string>>;
}

export type SpatialIngestionResult = {
  readonly status: 'COMPLETED' | 'ALREADY_IMPORTED';
  readonly ingestionRunId: string;
  readonly recordsWritten: number;
};

function lineWkt(
  points: readonly { longitude: number; latitude: number }[],
): string {
  return `LINESTRING(${points.map((point) => `${point.longitude} ${point.latitude}`).join(',')})`;
}

async function registerVersion(
  client: PoolClient,
  manifest: SpatialManifest,
): Promise<void> {
  await client.query(
    `insert into meta.dataset_source (id, source_key, name, provider, source_type, canonical_url, license_name, license_url, access_method, access_notes, coverage_notes, redistribution_rule, verification_status)
     values ($1::uuid, 'geofabrik-java-openstreetmap', 'OpenStreetMap Java extract', $2, 'OSM_PBF', $3, $4, $5, 'HTTPS_DOWNLOAD', 'Dated Geofabrik PBF transformed by pinned osmium-tool workflow.', 'Phase 2A bounded Jabodetabek engineering envelope.', 'ODbL attribution and share-alike obligations apply to derived databases.', 'VERIFIED')
     on conflict (source_key) do update set provider=excluded.provider, canonical_url=excluded.canonical_url, license_name=excluded.license_name, license_url=excluded.license_url, updated_at=now()`,
    [
      manifest.source_id,
      manifest.source.provider,
      manifest.source.url,
      manifest.source.license,
      manifest.source.license_url,
    ],
  );
  await client.query(
    `insert into meta.dataset_version (id, source_id, version_label, checksum_sha256, retrieved_at, raw_path_ref, manifest_path, validation_status, metadata_json)
     values ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6, 'data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json', 'VALID', $7::jsonb)
     on conflict (source_id, version_label) do nothing`,
    [
      manifest.dataset_version_id,
      manifest.source_id,
      manifest.version_label,
      manifest.raw.sha256,
      manifest.retrieved_at,
      manifest.raw.path,
      JSON.stringify({
        snapshotId: manifest.snapshot_id,
        processing: manifest.processing,
        transitSnapshot: manifest.transit_snapshot_dependency.snapshot_id,
      }),
    ],
  );
}

async function insertNodes(
  client: PoolClient,
  versionId: string,
  graph: WalkingGraph,
): Promise<void> {
  for (let start = 0; start < graph.nodes.length; start += BATCH_SIZE) {
    const batch = graph.nodes.slice(start, start + BATCH_SIZE);
    await client.query(
      `insert into spatial.network_node (id, dataset_version_id, external_id, node_kind, geom, source_tags)
       select u.id, $1::uuid, u.external_id, u.node_kind, ST_SetSRID(ST_MakePoint(u.longitude, u.latitude), 4326), u.tags::jsonb
       from unnest($2::uuid[], $3::text[], $4::text[], $5::float8[], $6::float8[], $7::text[]) as u(id, external_id, node_kind, longitude, latitude, tags)`,
      [
        versionId,
        batch.map((row) => row.id),
        batch.map((row) => row.externalId),
        batch.map((row) => row.kind),
        batch.map((row) => row.longitude),
        batch.map((row) => row.latitude),
        batch.map((row) => JSON.stringify(row.tags)),
      ],
    );
  }
}

async function insertWalkingEdges(
  client: PoolClient,
  versionId: string,
  graph: WalkingGraph,
): Promise<void> {
  for (let start = 0; start < graph.edges.length; start += BATCH_SIZE) {
    const batch = graph.edges.slice(start, start + BATCH_SIZE);
    await client.query(
      `insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
       select id, 'WALKING_EDGE', $1::uuid from unnest($2::uuid[]) as id`,
      [versionId, batch.map((row) => row.mobilityEntityId)],
    );
    await client.query(
      `insert into spatial.walking_edge (id, mobility_entity_id, dataset_version_id, from_node_id, to_node_id, source_way_id, segment_sequence, direction, length_m, access_classification, highway_class, bridge, tunnel, geom, source_tags)
       select u.id, u.entity_id, $1::uuid, u.from_id, u.to_id, u.way_id, u.sequence, u.direction, u.length_m, u.access_class, u.highway_class, u.bridge, u.tunnel, ST_GeomFromText(u.wkt, 4326), u.tags::jsonb
       from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::text[], $7::int4[], $8::text[], $9::float8[], $10::text[], $11::text[], $12::bool[], $13::bool[], $14::text[], $15::text[]) as u(id, entity_id, from_id, to_id, way_id, sequence, direction, length_m, access_class, highway_class, bridge, tunnel, wkt, tags)`,
      [
        versionId,
        batch.map((row) => row.id),
        batch.map((row) => row.mobilityEntityId),
        batch.map((row) => row.fromNodeId),
        batch.map((row) => row.toNodeId),
        batch.map((row) => row.sourceWayId),
        batch.map((row) => row.segmentSequence),
        batch.map((row) => row.direction),
        batch.map((row) => row.lengthM),
        batch.map((row) => row.accessClassification),
        batch.map((row) => row.highwayClass),
        batch.map((row) => row.bridge),
        batch.map((row) => row.tunnel),
        batch.map((row) => lineWkt(row.geometry)),
        batch.map((row) => JSON.stringify(row.tags)),
      ],
    );
  }
}

async function insertRailTopology(
  client: PoolClient,
  manifest: SpatialManifest,
  stations: readonly RailTopologyStation[],
  edges: readonly RailTopologyEdge[],
): Promise<void> {
  const versionId = manifest.dataset_version_id;
  const entityIds = [
    ...stations.map((row) => row.mobilityEntityId),
    ...edges.map((row) => row.mobilityEntityId),
  ];
  const entityTypes = [
    ...stations.map(() => 'STATION'),
    ...edges.map(() => 'RAIL_TOPOLOGY_EDGE'),
  ];
  await client.query(
    `insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
     select u.id, u.entity_type, $1::uuid from unnest($2::uuid[], $3::text[]) as u(id, entity_type)`,
    [versionId, entityIds, entityTypes],
  );
  await client.query(
    `insert into spatial.rail_topology_station (id, mobility_entity_id, dataset_version_id, operator_key, external_id, name, geom, official_corroboration_url)
     select u.id, u.entity_id, $1::uuid, u.operator_key, u.external_id, u.name, ST_SetSRID(ST_MakePoint(u.longitude, u.latitude), 4326), u.url
     from unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::float8[], $8::float8[], $9::text[]) as u(id, entity_id, operator_key, external_id, name, longitude, latitude, url)`,
    [
      versionId,
      stations.map((row) => row.id),
      stations.map((row) => row.mobilityEntityId),
      stations.map((row) => row.operatorKey),
      stations.map((row) => row.externalId),
      stations.map((row) => row.name),
      stations.map((row) => row.longitude),
      stations.map((row) => row.latitude),
      stations.map((row) => manifest.official_corroboration[row.operatorKey]),
    ],
  );
  await client.query(
    `insert into spatial.rail_topology_edge (id, mobility_entity_id, dataset_version_id, operator_key, external_way_id, rail_class, geom, source_tags)
     select u.id, u.entity_id, $1::uuid, u.operator_key, u.external_id, u.rail_class, ST_GeomFromText(u.wkt, 4326), u.tags::jsonb
     from unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) as u(id, entity_id, operator_key, external_id, rail_class, wkt, tags)`,
    [
      versionId,
      edges.map((row) => row.id),
      edges.map((row) => row.mobilityEntityId),
      edges.map((row) => row.operatorKey),
      edges.map((row) => row.externalWayId),
      edges.map((row) => row.railClass),
      edges.map((row) => lineWkt(row.geometry)),
      edges.map((row) => JSON.stringify(row.tags)),
    ],
  );
}

async function deriveEndpointsAndReferences(
  client: PoolClient,
  manifest: SpatialManifest,
): Promise<void> {
  const spatialVersion = manifest.dataset_version_id;
  const transitVersion =
    manifest.transit_snapshot_dependency.dataset_version_id;
  const provenance = `data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json#${manifest.snapshot_id}`;
  await client.query(
    `with targets as (
       select mobility_entity_id as entity_id, dataset_version_id as target_version, geom from transit.station where dataset_version_id=$1::uuid
       union all select mobility_entity_id, dataset_version_id, geom from transit.stop where dataset_version_id=$1::uuid
       union all select mobility_entity_id, dataset_version_id, geom from spatial.rail_topology_station where dataset_version_id=$2::uuid
     ), resolved as (
       select t.*,
         case when entrance.distance_m <= 250 then entrance.id when nearest.distance_m <= 300 then nearest.id else null end as node_id,
         case when entrance.distance_m <= 250 then entrance.distance_m when nearest.distance_m <= 300 then nearest.distance_m else null end as distance_m,
         case when entrance.distance_m <= 250 then 'VERIFIED_ENTRANCE' when nearest.distance_m <= 150 then 'NEAREST_PEDESTRIAN_NODE' when nearest.distance_m <= 300 then 'STATION_CENTROID' else 'NONE' end as method,
         case when entrance.distance_m <= 250 or nearest.distance_m <= 150 then 'RESOLVED' when nearest.distance_m <= 300 then 'FALLBACK' else 'UNRESOLVED' end as status
       from targets t
       left join lateral (select n.id, ST_Distance(n.geom::geography,t.geom::geography) distance_m from spatial.network_node n where n.dataset_version_id=$2::uuid and n.node_kind in ('ENTRANCE','TRANSIT_ACCESS') order by n.geom <-> t.geom limit 1) entrance on true
       left join lateral (select n.id, ST_Distance(n.geom::geography,t.geom::geography) distance_m from spatial.network_node n where n.dataset_version_id=$2::uuid order by n.geom <-> t.geom limit 1) nearest on true
     )
     insert into spatial.transit_endpoint_resolution (id, transit_entity_id, transit_dataset_version_id, spatial_dataset_version_id, network_node_id, resolution_method, resolution_status, distance_m, provenance_ref)
     select md5(entity_id::text || ':' || $2::text)::uuid, entity_id, target_version, $2::uuid, node_id, method, status, distance_m, $3 from resolved`,
    [transitVersion, spatialVersion, provenance],
  );
  await client.query(
    `insert into meta.source_entity_reference (id, source_key, operator_key, source_dataset_version_id, external_reference, reference_type, canonical_entity_id, provenance_ref)
     select md5('ref:' || mobility_entity_id::text)::uuid, 'transjakarta-official-gtfs-static', 'TRANSJAKARTA', dataset_version_id, external_id, 'OFFICIAL_ID', mobility_entity_id, $2
     from (select mobility_entity_id,dataset_version_id,external_id from transit.station where dataset_version_id=$1::uuid union all select mobility_entity_id,dataset_version_id,external_id from transit.stop where dataset_version_id=$1::uuid) entities`,
    [transitVersion, provenance],
  );
  await client.query(
    `insert into meta.source_entity_reference (id, source_key, operator_key, source_dataset_version_id, external_reference, reference_type, canonical_entity_id, provenance_ref)
     select md5('osm-ref:' || mobility_entity_id::text)::uuid, 'geofabrik-java-openstreetmap', operator_key, dataset_version_id, external_id, 'OSM_ID', mobility_entity_id, $2
     from spatial.rail_topology_station where dataset_version_id=$1::uuid`,
    [spatialVersion, provenance],
  );
  const aliasRows = await client.query<{
    entityId: string;
    sourceKey: string;
    operatorKey: string;
    versionId: string;
    name: string;
  }>(
    `select mobility_entity_id "entityId", 'transjakarta-official-gtfs-static' "sourceKey", 'TRANSJAKARTA' "operatorKey", dataset_version_id "versionId", name from transit.station where dataset_version_id=$1::uuid
     union all select mobility_entity_id, 'transjakarta-official-gtfs-static', 'TRANSJAKARTA', dataset_version_id, name from transit.stop where dataset_version_id=$1::uuid
     union all select mobility_entity_id, 'geofabrik-java-openstreetmap', operator_key, dataset_version_id, name from spatial.rail_topology_station where dataset_version_id=$2::uuid`,
    [transitVersion, spatialVersion],
  );
  for (let start = 0; start < aliasRows.rows.length; start += BATCH_SIZE) {
    const batch = aliasRows.rows.slice(start, start + BATCH_SIZE);
    await client.query(
      `insert into meta.entity_alias (id, source_key, operator_key, source_dataset_version_id, alias, normalized_alias, canonical_entity_id, alias_type, provenance_ref)
       select u.id, u.source_key, u.operator_key, u.version_id, u.alias, u.normalized, u.entity_id, 'CANONICAL_NAME', $1
       from unnest($2::uuid[], $3::text[], $4::text[], $5::uuid[], $6::text[], $7::text[], $8::uuid[]) as u(id,source_key,operator_key,version_id,alias,normalized,entity_id)`,
      [
        provenance,
        batch.map((row) =>
          stableUuid(
            'entity-alias',
            `${row.sourceKey}:${row.operatorKey}:${row.versionId}:${normalizeAlias(row.name)}:${row.entityId}`,
          ),
        ),
        batch.map((row) => row.sourceKey),
        batch.map((row) => row.operatorKey),
        batch.map((row) => row.versionId),
        batch.map((row) => row.name),
        batch.map((row) => normalizeAlias(row.name)),
        batch.map((row) => row.entityId),
      ],
    );
  }
}

async function deriveRouteReferences(
  client: PoolClient,
  manifest: SpatialManifest,
): Promise<void> {
  const transitVersion =
    manifest.transit_snapshot_dependency.dataset_version_id;
  const provenance = `data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json#${manifest.snapshot_id}`;
  await client.query(
    `insert into meta.source_entity_reference (id, source_key, operator_key, source_dataset_version_id, external_reference, reference_type, canonical_entity_id, provenance_ref)
     select md5('route-id:' || r.mobility_entity_id::text)::uuid, 'transjakarta-official-gtfs-static', o.code, r.dataset_version_id, r.external_id, 'OFFICIAL_ID', r.mobility_entity_id, $2
     from transit.route r join transit.operator o on o.id=r.operator_id and o.dataset_version_id=r.dataset_version_id
     where r.dataset_version_id=$1::uuid
     union all
     select md5('route-code:' || r.mobility_entity_id::text)::uuid, 'transjakarta-official-gtfs-static', o.code, r.dataset_version_id, r.short_name, 'ROUTE_CODE', r.mobility_entity_id, $2
     from transit.route r join transit.operator o on o.id=r.operator_id and o.dataset_version_id=r.dataset_version_id
     where r.dataset_version_id=$1::uuid and nullif(btrim(r.short_name), '') is not null
     on conflict do nothing`,
    [transitVersion, provenance],
  );
}

interface InterchangeEntityRow {
  entityId: string;
  operatorKey: string;
  longitude: number;
  latitude: number;
  resolutionId: string | null;
  nodeId: string | null;
  resolutionStatus: string | null;
}

async function deriveInterchanges(
  client: PoolClient,
  manifest: SpatialManifest,
  graph: WalkingGraph,
): Promise<{
  candidates: number;
  connected: number;
  disconnected: number;
  unresolved: number;
}> {
  const rows = await client.query<InterchangeEntityRow>(
    `with entities as (
       select mobility_entity_id as "entityId", 'TRANSJAKARTA' as "operatorKey", ST_X(geom) as longitude, ST_Y(geom) as latitude from transit.station where dataset_version_id=$1::uuid
       union all select mobility_entity_id, operator_key, ST_X(geom), ST_Y(geom) from spatial.rail_topology_station where dataset_version_id=$2::uuid
     )
     select e.*, r.id as "resolutionId", r.network_node_id as "nodeId", r.resolution_status as "resolutionStatus"
     from entities e left join spatial.transit_endpoint_resolution r on r.transit_entity_id=e."entityId" and r.spatial_dataset_version_id=$2::uuid`,
    [
      manifest.transit_snapshot_dependency.dataset_version_id,
      manifest.dataset_version_id,
    ],
  );
  const pathEngine = new DijkstraWalkingPath(graph.edges);
  const candidates: Array<{
    id: string;
    from: InterchangeEntityRow;
    to: InterchangeEntityRow;
    geodesic: number;
    network: number | null;
    status: 'CONNECTED' | 'DISCONNECTED' | 'UNRESOLVED';
  }> = [];
  for (let leftIndex = 0; leftIndex < rows.rows.length; leftIndex += 1) {
    const from = rows.rows[leftIndex] as InterchangeEntityRow;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rows.rows.length;
      rightIndex += 1
    ) {
      const to = rows.rows[rightIndex] as InterchangeEntityRow;
      if (from.operatorKey === to.operatorKey) continue;
      const geodesic = geodesicDistanceM(from, to);
      if (geodesic > 1_000) continue;
      const ordered =
        from.entityId < to.entityId
          ? ([from, to] as const)
          : ([to, from] as const);
      let status: 'CONNECTED' | 'DISCONNECTED' | 'UNRESOLVED' = 'UNRESOLVED';
      let network: number | null = null;
      if (
        from.resolutionStatus !== 'UNRESOLVED' &&
        to.resolutionStatus !== 'UNRESOLVED' &&
        from.nodeId !== null &&
        to.nodeId !== null
      ) {
        const path = pathEngine.shortestPath(from.nodeId, to.nodeId, 3_000);
        status = path.status === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED';
        network = path.distanceM;
      }
      candidates.push({
        id: stableUuid(
          'interchange-candidate',
          `${manifest.dataset_version_id}:${manifest.transit_snapshot_dependency.snapshot_id}:${ordered[0].entityId}:${ordered[1].entityId}`,
        ),
        from: ordered[0],
        to: ordered[1],
        geodesic,
        network,
        status,
      });
    }
  }
  const provenance = `data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json#${manifest.snapshot_id}`;
  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    await client.query(
      `insert into spatial.interchange_candidate (id,spatial_dataset_version_id,transit_snapshot_id,from_entity_id,to_entity_id,from_resolution_id,to_resolution_id,geodesic_distance_m,network_distance_m,path_status,provenance_ref)
       select u.id,$1::uuid,$2,u.from_id,u.to_id,u.from_resolution,u.to_resolution,u.geodesic,u.network,u.path_status,$3
       from unnest($4::uuid[],$5::uuid[],$6::uuid[],$7::uuid[],$8::uuid[],$9::float8[],$10::float8[],$11::text[]) as u(id,from_id,to_id,from_resolution,to_resolution,geodesic,network,path_status)
       on conflict (spatial_dataset_version_id,transit_snapshot_id,from_entity_id,to_entity_id) do nothing`,
      [
        manifest.dataset_version_id,
        manifest.transit_snapshot_dependency.snapshot_id,
        provenance,
        batch.map((row) => row.id),
        batch.map((row) => row.from.entityId),
        batch.map((row) => row.to.entityId),
        batch.map((row) => row.from.resolutionId),
        batch.map((row) => row.to.resolutionId),
        batch.map((row) => row.geodesic),
        batch.map((row) => row.network),
        batch.map((row) => row.status),
      ],
    );
  }
  return {
    candidates: candidates.length,
    connected: candidates.filter((row) => row.status === 'CONNECTED').length,
    disconnected: candidates.filter((row) => row.status === 'DISCONNECTED')
      .length,
    unresolved: candidates.filter((row) => row.status === 'UNRESOLVED').length,
  };
}

export async function ingestSpatialFoundation(
  manifest: SpatialManifest,
  graph: WalkingGraph,
  rail: {
    readonly stations: readonly RailTopologyStation[];
    readonly edges: readonly RailTopologyEdge[];
  },
): Promise<SpatialIngestionResult> {
  const pool = new Pool(getDatabaseConfig());
  const client = await pool.connect();
  const runId = randomUUID();
  const recordsRead =
    graph.nodes.length +
    graph.edges.length +
    rail.stations.length +
    rail.edges.length;
  try {
    await client.query('begin');
    await client.query('set local synchronous_commit = off');
    await registerVersion(client, manifest);
    const existing = await client.query<{ count: string }>(
      'select count(*)::text count from spatial.network_node where dataset_version_id=$1::uuid',
      [manifest.dataset_version_id],
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      await deriveRouteReferences(client, manifest);
      await deriveInterchanges(client, manifest, graph);
      await client.query('commit');
      return {
        status: 'ALREADY_IMPORTED',
        ingestionRunId: runId,
        recordsWritten: 0,
      };
    }
    await client.query(
      `insert into meta.ingestion_run (id,dataset_version_id,started_at,status,records_read) values ($1::uuid,$2::uuid,now(),'RUNNING',$3)`,
      [runId, manifest.dataset_version_id, recordsRead],
    );
    await insertNodes(client, manifest.dataset_version_id, graph);
    await client.query('drop index spatial.walking_edge_from_idx');
    await client.query('drop index spatial.walking_edge_to_idx');
    await client.query('drop index spatial.walking_edge_geom_gist');
    await insertWalkingEdges(client, manifest.dataset_version_id, graph);
    await client.query(
      'create index walking_edge_from_idx on spatial.walking_edge (from_node_id, dataset_version_id)',
    );
    await client.query(
      'create index walking_edge_to_idx on spatial.walking_edge (to_node_id, dataset_version_id)',
    );
    await client.query(
      'create index walking_edge_geom_gist on spatial.walking_edge using gist (geom)',
    );
    await insertRailTopology(client, manifest, rail.stations, rail.edges);
    await deriveEndpointsAndReferences(client, manifest);
    await deriveRouteReferences(client, manifest);
    await deriveInterchanges(client, manifest, graph);
    await client.query(
      `update meta.ingestion_run set completed_at=now(), status='SUCCEEDED', records_written=$2 where id=$1::uuid`,
      [runId, recordsRead],
    );
    await client.query('commit');
    return {
      status: 'COMPLETED',
      ingestionRunId: runId,
      recordsWritten: recordsRead,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
