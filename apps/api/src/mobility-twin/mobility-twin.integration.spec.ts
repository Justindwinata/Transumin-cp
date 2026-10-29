import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { sql } from 'kysely';

import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { KyselyMobilityStateRepository } from './infrastructure/kysely-mobility-state.repository.js';
import { MobilityStateController } from './interface/mobility-state.controller.js';

const sourceId = '70000000-0000-4000-8000-000000000001';
const versionId = '70000000-0000-4000-8000-000000000002';
const entityId = '70000000-0000-4000-8000-000000000003';
const database = createDatabase();
const repository = new KyselyMobilityStateRepository(
  database,
  new OperationalContractValidator(),
);

function observation(
  overrides: Partial<OperationalObservation> = {},
): OperationalObservation {
  return {
    observationId: '70000000-0000-4000-8000-000000000010',
    incidentId: '70000000-0000-4000-8000-000000000011',
    incidentType: 'MANUAL_OPERATOR_INCIDENT',
    affectedEntityRefs: ['fixture:entity'],
    affectedModes: ['MRT_JAKARTA'],
    operationalState: 'UNAVAILABLE',
    evidenceType: 'OBSERVED',
    sourceAuthority: 'OFFICIAL_OPERATOR_CONFIRMED',
    sourceChannel: 'OPERATOR_CONFIRMED',
    impactBasis: 'OPERATOR_CONFIRMED',
    observedAt: '2026-10-01T00:00:00.000Z',
    receivedAt: '2026-10-01T00:00:01.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
    expiresAt: '2026-10-01T01:00:00.000Z',
    reason: 'Fixture operator confirms temporary unavailability.',
    confidenceStatus: 'CONFIRMED',
    confidence: 1,
    provenance: {
      sourceId: '70000000-0000-4000-8000-000000000020',
      sourceClassification: 'PARTNERSHIP_REQUIRED',
      rawReference: 'fixture:operator:1',
      lineageReference: 'fixture:operator:1',
      retrievedAt: '2026-10-01T00:00:01.000Z',
    },
    sourceAttributes: {},
    ...overrides,
  };
}

describe('Phase 2B Mobility Twin persistence and snapshots', () => {
  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    await sql`
      insert into meta.dataset_source (
        id, source_key, name, provider, source_type, verification_status
      ) values (
        ${sourceId}::uuid, 'phase2b-test-source', 'Phase 2B test source',
        'TEST', 'TEST', 'VERIFIED'
      )
    `.execute(database);
    await sql`
      insert into meta.dataset_version (
        id, source_id, version_label, checksum_sha256, retrieved_at,
        raw_path_ref, manifest_path, validation_status
      ) values (
        ${versionId}::uuid, ${sourceId}::uuid, 'phase2b-fixture', ${'7'.repeat(64)},
        '2026-10-01T00:00:00Z', 'fixture', 'fixture', 'VALID'
      )
    `.execute(database);
    await sql`
      insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
      values (${entityId}::uuid, 'STATION', ${versionId}::uuid)
    `.execute(database);
  });

  after(async () => {
    await database.destroy();
  });

  it('persists observations idempotently and records meaningful state transitions', async () => {
    const item = observation();
    const first = await repository.persistObservation(item, entityId);
    const second = await repository.persistObservation(item, entityId);
    assert.equal(first.status, 'INSERTED');
    assert.equal(second.status, 'ALREADY_PERSISTED');
    await assert.rejects(
      sql`update twin.operational_observation set reason='tampered' where id=${item.observationId}::uuid`.execute(
        database,
      ),
      /OPERATIONAL_OBSERVATION_APPEND_ONLY/,
    );

    const unavailable = await repository.projectState(
      entityId,
      new Date('2026-10-01T00:10:00Z'),
    );
    assert.equal(unavailable.operationalState, 'UNAVAILABLE');
    await repository.projectState(entityId, new Date('2026-10-01T00:10:00Z'));
    let history = await repository.getStateHistory(entityId);
    assert.equal(history.length, 1);

    const recovery = observation({
      observationId: '70000000-0000-4000-8000-000000000012',
      incidentId: '70000000-0000-4000-8000-000000000013',
      operationalState: 'AVAILABLE',
      observedAt: '2026-10-01T00:20:00.000Z',
      receivedAt: '2026-10-01T00:20:01.000Z',
      updatedAt: '2026-10-01T00:20:01.000Z',
      expiresAt: '2026-10-01T02:00:00.000Z',
      reason: 'Fixture operator confirms service recovery.',
    });
    await repository.persistObservation(recovery, entityId);
    const available = await repository.projectState(
      entityId,
      new Date('2026-10-01T00:30:00Z'),
    );
    assert.equal(available.operationalState, 'AVAILABLE');
    const expired = await repository.projectState(
      entityId,
      new Date('2026-10-01T02:00:00Z'),
    );
    assert.equal(expired.operationalState, 'UNKNOWN');
    history = await repository.getStateHistory(entityId);
    assert.deepEqual(
      history.map((row) => [row.previousState, row.newState]),
      [
        [null, 'UNAVAILABLE'],
        ['UNAVAILABLE', 'AVAILABLE'],
        ['AVAILABLE', 'UNKNOWN'],
      ],
    );
    await sql`
      update twin.mobility_state set
        operational_state='UNAVAILABLE', evidence_type='OBSERVED',
        observation_id=${item.observationId}::uuid,
        observed_at='2026-09-29T00:00:00Z', expires_at='2026-09-30T00:00:00Z'
      where mobility_entity_id=${entityId}::uuid
    `.execute(database);
    assert.equal(
      (await repository.getCurrentState(entityId)).operationalState,
      'UNKNOWN',
    );
    assert.equal(
      (await repository.getStates([entityId]))[0]?.operationalState,
      'UNKNOWN',
    );
  });

  it('replays state at a cutoff without mutating current state', async () => {
    await repository.persistObservation(
      observation({
        observationId: '70000000-0000-4000-8000-000000000014',
        incidentId: '70000000-0000-4000-8000-000000000015',
        operationalState: 'AVAILABLE',
        observedAt: '2026-10-01T00:05:00.000Z',
        receivedAt: '2026-10-01T00:40:00.000Z',
        updatedAt: '2026-10-01T00:40:00.000Z',
        expiresAt: '2026-10-01T01:30:00.000Z',
        reason: 'Late-received historical fixture.',
      }),
      entityId,
    );
    const beforeRecovery = await repository.replayState(
      entityId,
      new Date('2026-10-01T00:10:00Z'),
    );
    const afterRecovery = await repository.replayState(
      entityId,
      new Date('2026-10-01T00:30:00Z'),
    );
    assert.equal(beforeRecovery.operationalState, 'UNAVAILABLE');
    assert.equal(afterRecovery.operationalState, 'AVAILABLE');
    assert.deepEqual(
      afterRecovery,
      await repository.replayState(entityId, new Date('2026-10-01T00:30:00Z')),
    );
    assert.equal(
      (await repository.getCurrentState(entityId)).operationalState,
      'UNKNOWN',
    );
  });

  it('creates deterministic finalized snapshots and rejects mutation', async () => {
    const input = {
      transitDatasetVersionId: versionId,
      spatialDatasetVersionId: versionId,
      processingVersion: 'PHASE_2B_V1',
      stateCutoffAt: new Date('2026-10-01T00:30:00Z'),
      configuration: { freshness_policy: 'PHASE_2B_V1' },
      manifestRef: 'fixture:phase2b-snapshot',
    } as const;
    const first = await repository.createSnapshot(input);
    const second = await repository.createSnapshot(input);
    const reordered = await repository.createSnapshot({
      ...input,
      configuration: {
        z: { second: true, first: true },
        freshness_policy: 'PHASE_2B_V1',
      },
    });
    const reorderedAgain = await repository.createSnapshot({
      ...input,
      configuration: {
        freshness_policy: 'PHASE_2B_V1',
        z: { first: true, second: true },
      },
    });
    assert.equal(first.snapshotId, second.snapshotId);
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(first.status, 'FINALIZED');
    assert.equal(first.materializedStateCount, 1);
    assert.equal(reordered.snapshotId, reorderedAgain.snapshotId);
    const controller = new MobilityStateController(repository);
    const snapshotEnvelope = await controller.getSnapshot(first.snapshotId);
    assert.equal(
      (snapshotEnvelope.data as Record<string, unknown>).status,
      'FINALIZED',
    );
    const stateEnvelope = await controller.getNetworkState(first.snapshotId);
    assert.equal(
      ((stateEnvelope.data as Record<string, unknown>).entities as unknown[])
        .length,
      1,
    );
    await assert.rejects(
      controller.getNetworkState(
        first.snapshotId,
        undefined,
        '70000000-0000-4000-8000-000000000099',
      ),
      BadRequestException,
    );
    await assert.rejects(
      sql`update twin.network_snapshot set manifest_ref='tampered' where id=${first.snapshotId}::uuid`.execute(
        database,
      ),
      /FINALIZED_NETWORK_SNAPSHOT_IMMUTABLE/,
    );
    await assert.rejects(
      sql`delete from twin.network_snapshot_state where snapshot_id=${first.snapshotId}::uuid`.execute(
        database,
      ),
      /FINALIZED_NETWORK_SNAPSHOT_STATE_IMMUTABLE/,
    );
  });
});
