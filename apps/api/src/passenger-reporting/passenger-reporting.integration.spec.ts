import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { PassengerReportService } from './passenger-report.service.js';
import { KyselyIncidentLifecycleRepository } from '../disruption/infrastructure/kysely-incident-lifecycle.repository.js';
import { OperationalEventBus } from '../disruption/application/operational-event-bus.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import { OperationalIncidentService } from '../operational-data/application/operational-incident.service.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';

const database = createDatabase();
const suffix = randomUUID();
const sourceId = randomUUID();
const versionId = randomUUID();
const snapshotId = randomUUID();
const entityId = randomUUID();
const recoveryId = randomUUID();
const journeyId = randomUUID();
const ownerRef = `m5-owner:${suffix}`;
const sourceKey = `m5-fixture-${suffix}`;
let service: PassengerReportService;

describe('M5 passenger report service persistence boundary', () => {
  before(async () => {
    const identity = await sql<{
      name: string;
    }>`select current_database() as name`.execute(database);
    assert.match(
      identity.rows[0]?.name ?? '',
      /^tnx_lightweight_[0-9a-f]{32}$/,
      'M5 mutation tests require Tier A scratch database.',
    );
    await migrateToLatest(database);
    await sql`insert into meta.dataset_source (id, source_key, name, provider, source_type, verification_status) values (${sourceId}::uuid, ${sourceKey}, 'M5 SAMPLE fixture', 'TEST', 'CONTROLLED_REPLAY', 'VERIFIED')`.execute(
      database,
    );
    await sql`insert into meta.dataset_version (id, source_id, version_label, checksum_sha256, retrieved_at, raw_path_ref, manifest_path, validation_status) values (${versionId}::uuid, ${sourceId}::uuid, ${sourceKey}, ${'b'.repeat(64)}, now(), 'fixture:m5', 'fixture:m5', 'VALID')`.execute(
      database,
    );
    await sql`insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id) values (${entityId}::uuid, 'STOP', ${versionId}::uuid)`.execute(
      database,
    );
    await sql`insert into twin.network_snapshot (id, transit_dataset_version_id, spatial_dataset_version_id, processing_version, state_cutoff_at, configuration_json, manifest_ref, content_hash, status, finalized_at) values (${snapshotId}::uuid, ${versionId}::uuid, ${versionId}::uuid, 'M5', now(), '{}'::jsonb, 'fixture:M5', ${'a'.repeat(64)}, 'FINALIZED', now())`.execute(
      database,
    );
    await sql`insert into journey.journey_plan (id, owner_ref, plan_fingerprint, original_plan_json, origin_lat, origin_lon, destination_lat, destination_lon, planned_start_at, planned_end_at, routing_snapshot_id, routing_manifest_sha256, graph_sha256, network_snapshot_id, network_snapshot_hash, mobility_projection_version, service_date, timezone, planned_at) values (${journeyId}::uuid, ${ownerRef}, ${createHash('sha256').update(journeyId).digest('hex')}, '{}'::jsonb, 0, 0, 0, 0, now(), now() + interval '1 hour', 'fixture:M5', ${'a'.repeat(64)}, ${'b'.repeat(64)}, ${snapshotId}::uuid, ${'c'.repeat(64)}, 'M5', '2026-10-03'::date, 'Asia/Jakarta', now())`.execute(
      database,
    );
    await sql`insert into journey.journey_leg (id, journey_id, sequence, mode, start_at, end_at, timing_precision, leg_fingerprint, original_leg_json) values (${randomUUID()}::uuid, ${journeyId}::uuid, 0, 'TRANSJAKARTA', now(), now() + interval '1 hour', 'ESTIMATED', ${'d'.repeat(64)}, '{}'::jsonb)`.execute(
      database,
    );
    await sql`insert into journey.journey_dependency (id, journey_id, leg_sequence, mobility_entity_id, canonical_entity_id, entity_type, product_mode, provenance_ref) values (${randomUUID()}::uuid, ${journeyId}::uuid, 0, ${entityId}::uuid, ${entityId}::uuid, 'STOP', 'TRANSJAKARTA', 'SAMPLE:m5')`.execute(
      database,
    );
    await sql`insert into journey.active_journey (journey_id, lifecycle_status, activated_at) values (${journeyId}::uuid, 'ACTIVE', now())`.execute(
      database,
    );
    await sql`insert into journey.journey_progress (journey_id, completed_leg_count, current_leg_sequence, progress_method, recorded_at, revision) values (${journeyId}::uuid, 0, 0, 'CONTROLLED_MANUAL', now(), 1)`.execute(
      database,
    );
    const validator = new OperationalContractValidator();
    const lifecycle = new KyselyIncidentLifecycleRepository(
      database,
      new OperationalIncidentService(validator),
      new KyselyMobilityStateRepository(database, validator),
      new OperationalEventBus(),
    );
    service = new PassengerReportService(database, lifecycle, {
      whenIdle: async () => undefined,
    } as never);
  });

  after(async () => database.destroy());

  it('persists idempotently and lists only matching owner plus journey', async () => {
    const input = {
      ownerRef,
      journeyId,
      category: 'SAFETY',
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      entityId,
      entityType: 'STOP',
      description: 'SAMPLE passenger observation.',
      key: `m5-key-${suffix}`,
    };
    const [first, replay] = await Promise.all([
      service.submit(input),
      service.submit(input),
    ]);
    assert.equal(first.report_id, replay.report_id);
    const own = await service.list(ownerRef, journeyId);
    const other = await service.list(`other:${suffix}`, journeyId);
    assert.equal(own.length, 1);
    assert.equal(other.length, 0);
    assert.equal(own[0]?.verification_status, 'REPORTED_UNVERIFIED');
  });

  it('reconciles one attempt by owner-scoped idempotency key without listing', async () => {
    const key = `m5-lookup-${suffix}`;
    const created = await service.submit({
      ownerRef,
      journeyId,
      category: 'SERVICE',
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      entityId,
      entityType: 'STOP',
      description: 'SAMPLE reconcile lookup.',
      key,
    });
    const found = await service.lookupByIdempotencyKey(ownerRef, key);
    assert.equal(found?.report_id, created.report_id);
    const foreign = await service.lookupByIdempotencyKey(
      `other:${suffix}`,
      key,
    );
    assert.equal(foreign, null);
  });

  it('uses accepted-generation targets and modes without changing original dependencies', async () => {
    const recoveredJourneyId = randomUUID();
    const recoveredOwner = `r7-owner:${suffix}`;
    const originalRouteId = randomUUID();
    const currentRouteId = randomUUID();
    const transitionId = randomUUID();
    const impactId = randomUUID();
    const digest = createHash('sha256')
      .update(recoveredJourneyId)
      .digest('hex');
    await sql`insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id) values
      (${originalRouteId}::uuid, 'ROUTE', ${versionId}::uuid),
      (${currentRouteId}::uuid, 'ROUTE', ${versionId}::uuid)`.execute(database);
    await sql`insert into journey.journey_plan (
      id, owner_ref, plan_fingerprint, original_plan_json, origin_lat, origin_lon,
      destination_lat, destination_lon, planned_start_at, planned_end_at,
      routing_snapshot_id, routing_manifest_sha256, graph_sha256, network_snapshot_id,
      network_snapshot_hash, mobility_projection_version, service_date, timezone, planned_at
    ) select ${recoveredJourneyId}::uuid, ${recoveredOwner}, ${digest},
      '{"legs":[],"fixture":"SIMULATED:R7"}'::jsonb, origin_lat, origin_lon,
      destination_lat, destination_lon, planned_start_at, planned_end_at,
      routing_snapshot_id, routing_manifest_sha256, graph_sha256, network_snapshot_id,
      network_snapshot_hash, mobility_projection_version, service_date, timezone, planned_at
      from journey.journey_plan where id=${journeyId}::uuid`.execute(database);
    await sql`insert into journey.journey_leg (id, journey_id, sequence, mode, start_at, end_at, timing_precision, leg_fingerprint, original_leg_json)
      values (${randomUUID()}::uuid, ${recoveredJourneyId}::uuid, 0, 'TRANSJAKARTA', now(), now()+interval '1 hour', 'ESTIMATED', ${digest}, '{"fixture":"SIMULATED:R7"}'::jsonb)`.execute(
      database,
    );
    await sql`insert into journey.journey_dependency (id, journey_id, leg_sequence, mobility_entity_id, canonical_entity_id, entity_type, product_mode, provenance_ref)
      values (${randomUUID()}::uuid, ${recoveredJourneyId}::uuid, 0, ${originalRouteId}::uuid, ${originalRouteId}::uuid, 'ROUTE', 'TRANSJAKARTA', 'SIMULATED:R7')`.execute(
      database,
    );
    await sql`insert into journey.active_journey (journey_id, lifecycle_status, activated_at) values (${recoveredJourneyId}::uuid, 'ACTIVE', now())`.execute(
      database,
    );
    await sql`insert into journey.journey_progress (journey_id, completed_leg_count, current_leg_sequence, progress_method, recorded_at, revision)
      values (${recoveredJourneyId}::uuid, 0, 0, 'CONTROLLED_MANUAL', now(), 1)`.execute(
      database,
    );
    const input = {
      ownerRef: recoveredOwner,
      journeyId: recoveredJourneyId,
      category: 'SERVICE',
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      entityId: originalRouteId,
      entityType: 'ROUTE',
      description: 'SIMULATED R7 route observation.',
      key: `r7-original-${suffix}`,
    };
    const originalReport = await service.submit(input);
    await sql`insert into twin.mobility_state_history (id, mobility_entity_id, previous_state, new_state, effective_at, evidence_type, freshness_status, provenance_ref, reason, projection_version, transition_fingerprint)
      values (${transitionId}::uuid, ${originalRouteId}::uuid, 'AVAILABLE', 'UNAVAILABLE', now(), 'SIMULATED', 'FRESH', 'SIMULATED:R7', 'SIMULATED R7 disruption', 'R7', ${digest})`.execute(
      database,
    );
    await sql`insert into journey.journey_impact (id, journey_id, owner_ref, state_transition_id, mobility_entity_id, impact_status, operational_state, evidence_type, freshness_status, provenance_ref, projection_version)
      values (${impactId}::uuid, ${recoveredJourneyId}::uuid, ${recoveredOwner}, ${transitionId}::uuid, ${originalRouteId}::uuid, 'BLOCKING', 'UNAVAILABLE', 'SIMULATED', 'FRESH', 'SIMULATED:R7', 'R7')`.execute(
      database,
    );
    const acceptedJourney = {
      journeyId: recoveredJourneyId,
      legs: [
        {
          sequence: 0,
          mode: 'MIKROTRANS',
          entityBindings: [
            {
              mobilityEntityId: currentRouteId,
              canonicalEntityId: currentRouteId,
              entityType: 'ROUTE',
              productMode: 'MIKROTRANS',
              provenanceRef: 'SIMULATED:R7',
            },
          ],
        },
      ],
    };
    await sql`insert into recovery.recovery_plan (
      id, active_journey_id, impact_id, owner_ref, idempotency_key, method, status,
      progress_revision, completed_leg_count, recovery_anchor_name, recovery_anchor_lat,
      recovery_anchor_lon, recovery_at, network_snapshot_id, mobility_projection_version,
      original_journey_fingerprint, proposed_fingerprint, preserved_leg_count,
      eligible_remaining_leg_count, changed_leg_count, plan_change_count,
      disrupted_entity_avoided, state_validation_ms, preservation_processing_ms,
      proposed_routing_ms, baseline_routing_ms, total_computation_ms,
      triggering_entity_id, state_transition_id, reason, proposed_journey_json, comparison_json
    ) values (${recoveryId}::uuid, ${recoveredJourneyId}::uuid, ${impactId}::uuid,
      ${recoveredOwner}, 'SIMULATED:R7', 'STATE_AWARE_REPAIR', 'COMPLETED', 1, 0,
      'SIMULATED anchor', 0, 0, now(), ${snapshotId}::uuid, 'R7', ${digest}, ${digest},
      0, 1, 1, 1, true, 0, 0, 0, 0, 0, ${originalRouteId}::uuid, ${transitionId}::uuid,
      'SIMULATED recovery', ${JSON.stringify(acceptedJourney)}::jsonb, '{}'::jsonb)`.execute(
      database,
    );
    await sql`insert into recovery.recovery_acceptance (recovery_id, owner_ref, idempotency_key, active_journey_id, accepted_progress_revision, accepted_impact_id, accepted_state_transition_id, accepted_projection_version, accepted_journey_fingerprint, accepted_journey_json, acceptance_json)
      values (${recoveryId}::uuid, ${recoveredOwner}, 'SIMULATED:R7', ${recoveredJourneyId}::uuid, 1, ${impactId}::uuid, ${transitionId}::uuid, 'R7', ${digest}, ${JSON.stringify(acceptedJourney)}::jsonb, '{}'::jsonb)`.execute(
      database,
    );
    // Exercise the real pointer trigger; never hand-write current dependencies.
    await sql`update journey.active_journey set accepted_recovery_id=${recoveryId}::uuid, recovery_accepted_at=now() where journey_id=${recoveredJourneyId}::uuid`.execute(
      database,
    );
    const currentInput = {
      ...input,
      entityId: currentRouteId,
      key: `r7-current-${suffix}`,
    };
    const currentReport = await service.submit(currentInput);
    assert.equal(currentReport.mobility_entity_id, currentRouteId);
    assert.equal(
      (await service.submit(currentInput)).report_id,
      currentReport.report_id,
    );
    await assert.rejects(
      service.submit({ ...input, key: `r7-stale-${suffix}` }),
      /Journey or selected target not found/,
    );
    await assert.rejects(
      service.submit({ ...currentInput, ownerRef: `other:${suffix}` }),
      /Journey is outside owner scope/,
    );
    const review = {
      reportId: String(currentReport.report_id),
      reviewer: 'r7-controlled-reviewer',
      state: 'UNAVAILABLE',
      reason: 'SIMULATED current route condition.',
      incidentType: 'SERVICE_SUSPENSION',
    };
    const verified = await service.verify(review);
    assert.equal(verified.verification_status, 'CONTROLLED_VERIFIED');
    const evidence = await sql<{
      mode: string;
      entityId: string;
      evidenceType: string;
    }>`select e.mode, e.mobility_entity_id as "entityId", i.evidence_type as "evidenceType"
      from disruption.operational_incident i join disruption.operational_incident_entity e on e.incident_id=i.id
      where i.id=${String(verified.incident_id)}::uuid`.execute(database);
    assert.deepEqual(evidence.rows, [
      {
        mode: 'MIKROTRANS',
        entityId: currentRouteId,
        evidenceType: 'SIMULATED',
      },
    ]);
    assert.equal((await service.verify(review)).review_replay, true);
    await assert.rejects(
      service.verify({ ...review, reportId: String(originalReport.report_id) }),
      /Report target has no supported journey mode/,
    );
    const original = await sql<{
      plan: unknown;
      entityId: string;
    }>`select p.original_plan_json as plan, d.mobility_entity_id as "entityId"
      from journey.journey_plan p join journey.journey_dependency d on d.journey_id=p.id
      where p.id=${recoveredJourneyId}::uuid`.execute(database);
    assert.deepEqual(original.rows, [
      {
        plan: { legs: [], fixture: 'SIMULATED:R7' },
        entityId: originalRouteId,
      },
    ]);
    assert.equal(
      (await service.list(recoveredOwner, recoveredJourneyId)).length,
      2,
    );
  });

  it('enforces ten reports per owner under concurrent submissions and returns retry seconds', async () => {
    const quotaOwner = `quota:${suffix}`;
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, index) =>
        service.submit({
          ownerRef: quotaOwner,
          journeyId: null,
          category: 'SERVICE',
          observedAt: new Date(Date.now() - 1_000).toISOString(),
          entityId,
          entityType: 'STOP',
          description: `SAMPLE concurrent report ${index}.`,
          key: `m5-concurrent-${index}-${suffix}`,
        }),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      10,
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0]?.reason), /Passenger report limit reached/);
    assert.equal(
      (rejected[0]?.reason as { retryAfterSeconds: number })
        .retryAfterSeconds >= 0,
      true,
    );
    const count = await sql<{
      count: number;
    }>`select count(*)::int as count from report.passenger_report where owner_ref=${quotaOwner}`.execute(
      database,
    );
    assert.equal(count.rows[0]?.count, 10);
  });

  it('rejects conflicting replay, isolates owners and expires window using owned timestamps', async () => {
    const windowOwner = `window:${suffix}`;
    const conflictKey = `window-conflict-${suffix}`;
    const payload = {
      ownerRef: windowOwner,
      journeyId: null,
      category: 'SERVICE' as const,
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      entityId,
      entityType: 'STOP' as const,
      description: 'SAMPLE window report.',
      key: conflictKey,
    };
    const created = await service.submit(payload);
    await assert.rejects(
      service.submit({ ...payload, description: 'different content' }),
      /different report content/,
    );
    assert.equal((await service.submit(payload)).report_id, created.report_id);
    const otherOwner = `window-other:${suffix}`;
    const other = await service.submit({
      ...payload,
      ownerRef: otherOwner,
      key: `window-other-key-${suffix}`,
    });
    assert.notEqual(other.report_id, created.report_id);
    for (let index = 1; index < 10; index += 1) {
      await service.submit({
        ownerRef: windowOwner,
        journeyId: null,
        category: 'SERVICE',
        observedAt: new Date(Date.now() - 1_000).toISOString(),
        entityId,
        entityType: 'STOP',
        description: `SAMPLE window filler ${index}.`,
        key: `window-filler-${index}-${suffix}`,
      });
    }
    const counted = await sql<{
      count: number;
    }>`select count(*)::int as count from report.passenger_report where owner_ref=${windowOwner} and created_at > clock_timestamp() - interval '10 minutes'`.execute(
      database,
    );
    assert.equal(counted.rows[0]?.count, 10);
    await assert.rejects(
      service.submit({
        ownerRef: windowOwner,
        journeyId: null,
        category: 'SERVICE',
        observedAt: new Date(Date.now() - 1_000).toISOString(),
        entityId,
        entityType: 'STOP',
        description: 'SAMPLE window over limit.',
        key: `window-over-${suffix}`,
      }),
      /Passenger report limit reached/,
    );
    await sql`update report.passenger_report set created_at = clock_timestamp() - interval '11 minutes' where owner_ref=${windowOwner} and idempotency_key=${conflictKey}`.execute(
      database,
    );
    const afterExpiry = await service.submit({
      ownerRef: windowOwner,
      journeyId: null,
      category: 'SERVICE',
      observedAt: new Date(Date.now() - 1_000).toISOString(),
      entityId,
      entityType: 'STOP',
      description: 'SAMPLE window after expiry.',
      key: `window-after-${suffix}`,
    });
    assert.ok(afterExpiry.report_id);
    const finalCount = await sql<{
      count: number;
    }>`select count(*)::int as count from report.passenger_report where owner_ref=${windowOwner} and created_at > clock_timestamp() - interval '10 minutes'`.execute(
      database,
    );
    assert.equal(finalCount.rows[0]?.count, 10);
    const otherCount = await sql<{
      count: number;
    }>`select count(*)::int as count from report.passenger_report where owner_ref=${otherOwner}`.execute(
      database,
    );
    assert.equal(otherCount.rows[0]?.count, 1);
  });

  it('derives retry seconds from tenth newest legacy row with ceil nonnegative', async () => {
    const legacyOwner = `legacy:${suffix}`;
    for (let index = 0; index < 12; index += 1) {
      await sql`insert into report.passenger_report (id, owner_ref, category, observation_time, mobility_entity_id, entity_type, description, idempotency_key, request_fingerprint) values (${randomUUID()}::uuid, ${legacyOwner}, 'SERVICE', now() - interval '30 seconds', ${entityId}::uuid, 'STOP', ${`legacy ${index}`}, ${`legacy-key-${index}-${suffix}`}, ${'a'.repeat(64)})`.execute(
        database,
      );
    }
    const before = await sql<{
      retry: number;
    }>`select greatest(0, ceil(extract(epoch from (created_at + interval '10 minutes' - clock_timestamp()))) )::int as retry from report.passenger_report where owner_ref=${legacyOwner} and created_at > clock_timestamp() - interval '10 minutes' order by created_at desc offset 9 limit 1`.execute(
      database,
    );
    assert.ok((before.rows[0]?.retry ?? -1) >= 0);
    await assert.rejects(
      service.submit({
        ownerRef: legacyOwner,
        journeyId: null,
        category: 'SERVICE',
        observedAt: new Date(Date.now() - 1_000).toISOString(),
        entityId,
        entityType: 'STOP',
        description: 'SAMPLE legacy over limit.',
        key: `legacy-try-${suffix}`,
      }),
      /Passenger report limit reached/,
    );
    const count = await sql<{
      count: number;
    }>`select count(*)::int as count from report.passenger_report where owner_ref=${legacyOwner}`.execute(
      database,
    );
    assert.equal(count.rows[0]?.count, 12);
  });

  it('uses tenth newest legacy row for retry calculation and rejects completed journey writes while allowing replay', async () => {
    const isolatedJourneyId = randomUUID();
    const isolatedOwner = `completed:${suffix}`;
    await sql`insert into journey.journey_plan (id, owner_ref, plan_fingerprint, original_plan_json, origin_lat, origin_lon, destination_lat, destination_lon, planned_start_at, planned_end_at, routing_snapshot_id, routing_manifest_sha256, graph_sha256, network_snapshot_id, network_snapshot_hash, mobility_projection_version, service_date, timezone, planned_at) select ${isolatedJourneyId}::uuid, ${isolatedOwner}, ${createHash('sha256').update(isolatedJourneyId).digest('hex')}, '{}'::jsonb, origin_lat, origin_lon, destination_lat, destination_lon, planned_start_at, planned_end_at, routing_snapshot_id, routing_manifest_sha256, graph_sha256, network_snapshot_id, network_snapshot_hash, mobility_projection_version, service_date, timezone, planned_at from journey.journey_plan where id=${journeyId}::uuid`.execute(
      database,
    );
    await sql`insert into journey.journey_leg (id, journey_id, sequence, mode, start_at, end_at, timing_precision, leg_fingerprint, original_leg_json) values (${randomUUID()}::uuid, ${isolatedJourneyId}::uuid, 0, 'TRANSJAKARTA', now(), now() + interval '1 hour', 'ESTIMATED', ${'d'.repeat(64)}, '{}'::jsonb)`.execute(
      database,
    );
    await sql`insert into journey.journey_dependency (id, journey_id, leg_sequence, mobility_entity_id, canonical_entity_id, entity_type, product_mode, provenance_ref) values (${randomUUID()}::uuid, ${isolatedJourneyId}::uuid, 0, ${entityId}::uuid, ${entityId}::uuid, 'STOP', 'TRANSJAKARTA', 'SAMPLE:m5')`.execute(
      database,
    );
    await sql`insert into journey.active_journey (journey_id, lifecycle_status, activated_at) values (${isolatedJourneyId}::uuid, 'ACTIVE', now())`.execute(
      database,
    );
    await sql`insert into journey.journey_progress (journey_id, completed_leg_count, current_leg_sequence, progress_method, recorded_at, revision) values (${isolatedJourneyId}::uuid, 0, 0, 'CONTROLLED_MANUAL', now(), 1)`.execute(
      database,
    );
    const key = `m5-completed-${suffix}`;
    const observedAt = new Date(Date.now() - 1_000).toISOString();
    const created = await service.submit({
      ownerRef: isolatedOwner,
      journeyId: isolatedJourneyId,
      category: 'SERVICE',
      observedAt,
      entityId,
      entityType: 'STOP',
      description: 'SAMPLE completed journey report.',
      key,
    });
    await sql`update journey.active_journey set lifecycle_status='COMPLETED', completed_at=clock_timestamp() where journey_id=${isolatedJourneyId}::uuid`.execute(
      database,
    );
    assert.equal(
      (
        await service.submit({
          ownerRef: isolatedOwner,
          journeyId: isolatedJourneyId,
          category: 'SERVICE',
          observedAt,
          entityId,
          entityType: 'STOP',
          description: 'SAMPLE completed journey report.',
          key,
        })
      ).report_id,
      created.report_id,
    );
    await assert.rejects(
      service.submit({
        ownerRef: isolatedOwner,
        journeyId: isolatedJourneyId,
        category: 'SERVICE',
        observedAt: new Date(Date.now() - 1_000).toISOString(),
        entityId,
        entityType: 'STOP',
        description: 'SAMPLE new completed journey report.',
        key: `m5-completed-new-${suffix}`,
      }),
      /Journey is completed/,
    );
    const owned = await sql<{
      count: number;
    }>`select count(*)::int as count from report.passenger_report where owner_ref=${isolatedOwner}`.execute(
      database,
    );
    assert.equal(owned.rows[0]?.count, 1);
  });
});
