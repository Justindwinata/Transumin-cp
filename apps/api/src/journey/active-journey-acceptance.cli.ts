import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { configureApplication } from '../application.js';
import { LiveOperationalGateway } from '../disruption/application/live-operational-gateway.js';
import { JourneyImpactService } from './application/journey-impact.service.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidencePath = path.join(
  root,
  'data/manifests/RUN-5A-ACTIVE-JOURNEY-ACCEPTANCE-EVIDENCE.json',
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

type ApiJourney = Readonly<{
  journey_id: string;
  status: string;
  segments: readonly Readonly<{
    sequence: number;
    mode: string;
    entity_bindings: readonly Readonly<{
      mobility_entity_id: string | null;
      canonical_entity_id: string;
      entity_type: string;
    }>[];
  }>[];
  progress?: { completed_segment_count: number; revision: number };
  dependencies?: readonly Readonly<{
    mobility_entity_id: string;
    canonical_entity_id: string;
  }>[];
  routing_context: Readonly<{
    routing_snapshot_id: string;
    network_snapshot_id: string;
    mobility_projection_version: string;
  }>;
}>;

type Envelope<T> = Readonly<{ data: T }>;

async function run(): Promise<object> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    const port = (app.getHttpServer().address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api/v1`;
    const [candidateA, candidateB] = await Promise.all([
      plan(base, {
        origin: { latitude: -6.108205, longitude: 106.89982 },
        destination: { latitude: -6.205627, longitude: 106.822295 },
        departure_at: '2026-10-02T08:00:00+07:00',
      }),
      plan(base, {
        origin: { latitude: -6.5942887, longitude: 106.7907695 },
        destination: { latitude: -6.2892744, longitude: 106.7749355 },
        departure_at: '2026-10-02T04:00:00+07:00',
      }),
    ]);
    const ownerA = `run5a:${randomUUID()}`;
    const ownerB = `run5a:${randomUUID()}`;
    const dependenciesA = stateBearing(candidateA);
    const dependenciesB = new Set(
      stateBearing(candidateB).map((item) => item.mobility_entity_id),
    );
    const target = dependenciesA.find(
      (item) =>
        item.entity_type === 'ROUTE' &&
        !dependenciesB.has(item.mobility_entity_id),
    );
    if (target === undefined)
      throw new Error(
        'Real plans did not expose an A-only canonical route dependency.',
      );

    const activationStarted = performance.now();
    const activeA = await activate(base, ownerA, candidateA);
    const activationMilliseconds = performance.now() - activationStarted;
    const activeB = await activate(base, ownerB, candidateB);
    const repeat = await activate(base, ownerA, candidateA);
    if (repeat.journey_id !== activeA.journey_id)
      throw new Error('Activation was not idempotent.');
    const dependencyMilliseconds = performance.now() - activationStarted;

    const progressResponse = await request<Envelope<ApiJourney>>(
      `${base}/journeys/${activeA.journey_id}/progress`,
      ownerA,
      {
        method: 'PATCH',
        body: JSON.stringify({
          completed_segment_count: 0,
          current_segment_sequence: 0,
          recorded_at: new Date().toISOString(),
        }),
      },
    );
    if ((progressResponse.data.progress?.revision ?? 0) < 2)
      throw new Error('Controlled progress did not update separately.');

    const gateway = app.get(LiveOperationalGateway);
    const impacts = app.get(JourneyImpactService);
    const impactStarted = performance.now();
    const observation = simulated(target.mobility_entity_id, 'UNAVAILABLE');
    await gateway.ingestObservations([observation], new Date());
    await impacts.whenIdle();
    const impactMilliseconds = performance.now() - impactStarted;
    const alertStarted = performance.now();
    const alertsA = await alerts(base, ownerA, activeA.journey_id);
    const alertsB = await alerts(base, ownerB, activeB.journey_id);
    const alertMilliseconds = performance.now() - alertStarted;
    if (alertsA.length !== 1 || alertsB.length !== 0)
      throw new Error('Targeted alert isolation failed.');
    if (alertsA[0]?.evidence_type !== 'SIMULATED')
      throw new Error('Acceptance evidence lost SIMULATED labeling.');

    await gateway.ingestObservations([observation], new Date());
    await impacts.whenIdle();
    if ((await alerts(base, ownerA, activeA.journey_id)).length !== 1)
      throw new Error('Duplicate transition created a duplicate alert.');

    const bDependency = stateBearing(candidateB)[0];
    if (bDependency === undefined)
      throw new Error('Journey B has no dependency.');
    await gateway.ingestObservations(
      [expiredUnavailable(bDependency.mobility_entity_id)],
      new Date(),
    );
    await impacts.whenIdle();
    if ((await alerts(base, ownerB, activeB.journey_id)).length !== 0)
      throw new Error('Expired evidence created a current alert.');

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      evidenceSemantics: 'REAL_OTP_JOURNEYS_WITH_CONTROLLED_SIMULATED_STATE',
      realJourney: {
        affectedJourneyId: activeA.journey_id,
        unaffectedJourneyId: activeB.journey_id,
        routingSnapshotId: activeA.routing_context.routing_snapshot_id,
        networkSnapshotId: activeA.routing_context.network_snapshot_id,
        mobilityProjectionVersion:
          activeA.routing_context.mobility_projection_version,
      },
      targeting: {
        disruptedCanonicalEntityId: target.canonical_entity_id,
        disruptedMobilityEntityId: target.mobility_entity_id,
        affectedAlertCount: alertsA.length,
        unaffectedAlertCount: alertsB.length,
        duplicateReplayAlertCount: 1,
        expiredEvidenceAlertCount: 0,
        ownerScoped: true,
      },
      persistence: {
        affectedDependencyCount: activeA.dependencies?.length ?? 0,
        unaffectedDependencyCount: activeB.dependencies?.length ?? 0,
        progressRevision: progressResponse.data.progress?.revision ?? 0,
        activationIdempotent: true,
      },
      performanceMilliseconds: {
        activation: round(activationMilliseconds),
        activationAndDependencyIndex: round(dependencyMilliseconds),
        stateChangeImpactLookupAndFanOut: round(impactMilliseconds),
        targetedAlertRead: round(alertMilliseconds),
        fanOutActiveJourneyCount: 2,
      },
      status: 'PASS',
    };
  } finally {
    await app.close();
  }
}

async function plan(base: string, input: object): Promise<ApiJourney> {
  const response = await request<Envelope<readonly ApiJourney[]>>(
    `${base}/journeys/plan`,
    null,
    {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        network_snapshot_id: snapshotId,
        preference: 'BALANCED',
      }),
    },
  );
  if (response.data[0] === undefined)
    throw new Error('Real OTP plan was empty.');
  return response.data[0];
}

async function activate(
  base: string,
  owner: string,
  selected: ApiJourney,
): Promise<ApiJourney> {
  return (
    await request<Envelope<ApiJourney>>(
      `${base}/journeys/${selected.journey_id}/activate`,
      owner,
      { method: 'POST', body: JSON.stringify({ selected_journey: selected }) },
    )
  ).data;
}

async function alerts(base: string, owner: string, journeyId: string) {
  return (
    await request<Envelope<readonly Record<string, unknown>[]>>(
      `${base}/journeys/${journeyId}/alerts`,
      owner,
    )
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
    },
  });
  const body = (await response.json()) as T;
  if (!response.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body)}`,
    );
  return body;
}

function stateBearing(journey: ApiJourney) {
  return journey.segments
    .flatMap((segment) => segment.entity_bindings)
    .filter(
      (
        binding,
      ): binding is {
        mobility_entity_id: string;
        canonical_entity_id: string;
        entity_type: string;
      } => binding.mobility_entity_id !== null,
    );
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
    reason: 'Controlled RUN 5A targeting acceptance.',
    confidenceStatus: 'SIMULATED',
    confidence: 1,
    provenance: {
      sourceId: randomUUID(),
      sourceClassification: 'UNKNOWN',
      rawReference: 'fixture:SIMULATED:run5a',
      lineageReference: 'fixture:SIMULATED:run5a',
      retrievedAt: now.toISOString(),
    },
    sourceAttributes: { fixture: true },
  };
}

function expiredUnavailable(entityId: string): OperationalObservation {
  const result = simulated(entityId, 'UNAVAILABLE');
  const now = Date.now();
  return {
    ...result,
    observedAt: new Date(now - 7_200_000).toISOString(),
    receivedAt: new Date(now - 7_199_000).toISOString(),
    updatedAt: new Date(now - 7_199_000).toISOString(),
    expiresAt: new Date(now - 3_600_000).toISOString(),
    provenance: {
      ...result.provenance,
      retrievedAt: new Date(now - 7_199_000).toISOString(),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const result = await run();
if (process.argv[2] === 'record')
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
