import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { DisruptionIntelligenceService } from './application/disruption-intelligence.service.js';

const sourceId = '80000000-0000-4000-8000-000000000001';
const versionId = '80000000-0000-4000-8000-000000000002';
const snapshotId = '80000000-0000-4000-8000-000000000003';
const nodeIds = [
  '80000000-0000-4000-8000-000000000011',
  '80000000-0000-4000-8000-000000000012',
  '80000000-0000-4000-8000-000000000013',
  '80000000-0000-4000-8000-000000000014',
] as const;
const edgeIds = [
  '80000000-0000-4000-8000-000000000021',
  '80000000-0000-4000-8000-000000000022',
  '80000000-0000-4000-8000-000000000023',
] as const;
const mobilityIds = [
  '80000000-0000-4000-8000-000000000031',
  '80000000-0000-4000-8000-000000000032',
  '80000000-0000-4000-8000-000000000033',
] as const;

const database = createDatabase();
const intelligence = new DisruptionIntelligenceService(database);

describe('Phase 3 disruption and scenario persistence', () => {
  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    await sql`
      insert into meta.dataset_source (
        id, source_key, name, provider, source_type, verification_status
      ) values (
        ${sourceId}::uuid, 'phase3-fixture', 'Phase 3 controlled fixture',
        'TEST', 'CONTROLLED_REPLAY', 'VERIFIED'
      )
    `.execute(database);
    await sql`
      insert into meta.dataset_version (
        id, source_id, version_label, checksum_sha256, retrieved_at,
        raw_path_ref, manifest_path, validation_status
      ) values (
        ${versionId}::uuid, ${sourceId}::uuid, 'phase3-controlled', ${'8'.repeat(64)},
        '2026-10-01T00:00:00Z', 'fixture:phase3', 'fixture:phase3', 'VALID'
      )
    `.execute(database);
    for (const mobilityId of mobilityIds)
      await sql`
        insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
        values (${mobilityId}::uuid, 'WALKING_EDGE', ${versionId}::uuid)
      `.execute(database);
    for (const [index, nodeId] of nodeIds.entries())
      await sql`
        insert into spatial.network_node (
          id, dataset_version_id, external_id, node_kind, geom
        ) values (
          ${nodeId}::uuid, ${versionId}::uuid, ${`phase3-node-${index}`}, 'PEDESTRIAN',
          ST_SetSRID(ST_MakePoint(${106.8 + index * 0.001}, -6.2), 4326)
        )
      `.execute(database);
    for (let index = 0; index < edgeIds.length; index += 1)
      await sql`
        insert into spatial.walking_edge (
          id, mobility_entity_id, dataset_version_id, from_node_id, to_node_id,
          source_way_id, segment_sequence, direction, length_m,
          access_classification, highway_class, geom
        ) values (
          ${edgeIds[index]}::uuid, ${mobilityIds[index]}::uuid, ${versionId}::uuid,
          ${nodeIds[index]}::uuid, ${nodeIds[index + 1]}::uuid,
          'phase3-way', ${index}, 'FORWARD', 110, 'ALLOWED', 'footway',
          ST_SetSRID(ST_MakeLine(
            ST_MakePoint(${106.8 + index * 0.001}, -6.2),
            ST_MakePoint(${106.8 + (index + 1) * 0.001}, -6.2)
          ), 4326)
        )
      `.execute(database);
    await sql`
      insert into twin.network_snapshot (
        id, transit_dataset_version_id, spatial_dataset_version_id,
        processing_version, state_cutoff_at, manifest_ref, content_hash,
        status, finalized_at
      ) values (
        ${snapshotId}::uuid, ${versionId}::uuid, ${versionId}::uuid,
        'PHASE_3_FIXTURE', '2026-10-01T00:00:00Z', 'fixture:phase3',
        ${'9'.repeat(64)}, 'FINALIZED', '2026-10-01T00:00:00Z'
      )
    `.execute(database);
  });

  after(async () => {
    await database.destroy();
  });

  it('persists flood exposure without fabricating a transport closure', async () => {
    const event = await intelligence.createControlledEvent({
      incidentType: 'FLOOD',
      sourceId,
      evidenceType: 'OBSERVED',
      operationalState: 'UNKNOWN',
      effectiveFrom: '2026-10-01T00:00:00Z',
      effectiveTo: '2026-10-01T06:00:00Z',
      receivedAt: '2026-10-01T00:01:00Z',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [106.7999, -6.2001],
            [106.8005, -6.2001],
            [106.8005, -6.1999],
            [106.7999, -6.1999],
            [106.7999, -6.2001],
          ],
        ],
      },
      reason: 'Controlled observed flood fixture; exposure only.',
      provenanceRef: 'fixture:phase3:flood',
      rawReference: 'fixture:phase3:flood',
    });
    const impact = await intelligence.calculateFloodImpact(
      event.eventId,
      snapshotId,
    );
    assert.equal(event.operationalState, 'UNKNOWN');
    assert.equal(impact.directExposedCount, 1);
    assert.equal(impact.confirmedUnavailableCount, 0);
    const rows = await sql<{ kind: string; state: string | null }>`
      select impact_kind kind, resulting_state state
      from disruption.entity_impact where impact_analysis_id=${impact.impactId}::uuid
    `.execute(database);
    assert.deepEqual(rows.rows, [{ kind: 'DIRECT_EXPOSURE', state: null }]);
    await assert.rejects(
      intelligence.createControlledEvent({
        incidentType: 'FLOOD',
        sourceId,
        evidenceType: 'OBSERVED',
        operationalState: 'UNAVAILABLE',
        effectiveFrom: '2026-10-01T00:00:00Z',
        effectiveTo: null,
        receivedAt: '2026-10-01T00:01:00Z',
        geometry: { type: 'Polygon', coordinates: [] },
        reason: 'Invalid inferred closure.',
        provenanceRef: 'fixture:invalid',
        rawReference: 'fixture:invalid',
      }),
      /ENVIRONMENTAL_EXPOSURE_CANNOT_ASSERT_CLOSURE/,
    );
  });

  it('runs an idempotent isolated scenario and preserves immutable base state', async () => {
    const scenario = await intelligence.createScenario({
      name: 'Controlled middle-edge flood block',
      actions: [
        {
          mobilityEntityId: mobilityIds[1],
          actionType: 'BLOCK_ENTITY',
          reason: 'Controlled scenario explicitly blocks the exposed edge.',
        },
      ],
    });
    const first = await intelligence.createAndExecuteRun({
      scenarioId: scenario.scenarioId,
      snapshotId,
      idempotencyKey: 'phase3-controlled-run',
      configuration: { seed: 42 },
    });
    const repeated = await intelligence.createAndExecuteRun({
      scenarioId: scenario.scenarioId,
      snapshotId,
      idempotencyKey: 'phase3-controlled-run',
      configuration: { seed: 42 },
    });
    assert.equal(first.simulationRunId, repeated.simulationRunId);
    assert.equal(first.status, 'COMPLETED');
    const overrides = await intelligence.getOverrides(first.simulationRunId);
    assert.equal(overrides[0]?.evidenceType, 'SIMULATED');
    assert.equal(overrides[0]?.baseState, 'UNKNOWN');
    assert.equal(overrides[0]?.overrideState, 'UNAVAILABLE');
    const impact = await intelligence.getSimulationImpact(
      first.simulationRunId,
    );
    assert.equal(impact.componentsBefore, 1);
    assert.equal(impact.componentsAfter, 2);
    assert.equal(impact.connectivityLoss, 1);
    const base = await sql<{ count: number }>`
      select count(*)::int count from twin.network_snapshot_state
      where snapshot_id=${snapshotId}::uuid
    `.execute(database);
    assert.equal(base.rows[0]?.count, 0);
    await assert.rejects(
      intelligence.createAndExecuteRun({
        scenarioId: scenario.scenarioId,
        snapshotId,
        idempotencyKey: 'phase3-controlled-run',
        configuration: { seed: 43 },
      }),
      /IDEMPOTENCY_CONFLICT/,
    );
  });
});
