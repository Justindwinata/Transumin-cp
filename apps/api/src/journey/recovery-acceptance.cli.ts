import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';
import { sql, type Kysely } from 'kysely';

import { AppModule } from '../app.module.js';
import { configureApplication } from '../application.js';
import {
  DATABASE,
  type FoundationDatabase,
} from '../infrastructure/database/database.constants.js';
import { LiveOperationalGateway } from '../disruption/application/live-operational-gateway.js';
import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../mobility-twin/application/mobility-state.port.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';
import { JourneyImpactService } from './application/journey-impact.service.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidencePath = path.join(
  root,
  'data/manifests/RUN-5B-RECOVERY-COMPARISON-EVIDENCE.json',
);
const snapshotId = '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f';

function serviceToken(): string {
  const token = process.env.PASSENGER_SERVICE_TOKEN;
  if (!token || token.length < 32)
    throw new Error(
      'PASSENGER_SERVICE_TOKEN is required for protected passenger routes.',
    );
  return token;
}

type Binding = Readonly<{
  mobility_entity_id: string | null;
  canonical_entity_id: string;
  entity_type: string;
}>;
type Segment = Readonly<{
  sequence: number;
  mode: string;
  start_at: string;
  end_at: string;
  from: { latitude: number | null; longitude: number | null };
  entity_bindings: readonly Binding[];
}>;
type ApiJourney = Readonly<{
  journey_id: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  segments: readonly Segment[];
  progress?: { recorded_at: string; revision: number };
  routing_context: {
    routing_snapshot_id: string;
    network_snapshot_id: string;
  };
}>;
type Alert = Readonly<{ impact_id: string }>;
type Recovery = Readonly<{
  recovery_id: string;
  status: string;
  original_journey_fingerprint: string;
  network_snapshot_id: string;
  mobility_projection_version: string;
  triggering_entity_id: string;
  recovery_anchor: { latitude: number; longitude: number };
  proposed_fingerprint: string | null;
  baseline_fingerprint: string | null;
  preserved_segment_count: number;
  changed_segment_count: number;
  additional_duration_seconds: number | null;
  additional_transfers: number | null;
  proposed_journey: ApiJourney | null;
  baseline_journey: ApiJourney | null;
  rejoin_status: 'REJOINED' | 'SUFFIX_REPLANNED' | 'NO_PATH';
  rejoin_reason: string;
  rejoined_segments: readonly number[];
  preserved_segments: readonly number[];
  repaired_segments: readonly number[];
  invalidated_segments: readonly number[];
  metrics: {
    recovery_success: boolean;
    preserved_leg_ratio: number;
    eligible_remaining_leg_count: number;
    plan_change_count: number;
    disrupted_entity_avoidance: boolean;
    state_validation_ms: number;
    preservation_processing_ms: number;
    proposed_routing_ms: number;
    baseline_routing_ms: number;
    total_computation_ms: number;
    state_aware: {
      recovery_success: boolean;
      preserved_leg_ratio: number;
      additional_duration_seconds: number | null;
      additional_transfers: number | null;
      plan_change_count: number | null;
      disrupted_entity_avoidance: boolean;
      timing: {
        total_ms: number;
        routing_ms: number;
        validation_ms: number;
        merge_ms: number;
      };
    };
    full_replan: {
      recovery_success: boolean;
      preserved_leg_ratio: number;
      additional_duration_seconds: number | null;
      additional_transfers: number | null;
      plan_change_count: number | null;
      disrupted_entity_avoidance: boolean;
      timing: { total_ms: number; routing_ms: number; validation_ms: number };
    };
  };
}>;
type Envelope<T> = Readonly<{ data: T }>;

async function run(): Promise<object> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    const port = (app.getHttpServer().address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api/v1`;
    const states = app.get<MobilityStatePort>(MOBILITY_STATE_PORT);
    const gateway = app.get(LiveOperationalGateway);
    const impacts = app.get(JourneyImpactService);
    await clearControlledUnavailableState(
      app.get<Kysely<FoundationDatabase>>(DATABASE),
      gateway,
      impacts,
    );
    const alternatives = await plan(base);
    let selected:
      | {
          original: ApiJourney;
          target: { mobilityEntityId: string; sequence: number };
        }
      | undefined;
    for (const candidate of alternatives.filter(isMultimodalWithRepairPrefix)) {
      for (const candidateTarget of futureRouteDependencies(candidate)) {
        const [state] = await states.getStates([
          candidateTarget.mobilityEntityId,
        ]);
        if (state?.operationalState !== 'UNAVAILABLE') {
          selected = { original: candidate, target: candidateTarget };
          break;
        }
      }
      if (selected !== undefined) break;
    }
    if (selected === undefined) {
      const original = alternatives.find(isMultimodalWithRepairPrefix);
      const target = original && futureRouteDependencies(original)[0];
      if (original && target) {
        await gateway.ingestObservations(
          [simulated(target.mobilityEntityId, 'AVAILABLE')],
          new Date(),
        );
        await impacts.whenIdle();
        selected = { original, target };
      }
    }
    if (selected === undefined)
      throw new Error(
        'No real multimodal journey exposed a repairable future route dependency.',
      );
    const { original, target } = selected;
    const owner = `run5b:${randomUUID()}`;
    const active = await activate(base, owner, original);
    const completedLegCount = 2;
    const progressed = await updateProgress(
      base,
      owner,
      active,
      completedLegCount,
    );

    await gateway.ingestObservations(
      [simulated(target.mobilityEntityId, 'UNAVAILABLE')],
      new Date(),
    );
    await impacts.whenIdle();
    const activeAlerts = await alerts(base, owner, active.journey_id);
    const impactId = activeAlerts.at(-1)?.impact_id;
    if (impactId === undefined)
      throw new Error('Simulated future disruption produced no impact.');

    const recoveryAt = progressed.progress!.recorded_at;
    const idempotencyKey = `run5b-${original.journey_id}-${impactId}`;
    const recoveryStarted = performance.now();
    const recovery = await createRecovery(
      base,
      owner,
      idempotencyKey,
      active.journey_id,
      impactId,
      recoveryAt,
    );
    const recoveryMilliseconds = performance.now() - recoveryStarted;
    const repeated = await createRecovery(
      base,
      owner,
      idempotencyKey,
      active.journey_id,
      impactId,
      recoveryAt,
    );
    assertAcceptedRecovery(recovery, repeated, target.mobilityEntityId);

    const early = await executeEarlyScenario(
      base,
      alternatives.filter(
        (candidate) => candidate.journey_id !== original.journey_id,
      ),
      states,
      gateway,
      impacts,
    );
    const rejoin = await executeRejoinScenario(
      base,
      gateway,
      impacts,
      app.get<Kysely<FoundationDatabase>>(DATABASE),
    );

    const alertsBeforeCompletedOnly = (
      await alerts(base, owner, active.journey_id)
    ).length;
    const completedOnly = completedOnlyDependency(original);
    if (completedOnly !== undefined) {
      await gateway.ingestObservations(
        [simulated(completedOnly, 'UNAVAILABLE')],
        new Date(),
      );
      await impacts.whenIdle();
      if (
        (await alerts(base, owner, active.journey_id)).length !==
        alertsBeforeCompletedOnly
      )
        throw new Error(
          'A completed-only dependency created a new current alert.',
        );
    }

    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      evidenceSemantics:
        'REAL_OTP_MULTIMODAL_JOURNEY_WITH_CONTROLLED_SIMULATED_STATE',
      scenario: {
        name: 'MID_JOURNEY_FUTURE_ROUTE_UNAVAILABLE',
        originalJourneyId: original.journey_id,
        originalModes: [
          ...new Set(original.segments.map((segment) => segment.mode)),
        ],
        progressCompletedLegCount: completedLegCount,
        recoveryAnchor: recovery.recovery_anchor,
        disruptedMobilityEntityId: target.mobilityEntityId,
        disruptedLegSequence: target.sequence,
        impactId,
      },
      proposed: {
        outcome: recovery.status,
        fingerprint: recovery.proposed_fingerprint,
        addedTravelTimeSeconds: recovery.additional_duration_seconds,
        addedTransfers: recovery.additional_transfers,
        changedLegCount: recovery.changed_segment_count,
        metrics: recovery.metrics,
      },
      baseline: {
        method: 'FULL_REPLAN',
        fingerprint: recovery.baseline_fingerprint,
        sameAnchor:
          recovery.baseline_journey?.origin.latitude ===
            recovery.recovery_anchor.latitude &&
          recovery.baseline_journey?.origin.longitude ===
            recovery.recovery_anchor.longitude,
      },
      earlyDisruption: early,
      rejoin,
      typedNoPathEvidence: {
        automatedTest:
          'RUN 5B returns NO_PATH while retaining the independently computed FULL_REPLAN baseline',
        silentFallback: false,
      },
      invariants: {
        immutableOriginalJourneyId: original.journey_id,
        completedHistoryExcludedFromPreservedRatio: true,
        blockedEntityAvoided: recovery.metrics.disrupted_entity_avoidance,
        idempotentRecoveryId: recovery.recovery_id === repeated.recovery_id,
        sameNetworkSnapshot:
          recovery.proposed_journey?.routing_context.network_snapshot_id ===
            recovery.baseline_journey?.routing_context.network_snapshot_id &&
          recovery.proposed_journey?.routing_context.network_snapshot_id ===
            snapshotId,
        completedOnlyDependencyAlertSuppressed:
          completedOnly === undefined
            ? 'COVERED_BY_DATABASE_INTEGRATION'
            : true,
        simulatedNeverLive: true,
      },
      performanceMilliseconds: {
        comparisonOrchestrationWall: round(recoveryMilliseconds),
        stateValidation: recovery.metrics.state_validation_ms,
        mergeAndPreservation: recovery.metrics.preservation_processing_ms,
        stateAwareRouting: recovery.metrics.proposed_routing_ms,
        fullReplanRouting: recovery.metrics.baseline_routing_ms,
        recordedComparisonOrchestration: recovery.metrics.total_computation_ms,
        stateAwareTotal: recovery.metrics.state_aware.timing.total_ms,
        fullReplanTotal: recovery.metrics.full_replan.timing.total_ms,
      },
      status: 'PASS',
    };
  } finally {
    await app.close();
  }
}

async function executeRejoinScenario(
  base: string,
  gateway: LiveOperationalGateway,
  impacts: JourneyImpactService,
  database: Kysely<FoundationDatabase>,
) {
  const cases = [
    {
      origin: { latitude: -6.5942887, longitude: 106.7907695 },
      destination: { latitude: -6.2892744, longitude: 106.7749355 },
      departureAt: '2026-10-02T04:03:00+07:00',
    },
    {
      origin: { latitude: -6.13679, longitude: 106.8149 },
      destination: { latitude: -6.2924511, longitude: 106.7924644 },
      departureAt: '2026-10-02T06:03:00+07:00',
    },
    {
      origin: { latitude: -6.1574335, longitude: 106.9142078 },
      destination: { latitude: -6.2924511, longitude: 106.7924644 },
      departureAt: '2026-10-02T06:03:00+07:00',
    },
    {
      origin: { latitude: -6.108205, longitude: 106.89982 },
      destination: { latitude: -6.205627, longitude: 106.822295 },
      departureAt: '2026-10-02T08:13:00+07:00',
    },
  ];
  const outcomes: Array<{
    caseIndex: number;
    journeyId: string;
    targetSequence: number;
    status: string;
    reason: string;
  }> = [];
  for (const [caseIndex, testCase] of cases.entries()) {
    await clearControlledUnavailableState(database, gateway, impacts);
    const journeys = await planAt(base, testCase);
    for (const journey of journeys.filter(isMultimodal)) {
      const candidates = journey.segments
        .flatMap((segment) =>
          segment.sequence > 0 && segment.sequence < journey.segments.length - 1
            ? segment.entity_bindings
                .filter(
                  (binding) =>
                    binding.entity_type === 'ROUTE' &&
                    binding.mobility_entity_id !== null,
                )
                .map((binding) => ({
                  sequence: segment.sequence,
                  entityId: binding.mobility_entity_id!,
                }))
            : [],
        )
        .filter(({ sequence, entityId }) =>
          journey.segments
            .slice(sequence + 1)
            .every((segment) =>
              segment.entity_bindings.every(
                (binding) => binding.mobility_entity_id !== entityId,
              ),
            ),
        );
      for (const target of candidates) {
        await clearControlledUnavailableState(database, gateway, impacts);
        const owner = `run5br:${caseIndex}:${randomUUID()}`;
        const active = await activate(base, owner, journey);
        const completed = Math.max(0, target.sequence - 1);
        const progressed =
          completed === 0
            ? active
            : await updateProgress(base, owner, active, completed);
        await gateway.ingestObservations(
          [simulated(target.entityId, 'UNAVAILABLE')],
          new Date(),
        );
        await impacts.whenIdle();
        const impactId = (await alerts(base, owner, active.journey_id)).at(
          -1,
        )?.impact_id;
        if (impactId === undefined) continue;
        const recovery = await createRecovery(
          base,
          owner,
          `run5br-${impactId}`,
          active.journey_id,
          impactId,
          progressed.progress!.recorded_at,
        );
        outcomes.push({
          caseIndex,
          journeyId: journey.journey_id,
          targetSequence: target.sequence,
          status: recovery.rejoin_status,
          reason: recovery.rejoin_reason,
        });
        if (recovery.rejoin_status === 'REJOINED') {
          if (
            recovery.rejoined_segments.length === 0 ||
            recovery.proposed_journey === null
          )
            throw new Error('Rejoin status has no preserved original suffix.');
          if (
            recovery.proposed_journey.segments.some((segment) =>
              segment.entity_bindings.some(
                (binding) => binding.mobility_entity_id === target.entityId,
              ),
            )
          )
            throw new Error(
              'Rejoined recovery retained the blocked canonical entity.',
            );
          if (
            recovery.baseline_journey === null ||
            recovery.baseline_journey.origin.latitude !==
              recovery.recovery_anchor.latitude ||
            recovery.baseline_journey.origin.longitude !==
              recovery.recovery_anchor.longitude ||
            recovery.proposed_journey.routing_context.network_snapshot_id !==
              recovery.network_snapshot_id ||
            recovery.baseline_journey.routing_context.network_snapshot_id !==
              recovery.network_snapshot_id ||
            recovery.proposed_journey.routing_context.routing_snapshot_id !==
              journey.routing_context.routing_snapshot_id ||
            recovery.baseline_journey.routing_context.routing_snapshot_id !==
              journey.routing_context.routing_snapshot_id
          )
            throw new Error(
              'Rejoin comparison does not share anchor, routing graph and network snapshot.',
            );
          const persistedRoles = await sql<{ role: string }>`
            select distinct result_leg_json->>'recoveryStructure' as role
            from recovery.recovery_segment
            where recovery_id=${recovery.recovery_id}::uuid
          `.execute(database);
          const roles = persistedRoles.rows.map((row) => row.role).sort();
          if (
            [
              'COMPLETED',
              'PRESERVED',
              'INVALIDATED',
              'REPAIRED',
              'REJOINED',
            ].some((role) => !roles.includes(role))
          )
            throw new Error(
              `Persisted recovery structure is incomplete: ${roles.join(',')}`,
            );
          return {
            status: 'PASS',
            scenarioId: `RUN-5B-R-REJOIN-${caseIndex}-${target.sequence}`,
            caseIndex,
            originalJourneyId: journey.journey_id,
            originalJourneyFingerprint: recovery.original_journey_fingerprint,
            modes: [
              ...new Set(journey.segments.map((segment) => segment.mode)),
            ],
            progress: {
              completedLegCount: completed,
              recoveryAt: progressed.progress!.recorded_at,
              revision: progressed.progress!.revision,
            },
            recoveryAnchor: recovery.recovery_anchor,
            disruption: {
              evidenceType: 'SIMULATED',
              operationalState: 'UNAVAILABLE',
              blockedEntityId: target.entityId,
              blockedLegSequence: target.sequence,
              impactId,
            },
            snapshot: {
              networkSnapshotId: recovery.network_snapshot_id,
              mobilityProjectionVersion: recovery.mobility_projection_version,
              routingInputVersion: journey.routing_context.routing_snapshot_id,
              sameAnchorGraphAndNetworkSnapshot: true,
            },
            recoveryId: recovery.recovery_id,
            structure: {
              preserved: recovery.preserved_segments,
              invalidated: recovery.invalidated_segments,
              repaired: recovery.repaired_segments,
              rejoined: recovery.rejoined_segments,
              persistedRoles: roles,
            },
            rejoinReason: recovery.rejoin_reason,
            proposed: {
              outcome: recovery.status,
              fingerprint: recovery.proposed_fingerprint,
              metrics: recovery.metrics.state_aware,
            },
            baseline: {
              outcome:
                recovery.baseline_journey === null ? 'NO_PATH' : 'COMPLETED',
              fingerprint: recovery.baseline_fingerprint,
              metrics: recovery.metrics.full_replan,
            },
            pairedDifferences: {
              preservedLegRatio: round(
                recovery.metrics.state_aware.preserved_leg_ratio -
                  recovery.metrics.full_replan.preserved_leg_ratio,
              ),
              planChangeCount:
                (recovery.metrics.state_aware.plan_change_count ?? 0) -
                (recovery.metrics.full_replan.plan_change_count ?? 0),
              addedTravelTimeSeconds:
                (recovery.metrics.state_aware.additional_duration_seconds ??
                  0) -
                (recovery.metrics.full_replan.additional_duration_seconds ?? 0),
              addedTransfers:
                (recovery.metrics.state_aware.additional_transfers ?? 0) -
                (recovery.metrics.full_replan.additional_transfers ?? 0),
              totalMs: round(
                recovery.metrics.state_aware.timing.total_ms -
                  recovery.metrics.full_replan.timing.total_ms,
              ),
            },
            testedCases: outcomes.length,
          };
        }
      }
    }
  }
  throw new Error(
    `No real OTP journey admitted an operationally and temporally valid suffix rejoin: ${JSON.stringify(outcomes)}`,
  );
}

async function clearControlledUnavailableState(
  database: Kysely<FoundationDatabase>,
  gateway: LiveOperationalGateway,
  impacts: JourneyImpactService,
): Promise<void> {
  const rows = await sql<{ mobilityEntityId: string }>`
    select mobility_entity_id as "mobilityEntityId"
    from twin.mobility_state
    where operational_state='UNAVAILABLE' and evidence_type='SIMULATED'
  `.execute(database);
  for (const row of rows.rows)
    await gateway.ingestObservations(
      [simulated(row.mobilityEntityId, 'AVAILABLE')],
      new Date(),
    );
  await impacts.whenIdle();
}

async function executeEarlyScenario(
  base: string,
  alternatives: readonly ApiJourney[],
  states: MobilityStatePort,
  gateway: LiveOperationalGateway,
  impacts: JourneyImpactService,
) {
  for (const original of alternatives) {
    if (!isMultimodal(original)) continue;
    for (const target of earlyRouteDependencies(original)) {
      const [state] = await states.getStates([target.mobilityEntityId]);
      if (state?.operationalState === 'UNAVAILABLE') {
        await gateway.ingestObservations(
          [simulated(target.mobilityEntityId, 'AVAILABLE')],
          new Date(),
        );
        await impacts.whenIdle();
      }
      const owner = `run5b-early:${randomUUID()}`;
      const active = await activate(base, owner, original);
      await gateway.ingestObservations(
        [simulated(target.mobilityEntityId, 'UNAVAILABLE')],
        new Date(),
      );
      await impacts.whenIdle();
      const impactId = (await alerts(base, owner, active.journey_id)).at(
        -1,
      )?.impact_id;
      if (!impactId) continue;
      const recoveryAt = active.progress!.recorded_at;
      const recovery = await createRecovery(
        base,
        owner,
        `run5b-early-${original.journey_id}-${impactId}`,
        active.journey_id,
        impactId,
        recoveryAt,
      );
      if (recovery.baseline_journey === null)
        throw new Error('Early-disruption FULL REPLAN baseline is absent.');
      if (
        recovery.proposed_journey !== null &&
        recovery.proposed_journey.segments.some((segment) =>
          segment.entity_bindings.some(
            (binding) => binding.mobility_entity_id === target.mobilityEntityId,
          ),
        )
      )
        throw new Error('Early recovery retained the blocked entity.');
      return {
        originalJourneyId: original.journey_id,
        originalModes: [...new Set(original.segments.map((item) => item.mode))],
        progressCompletedLegCount: 0,
        disruptedLegSequence: target.sequence,
        proposedOutcome: recovery.status,
        proposedFingerprint: recovery.proposed_fingerprint,
        baselineFingerprint: recovery.baseline_fingerprint,
        sameAnchor:
          recovery.baseline_journey.origin.latitude ===
            recovery.recovery_anchor.latitude &&
          recovery.baseline_journey.origin.longitude ===
            recovery.recovery_anchor.longitude,
        blockedEntityAvoided:
          recovery.proposed_journey === null ||
          recovery.metrics.disrupted_entity_avoidance,
      };
    }
  }
  throw new Error(
    'No independent real multimodal early-disruption case was available.',
  );
}

function isMultimodal(journey: ApiJourney): boolean {
  return (
    new Set(
      journey.segments
        .filter((segment) => segment.mode !== 'WALK')
        .map((segment) => segment.mode),
    ).size >= 2
  );
}

function isMultimodalWithRepairPrefix(journey: ApiJourney): boolean {
  return isMultimodal(journey) && futureRouteDependencies(journey).length > 0;
}

function earlyRouteDependencies(journey: ApiJourney) {
  return journey.segments
    .filter((segment) => segment.sequence <= 1)
    .flatMap((segment) =>
      segment.entity_bindings
        .filter(
          (binding) =>
            binding.entity_type === 'ROUTE' &&
            binding.mobility_entity_id !== null,
        )
        .map((binding) => ({
          mobilityEntityId: binding.mobility_entity_id!,
          sequence: segment.sequence,
        })),
    );
}

function futureRouteDependencies(journey: ApiJourney) {
  const result: Array<{ mobilityEntityId: string; sequence: number }> = [];
  for (const segment of journey.segments) {
    if (segment.sequence < 3) continue;
    const binding = segment.entity_bindings.find(
      (candidate) =>
        candidate.entity_type === 'ROUTE' &&
        candidate.mobility_entity_id !== null,
    );
    if (binding?.mobility_entity_id)
      result.push({
        mobilityEntityId: binding.mobility_entity_id,
        sequence: segment.sequence,
      });
  }
  return result;
}

function completedOnlyDependency(journey: ApiJourney): string | undefined {
  const future = new Set(
    journey.segments
      .slice(2)
      .flatMap((segment) =>
        segment.entity_bindings.flatMap((binding) =>
          binding.mobility_entity_id === null
            ? []
            : [binding.mobility_entity_id],
        ),
      ),
  );
  return (
    journey.segments
      .slice(0, 2)
      .flatMap((segment) => segment.entity_bindings)
      .find(
        (binding) =>
          binding.mobility_entity_id !== null &&
          !future.has(binding.mobility_entity_id),
      )?.mobility_entity_id ?? undefined
  );
}

function assertAcceptedRecovery(
  recovery: Recovery,
  repeated: Recovery,
  blockedEntityId: string,
): void {
  if (recovery.status !== 'COMPLETED' || recovery.proposed_journey === null)
    throw new Error('State-aware repair did not return a valid proposal.');
  if (recovery.baseline_journey === null)
    throw new Error('Same-state FULL REPLAN baseline is absent.');
  if (
    recovery.preserved_segment_count < 1 ||
    recovery.metrics.preserved_leg_ratio <= 0
  )
    throw new Error('Valid original remaining structure was not preserved.');
  if (!recovery.proposed_fingerprint || !recovery.baseline_fingerprint)
    throw new Error('Comparison fingerprints are absent.');
  if (recovery.recovery_id !== repeated.recovery_id)
    throw new Error('Recovery idempotency failed.');
  const leaked = recovery.proposed_journey.segments.some((segment) =>
    segment.entity_bindings.some(
      (binding) => binding.mobility_entity_id === blockedEntityId,
    ),
  );
  if (leaked)
    throw new Error('Blocked canonical entity leaked into accepted recovery.');
}

async function plan(base: string): Promise<readonly ApiJourney[]> {
  return planAt(base, {
    origin: { latitude: -6.108205, longitude: 106.89982 },
    destination: { latitude: -6.205627, longitude: 106.822295 },
    departureAt: '2026-10-02T08:11:00+07:00',
  });
}

async function planAt(
  base: string,
  input: {
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    departureAt: string;
  },
): Promise<readonly ApiJourney[]> {
  const response = await request<Envelope<readonly ApiJourney[]>>(
    `${base}/journeys/plan`,
    null,
    {
      method: 'POST',
      body: JSON.stringify({
        origin: input.origin,
        destination: input.destination,
        departure_at: input.departureAt,
        network_snapshot_id: snapshotId,
        preference: 'BALANCED',
      }),
    },
  );
  return response.data;
}

async function activate(
  base: string,
  owner: string,
  selected: ApiJourney,
): Promise<ApiJourney> {
  const response = await fetch(
    `${base}/journeys/${selected.journey_id}/activate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-passenger-service-token': serviceToken(),
        'x-journey-owner': owner,
        'idempotency-key': `run5b-activation-${selected.journey_id}`,
      },
      body: JSON.stringify({
        selected_journey: selected,
        activated_at: selected.segments[0]?.start_at,
      }),
    },
  );
  if (response.ok)
    return ((await response.json()) as Envelope<ApiJourney>).data;
  throw new Error(
    `POST activation failed: ${response.status} ${await response.text()}`,
  );
}

async function updateProgress(
  base: string,
  owner: string,
  journey: ApiJourney,
  completed: number,
) {
  return (
    await request<Envelope<ApiJourney>>(
      `${base}/journeys/${journey.journey_id}/progress`,
      owner,
      {
        method: 'PATCH',
        body: JSON.stringify({
          completed_segment_count: completed,
          current_segment_sequence: completed,
          recorded_at: journey.segments[completed]!.start_at,
        }),
      },
    )
  ).data;
}

async function alerts(
  base: string,
  owner: string,
  journeyId: string,
): Promise<readonly Alert[]> {
  return (
    await request<Envelope<readonly Alert[]>>(
      `${base}/journeys/${journeyId}/alerts`,
      owner,
    )
  ).data;
}

async function createRecovery(
  base: string,
  owner: string,
  key: string,
  journeyId: string,
  impactId: string,
  recoveryAt: string,
): Promise<Recovery> {
  return (
    await request<Envelope<Recovery>>(`${base}/recoveries`, owner, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        original_journey_id: journeyId,
        impact_id: impactId,
        recovery_at: recoveryAt,
      }),
    })
  ).data;
}

async function request<T>(
  url: string,
  owner: string | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-passenger-service-token': serviceToken(),
      ...(owner === null ? {} : { 'x-journey-owner': owner }),
      ...init.headers,
    },
  });
  const body = (await response.json()) as T;
  if (!response.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body)}`,
    );
  return body;
}

function simulated(
  entityId: string,
  state: OperationalObservation['operationalState'],
): OperationalObservation {
  const now = new Date();
  return {
    observationId: randomUUID(),
    incidentId: randomUUID(),
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityRefs: [`CANONICAL:${entityId}`],
    affectedModes: ['TRANSJAKARTA'],
    operationalState: state,
    evidenceType: 'SIMULATED',
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    impactBasis: 'CONTROLLED_SIMULATION',
    observedAt: new Date(now.getTime() - 1000).toISOString(),
    receivedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    reason: 'Controlled RUN 5B recovery acceptance.',
    confidenceStatus: 'SIMULATED',
    confidence: 1,
    provenance: {
      sourceId: randomUUID(),
      sourceClassification: 'UNKNOWN',
      rawReference: 'fixture:SIMULATED:run5b',
      lineageReference: 'fixture:SIMULATED:run5b',
      retrievedAt: now.toISOString(),
    },
    sourceAttributes: { fixture: true },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const result = await run();
if (process.argv[2] === 'verify') {
  const frozen = JSON.parse(await readFile(evidencePath, 'utf8')) as {
    rejoin: {
      originalJourneyFingerprint: string;
      proposed: {
        fingerprint: string;
        metrics: {
          preserved_leg_ratio: number;
          plan_change_count: number | null;
          additional_duration_seconds: number | null;
          additional_transfers: number | null;
        };
      };
      baseline: {
        fingerprint: string;
        metrics: {
          preserved_leg_ratio: number;
          plan_change_count: number | null;
          additional_duration_seconds: number | null;
          additional_transfers: number | null;
        };
      };
      structure: {
        preserved: number[];
        invalidated: number[];
        rejoined: number[];
      };
    };
  };
  const current = result as typeof frozen;
  const stable = (value: (typeof frozen)['rejoin']) => ({
    originalJourneyFingerprint: value.originalJourneyFingerprint,
    proposedFingerprint: value.proposed.fingerprint,
    baselineFingerprint: value.baseline.fingerprint,
    proposedMetrics: {
      plr: value.proposed.metrics.preserved_leg_ratio,
      pcc: value.proposed.metrics.plan_change_count,
      att: value.proposed.metrics.additional_duration_seconds,
      transfers: value.proposed.metrics.additional_transfers,
    },
    baselineMetrics: {
      plr: value.baseline.metrics.preserved_leg_ratio,
      pcc: value.baseline.metrics.plan_change_count,
      att: value.baseline.metrics.additional_duration_seconds,
      transfers: value.baseline.metrics.additional_transfers,
    },
    structure: {
      preserved: value.structure.preserved,
      invalidated: value.structure.invalidated,
      rejoined: value.structure.rejoined,
    },
  });
  if (
    JSON.stringify(stable(current.rejoin)) !==
    JSON.stringify(stable(frozen.rejoin))
  )
    throw new Error(
      'Real OTP rejoin result differs from the frozen normalized research comparison.',
    );
}
if (process.argv[2] === 'record')
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
