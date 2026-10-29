import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import type { AcceptRecoveryInput } from './application/recovery.repository.port.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';
import { KyselyRecoveryRepository } from './infrastructure/kysely-recovery.repository.js';

const database = createDatabase();
const repository = new KyselyRecoveryRepository(database);
const journeys = new KyselyActiveJourneyRepository(database);

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
  resolvedRecovery: randomUUID(),
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

async function cloneProposal(
  recoveryId: string,
  idempotencyKey: string,
  predecessor: string | null,
  progressRevision = 2,
): Promise<void> {
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
    ) select
      ${recoveryId}::uuid, active_journey_id, impact_id, owner_ref,
      ${idempotencyKey}, method, status, ${progressRevision}, completed_leg_count,
      recovery_anchor_name, recovery_anchor_lat, recovery_anchor_lon,
      recovery_at, network_snapshot_id, mobility_projection_version,
      original_journey_fingerprint, proposed_fingerprint, baseline_fingerprint,
      preserved_leg_count, eligible_remaining_leg_count, changed_leg_count,
      added_travel_time_seconds, added_transfers, plan_change_count,
      disrupted_entity_avoided, state_validation_ms, preservation_processing_ms,
      proposed_routing_ms, baseline_routing_ms, total_computation_ms,
      triggering_entity_id, state_transition_id, reason,
      proposed_journey_json, baseline_journey_json,
      comparison_json || ${JSON.stringify({ recoveryId, baseRecoveryId: predecessor })}::jsonb
    from recovery.recovery_plan where id=${ids.recovery}::uuid
  `.execute(database);
}

describe('M6 recovery acceptance lineage', () => {
  it('serializes PostgreSQL accept vs updateProgress into one committed outcome', async () => {
    const ownerRef = `m6:race:${randomUUID()}`;
    const journeyId = randomUUID();
    const impactId = randomUUID();
    const recoveryId = randomUUID();
    await sql`
      insert into journey.journey_plan (
        id, owner_ref, plan_fingerprint, original_plan_json,
        origin_lat, origin_lon, destination_lat, destination_lon,
        planned_start_at, planned_end_at, routing_snapshot_id,
        routing_manifest_sha256, graph_sha256, network_snapshot_id,
        network_snapshot_hash, mobility_projection_version, service_date,
        timezone, planned_at
      ) select ${journeyId}::uuid, ${ownerRef}, plan_fingerprint,
        original_plan_json, origin_lat, origin_lon, destination_lat,
        destination_lon, planned_start_at, planned_end_at, routing_snapshot_id,
        routing_manifest_sha256, graph_sha256, network_snapshot_id,
        network_snapshot_hash, mobility_projection_version, service_date,
        timezone, planned_at from journey.journey_plan where id=${ids.journey}::uuid
    `.execute(database);
    await sql`
      insert into journey.journey_leg (
        id, journey_id, sequence, mode, start_at, end_at,
        timing_precision, leg_fingerprint, original_leg_json
      ) select ${randomUUID()}::uuid, ${journeyId}::uuid, sequence, mode,
        start_at, end_at, timing_precision, leg_fingerprint, original_leg_json
      from journey.journey_leg where journey_id=${ids.journey}::uuid
    `.execute(database);
    await sql`
      insert into journey.journey_leg (
        id, journey_id, sequence, mode, start_at, end_at,
        timing_precision, leg_fingerprint, original_leg_json
      ) values (
        ${randomUUID()}::uuid, ${journeyId}::uuid, 1, 'WALK',
        '2026-10-13T03:30:00.000Z', '2026-10-13T04:00:00.000Z',
        'FREQUENCY_DERIVED', ${ids.legFingerprint},
        ${JSON.stringify({ sequence: 1 })}::jsonb
      )
    `.execute(database);
    await sql`
      insert into journey.active_journey (journey_id, lifecycle_status, activated_at)
      values (${journeyId}::uuid, 'ACTIVE', now())
    `.execute(database);
    await sql`
      insert into journey.journey_progress (
        journey_id, completed_leg_count, current_leg_sequence,
        progress_method, recorded_at, revision
      ) values (${journeyId}::uuid, 1, 1, 'CONTROLLED_MANUAL',
        '2026-10-13T03:30:00.000Z'::timestamptz, 2)
    `.execute(database);
    await sql`
      insert into journey.journey_impact (
        id, journey_id, owner_ref, state_transition_id, mobility_entity_id,
        impact_status, operational_state, evidence_type, freshness_status,
        provenance_ref, projection_version
      ) select ${impactId}::uuid, ${journeyId}::uuid, ${ownerRef},
        state_transition_id, mobility_entity_id, impact_status, operational_state,
        evidence_type, freshness_status, provenance_ref, projection_version
      from journey.journey_impact where id=${ids.impact}::uuid
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
      ) select
        ${recoveryId}::uuid, ${journeyId}::uuid, ${impactId}::uuid,
        ${ownerRef}, 'm6-race-accept', method, status, progress_revision,
        completed_leg_count, recovery_anchor_name, recovery_anchor_lat,
        recovery_anchor_lon, recovery_at, network_snapshot_id,
        mobility_projection_version, original_journey_fingerprint,
        proposed_fingerprint, baseline_fingerprint, preserved_leg_count,
        eligible_remaining_leg_count, changed_leg_count,
        added_travel_time_seconds, added_transfers, plan_change_count,
        disrupted_entity_avoided, state_validation_ms, preservation_processing_ms,
        proposed_routing_ms, baseline_routing_ms, total_computation_ms,
        triggering_entity_id, state_transition_id, reason,
        proposed_journey_json, baseline_journey_json,
        comparison_json || jsonb_build_object('recoveryId', ${recoveryId}::uuid, 'baseRecoveryId', null)
      from recovery.recovery_plan where id=${ids.recovery}::uuid
    `.execute(database);

    const raced = await Promise.allSettled([
      repository.accept({
        recoveryId,
        ownerRef,
        idempotencyKey: 'm6-race-accept',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      journeys.updateProgress({
        journeyId,
        ownerRef,
        completedLegCount: 2,
        currentLegSequence: null,
        recordedAt: '2026-10-13T04:00:00.000Z',
      }),
    ]);
    assert.equal(
      raced.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      raced.filter((result) => result.status === 'rejected').length,
      1,
    );
    const persisted = await sql<{
      revision: number;
      completed: number;
      pointer: string | null;
      acceptances: number;
    }>`
      select pr.revision, pr.completed_leg_count as completed,
        a.accepted_recovery_id as pointer,
        (select count(*)::int from recovery.recovery_acceptance
         where recovery_id=${recoveryId}::uuid) as acceptances
      from journey.active_journey a
      join journey.journey_progress pr on pr.journey_id=a.journey_id
      where a.journey_id=${journeyId}::uuid
    `.execute(database);
    const state = persisted.rows[0]!;
    assert.ok(
      (state.pointer === recoveryId &&
        state.revision === 2 &&
        state.acceptances === 1) ||
        (state.pointer === null &&
          state.revision === 3 &&
          state.completed === 2 &&
          state.acceptances === 0),
      'row locks must commit either complete accept or complete progress only',
    );
  });

  it('persists additive acceptance and advances the current-itinerary pointer', async () => {
    const acceptance = await repository.accept({
      recoveryId: ids.recovery,
      ownerRef: ids.owner,
      idempotencyKey: 'm6-accept-key',
      progressRevision: 2,
      acceptedJourney: journeyJson(ids.replacementEntity),
      acceptedJourneyFingerprint: ids.proposalFingerprint,
      acceptedAt,
    });
    const replay = await repository.accept({
      recoveryId: ids.recovery,
      ownerRef: ids.owner,
      idempotencyKey: 'm6-accept-key',
      progressRevision: 2,
      acceptedJourney: journeyJson(ids.replacementEntity),
      acceptedJourneyFingerprint: ids.proposalFingerprint,
      acceptedAt,
    });
    assert.deepEqual(replay, acceptance);
    assert.equal(acceptance.recoveryId, ids.recovery);
    assert.equal(acceptance.acceptedProgressRevision, 2);
    assert.equal(
      acceptance.acceptedJourneyFingerprint,
      ids.proposalFingerprint,
    );

    const plan = await sql<{ originalPlan: unknown; proposedJourney: unknown }>`
      select p.original_plan_json as "originalPlan",
        r.proposed_journey_json as "proposedJourney"
      from journey.journey_plan p
      join recovery.recovery_plan r on r.active_journey_id=p.id
      where p.id=${ids.journey}::uuid
    `.execute(database);
    assert.deepEqual(
      plan.rows[0]?.originalPlan,
      journeyJson(ids.originalEntity),
    );
    assert.deepEqual(
      plan.rows[0]?.proposedJourney,
      journeyJson(ids.replacementEntity),
    );

    const pointer = await sql<{ acceptedRecoveryId: string; acceptedAt: Date }>`
      select accepted_recovery_id as "acceptedRecoveryId",
        recovery_accepted_at as "acceptedAt"
      from journey.active_journey where journey_id=${ids.journey}::uuid
    `.execute(database);
    assert.equal(pointer.rows[0]?.acceptedRecoveryId, ids.recovery);

    const events = await sql<{ eventType: string }>`
      select event_type as "eventType" from journey.journey_state_event
      where journey_id=${ids.journey}::uuid and event_type='RECOVERY_ACCEPTED'
    `.execute(database);
    assert.equal(events.rows.length, 1);
  });

  it('replays the same acceptance even after later progress or impact changes', async () => {
    await sql`
      update journey.journey_progress set
        completed_leg_count=1, revision=3, recorded_at='2026-10-13T04:01:00Z'
      where journey_id=${ids.journey}::uuid
    `.execute(database);
    await sql`
      update journey.journey_impact set resolved_at='2026-10-13T04:01:00Z'
      where id=${ids.impact}::uuid
    `.execute(database);
    const replay = await repository.accept({
      recoveryId: ids.recovery,
      ownerRef: ids.owner,
      idempotencyKey: 'm6-accept-key',
      progressRevision: 2,
      acceptedJourney: journeyJson(ids.replacementEntity),
      acceptedJourneyFingerprint: ids.proposalFingerprint,
      acceptedAt: '2026-10-13T04:05:00.000Z',
    });
    await assert.rejects(
      repository.accept({
        recoveryId: ids.recovery,
        ownerRef: ids.owner,
        idempotencyKey: 'm6-accept-key',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.originalEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt: '2026-10-13T04:05:00.000Z',
      }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    assert.equal(replay.recoveryId, ids.recovery);
    assert.equal(replay.acceptedAt, acceptedAt);
    const rows = await sql<{ count: number }>`
      select count(*)::int as count from recovery.recovery_acceptance
      where recovery_id=${ids.recovery}::uuid
    `.execute(database);
    assert.equal(rows.rows[0]?.count, 1);
    await sql`
      update journey.journey_progress set
        completed_leg_count=1, revision=2,
        recorded_at='2026-10-13T03:30:00Z'
      where journey_id=${ids.journey}::uuid
    `.execute(database);
    await sql`
      update journey.journey_impact set resolved_at=null
      where id=${ids.impact}::uuid
    `.execute(database);
  });

  it('rejects a proposal whose triggering impact already expired', async () => {
    const expiredTransition = randomUUID();
    await sql`
      insert into twin.mobility_state_history (
        id, mobility_entity_id, previous_state, new_state, effective_at,
        evidence_type, freshness_status, provenance_ref, reason,
        projection_version, transition_fingerprint
      ) values (
        ${expiredTransition}::uuid, ${ids.replacementEntity}::uuid,
        'AVAILABLE', 'UNAVAILABLE', '2026-10-13T03:30:00.000Z'::timestamptz,
        'SIMULATED', 'FRESH', 'fixture:SIMULATED', 'expired fixture',
        'PHASE_M6_TEST', ${digest(randomUUID())}
      )
    `.execute(database);
    const expiredImpact = randomUUID();
    await sql`
      insert into journey.journey_impact (
        id, journey_id, owner_ref, state_transition_id, mobility_entity_id,
        impact_status, operational_state, evidence_type, freshness_status,
        provenance_ref, projection_version, expires_at
      ) values (
        ${expiredImpact}::uuid, ${ids.journey}::uuid, ${ids.owner},
        ${expiredTransition}::uuid, ${ids.replacementEntity}::uuid,
        'BLOCKING', 'UNAVAILABLE', 'SIMULATED', 'FRESH', 'fixture:SIMULATED',
        'PHASE_M6_TEST', '2026-01-01T00:00:00Z'::timestamptz
      )
    `.execute(database);
    const expiredProposal = randomUUID();
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
      ) select
        ${expiredProposal}::uuid, active_journey_id, ${expiredImpact}::uuid,
        owner_ref, 'g1-expired-proposal', method, status, progress_revision,
        completed_leg_count, recovery_anchor_name, recovery_anchor_lat,
        recovery_anchor_lon, recovery_at, network_snapshot_id,
        mobility_projection_version, original_journey_fingerprint,
        proposed_fingerprint, baseline_fingerprint, preserved_leg_count,
        eligible_remaining_leg_count, changed_leg_count, added_travel_time_seconds,
        added_transfers, plan_change_count, disrupted_entity_avoided,
        state_validation_ms, preservation_processing_ms, proposed_routing_ms,
        baseline_routing_ms, total_computation_ms, ${ids.replacementEntity}::uuid,
        ${expiredTransition}::uuid, reason, proposed_journey_json,
        baseline_journey_json,
        comparison_json || ${JSON.stringify({ recoveryId: expiredProposal, baseRecoveryId: ids.recovery })}::jsonb
      from recovery.recovery_plan where id=${ids.recovery}::uuid
    `.execute(database);
    await assert.rejects(
      repository.accept({
        recoveryId: expiredProposal,
        ownerRef: ids.owner,
        idempotencyKey: 'g1-expired-accept',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_STALE' },
    );
    assert.equal(
      (
        await sql<{ count: number }>`
          select count(*)::int as count from recovery.recovery_acceptance
          where recovery_id=${expiredProposal}::uuid
        `.execute(database)
      ).rows[0]?.count,
      0,
      'expired proposal acceptance must not persist lineage',
    );
  });

  it('rejects a stale G0 source token after R1 acceptance', async () => {
    const staleG0 = randomUUID();
    await cloneProposal(staleG0, 'g1-stale-g0-proposal', null);
    await assert.rejects(
      repository.accept({
        recoveryId: staleG0,
        ownerRef: ids.owner,
        idempotencyKey: 'g1-stale-g0-accept',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_STALE' },
    );
    assert.equal(
      (
        await sql<{ count: number }>`
          select count(*)::int as count from recovery.recovery_acceptance
          where recovery_id=${staleG0}::uuid
        `.execute(database)
      ).rows[0]?.count,
      0,
    );
  });

  it('rejects acceptance once the proposal revision is stale', async () => {
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
        ${randomUUID()}::uuid, ${ids.journey}::uuid, ${ids.impact}::uuid,
        ${ids.owner}, 'm6-stale-key', 'STATE_AWARE_REPAIR', 'COMPLETED',
        1, 0, 'anchor', -6.21, 106.81,
        '2026-10-13T03:30:00.000Z'::timestamptz, ${ids.snapshot}::uuid,
        'PHASE_M6_TEST', ${ids.planFingerprint}, ${ids.proposalFingerprint},
        null, 1, 1, 1, 120, 0, 1, true, 1, 1, 1, 1, 5,
        ${ids.originalEntity}::uuid, ${ids.transition}::uuid, 'stale fixture',
        ${JSON.stringify(journeyJson(ids.replacementEntity))}::jsonb,
        null, ${JSON.stringify({ recoveryId: 'stale' })}::jsonb
      )
    `.execute(database);
    const stale = await sql<{ id: string }>`
      select id from recovery.recovery_plan
      where owner_ref=${ids.owner} and idempotency_key='m6-stale-key'
    `.execute(database);
    await assert.rejects(
      repository.accept({
        recoveryId: stale.rows[0]!.id,
        ownerRef: ids.owner,
        idempotencyKey: 'm6-stale-accept',
        progressRevision: 1,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_STALE' },
    );
  });

  it('rejects a second proposal racing the same accepted journey', async () => {
    const competitor = randomUUID();
    const competingJourney = journeyJson(ids.blockedEntity);
    const competingFingerprint = 'a'.repeat(64);
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
        ${competitor}::uuid, ${ids.journey}::uuid, ${ids.impact}::uuid,
        ${ids.owner}, 'm6-competitor-key', 'STATE_AWARE_REPAIR', 'COMPLETED',
        2, 1, 'anchor', -6.21, 106.81,
        '2026-10-13T03:30:00.000Z'::timestamptz, ${ids.snapshot}::uuid,
        'PHASE_M6_TEST', ${ids.planFingerprint}, ${competingFingerprint},
        null, 1, 1, 1, 120, 0, 1, true, 1, 1, 1, 1, 5,
        ${ids.originalEntity}::uuid, ${ids.transition}::uuid, 'competitor fixture',
        ${JSON.stringify(competingJourney)}::jsonb, null, ${JSON.stringify({ recoveryId: competitor })}::jsonb
      )
    `.execute(database);
    await assert.rejects(
      repository.accept({
        recoveryId: competitor,
        ownerRef: ids.owner,
        idempotencyKey: 'm6-competitor-accept',
        progressRevision: 2,
        acceptedJourney: competingJourney,
        acceptedJourneyFingerprint: competingFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_STALE' },
    );
    const lineage = await sql<{
      count: number;
      recoveryId: string;
      revision: number;
    }>`
      select count(*)::int as count,
        (select accepted_recovery_id from journey.active_journey where journey_id=${ids.journey}::uuid) as "recoveryId",
        (select revision from journey.journey_progress where journey_id=${ids.journey}::uuid) as revision
      from recovery.recovery_acceptance
      where active_journey_id=${ids.journey}::uuid
    `.execute(database);
    assert.equal(
      lineage.rows[0]?.count,
      1,
      'racing second proposal must not duplicate lineage',
    );
    assert.equal(
      lineage.rows[0]?.recoveryId,
      ids.recovery,
      'first winner keeps pointer',
    );
    assert.equal(
      lineage.rows[0]?.revision,
      2,
      'racing accept must not double increment revision',
    );
  });

  it('rejects acceptance when the replacement now depends on a blocked entity', async () => {
    await sql`
      insert into twin.mobility_state (
        id, mobility_entity_id, operational_state, freshness_status,
        state_as_of, projection_version, state_fingerprint
      ) values (
        ${randomUUID()}::uuid, ${ids.blockedEntity}::uuid, 'UNAVAILABLE', 'FRESH',
        now(), 'PHASE_M6_TEST', ${`s-${ids.blockedEntity}`}
      )
    `.execute(database);
    const blockedProposal = randomUUID();
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
        ${blockedProposal}::uuid, ${ids.journey}::uuid, ${ids.impact}::uuid,
        ${ids.owner}, 'm6-blocked-key', 'STATE_AWARE_REPAIR', 'COMPLETED',
        2, 1, 'anchor', -6.21, 106.81,
        '2026-10-13T03:30:00.000Z'::timestamptz, ${ids.snapshot}::uuid,
        'PHASE_M6_TEST', ${ids.planFingerprint}, ${ids.proposalFingerprint},
        null, 1, 1, 1, 120, 0, 1, true, 1, 1, 1, 1, 5,
        ${ids.originalEntity}::uuid, ${ids.transition}::uuid, 'blocked fixture',
        ${JSON.stringify(journeyJson(ids.blockedEntity))}::jsonb,
        null, ${JSON.stringify({ recoveryId: blockedProposal, baseRecoveryId: ids.recovery })}::jsonb
      )
    `.execute(database);
    await assert.rejects(
      repository.accept({
        recoveryId: blockedProposal,
        ownerRef: ids.owner,
        idempotencyKey: 'm6-blocked-accept',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.blockedEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_CANDIDATE_BLOCKED' },
    );
    const blockedState = await sql<{ count: number }>`
      select count(*)::int as count from twin.mobility_state
      where mobility_entity_id=${ids.blockedEntity}::uuid and operational_state='UNAVAILABLE'
    `.execute(database);
    assert.equal(
      blockedState.rows[0]?.count,
      1,
      'S09 blocked candidate must stay UNAVAILABLE',
    );
    const persisted = await sql<{ count: number }>`
      select count(*)::int as count from recovery.recovery_acceptance
      where recovery_id=${blockedProposal}::uuid
        and owner_ref=${ids.owner} and idempotency_key='m6-blocked-accept'
    `.execute(database);
    assert.equal(
      persisted.rows[0]?.count,
      0,
      'S09 rejected acceptance must not persist lineage',
    );
  });

  it('supports sequential R1/R2/R3 generations, concurrent single-winner advance, and post-progress source tokens', async () => {
    const revisionBefore = (
      await sql<{
        revision: number;
      }>`select revision from journey.journey_progress where journey_id=${ids.journey}::uuid`.execute(
        database,
      )
    ).rows[0]!.revision;
    let predecessor: string = ids.recovery;
    const chain: string[] = [ids.recovery];
    for (const generation of ['R2', 'R3'] as const) {
      const recoveryId = randomUUID();
      await cloneProposal(recoveryId, `g1-${generation}-proposal`, predecessor);
      const acceptance = await repository.accept({
        recoveryId,
        ownerRef: ids.owner,
        idempotencyKey: `g1-${generation}-accept`,
        progressRevision: revisionBefore,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      });
      assert.equal(acceptance.predecessorRecoveryId, predecessor);
      predecessor = recoveryId;
      chain.push(recoveryId);
    }

    const racers = [randomUUID(), randomUUID()];
    await Promise.all(
      racers.map((recoveryId, index) =>
        cloneProposal(recoveryId, `g1-race-${index}-proposal`, predecessor),
      ),
    );
    // Each repository call owns a separate PostgreSQL transaction. Exactly one
    // proposal based on the same generation may advance the locked pointer.
    const raced = await Promise.allSettled(
      racers.map((recoveryId, index) =>
        repository.accept({
          recoveryId,
          ownerRef: ids.owner,
          idempotencyKey: `g1-race-${index}-accept`,
          progressRevision: revisionBefore,
          acceptedJourney: journeyJson(ids.replacementEntity),
          acceptedJourneyFingerprint: ids.proposalFingerprint,
          acceptedAt,
        }),
      ),
    );
    assert.equal(
      raced.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      raced.filter((result) => result.status === 'rejected').length,
      1,
    );
    const winner = (
      raced.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof repository.accept>>>
    ).value;
    assert.equal(winner.predecessorRecoveryId, predecessor);
    chain.push(winner.recoveryId);

    const staleAfterProgress = randomUUID();
    await cloneProposal(
      staleAfterProgress,
      'g1-pre-progress-proposal',
      winner.recoveryId,
    );
    await sql`update journey.journey_progress set revision=revision+1, updated_at=now() where journey_id=${ids.journey}::uuid`.execute(
      database,
    );
    await assert.rejects(
      repository.accept({
        recoveryId: staleAfterProgress,
        ownerRef: ids.owner,
        idempotencyKey: 'g1-pre-progress-accept',
        progressRevision: revisionBefore,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_STALE' },
    );
    const revisionAfter = revisionBefore + 1;
    const postProgress = randomUUID();
    await cloneProposal(
      postProgress,
      'g1-post-progress-proposal',
      winner.recoveryId,
      revisionAfter,
    );
    const latestJourney = {
      ...journeyJson(ids.replacementEntity)!,
      journeyId: postProgress,
    };
    const finalAcceptance = await repository.accept({
      recoveryId: postProgress,
      ownerRef: ids.owner,
      idempotencyKey: 'g1-post-progress-accept',
      progressRevision: revisionAfter,
      acceptedJourney: latestJourney,
      acceptedJourneyFingerprint: ids.proposalFingerprint,
      acceptedAt,
    });
    assert.equal(finalAcceptance.predecessorRecoveryId, winner.recoveryId);
    chain.push(postProgress);

    const originalLegRows = await sql<{
      sequence: number;
      mode: string;
      legFingerprint: string;
      originalLeg: unknown;
    }>`
      select sequence, mode, leg_fingerprint as "legFingerprint",
        original_leg_json as "originalLeg"
      from journey.journey_leg where journey_id=${ids.journey}::uuid
      order by sequence
    `.execute(database);
    const restartedRepository = new KyselyRecoveryRepository(database);
    for (const recoveryId of chain) {
      const persistedAcceptance = await restartedRepository.findAcceptance(
        recoveryId,
        ids.owner,
      );
      assert.ok(
        persistedAcceptance,
        `acceptance ${recoveryId} survives repository restart`,
      );
    }
    const durableEvents = await sql<{ count: number }>`
      select count(*)::int as count from journey.journey_state_event
      where journey_id=${ids.journey}::uuid and event_type='RECOVERY_ACCEPTED'
    `.execute(database);
    assert.equal(durableEvents.rows[0]?.count, chain.length);
    const durable = await sql<{
      recoveryId: string;
      predecessor: string | null;
      revision: number;
      originalPlan: unknown;
      acceptedJourney: unknown;
      currentItinerary: unknown;
      currentFirstLeg: unknown;
      latestRecoveryId: string;
    }>`
      select ra.recovery_id as "recoveryId",
        ra.acceptance_json->>'predecessorRecoveryId' as predecessor,
        pr.revision,
        p.original_plan_json as "originalPlan",
        ra.accepted_journey_json as "acceptedJourney",
        a.current_itinerary_json as "currentItinerary",
        a.current_itinerary_json->'legs'->0 as "currentFirstLeg",
        a.accepted_recovery_id as "latestRecoveryId"
      from recovery.recovery_acceptance ra
      join journey.active_journey a on a.journey_id=ra.active_journey_id
      join journey.journey_progress pr on pr.journey_id=a.journey_id
      join journey.journey_plan p on p.id=a.journey_id
      where ra.active_journey_id=${ids.journey}::uuid
      order by ra.accepted_at, ra.recovery_id
    `.execute(database);
    const lineage = new Map(
      durable.rows.map((row) => [row.recoveryId, row.predecessor]),
    );
    assert.equal(
      lineage.get(chain[0]!),
      null,
      'legacy absent token is durable G0',
    );
    for (let index = 1; index < chain.length; index += 1)
      assert.equal(lineage.get(chain[index]!), chain[index - 1]);
    assert.equal(
      durable.rows[0]?.revision,
      revisionAfter,
      'acceptance never increments progress revision',
    );
    assert.deepEqual(
      durable.rows[0]?.originalPlan,
      journeyJson(ids.originalEntity),
    );
    assert.deepEqual(
      durable.rows[0]?.currentFirstLeg,
      journeyJson(ids.originalEntity)!.legs[0],
      'materialization retains original completed history across generations',
    );
    assert.equal(durable.rows.length, chain.length);
    for (const row of durable.rows) {
      assert.equal(row.latestRecoveryId, postProgress);
      assert.deepEqual(row.originalPlan, journeyJson(ids.originalEntity));
      assert.deepEqual(
        row.acceptedJourney,
        row.recoveryId === postProgress
          ? latestJourney
          : journeyJson(ids.replacementEntity),
        'earlier acceptance payloads remain immutable',
      );
      assert.deepEqual(
        row.currentItinerary,
        {
          ...latestJourney,
          legs: [
            journeyJson(ids.originalEntity)!.legs[0],
            { ...latestJourney.legs[0], sequence: 1 },
          ],
        },
        'latest itinerary contains exactly completed history plus rebased suffix',
      );
    }

    assert.deepEqual(
      originalLegRows.rows.map(
        ({ sequence, mode, legFingerprint, originalLeg }) => ({
          sequence,
          mode,
          legFingerprint,
          originalLeg,
        }),
      ),
      [
        {
          sequence: 0,
          mode: 'TRANSJAKARTA',
          legFingerprint: ids.legFingerprint,
          originalLeg: { sequence: 0 },
        },
      ],
      'original journey_leg rows remain unchanged through lineage and progress',
    );
  });
  it('rejects acceptance when the triggering impact has resolved', async () => {
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
      ) select
        ${ids.resolvedRecovery}::uuid, active_journey_id, impact_id, owner_ref,
        'm6-resolved-proposal', method, status, progress_revision, completed_leg_count,
        recovery_anchor_name, recovery_anchor_lat, recovery_anchor_lon,
        recovery_at, network_snapshot_id, mobility_projection_version,
        original_journey_fingerprint, proposed_fingerprint, baseline_fingerprint,
        preserved_leg_count, eligible_remaining_leg_count, changed_leg_count,
        added_travel_time_seconds, added_transfers, plan_change_count,
        disrupted_entity_avoided, state_validation_ms, preservation_processing_ms,
        proposed_routing_ms, baseline_routing_ms, total_computation_ms,
        triggering_entity_id, state_transition_id, reason,
        proposed_journey_json, baseline_journey_json, comparison_json
      from recovery.recovery_plan where id=${ids.recovery}::uuid
    `.execute(database);
    await sql`
      update journey.journey_impact set resolved_at='2026-10-13T04:00:00.000Z'::timestamptz
      where id=${ids.impact}::uuid
    `.execute(database);
    await assert.rejects(
      repository.accept({
        recoveryId: ids.resolvedRecovery,
        ownerRef: ids.owner,
        idempotencyKey: 'm6-resolved-accept',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_STALE' },
    );
    assert.equal(
      (
        await sql<{ count: number }>`
        select count(*)::int as count from recovery.recovery_acceptance
        where recovery_id=${ids.resolvedRecovery}::uuid
      `.execute(database)
      ).rows[0]?.count,
      0,
    );
  });

  it('refuses acceptance from a foreign owner scope', async () => {
    await assert.rejects(
      repository.accept({
        recoveryId: ids.recovery,
        ownerRef: 'm6:other',
        idempotencyKey: 'm6-foreign-accept',
        progressRevision: 2,
        acceptedJourney: journeyJson(ids.replacementEntity),
        acceptedJourneyFingerprint: ids.proposalFingerprint,
        acceptedAt,
      }),
      { code: 'RECOVERY_NOT_FOUND' },
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
