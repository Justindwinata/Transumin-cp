import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { getDatabaseConfig } from '../infrastructure/database/database.config.js';
import { auditWalkingGraph } from './application/graph-quality.js';
import {
  ingestSpatialFoundation,
  type SpatialManifest,
} from './infrastructure/spatial-ingestor.js';
import { buildWalkingGraphFromOpl } from './osm/osm-opl-reader.js';
import { readRailTopologyFromOpl } from './osm/rail-topology-reader.js';

const executeFile = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const manifestPath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json',
);
type Command = 'fetch' | 'validate' | 'ingest' | 'verify';

function command(value: string | undefined): Command {
  if (
    value === 'fetch' ||
    value === 'validate' ||
    value === 'ingest' ||
    value === 'verify'
  )
    return value;
  throw new Error('Expected command: fetch, validate, ingest, or verify');
}
async function loadManifest(): Promise<
  SpatialManifest & Record<string, unknown>
> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as SpatialManifest &
    Record<string, unknown>;
}
async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}
async function assertArtifact(
  filePath: string,
  bytes: number,
  checksum: string,
): Promise<void> {
  const actual = await stat(filePath);
  if (actual.size !== bytes)
    throw new Error(
      `${path.relative(repositoryRoot, filePath)} byte size differs from manifest`,
    );
  if ((await sha256(filePath)) !== checksum)
    throw new Error(
      `${path.relative(repositoryRoot, filePath)} SHA-256 differs from manifest`,
    );
}

async function fetchSnapshot(
  manifest: SpatialManifest & Record<string, unknown>,
): Promise<void> {
  const sourceArchive = manifest.source_archive as {
    path: string;
    bytes: number;
    sha256: string;
  };
  const sourcePath = path.join(repositoryRoot, sourceArchive.path);
  try {
    await assertArtifact(sourcePath, sourceArchive.bytes, sourceArchive.sha256);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const temporary = `${sourcePath}.${process.pid}.part`;
    const response = await fetch(manifest.source.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(1_800_000),
      headers: { 'user-agent': 'TRANSUM-IN-NEXUS/Phase-2A academic research' },
    });
    if (!response.ok || response.body === null)
      throw new Error(`OSM download failed with HTTP ${response.status}`, {
        cause: error,
      });
    const resolved = new URL(response.url);
    if (
      resolved.protocol !== 'https:' ||
      resolved.hostname !== 'download.geofabrik.de'
    )
      throw new Error(`Unexpected OSM download origin: ${response.url}`, {
        cause: error,
      });
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    await assertArtifact(temporary, sourceArchive.bytes, sourceArchive.sha256);
    await rename(temporary, sourcePath);
  }
  const rawPath = path.join(repositoryRoot, manifest.raw.path);
  const oplPath = path.join(repositoryRoot, manifest.processing.opl_path);
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(oplPath), { recursive: true });
  try {
    await Promise.all([
      assertArtifact(rawPath, manifest.raw.bytes, manifest.raw.sha256),
      assertArtifact(
        oplPath,
        Number((manifest.processing as Record<string, unknown>).opl_bytes),
        manifest.processing.opl_sha256,
      ),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const script = `set -eu
apt-get update >/dev/null
apt-get install -y --no-install-recommends osmium-tool >/dev/null
osmium extract --strategy complete_ways --set-bounds --bbox 106.205898,-6.649546,107.217352,-5.994144 ${sourceArchive.path} -o data/raw/osm/2026-09-30/phase2a/jabodetabek-envelope.osm.pbf --overwrite
osmium tags-filter data/raw/osm/2026-09-30/phase2a/jabodetabek-envelope.osm.pbf w/highway n/railway=subway_entrance n/public_transport n/highway=bus_stop w/railway=rail,subway,light_rail n/railway=station,halt,tram_stop -o data/raw/osm/2026-09-30/phase2a/jabodetabek-spatial-filtered.osm.pbf --overwrite
osmium extract --strategy simple --set-bounds --bbox 106.205898,-6.649546,107.217352,-5.994144 data/raw/osm/2026-09-30/phase2a/jabodetabek-spatial-filtered.osm.pbf -o ${manifest.raw.path} --overwrite
osmium cat ${manifest.raw.path} -f opl -o ${manifest.processing.opl_path} --overwrite`;
    await executeFile(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${repositoryRoot}:/workspace`,
        '-w',
        '/workspace',
        'debian@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251',
        'sh',
        '-c',
        script,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    await Promise.all([
      assertArtifact(rawPath, manifest.raw.bytes, manifest.raw.sha256),
      assertArtifact(
        oplPath,
        Number((manifest.processing as Record<string, unknown>).opl_bytes),
        manifest.processing.opl_sha256,
      ),
    ]);
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'VERIFIED_LOCAL', source: sourceArchive.sha256, bounded: manifest.raw.sha256 })}\n`,
  );
}

async function loadValidated(
  manifest: SpatialManifest & Record<string, unknown>,
) {
  await fetchSnapshot(manifest);
  const started = performance.now();
  const graph = await buildWalkingGraphFromOpl(
    path.join(repositoryRoot, manifest.processing.opl_path),
    manifest.dataset_version_id,
  );
  const rail = await readRailTopologyFromOpl(
    path.join(repositoryRoot, manifest.processing.opl_path),
    manifest.dataset_version_id,
  );
  const quality = auditWalkingGraph(graph);
  const expected = manifest.network_quality as typeof quality & {
    source_nodes_processed: number;
    source_ways_processed: number;
    ways_rejected_by_walkability: number;
    missing_boundary_node_references: number;
    network_nodes: number;
    walking_edges: number;
    connected_components: number;
    largest_component_nodes: number;
    isolated_nodes: number;
    dangling_nodes: number;
    duplicate_edges: number;
    zero_length_edges: number;
    self_loops: number;
  };
  const actual = {
    source_nodes_processed: graph.sourceNodeCount,
    source_ways_processed: graph.sourceWayCount,
    ways_rejected_by_walkability: graph.rejectedWayCount,
    missing_boundary_node_references: graph.missingNodeReferenceCount,
    network_nodes: quality.nodes,
    walking_edges: quality.edges,
    connected_components: quality.connectedComponents,
    largest_component_nodes: quality.largestComponentNodes,
    isolated_nodes: quality.isolatedNodes,
    dangling_nodes: quality.danglingNodes,
    duplicate_edges: quality.duplicateEdges,
    zero_length_edges: quality.zeroLengthEdges,
    self_loops: quality.selfLoops,
  };
  for (const [key, value] of Object.entries(actual))
    if (expected[key as keyof typeof expected] !== value)
      throw new Error(`Spatial manifest count mismatch for ${key}: ${value}`);
  return { graph, rail, durationMs: performance.now() - started, quality };
}

async function verifyDatabase(
  manifest: SpatialManifest,
): Promise<Record<string, unknown>> {
  const pool = new Pool(getDatabaseConfig());
  try {
    const result = await pool.query(
      `select
        (select count(*)::int from spatial.network_node where dataset_version_id=$1::uuid) nodes,
        (select count(*)::int from spatial.walking_edge where dataset_version_id=$1::uuid) edges,
        (select count(*)::int from spatial.rail_topology_station where dataset_version_id=$1::uuid) rail_stations,
        (select count(*)::int from spatial.rail_topology_edge where dataset_version_id=$1::uuid) rail_edges,
        (select count(*)::int from spatial.transit_endpoint_resolution where spatial_dataset_version_id=$1::uuid and resolution_status='RESOLVED') resolved,
        (select count(*)::int from spatial.transit_endpoint_resolution where spatial_dataset_version_id=$1::uuid and resolution_status='FALLBACK') fallback,
        (select count(*)::int from spatial.transit_endpoint_resolution where spatial_dataset_version_id=$1::uuid and resolution_status='UNRESOLVED') unresolved,
        (select count(*)::int from meta.source_entity_reference where source_dataset_version_id in ($1::uuid,$2::uuid)) references,
        (select count(*)::int from meta.source_entity_reference ref where ref.source_dataset_version_id=$2::uuid and ref.reference_type in ('OFFICIAL_ID','ROUTE_CODE') and exists (select 1 from transit.route r where r.mobility_entity_id=ref.canonical_entity_id and r.dataset_version_id=$2::uuid)) route_references,
        (select count(*)::int from meta.source_entity_reference ref where ref.source_dataset_version_id=$2::uuid and ref.reference_type='ROUTE_CODE' and exists (select 1 from transit.route r where r.mobility_entity_id=ref.canonical_entity_id and r.dataset_version_id=$2::uuid)) route_code_references,
        (select count(*)::int from meta.entity_alias where source_dataset_version_id in ($1::uuid,$2::uuid)) aliases,
        (select count(*)::int from spatial.interchange_candidate where spatial_dataset_version_id=$1::uuid) interchange_candidates,
        (select count(*)::int from spatial.interchange_candidate where spatial_dataset_version_id=$1::uuid and path_status='CONNECTED') connected_candidates,
        (select count(*)::int from spatial.interchange_candidate where spatial_dataset_version_id=$1::uuid and path_status='DISCONNECTED') disconnected_candidates,
        (select count(*)::int from spatial.interchange_candidate where spatial_dataset_version_id=$1::uuid and path_status='UNRESOLVED') unresolved_candidates,
        (select count(*)::int from spatial.walking_edge where dataset_version_id=$1::uuid and (not ST_IsValid(geom) or ST_SRID(geom)<>4326)) invalid_geometry`,
      [
        manifest.dataset_version_id,
        manifest.transit_snapshot_dependency.dataset_version_id,
      ],
    );
    return result.rows[0] as Record<string, unknown>;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const selected = command(process.argv[2]);
  const manifest = await loadManifest();
  if (selected === 'fetch') {
    await fetchSnapshot(manifest);
    return;
  }
  if (selected === 'verify') {
    process.stdout.write(`${JSON.stringify(await verifyDatabase(manifest))}\n`);
    return;
  }
  const validated = await loadValidated(manifest);
  if (selected === 'validate') {
    process.stdout.write(
      `${JSON.stringify({ status: 'VALID', durationMs: validated.durationMs, quality: validated.quality, railStations: validated.rail.stations.length, railEdges: validated.rail.edges.length })}\n`,
    );
    return;
  }
  const result = await ingestSpatialFoundation(
    manifest,
    validated.graph,
    validated.rail,
  );
  process.stdout.write(
    `${JSON.stringify({ ...result, parseAndValidationMs: validated.durationMs })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
