import 'reflect-metadata';

import { PetaBencanaOperationalAdapter } from '../operational-data/infrastructure/petabencana-operational.adapter.js';

async function main(): Promise<void> {
  if (process.argv[2] !== 'probe')
    throw new Error('Usage: petabencana.cli.ts probe');
  const started = performance.now();
  const receivedAt = new Date();
  const observations =
    await new PetaBencanaOperationalAdapter().fetchFloodAreas({
      receivedAt,
    });
  process.stdout.write(
    `${JSON.stringify({
      status: 'REACHABLE',
      source: 'PetaBencana documented flood-area API',
      probed_at: receivedAt.toISOString(),
      flood_area_count: observations.length,
      duration_ms: Number((performance.now() - started).toFixed(2)),
      evidence_label: 'LIVE_PROBE_ONLY_NOT_PERSISTED',
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: 'UNREACHABLE',
      probed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      evidence_label: 'EXTERNAL_PROBE_FAILURE',
    })}\n`,
  );
  process.exitCode = 2;
});
