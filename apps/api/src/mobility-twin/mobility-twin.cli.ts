import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { KyselyMobilityStateRepository } from './infrastructure/kysely-mobility-state.repository.js';

type Command = 'snapshot' | 'verify';
type PhaseTwoManifest = Readonly<{
  network_snapshot_id: string | null;
  content_hash: string | null;
  state_cutoff_at: string;
  processing_version: string;
  transit_snapshot: { dataset_version_id: string };
  spatial_snapshot: { dataset_version_id: string };
  configuration: Readonly<Record<string, unknown>>;
  manifest_ref: string;
}>;

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const manifestPath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-2-BASE-NETWORK-SNAPSHOT.json',
);

function command(value: string | undefined): Command {
  if (value === 'snapshot' || value === 'verify') return value;
  throw new Error('Expected command: snapshot or verify');
}

async function loadManifest(): Promise<PhaseTwoManifest> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as PhaseTwoManifest;
}

async function main(): Promise<void> {
  const selected = command(process.argv[2]);
  const manifest = await loadManifest();
  const database = createDatabase();
  const repository = new KyselyMobilityStateRepository(
    database,
    new OperationalContractValidator(),
  );
  const input = {
    transitDatasetVersionId: manifest.transit_snapshot.dataset_version_id,
    spatialDatasetVersionId: manifest.spatial_snapshot.dataset_version_id,
    processingVersion: manifest.processing_version,
    stateCutoffAt: new Date(manifest.state_cutoff_at),
    configuration: manifest.configuration,
    manifestRef: manifest.manifest_ref,
  };
  try {
    const started = performance.now();
    const snapshot = await repository.createSnapshot(input);
    const snapshotMs = performance.now() - started;
    if (
      manifest.network_snapshot_id !== null &&
      snapshot.snapshotId !== manifest.network_snapshot_id
    )
      throw new Error('Network snapshot ID differs from the tracked manifest');
    if (
      manifest.content_hash !== null &&
      snapshot.contentHash !== manifest.content_hash
    )
      throw new Error(
        'Network snapshot hash differs from the tracked manifest',
      );
    if (selected === 'snapshot') {
      process.stdout.write(
        `${JSON.stringify({ status: snapshot.status, snapshot, snapshotMs })}\n`,
      );
      return;
    }

    const counts = await sql<{
      entities: number;
      observations: number;
      currentStates: number;
      history: number;
      snapshotStates: number;
    }>`
      select
        (select count(*)::int from twin.mobility_entity) entities,
        (select count(*)::int from twin.operational_observation) observations,
        (select count(*)::int from twin.mobility_state) as "currentStates",
        (select count(*)::int from twin.mobility_state_history) history,
        (select count(*)::int from twin.network_snapshot_state where snapshot_id=${snapshot.snapshotId}::uuid) as "snapshotStates"
    `.execute(database);
    const entityIds = await sql<{ id: string }>`
      select id from twin.mobility_entity order by id limit 100
    `.execute(database);
    const ids = entityIds.rows.map((row) => row.id);
    const singleStarted = performance.now();
    if (ids[0]) await repository.getCurrentState(ids[0]);
    const singleStateMs = performance.now() - singleStarted;
    const batchStarted = performance.now();
    await repository.getStates(ids);
    const batchStateMs = performance.now() - batchStarted;
    const replayStarted = performance.now();
    if (ids[0]) await repository.replayState(ids[0], input.stateCutoffAt);
    const replayMs = performance.now() - replayStarted;
    process.stdout.write(
      `${JSON.stringify({
        status: 'PASS',
        snapshot_id: snapshot.snapshotId,
        content_hash: snapshot.contentHash,
        counts: counts.rows[0],
        performance_ms: {
          single_state_lookup: singleStateMs,
          batch_state_lookup_100: batchStateMs,
          state_at_time_replay: replayMs,
          idempotent_snapshot_lookup: snapshotMs,
        },
      })}\n`,
    );
  } finally {
    await database.destroy();
  }
}

await main();
