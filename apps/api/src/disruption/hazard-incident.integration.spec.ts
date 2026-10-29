import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { DisruptionIntelligenceService } from '../disruption/application/disruption-intelligence.service.js';
import { KyselyIncidentLifecycleRepository } from '../disruption/infrastructure/kysely-incident-lifecycle.repository.js';
import { OperationalEventBus } from '../disruption/application/operational-event-bus.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import {
  OperationalIncidentService,
  OperationalIncidentServiceError,
} from '../operational-data/application/operational-incident.service.js';
import type { IncidentEvidenceInput } from '../operational-data/domain/hazard-incident.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';

const sourceId = '91000000-0000-4000-8000-000000000001';
const versionId = '91000000-0000-4000-8000-000000000002';
const routeId = '91000000-0000-4000-8000-000000000010';
const stopId = '91000000-0000-4000-8000-000000000011';
const stationId = '91000000-0000-4000-8000-000000000020';
const unverifiedId = '91000000-0000-4000-8000-000000000030';
const incidentId2 = '91000000-0000-4000-8000-000000000032';
const unknownCloseId = '91000000-0000-4000-8000-000000000033';
const blockerBId = '91000000-0000-4000-8000-000000000034';
const blockerCId = '91000000-0000-4000-8000-000000000035';

const database = createDatabase();
const validator = new OperationalContractValidator();
const mobility = new KyselyMobilityStateRepository(database, validator);
const incidents = new OperationalIncidentService(validator);
const bus = new OperationalEventBus();
const intelligence = new DisruptionIntelligenceService(database);
const lifecycle = new KyselyIncidentLifecycleRepository(
  database,
  incidents,
  mobility,
  bus,
);

function evidence(
  incident: string,
  clock: Date,
  overlaps?: Partial<IncidentEvidenceInput>,
): IncidentEvidenceInput {
  return {
    incidentId: incident,
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityIds: [routeId],
    affectedModes: ['TRANSJAKARTA'],
    operationalState: 'UNAVAILABLE',
    sourceClass: 'SIMULATED',
    sourceId,
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    evidenceType: 'SIMULATED',
    sourceClassification: 'NOT_AVAILABLE',
    observedAt: clock.toISOString(),
    effectiveFrom: clock.toISOString(),
    expiresAt: new Date(clock.getTime() + 60 * 60 * 1000).toISOString(),
    receivedAt: clock.toISOString(),
    reason: 'Controlled simulated incident for X1-A integration coverage.',
    provenanceRef: 'fixture:x1a:incident',
    rawReference: 'fixture:x1a:incident',
    supportingHazardEventId: null,
    ...overlaps,
  };
}

let hazardEventId: string | null = null;

describe('X1-A hazard-incident lifecycle and Twin projection', () => {
  const now = new Date('2026-10-07T03:00:00.000Z');
  const future = new Date('2026-10-07T06:00:00.000Z');

  before(async () => {
    await assertInvocationScratchDatabase(database);
    await migrateToLatest(database);
    await sql`
      insert into meta.dataset_source (id, source_key, name, provider, source_type, verification_status)
      values (${sourceId}::uuid, 'x1a-fixture', 'X1-A fixture', 'TEST', 'CONTROLLED_REPLAY', 'VERIFIED')
    `.execute(database);
    await sql`
      insert into meta.dataset_version (id, source_id, version_label, checksum_sha256, retrieved_at, raw_path_ref, manifest_path, validation_status)
      values (${versionId}::uuid, ${sourceId}::uuid, 'x1a-fixture', ${'a'.repeat(64)}, '2026-10-07T00:00:00Z', 'fixture:x1a', 'fixture:x1a', 'VALID')
    `.execute(database);
    for (const [id, type] of [
      [routeId, 'ROUTE'],
      [stopId, 'STOP'],
      [stationId, 'STATION'],
    ] as const)
      await sql`
        insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
        values (${id}::uuid, ${type}, ${versionId}::uuid)
      `.execute(database);
  });

  after(async () => {
    await database.destroy();
  });

  it('keeps hazard evidence UNKNOWN and never blocks transit while unverified', async () => {
    const hazard = await intelligence.createControlledEvent({
      incidentType: 'FLOOD',
      sourceId,
      evidenceType: 'OBSERVED',
      operationalState: 'UNKNOWN',
      effectiveFrom: now.toISOString(),
      effectiveTo: future.toISOString(),
      receivedAt: now.toISOString(),
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [106.8, -6.2],
            [106.801, -6.2],
            [106.801, -6.199],
            [106.8, -6.199],
            [106.8, -6.2],
          ],
        ],
      },
      reason: 'X1-A hazard capture fixture.',
      provenanceRef: 'fixture:x1a:hazard',
      rawReference: 'fixture:x1a:hazard',
    });
    hazardEventId = hazard.eventId;
    assert.ok(hazardEventId !== null);
    assert.equal(hazard.operationalState, 'UNKNOWN');

    const unverified = await lifecycle.ingest(
      evidence(unverifiedId, now, { supportingHazardEventId: hazard.eventId }),
      'UNVERIFIED',
      now,
    );
    assert.equal(unverified.status, 'INSERTED');
    // Hazard alone plus an unverified incident never blocks the exact canonical route.
    assert.equal(
      (await mobility.replayState(routeId, new Date(now.getTime() + 10_000)))
        .operationalState,
      'UNKNOWN',
    );
  });

  it('blocks only a verified-active exact entity inside its effective window', async () => {
    const futureIncident = await lifecycle.ingest(
      evidence(incidentId2, now, {
        effectiveFrom: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        expiresAt: future.toISOString(),
      }),
      'VERIFIED',
      now,
    );
    assert.equal(futureIncident.status, 'INSERTED');

    // Before effectiveFrom the restriction is not yet active.
    assert.equal(
      (await mobility.replayState(routeId, now)).operationalState,
      'UNKNOWN',
    );

    // Inside the window the canonical route is blocked; unrelated entities are untouched.
    const duringIncident = new Date(now.getTime() + 15 * 60 * 1000);
    assert.equal(
      (await mobility.replayState(routeId, duringIncident)).operationalState,
      'UNAVAILABLE',
    );
    assert.equal(
      (await mobility.replayState(stopId, duringIncident)).operationalState,
      'UNKNOWN',
    );

    // Past expiresAt the restriction lapses.
    assert.equal(
      (await mobility.replayState(routeId, new Date(future.getTime() + 1000)))
        .operationalState,
      'UNKNOWN',
    );
  });

  it('proves idempotence, conflicting-identity rejection, and resolution isolation with an append-only journal', async () => {
    // Re-ingesting the exact same evidence yields no duplicate impact.
    const unchanged = await lifecycle.ingest(
      evidence(incidentId2, now, {
        effectiveFrom: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        expiresAt: future.toISOString(),
      }),
      'VERIFIED',
      now,
    );
    assert.equal(unchanged.status, 'ALREADY_PERSISTED');

    // Same incident id with mismatched evidence fails closed.
    await assert.rejects(
      lifecycle.ingest(
        evidence(incidentId2, now, {
          effectiveFrom: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          expiresAt: future.toISOString(),
          reason: 'Same id, mismatched input.',
        }),
        'VERIFIED',
        now,
      ),
      (error: unknown) =>
        error instanceof OperationalIncidentServiceError &&
        error.failure.code === 'INCIDENT_IDENTITY_CONFLICT',
    );

    const duringIncident = new Date(now.getTime() + 15 * 60 * 1000);
    const blocked = await mobility.replayState(routeId, duringIncident);
    assert.equal(blocked.operationalState, 'UNAVAILABLE');
    assert.equal(blocked.provenanceRef, 'fixture:x1a:incident');

    // Resolve and confirm only this incident's restriction lapses.
    await lifecycle.transition({
      incidentId: incidentId2,
      toStatus: 'RESOLVED',
      changedAt: new Date(now.getTime() + 16 * 60 * 1000).toISOString(),
      reason: 'Resolved: only its own impacted entity recovers.',
      provenanceRef: 'fixture:x1a:resolve-route',
    });
    const beforeResolution = new Date(now.getTime() + 15 * 60 * 1000);
    const afterResolution = new Date(now.getTime() + 17 * 60 * 1000);
    // Replay before the resolution still reflects the restriction; after it, it lapses.
    assert.equal(
      (await mobility.replayState(routeId, beforeResolution)).operationalState,
      'UNAVAILABLE',
    );
    assert.equal(
      (await mobility.replayState(routeId, afterResolution)).operationalState,
      'UNKNOWN',
    );
    assert.equal(
      (await mobility.replayState(stopId, afterResolution)).operationalState,
      'UNKNOWN',
    );

    await assert.rejects(
      sql`update disruption.operational_incident_journal set lifecycle_status='VERIFIED_ACTIVE' where id=(select id from disruption.operational_incident_journal where incident_id=${incidentId2}::uuid order by revision desc limit 1)`.execute(
        database,
      ),
      /OPERATIONAL_INCIDENT_JOURNAL_APPEND_ONLY/,
    );
  });

  it('records late evidence with provenance while rejecting out-of-order terminal transitions', async () => {
    // G6/G7-adjacent temporal control: a valid late arrival (observed earlier,
    // received later) is ingestible with correct provenance; replay still
    // reflects the evidence window rather than overwriting newer authority.
    const lateObserved = new Date(now.getTime() - 30 * 60 * 1000);
    const lateReceived = now;
    const late = await lifecycle.ingest(
      evidence('91000000-0000-4000-8000-000000000040', lateObserved, {
        affectedEntityIds: [stopId],
        receivedAt: lateReceived.toISOString(),
        effectiveFrom: lateObserved.toISOString(),
        expiresAt: future.toISOString(),
      }),
      'VERIFIED',
      lateReceived,
    );
    assert.equal(late.status, 'INSERTED');
    assert.equal(
      (await mobility.replayState(stopId, new Date(now.getTime() + 1000)))
        .operationalState,
      'UNAVAILABLE',
    );
    // Terminal-ordering: a second terminal transition on the same incident must
    // fail closed on lifecycle state, not silently rewrite journal history.
    await lifecycle.transition({
      incidentId: '91000000-0000-4000-8000-000000000040',
      toStatus: 'RESOLVED',
      changedAt: new Date(now.getTime() + 2000).toISOString(),
      reason: 'Late-evidence control resolved with provenance.',
      provenanceRef: 'fixture:x1a:late-resolution',
    });
    await assert.rejects(
      lifecycle.transition({
        incidentId: '91000000-0000-4000-8000-000000000040',
        toStatus: 'RETRACTED',
        changedAt: new Date(now.getTime() + 3000).toISOString(),
        reason: 'Double terminal transition must fail closed.',
        provenanceRef: 'fixture:x1a:double-terminal',
      }),
      (error: unknown) =>
        error instanceof OperationalIncidentServiceError &&
        error.failure.code === 'LIFECYCLE_ALREADY_TERMINAL',
    );
  });

  it('keeps independent blockers effective and rejects backdated terminal transitions', async () => {
    const start = new Date('2026-10-07T04:00:00.000Z');
    const received = new Date(start.getTime() + 10_000);
    const expires = new Date(start.getTime() + 60 * 60 * 1000);
    const first = evidence(blockerBId, start, {
      receivedAt: received.toISOString(),
      effectiveFrom: start.toISOString(),
      expiresAt: expires.toISOString(),
    });
    const second = evidence(blockerCId, start, {
      receivedAt: received.toISOString(),
      effectiveFrom: start.toISOString(),
      expiresAt: expires.toISOString(),
      provenanceRef: 'fixture:x1a:independent-blocker',
      rawReference: 'fixture:x1a:independent-blocker',
    });
    const concurrent = await Promise.all([
      lifecycle.ingest(first, 'VERIFIED', received),
      lifecycle.ingest(first, 'VERIFIED', received),
      lifecycle.ingest(second, 'VERIFIED', received),
    ]);
    assert.deepEqual(
      concurrent
        .slice(0, 2)
        .map((result) => result.status)
        .sort(),
      ['ALREADY_PERSISTED', 'INSERTED'],
    );
    assert.equal(
      (
        await sql<{ count: number }>`
        select count(*)::int as count from twin.operational_observation
        where incident_id=${blockerBId}::uuid
      `.execute(database)
      ).rows[0]?.count,
      1,
    );
    assert.equal(
      (
        await sql<{ count: number }>`
        select count(*)::int as count from disruption.operational_incident_journal
        where incident_id=${blockerBId}::uuid
      `.execute(database)
      ).rows[0]?.count,
      1,
    );
    assert.equal(
      bus
        .snapshot('operational.state.changed')
        .filter((event) => event.incidentId === blockerBId).length,
      1,
    );
    const activeAt = new Date(received.getTime() + 1_000);
    assert.equal(
      (await mobility.replayState(routeId, activeAt)).operationalState,
      'UNAVAILABLE',
    );

    await lifecycle
      .transition({
        incidentId: blockerBId,
        toStatus: 'RESOLVED',
        changedAt: new Date(received.getTime() - 1).toISOString(),
        reason: 'Backdated resolution must not rewrite current lifecycle.',
        provenanceRef: 'fixture:x1a:backdated-resolution',
      })
      .then(
        () => assert.fail('Backdated transition unexpectedly succeeded.'),
        (error: unknown) =>
          assert.ok(
            error instanceof OperationalIncidentServiceError &&
              error.failure.code === 'INCIDENT_INPUT_INVALID',
          ),
      );
    assert.equal(
      (await lifecycle.get(blockerBId))?.lifecycleStatus,
      'VERIFIED_ACTIVE',
    );

    await lifecycle.transition({
      incidentId: blockerBId,
      toStatus: 'RESOLVED',
      changedAt: new Date(received.getTime() + 2_000).toISOString(),
      reason: 'Resolve only first independent restriction.',
      provenanceRef: 'fixture:x1a:resolve-first',
    });
    assert.equal(
      (
        await mobility.replayState(
          routeId,
          new Date(received.getTime() + 3_000),
        )
      ).operationalState,
      'UNAVAILABLE',
    );
    await lifecycle.transition({
      incidentId: blockerCId,
      toStatus: 'RETRACTED',
      changedAt: new Date(received.getTime() + 4_000).toISOString(),
      reason: 'Retract final independent restriction.',
      provenanceRef: 'fixture:x1a:retract-second',
    });
    assert.equal(
      (
        await mobility.replayState(
          routeId,
          new Date(received.getTime() + 5_000),
        )
      ).operationalState,
      'UNKNOWN',
    );
  });

  it('rejects a terminal transition that predates its accepted journal and preserves the historical window', async () => {
    const base = new Date('2026-10-07T05:20:00.000Z');
    const incident = '91000000-0000-4000-8000-000000000041';
    await lifecycle.ingest(
      evidence(incident, base, { affectedEntityIds: [routeId] }),
      'VERIFIED',
      base,
    );
    await lifecycle.transition({
      incidentId: incident,
      toStatus: 'RESOLVED',
      changedAt: new Date(base.getTime() + 4_000).toISOString(),
      reason:
        'Forward transition establishes the accepted latest journal instant.',
      provenanceRef: 'fixture:x1a:forward-terminal',
    });
    assert.equal(
      (await mobility.replayState(routeId, new Date(base.getTime() + 5_000)))
        .operationalState,
      'UNKNOWN',
    );
    // A transition whose changedAt predates the accepted latest journal (same
    // incident) must fail closed as INCIDENT_INPUT_INVALID, regardless of
    // receivedAt. The historical UNKNOWN window is still replayed.
    const backdated = lifecycle.transition({
      incidentId: incident,
      toStatus: 'RETRACTED',
      changedAt: new Date(base.getTime() + 3_000).toISOString(),
      reason: 'Stale journal ordering must not rewrite an accepted terminal.',
      provenanceRef: 'fixture:x1a:stale-journal',
    });
    await assert.rejects(
      backdated,
      (error: unknown) =>
        error instanceof OperationalIncidentServiceError &&
        error.failure.code === 'INCIDENT_INPUT_INVALID',
    );
    assert.equal(
      (await mobility.replayState(routeId, new Date(base.getTime() + 6_000)))
        .operationalState,
      'UNKNOWN',
    );
  });

  it('retracts a separate incident and removes its restriction', async () => {
    await lifecycle.ingest(
      evidence(unknownCloseId, now, {
        incidentType: 'STOP_CLOSURE',
        affectedEntityIds: [stationId],
        affectedModes: ['MRT_JAKARTA'],
      }),
      'VERIFIED',
      now,
    );
    assert.equal(
      (await mobility.replayState(stationId, new Date(now.getTime() + 30_000)))
        .operationalState,
      'UNAVAILABLE',
    );
    await lifecycle.transition({
      incidentId: unknownCloseId,
      toStatus: 'RETRACTED',
      changedAt: new Date(now.getTime() + 60_000).toISOString(),
      reason: 'Retracted after audit.',
      provenanceRef: 'fixture:x1a:retract',
    });
    assert.equal(
      (await mobility.replayState(stationId, new Date(now.getTime() + 61_000)))
        .operationalState,
      'UNKNOWN',
    );
  });

  it('enforces canonical entity linkage and rejects invalid hazard geometry', async () => {
    await assert.rejects(
      lifecycle.ingest(
        evidence('90000000-0000-4000-8000-000000000099', now, {
          affectedEntityIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff'],
        }),
        'VERIFIED',
        now,
      ),
      (error: unknown) =>
        error instanceof OperationalIncidentServiceError &&
        error.failure.code === 'INCIDENT_ENTITY_UNKNOWN',
    );
    await assert.rejects(
      intelligence.createControlledEvent({
        incidentType: 'FLOOD',
        sourceId,
        evidenceType: 'OBSERVED',
        operationalState: 'UNKNOWN',
        effectiveFrom: now.toISOString(),
        effectiveTo: future.toISOString(),
        receivedAt: now.toISOString(),
        geometry: { type: 'Polygon', coordinates: [] },
        reason: 'Empty geometry must be rejected.',
        provenanceRef: 'fixture:x1a:invalid-geometry',
        rawReference: 'fixture:x1a:invalid-geometry',
      }),
      /INVALID_HAZARD_GEOMETRY/,
    );
  });
});
