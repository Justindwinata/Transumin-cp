import 'reflect-metadata';

import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import { PetaBencanaOperationalAdapter } from '../operational-data/infrastructure/petabencana-operational.adapter.js';
import { DisruptionIntelligenceService } from './application/disruption-intelligence.service.js';
import { LiveOperationalGateway } from './application/live-operational-gateway.js';
import { OperationalEventBus } from './application/operational-event-bus.js';
import {
  analyzeConnectivity,
  overrideState,
} from './domain/disruption-intelligence.js';
import { KyselyOperationalEntityResolver } from './infrastructure/kysely-operational-entity-resolver.js';

async function ingest(): Promise<void> {
  const database = createDatabase();
  try {
    const validator = new OperationalContractValidator();
    const gateway = new LiveOperationalGateway(
      new KyselyMobilityStateRepository(database, validator),
      new KyselyOperationalEntityResolver(database),
      validator,
      new OperationalEventBus(),
    );
    const intelligence = new DisruptionIntelligenceService(database);
    const snapshot = await sql<{ id: string }>`
      select id from twin.network_snapshot where status='FINALIZED'
      order by created_at desc limit 1
    `.execute(database);
    if (!snapshot.rows[0])
      throw new Error('No finalized network snapshot exists');
    const adapter = new PetaBencanaOperationalAdapter();
    const retrievedAt = new Date();
    const fetchStarted = performance.now();
    const areas = await adapter.fetchFloodAreas({ receivedAt: retrievedAt });
    const fetchMs = performance.now() - fetchStarted;
    const gatewayStarted = performance.now();
    const gatewayResult = await gateway.ingestObservations(
      areas.map((item) => item.observation),
      retrievedAt,
    );
    const gatewayMs = performance.now() - gatewayStarted;
    const impacts = [];
    const impactStarted = performance.now();
    for (const area of areas) {
      const event = await intelligence.persistPetaBencanaFlood(area);
      impacts.push(
        await intelligence.calculateFloodImpact(
          event.eventId,
          snapshot.rows[0].id,
        ),
      );
    }
    const impactMs = performance.now() - impactStarted;
    process.stdout.write(
      `${JSON.stringify({
        status: 'COMPLETED',
        evidence_type: 'OBSERVED',
        retrieved_at: retrievedAt.toISOString(),
        flood_areas: areas.length,
        observations_inserted: gatewayResult.inserted,
        observations_duplicate: gatewayResult.duplicates,
        unresolved_environmental_references:
          gatewayResult.unresolvedReferences.length,
        direct_exposures: impacts.reduce(
          (sum, item) => sum + item.directExposedCount,
          0,
        ),
        confirmed_unavailable: impacts.reduce(
          (sum, item) => sum + item.confirmedUnavailableCount,
          0,
        ),
        snapshot_id: snapshot.rows[0].id,
        performance_ms: {
          source_fetch: Number(fetchMs.toFixed(3)),
          observation_ingest: Number(gatewayMs.toFixed(3)),
          flood_impact: Number(impactMs.toFixed(3)),
        },
      })}\n`,
    );
  } finally {
    await database.destroy();
  }
}

function benchmark(): void {
  const edges = Array.from({ length: 10_000 }, (_, index) => ({
    mobilityEntityId: `edge-${index}`,
    fromNodeId: `node-${index}`,
    toNodeId: `node-${index + 1}`,
    state: index === 5000 ? ('UNAVAILABLE' as const) : ('UNKNOWN' as const),
  }));
  const connectivityStarted = performance.now();
  const connectivity = analyzeConnectivity(edges);
  const connectivityMs = performance.now() - connectivityStarted;
  const overrideStarted = performance.now();
  for (let index = 0; index < 10_000; index += 1)
    overrideState('UNKNOWN', {
      actionId: `action-${index}`,
      mobilityEntityId: `edge-${index}`,
      actionType: 'BLOCK_ENTITY',
      availability: null,
      reason: 'Controlled benchmark.',
    });
  const overrideMs = performance.now() - overrideStarted;
  const bus = new OperationalEventBus();
  const sseStarted = performance.now();
  for (let index = 0; index < 10_000; index += 1)
    bus.publish({
      type: 'disruption.detected',
      entityId: null,
      incidentId: null,
      observationId: null,
      evidenceType: 'SIMULATED',
      operationalState: 'UNKNOWN',
      sourceId: null,
      metadata: { sequence: index },
    });
  const sseMs = performance.now() - sseStarted;
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      sample: { edges: 10_000, overrides: 10_000, events: 10_000 },
      connectivity,
      performance_ms: {
        connectivity_10k_edges: Number(connectivityMs.toFixed(3)),
        scenario_override_10k: Number(overrideMs.toFixed(3)),
        sse_publication_10k: Number(sseMs.toFixed(3)),
      },
    })}\n`,
  );
}

async function verify(): Promise<void> {
  const database = createDatabase();
  try {
    const result = await sql<{
      events: number;
      exposures: number;
      falseClosures: number;
      completedRuns: number;
      simulatedOverrides: number;
      nonSimulatedOverrides: number;
    }>`
      select
        (select count(*)::int from disruption.event) events,
        (select count(*)::int from disruption.entity_impact where impact_kind='DIRECT_EXPOSURE') exposures,
        (select count(*)::int from disruption.entity_impact where impact_kind='DIRECT_EXPOSURE' and resulting_state is not null) "falseClosures",
        (select count(*)::int from simulation.run where status='COMPLETED') "completedRuns",
        (select count(*)::int from simulation.state_override where evidence_type='SIMULATED') "simulatedOverrides",
        (select count(*)::int from simulation.state_override where evidence_type<>'SIMULATED') "nonSimulatedOverrides"
    `.execute(database);
    process.stdout.write(
      `${JSON.stringify({
        status:
          result.rows[0]?.falseClosures === 0 &&
          result.rows[0]?.nonSimulatedOverrides === 0
            ? 'PASS'
            : 'FAIL',
        ...result.rows[0],
      })}\n`,
    );
  } finally {
    await database.destroy();
  }
}

const command = process.argv[2];
void (
  command === 'ingest'
    ? ingest()
    : command === 'verify'
      ? verify()
      : command === 'benchmark'
        ? Promise.resolve(benchmark())
        : Promise.reject(
            new Error('Usage: disruption.cli.ts ingest|verify|benchmark'),
          )
).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
