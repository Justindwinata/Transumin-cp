import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import type { AcceptRecoveryInput } from './application/recovery.repository.port.js';
import { ActiveJourneyService } from './application/active-journey.service.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';
import { KyselyRecoveryRepository } from './infrastructure/kysely-recovery.repository.js';

const database = createDatabase();
const repository = new KyselyRecoveryRepository(database);

const digest = (key: string) => createHash('sha256').update(key).digest('hex');
const ids = {
  source: randomUUID(),
  checksum: digest(randomUUID()),
  networkHash: digest(randomUUID()),
  planFingerprint: digest(randomUUID()),
  routeManifestHash: digest(randomUUID()),
  graphHash: digest(randomUUID()),
  snapshotHash: digest(randomUUID()),
  legFingerprint: digest(randomUUID()),
  transitionFingerprint: digest(randomUUID()),
  version: randomUUID(),
  snapshot: randomUUID(),
  owner: `m6:${randomUUID()}`,
  journey: randomUUID(),
  originalEntity: randomUUID(),
  replacementEntity: randomUUID(),
  blockedEntity: randomUUID(),
  transition: randomUUID(),
  impact: randomUUID(),
  recovery: randomUUID(),
  proposalFingerprint: digest(randomUUID()),
} as const;
const acceptedAt = '2026-10-13T04:00:00.000Z';

before(async () => {
  const identity = await sql<{
    name: string;
  }>`select current_database() as name`.execute(database);
  assert.match(
    identity.rows[0]?.name ?? '',
    /^tnx_lightweight_[0-9a-f]{32}$/,
    'M6 mutation tests require Tier A scratch database.',
  );
  await migrateToLatest(database);
  await sql`
    insert into meta.dataset_source (
      id, source_key, name, provider, source_type, verification_status
    ) values (
      ${ids.source}::uuid, ${`m6-fixture-${ids.source}`}, 'M6 fixture',
      'Test', 'SYNTHETIC_TEST', 'VERIFIED'
    )
  `.execute(database);
  await sql`
    insert into meta.dataset_version (
      id, source_id, version_label, checksum_sha256, retrieved_at,
      raw_path_ref, manifest_path, validation_status
    ) values (
      ${ids.version}::uuid, ${ids.source}::uuid, 'm6-fixture', ${ids.checksum},
      now(), 'fixture:SIMULATED', 'fixture:SIMULATED', 'VALID'
    )
  `.execute(database);
  await sql`
    insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
    values
      (${ids.originalEntity}::uuid, 'ROUTE', ${ids.version}::uuid),
      (${ids.replacementEntity}::uuid, 'ROUTE', ${ids.version}::uuid),
      (${ids.blockedEntity}::uuid, 'ROUTE', ${ids.version}::uuid)
  `.execute(database);
  await sql`
    insert into twin.network_snapshot (
      id, transit_dataset_version_id, spatial_dataset_version_id,
      processing_version, state_cutoff_at, configuration_json, manifest_ref,
      content_hash, status, finalized_at
    ) values (
      ${ids.snapshot}::uuid, ${ids.version}::uuid, ${ids.version}::uuid,
      'PHASE_M6_TEST', now(), '{}'::jsonb, 'fixture:SIMULATED',
      ${ids.networkHash}, 'FINALIZED', now()
    )
  `.execute(database);
  await sql`
    insert into journey.journey_plan (
      id, owner_ref, plan_fingerprint, original_plan_json,
      origin_lat, origin_lon, destination_lat, destination_lon,
      planned_start_at, planned_end_at, routing_snapshot_id,
      routing_manifest_sha256, graph_sha256, network_snapshot_id,
      network_snapshot_hash, mobility_projection_version, service_date,
      timezone, planned_at
    ) values (
      ${ids.journey}::uuid, ${ids.owner}, ${ids.planFingerprint},
      ${JSON.stringify(journeyJson(ids.originalEntity))}::jsonb,
      -6.2, 106.8, -6.3, 106.9,
      '2026-10-13T03:00:00.000Z', '2026-10-13T05:00:00.000Z',
      'm6-routing', ${ids.routeManifestHash}, ${ids.graphHash},
      ${ids.snapshot}::uuid, ${ids.snapshotHash}, 'PHASE_M6_TEST',
      '2026-10-13'::date, 'Asia/Jakarta', now()
    )
  `.execute(database);
  await sql`
    insert into journey.journey_leg (
      id, journey_id, sequence, mode, start_at, end_at,
      timing_precision, leg_fingerprint, original_leg_json
    ) values (
      ${randomUUID()}::uuid, ${ids.journey}::uuid, 0, 'TRANSJAKARTA',
      '2026-10-13T03:00:00.000Z', '2026-10-13T03:30:00.000Z',
      'FREQUENCY_DERIVED', ${ids.legFingerprint},
      ${JSON.stringify({ sequence: 0 })}::jsonb
    )
  `.execute(database);
  await sql`
    insert into journey.active_journey (journey_id, lifecycle_status, activated_at)
    values (${ids.journey}::uuid, 'ACTIVE', '2026-10-13T03:00:00.000Z'::timestamptz)
  `.execute(database);
  await sql`
    insert into journey.journey_progress (
      journey_id, completed_leg_count, current_leg_sequence,
      progress_method, recorded_at, revision
    ) values (
      ${ids.journey}::uuid, 1, 1, 'CONTROLLED_MANUAL',
      '2026-10-13T03:30:00.000Z'::timestamptz, 2
    )
  `.execute(database);
  await sql`
    insert into twin.mobility_state_history (
      id, mobility_entity_id, previous_state, new_state, effective_at,
      evidence_type, freshness_status, provenance_ref, reason,
      projection_version, transition_fingerprint
    ) values (
      ${ids.transition}::uuid, ${ids.originalEntity}::uuid, 'AVAILABLE', 'UNAVAILABLE',
      '2026-10-13T03:30:00.000Z'::timestamptz, 'SIMULATED', 'FRESH',
      'fixture:SIMULATED', 'M6 fixture disruption', 'PHASE_M6_TEST', ${ids.transitionFingerprint}
    )
  `.execute(database);
  await sql`
    insert into journey.journey_impact (
      id, journey_id, owner_ref, state_transition_id, mobility_entity_id,
      impact_status, operational_state, evidence_type, freshness_status,
      provenance_ref, projection_version
    ) values (
      ${ids.impact}::uuid, ${ids.journey}::uuid, ${ids.owner},
      ${ids.transition}::uuid, ${ids.originalEntity}::uuid,
      'BLOCKING', 'UNAVAILABLE', 'SIMULATED', 'FRESH',
      'fixture:SIMULATED', 'PHASE_M6_TEST'
    )
  `.execute(database);
  await sql`
    insert into recovery.recovery_plan (
      id, active_journey_id, impact_id, owner_ref, idempotency_key,
      method, status, progress_revision, completed_leg_count,
      recovery_anchor_name, recovery_anchor_lat, recovery_anchor_lon,
      recovery_at, network_snapshot_id, mobility_projection_version,
      original_journey_fingerprint, proposed_fingerprint, baseline_fingerprint,
      preserved_leg_count, eligible_remaining_leg_count, changed_leg_count,
      added_travel_time_seconds, added_transfers, plan_change_count,
      disrupted_entity_avoided, state_validation_ms, preservation_processing_ms,
      proposed_routing_ms, baseline_routing_ms, total_computation_ms,
      triggering_entity_id, state_transition_id, reason,
      proposed_journey_json, baseline_journey_json, comparison_json
    ) values (
      ${ids.recovery}::uuid, ${ids.journey}::uuid, ${ids.impact}::uuid,
      ${ids.owner}, 'm6-recovery-key', 'STATE_AWARE_REPAIR', 'COMPLETED',
      2, 1, 'anchor', -6.21, 106.81,
      '2026-10-13T03:30:00.000Z'::timestamptz, ${ids.snapshot}::uuid,
      'PHASE_M6_TEST', ${ids.planFingerprint}, ${ids.proposalFingerprint},
      ${'9'.repeat(64)}, 1, 1, 1, 120, 0, 1, true,
      1, 1, 1, 1, 5, ${ids.originalEntity}::uuid, ${ids.transition}::uuid,
      'M6 fixture recovery', ${JSON.stringify(journeyJson(ids.replacementEntity))}::jsonb,
      null, ${JSON.stringify({ recoveryId: ids.recovery })}::jsonb
    )
  `.execute(database);
});

after(async () => {
  // Immutable evidence remains until invocation-owned scratch DB disposal.
  await database.destroy();
});

describe('active journey accepted continuation (Tier A SIMULATED)', () => {
  it('maps completed history plus replacement suffix without replay; guards old actions and completes replacement', async () => {
    const activeRepository = new KyselyActiveJourneyRepository(database);
    const journeys = new ActiveJourneyService(activeRepository);
    const original = (await journeys.get(ids.journey, ids.owner)).originalPlan;
    const suffix = journeyJson(ids.replacementEntity)!;
    const transit = { ...suffix.legs[0]!, sequence: 1 };
    const walk = {
      ...transit,
      sequence: 0,
      mode: 'WALK' as const,
      otpMode: 'WALK',
      entityBindings: [],
      routeId: null,
      tripId: null,
    };
    const replacement = { ...suffix, legs: [walk, transit] };
    await repository.accept({
      recoveryId: ids.recovery,
      ownerRef: ids.owner,
      idempotencyKey: 'continuation-accept-key',
      progressRevision: 2,
      acceptedJourney: replacement,
      acceptedJourneyFingerprint: ids.proposalFingerprint,
      acceptedAt,
    });
    const accepted = await journeys.get(ids.journey, ids.owner);
    assert.deepEqual(accepted.originalPlan, original);
    assert.equal(accepted.planFingerprint, ids.planFingerprint);
    assert.deepEqual(
      accepted.currentPlan!.legs.map((l) => l.sequence),
      [0, 1, 2],
    );
    assert.deepEqual(accepted.currentPlan!.legs[0], original.legs[0]);
    assert.equal(accepted.currentPlan!.legs[1]!.mode, 'WALK');
    assert.equal(
      accepted.currentPlan!.legs[2]!.entityBindings[0]!.mobilityEntityId,
      ids.replacementEntity,
    );
    assert.equal(accepted.progress.completedLegCount, 1);
    assert.equal(accepted.progress.currentLegSequence, 1);
    assert.equal(accepted.progress.revision, 2);
    assert.deepEqual(
      accepted.dependencies.map((d) => [d.legSequence, d.mobilityEntityId]),
      [[2, ids.replacementEntity]],
    );
    const action = {
      journeyId: ids.journey,
      ownerRef: ids.owner,
      legSequence: 1,
      confirmedAt: acceptedAt,
    };
    await assert.rejects(journeys.confirmBoarding(action), {
      code: 'STALE_ROUTE',
    });
    await assert.rejects(journeys.confirmAlighting(action), {
      code: 'STALE_ROUTE',
    });
    await assert.rejects(
      journeys.updateProgress({
        journeyId: ids.journey,
        ownerRef: ids.owner,
        completedLegCount: 2,
        currentLegSequence: 2,
        recordedAt: acceptedAt,
      }),
      { code: 'STALE_ROUTE' },
    );
    await assert.rejects(
      journeys.confirmBoarding({ ...action, acceptedRecoveryId: ids.recovery }),
      { code: 'INVALID_BOARDING' },
    );
    const walkDone = await journeys.updateProgress({
      journeyId: ids.journey,
      ownerRef: ids.owner,
      completedLegCount: 2,
      currentLegSequence: 2,
      recordedAt: acceptedAt,
      acceptedRecoveryId: ids.recovery,
    });
    assert.equal(walkDone.lifecycleStatus, 'ACTIVE');
    const transitAction = {
      ...action,
      legSequence: 2,
      acceptedRecoveryId: ids.recovery,
    };
    await assert.rejects(journeys.confirmAlighting(transitAction), {
      code: 'INVALID_BOARDING',
    });
    await assert.rejects(
      journeys.updateProgress({
        journeyId: ids.journey,
        ownerRef: ids.owner,
        completedLegCount: 3,
        currentLegSequence: null,
        recordedAt: acceptedAt,
        acceptedRecoveryId: ids.recovery,
      }),
      { code: 'INVALID_PROGRESS' },
    );
    const boarded = await journeys.confirmBoarding(transitAction);
    assert.equal(boarded.progress.boardingConfirmedLegSequence, 2);
    const retried = await journeys.confirmBoarding(transitAction);
    assert.equal(retried.progress.revision, boarded.progress.revision);
    const exited = await journeys.confirmAlighting(transitAction);
    assert.equal(exited.progress.alightingConfirmedLegSequence, 2);
    const completed = await journeys.updateProgress({
      journeyId: ids.journey,
      ownerRef: ids.owner,
      completedLegCount: 3,
      currentLegSequence: null,
      recordedAt: acceptedAt,
      acceptedRecoveryId: ids.recovery,
    });
    assert.equal(completed.lifecycleStatus, 'COMPLETED');
    assert.deepEqual(completed.originalPlan, original);
    assert.deepEqual(completed.currentPlan, accepted.currentPlan);
    const impact = await sql<{
      resolved: Date | null;
    }>`select resolved_at as resolved from journey.journey_impact where id=${ids.impact}::uuid`.execute(
      database,
    );
    assert.equal(
      impact.rows[0]!.resolved,
      null,
      'Acceptance must not resolve blocking state',
    );
  });
});

function journeyJson(entityId: string): AcceptRecoveryInput['acceptedJourney'] {
  return {
    journeyId: entityId,
    origin: { latitude: -6.2, longitude: 106.8 },
    destination: { latitude: -6.3, longitude: 106.9 },
    startAt: '2026-10-13T03:00:00.000Z',
    endAt: '2026-10-13T05:00:00.000Z',
    durationSeconds: 7200,
    transferCount: 0,
    walkingDistanceMeters: 0,
    fareStatus: 'UNKNOWN',
    routingContext: {
      provider: 'OTP',
      providerVersion: '2.10.0',
      routingSnapshotId: 'm6-routing',
      routingManifestSha256: ids.routeManifestHash,
      graphSha256: ids.graphHash,
      networkSnapshotId: ids.snapshot,
      networkSnapshotHash: ids.snapshotHash,
      mobilityProjectionVersion: 'PHASE_M6_TEST',
      plannedAt: '2026-10-13T01:00:00.000Z',
      commonServiceDate: '2026-10-13',
      timezone: 'Asia/Jakarta',
      attemptCount: 1,
      excludedRouteIds: [],
    },
    legs: [
      {
        sequence: 0,
        mode: 'TRANSJAKARTA',
        otpMode: 'BUS',
        from: { name: 'A', otpStopId: null, latitude: -6.2, longitude: 106.8 },
        to: { name: 'B', otpStopId: null, latitude: -6.3, longitude: 106.9 },
        intermediateStops: [],
        startAt: '2026-10-13T03:00:00.000Z',
        endAt: '2026-10-13T03:30:00.000Z',
        durationSeconds: 1800,
        distanceMeters: 1000,
        routeId: `route-${entityId}`,
        routeShortName: 'R',
        tripId: `trip-${entityId}`,
        serviceDate: '2026-10-13',
        timingPrecision: 'FREQUENCY_DERIVED',
        entityBindings: [
          {
            otpEntityId: `otp-${entityId}`,
            productMode: 'TRANSJAKARTA',
            entityType: 'ROUTE',
            canonicalEntityId: entityId,
            mobilityEntityId: entityId,
            resolutionMethod: 'EXACT_SOURCE_REFERENCE',
            provenanceRef: 'fixture:SIMULATED',
          },
        ],
        operationalFlags: [],
      },
    ],
  };
}
