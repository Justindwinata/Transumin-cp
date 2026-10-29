import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import {
  ActiveJourneyService,
  activeJourneyInstanceId,
  dependencyId,
  extractJourneyDependencies,
  productActivationFingerprint,
  selectedJourneyFingerprint,
} from './application/active-journey.service.js';
import { ActiveJourneyError } from './domain/active-journey.js';
import type { JourneyAlternative } from './domain/journey.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';

const database = createDatabase();
const repository = new KyselyActiveJourneyRepository(database);
const journeys = new ActiveJourneyService(repository);

const owner = `m4:${randomUUID()}`;
const otherOwner = `m4:${randomUUID()}`;
const routingJourneyId = randomUUID();
const journeyId = activeJourneyInstanceId(owner, routingJourneyId);
const snapshotId = randomUUID();
const versionId = randomUUID();
const sourceId = randomUUID();
const mrtEntity = randomUUID();
const busEntity = randomUUID();

function alternative(
  legs: readonly JourneyAlternative['legs'][number][],
  routingId = routingJourneyId,
): JourneyAlternative {
  return {
    journeyId: routingId,
    startAt: '2026-10-03T01:00:00.000Z',
    endAt: '2026-10-03T03:00:00.000Z',
    durationSeconds: 7200,
    walkingDistanceMeters: 320,
    transferCount: legs.length - 1,
    fareStatus: 'UNKNOWN',
    origin: { latitude: -6.2, longitude: 106.8 },
    destination: { latitude: -6.21, longitude: 106.81 },
    legs,
    routingContext: {
      provider: 'OTP',
      providerVersion: '2.10.0',
      routingSnapshotId: 'snapshot-0',
      routingManifestSha256: 'a'.repeat(64),
      graphSha256: 'b'.repeat(64),
      networkSnapshotId: snapshotId,
      networkSnapshotHash: 'c'.repeat(64),
      mobilityProjectionVersion: 'M4',
      commonServiceDate: '2026-10-03',
      timezone: 'Asia/Jakarta',
      plannedAt: '2026-10-03T01:00:00.000Z',
      attemptCount: 1,
      excludedRouteIds: [],
    },
  };
}

function transitLeg(
  sequence: number,
  mode: 'MRT_JAKARTA' | 'TRANSJAKARTA',
  entityId: string,
): JourneyAlternative['legs'][number] {
  const start = new Date(
    Date.parse('2026-10-03T01:00:00.000Z') + sequence * 1_800_000,
  );
  return {
    sequence,
    mode,
    otpMode: mode === 'MRT_JAKARTA' ? 'SUBWAY' : 'BUS',
    from: {
      name: `Stop ${sequence}`,
      otpStopId: null,
      latitude: -6.2,
      longitude: 106.8,
    },
    to: {
      name: `Stop ${sequence + 1}`,
      otpStopId: null,
      latitude: -6.21,
      longitude: 106.81,
    },
    intermediateStops: [],
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 1_200_000).toISOString(),
    durationSeconds: 1200,
    distanceMeters: 3000,
    routeId: `route-${sequence}`,
    routeShortName: mode === 'MRT_JAKARTA' ? 'MRT' : 'TJ',
    tripId: `trip-${sequence}`,
    serviceDate: '2026-10-03',
    timingPrecision: 'EXACT_SCHEDULE',
    entityBindings: [
      {
        otpEntityId: `route-${sequence}`,
        productMode: mode,
        entityType: 'ROUTE',
        canonicalEntityId: entityId,
        mobilityEntityId: entityId,
        resolutionMethod: 'EXACT_SOURCE_REFERENCE',
        provenanceRef: 'fixture:M4',
      },
    ],
    operationalFlags: [],
  };
}

function walkingLeg(sequence: number): JourneyAlternative['legs'][number] {
  const start = new Date(
    Date.parse('2026-10-03T01:00:00.000Z') + sequence * 1_800_000,
  );
  return {
    sequence,
    mode: 'WALK',
    otpMode: 'WALK',
    from: {
      name: `Stop ${sequence}`,
      otpStopId: null,
      latitude: -6.2,
      longitude: 106.8,
    },
    to: {
      name: `Stop ${sequence + 1}`,
      otpStopId: null,
      latitude: -6.205,
      longitude: 106.805,
    },
    intermediateStops: [],
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 300_000).toISOString(),
    durationSeconds: 300,
    distanceMeters: 320,
    routeId: null,
    routeShortName: null,
    tripId: null,
    serviceDate: '2026-10-03',
    timingPrecision: 'ESTIMATED',
    entityBindings: [
      {
        otpEntityId: 'walk',
        productMode: 'WALK',
        entityType: 'STOP',
        canonicalEntityId: mrtEntity,
        mobilityEntityId: mrtEntity,
        resolutionMethod: 'EXACT_SOURCE_REFERENCE',
        provenanceRef: 'fixture:M4',
      },
    ],
    operationalFlags: [],
  };
}

async function activateWith(
  legs: readonly JourneyAlternative['legs'][number][],
  ownerRef = owner,
  routingId = routingJourneyId,
) {
  return journeys.activate({
    ownerRef,
    selectedJourney: alternative(legs, routingId),
    activatedAt: '2026-10-03T01:00:00.000Z',
  });
}

describe('M4 explicit boarding evidence', () => {
  before(async () => {
    await migrateToLatest(database);
    await sql`
      insert into meta.dataset_source (id, source_key, name, provider, source_type, verification_status)
      values (${sourceId}::uuid, ${`m4-${sourceId}`}, 'M4 fixture', 'Test', 'SYNTHETIC_TEST', 'VERIFIED')
    `.execute(database);
    await sql`
      insert into meta.dataset_version (id, source_id, version_label, checksum_sha256, retrieved_at, raw_path_ref, manifest_path, validation_status)
      values (${versionId}::uuid, ${sourceId}::uuid, 'm4', ${'a'.repeat(64)}, now(), 'fixture:M4', 'fixture:M4', 'VALID')
    `.execute(database);
    await sql`
      insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
      values
        (${mrtEntity}::uuid, 'ROUTE', ${versionId}::uuid),
        (${busEntity}::uuid, 'ROUTE', ${versionId}::uuid)
    `.execute(database);
    await sql`
      insert into twin.network_snapshot (id, transit_dataset_version_id, spatial_dataset_version_id, processing_version, state_cutoff_at, configuration_json, manifest_ref, content_hash, status, finalized_at)
      values (${snapshotId}::uuid, ${versionId}::uuid, ${versionId}::uuid, 'M4', now(), '{}'::jsonb, 'fixture:M4', ${'d'.repeat(64)}, 'FINALIZED', now())
    `.execute(database);
  });

  // Immutable fixtures stay intact; verified invocation-owned runner disposes whole DB.
  after(async () => {
    await database.destroy();
  });

  it('enforces boarding-before-alighting and rejects invalid transitions', async () => {
    const active = await activateWith([
      transitLeg(0, 'MRT_JAKARTA', mrtEntity),
    ]);
    assert.equal(active.journeyId, journeyId);
    assert.equal(active.progress.boardingConfirmedLegSequence, null);

    await assert.rejects(
      () =>
        journeys.confirmAlighting({
          journeyId,
          ownerRef: owner,
          legSequence: 0,
          confirmedAt: '2026-10-03T01:05:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_BOARDING',
    );
    const boarded = await journeys.confirmBoarding({
      journeyId,
      ownerRef: owner,
      legSequence: 0,
      confirmedAt: '2026-10-03T01:05:00.000Z',
    });
    assert.equal(boarded.progress.boardingConfirmedLegSequence, 0);
    assert.equal(
      boarded.progress.boardingConfirmedAt,
      '2026-10-03T01:05:00.000Z',
    );
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId,
          ownerRef: owner,
          legSequence: 1,
          confirmedAt: '2026-10-03T01:06:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_BOARDING',
    );
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId,
          ownerRef: owner,
          legSequence: 0,
          confirmedAt: '2026-10-03T01:04:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_BOARDING',
    );
    // Stale progress timestamp is rejected for a leg that has no record yet.
    await assert.rejects(
      () =>
        journeys.confirmAlighting({
          journeyId,
          ownerRef: owner,
          legSequence: 0,
          confirmedAt: '2026-10-03T01:04:59.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_PROGRESS',
    );
    const exited = await journeys.confirmAlighting({
      journeyId,
      ownerRef: owner,
      legSequence: 0,
      confirmedAt: '2026-10-03T01:35:00.000Z',
    });
    assert.equal(exited.progress.alightingConfirmedLegSequence, 0);
    assert.equal(
      exited.progress.alightingConfirmedAt,
      '2026-10-03T01:35:00.000Z',
    );
    assert.equal(exited.progress.revision >= 3, true);
  });

  it('rejects cross-owner boarding and walking-leg boarding', async () => {
    const secondRoutingId = randomUUID();
    const active = await activateWith(
      [walkingLeg(0), transitLeg(1, 'TRANSJAKARTA', busEntity)],
      owner,
      secondRoutingId,
    );
    const leggedId = active.journeyId;
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId: leggedId,
          ownerRef: otherOwner,
          legSequence: 1,
          confirmedAt: '2026-10-03T01:05:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'OWNER_SCOPE_MISMATCH',
    );
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId: leggedId,
          ownerRef: owner,
          legSequence: 0,
          confirmedAt: '2026-10-03T01:05:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_BOARDING',
    );
  });

  it('keeps per-leg confirmation history across multiple transit legs', async () => {
    const routingId = randomUUID();
    const active = await activateWith(
      [
        walkingLeg(0),
        transitLeg(1, 'MRT_JAKARTA', mrtEntity),
        transitLeg(2, 'TRANSJAKARTA', busEntity),
      ],
      owner,
      routingId,
    );
    const id = active.journeyId;
    // Walking leg uses manual progress; boarding a walking leg is rejected.
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId: id,
          ownerRef: owner,
          legSequence: 0,
          confirmedAt: '2026-10-03T01:05:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_BOARDING',
    );
    await journeys.updateProgress({
      journeyId: id,
      ownerRef: owner,
      completedLegCount: 1,
      currentLegSequence: 1,
      recordedAt: '2026-10-03T01:06:00.000Z',
    });
    const boarded1 = await journeys.confirmBoarding({
      journeyId: id,
      ownerRef: owner,
      legSequence: 1,
      confirmedAt: '2026-10-03T01:07:00.000Z',
    });
    assert.equal(boarded1.progress.boardingConfirmedLegSequence, 1);
    // Duplicate identical confirmation is idempotent: revision must not inflate.
    const retried = await journeys.confirmBoarding({
      journeyId: id,
      ownerRef: owner,
      legSequence: 1,
      confirmedAt: '2026-10-03T01:07:00.000Z',
    });
    assert.equal(retried.progress.revision, boarded1.progress.revision);
    const alighted1 = await journeys.confirmAlighting({
      journeyId: id,
      ownerRef: owner,
      legSequence: 1,
      confirmedAt: '2026-10-03T01:20:00.000Z',
    });
    assert.equal(alighted1.progress.alightingConfirmedLegSequence, 1);
    const alightRetry = await journeys.confirmAlighting({
      journeyId: id,
      ownerRef: owner,
      legSequence: 1,
      confirmedAt: '2026-10-03T01:20:00.000Z',
    });
    assert.equal(alightRetry.progress.revision, alighted1.progress.revision);
    await journeys.updateProgress({
      journeyId: id,
      ownerRef: owner,
      completedLegCount: 2,
      currentLegSequence: 2,
      recordedAt: '2026-10-03T01:21:00.000Z',
    });
    const boarded2 = await journeys.confirmBoarding({
      journeyId: id,
      ownerRef: owner,
      legSequence: 2,
      confirmedAt: '2026-10-03T01:22:00.000Z',
    });
    assert.equal(boarded2.progress.boardingConfirmedLegSequence, 2);
    await journeys.confirmAlighting({
      journeyId: id,
      ownerRef: owner,
      legSequence: 2,
      confirmedAt: '2026-10-03T01:40:00.000Z',
    });
    // Append-only state events preserve evidence for every confirmed leg.
    const events = await sql<{
      eventType: string;
      payload: { legSequence: number };
    }>`
      select event_type as "eventType", payload_json as payload
      from journey.journey_state_event
      where journey_id=${id}::uuid and event_type in ('BOARDED','ALIGHTED')
      order by occurred_at
    `.execute(database);
    assert.deepEqual(
      events.rows.map((row) => `${row.eventType}:${row.payload.legSequence}`),
      ['BOARDED:1', 'ALIGHTED:1', 'BOARDED:2', 'ALIGHTED:2'],
    );
    // Re-boarding an already exited leg is rejected.
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId: id,
          ownerRef: owner,
          legSequence: 1,
          confirmedAt: '2026-10-03T01:45:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'INVALID_BOARDING',
    );
    const completedJourney = await journeys.updateProgress({
      journeyId: id,
      ownerRef: owner,
      completedLegCount: 3,
      currentLegSequence: null,
      recordedAt: '2026-10-03T01:41:00.000Z',
    });
    assert.equal(completedJourney.lifecycleStatus, 'COMPLETED');
    await assert.rejects(
      () =>
        journeys.confirmBoarding({
          journeyId: id,
          ownerRef: owner,
          legSequence: 2,
          confirmedAt: '2026-10-03T01:50:00.000Z',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'JOURNEY_NOT_ACTIVE',
    );
  });

  it('serializes concurrent identical boarding via row lock', async () => {
    const routingId = randomUUID();
    const active = await activateWith(
      [transitLeg(0, 'TRANSJAKARTA', busEntity)],
      owner,
      routingId,
    );
    const id = active.journeyId;
    await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        journeys.confirmBoarding({
          journeyId: id,
          ownerRef: owner,
          legSequence: 0,
          confirmedAt: '2026-10-03T02:00:00.000Z',
        }),
      ),
    );
    const distinctEvents = await sql<{ count: string }>`
      select count(*)::text from journey.journey_state_event
      where journey_id=${id}::uuid and event_type='BOARDED'
    `.execute(database);
    assert.equal(distinctEvents.rows[0]?.count, '1');
    const afterAll = await journeys.get(id, owner);
    assert.equal(afterAll.progress.boardingConfirmedLegSequence, 0);
    assert.equal(afterAll.progress.revision, active.progress.revision + 1);
    // Concurrent identical requests serialize to one state event/revision.
  });

  it('extracts audited dependencies without GPS claims', () => {
    const extracted = extractJourneyDependencies(
      alternative([transitLeg(0, 'MRT_JAKARTA', mrtEntity)]),
    );
    assert.deepEqual(
      extracted.map((item) => ({
        id: dependencyId(
          routingJourneyId,
          item.legSequence,
          item.mobilityEntityId,
        ),
        owner: item.journeyId,
      })),
      [
        {
          id: dependencyId(routingJourneyId, 0, mrtEntity),
          owner: routingJourneyId,
        },
      ],
    );
    assert.equal(
      selectedJourneyFingerprint(
        alternative([transitLeg(0, 'MRT_JAKARTA', mrtEntity)]),
      ).length,
      64,
    );
  });

  it('activates idempotently by explicit Idempotency-Key with owner independence', async () => {
    const legs = [transitLeg(0, 'MRT_JAKARTA', mrtEntity)];
    const key = `k:${randomUUID()}`;
    const first = await journeys.activate({
      ownerRef: owner,
      selectedJourney: alternative(legs),
      activatedAt: '2026-10-03T01:00:00.000Z',
      idempotencyKey: key,
    });
    // Same key + equivalent content with a volatile replan timestamp replays.
    const replan = {
      ...alternative(legs),
      routingContext: {
        ...alternative(legs).routingContext,
        plannedAt: '2026-10-03T02:30:00.000Z',
      },
    };
    const replay = await journeys.activate({
      ownerRef: owner,
      selectedJourney: replan,
      activatedAt: '2026-10-03T02:30:00.000Z',
      idempotencyKey: key,
    });
    assert.equal(replay.journeyId, first.journeyId);
    assert.equal(replay.activatedAt, first.activatedAt);
    // Distinct key with equivalent content is a legitimate separate activation.
    const second = await journeys.activate({
      ownerRef: owner,
      selectedJourney: alternative(legs),
      activatedAt: '2026-10-03T02:31:00.000Z',
      idempotencyKey: `k:${randomUUID()}`,
    });
    assert.notEqual(second.journeyId, first.journeyId);
    // Distinct owner with the same routing result does not collide.
    const other = await journeys.activate({
      ownerRef: otherOwner,
      selectedJourney: alternative(legs),
      activatedAt: '2026-10-03T02:32:00.000Z',
      idempotencyKey: key,
    });
    assert.notEqual(other.journeyId, first.journeyId);
    // Same key with genuinely different plan content is a conflict.
    const changed = [
      transitLeg(0, 'MRT_JAKARTA', mrtEntity),
      transitLeg(1, 'TRANSJAKARTA', busEntity),
    ];
    await assert.rejects(
      () =>
        journeys.activate({
          ownerRef: owner,
          selectedJourney: alternative(changed),
          activatedAt: '2026-10-03T02:33:00.000Z',
          idempotencyKey: key,
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'ACTIVATION_CONFLICT',
    );
    // Invalid key format is rejected before any identity work.
    await assert.rejects(
      () =>
        journeys.activate({
          ownerRef: owner,
          selectedJourney: alternative(legs),
          activatedAt: '2026-10-03T02:34:00.000Z',
          idempotencyKey: 'short',
        }),
      (error: unknown) =>
        error instanceof ActiveJourneyError &&
        error.code === 'ACTIVATION_CONFLICT',
    );
    // Concurrent identical activation replays the winner's instance exactly once.
    const concurrentKey = `k:${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        journeys.activate({
          ownerRef: owner,
          selectedJourney: alternative(legs),
          activatedAt: '2026-10-03T02:35:00.000Z',
          idempotencyKey: concurrentKey,
        }),
      ),
    );
    const concurrentIds = new Set(
      results.map((result) =>
        result.status === 'fulfilled' ? result.value.journeyId : 'REJECTED',
      ),
    );
    assert.equal(concurrentIds.size, 1);
  });

  it('keeps the product activation fingerprint stable across volatile replan time', () => {
    const legs = [transitLeg(0, 'MRT_JAKARTA', mrtEntity)];
    const original = alternative(legs);
    const replan = {
      ...alternative(legs),
      routingContext: {
        ...alternative(legs).routingContext,
        plannedAt: '2026-10-04T09:00:00.000Z',
      },
    };
    assert.equal(
      productActivationFingerprint(replan),
      productActivationFingerprint(original),
    );
    // Meaningful service-day context stays part of the product identity.
    const otherDay = {
      ...alternative(legs),
      routingContext: {
        ...alternative(legs).routingContext,
        commonServiceDate: '2026-10-05',
      },
    };
    assert.notEqual(
      productActivationFingerprint(otherDay),
      productActivationFingerprint(original),
    );
    // Research fingerprints keep the original hash (planned_at included).
    assert.notEqual(
      selectedJourneyFingerprint(replan),
      selectedJourneyFingerprint(original),
    );
  });
});
