import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { LiveOperationalGateway } from '../disruption/application/live-operational-gateway.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';
import { JourneyImpactService } from './application/journey-impact.service.js';

const api = `${process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000'}/api/passenger`;
type Binding = { mobility_entity_id: string | null; entity_type: string };
type Leg = {
  sequence: number;
  mode: string;
  start_at: string;
  entity_bindings: Binding[];
};
type Journey = {
  journey_id: string;
  segments: Leg[];
  progress?: { recorded_at: string };
};
type Alert = { impact_id: string; evidence_type: string };
type Recovery = {
  status: string;
  proposed_journey: Journey | null;
  network_snapshot_id: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}/${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as { data?: T; error?: unknown };
  if (!response.ok || body.data === undefined)
    throw new Error(
      `${path}: HTTP ${response.status} ${JSON.stringify(body.error)}`,
    );
  return body.data;
}

function simulated(entityId: string, mode: string): OperationalObservation {
  const now = new Date();
  return {
    observationId: randomUUID(),
    incidentId: randomUUID(),
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityRefs: [`CANONICAL:${entityId}`],
    affectedModes: [mode as OperationalObservation['affectedModes'][number]],
    operationalState: 'UNAVAILABLE',
    evidenceType: 'SIMULATED',
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    impactBasis: 'CONTROLLED_SIMULATION',
    observedAt: new Date(now.getTime() - 1000).toISOString(),
    receivedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    reason: 'Controlled PRODUCT-P1 passenger acceptance.',
    confidenceStatus: 'SIMULATED',
    confidence: 1,
    provenance: {
      sourceId: randomUUID(),
      sourceClassification: 'UNKNOWN',
      rawReference: 'fixture:SIMULATED:product-p1',
      lineageReference: 'fixture:SIMULATED:product-p1',
      retrievedAt: now.toISOString(),
    },
    sourceAttributes: { fixture: true },
  };
}

async function plan(
  snapshot: string,
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  departure: string,
) {
  return request<Journey[]>('journeys/plan', {
    method: 'POST',
    body: JSON.stringify({
      origin,
      destination,
      departure_at: departure,
      network_snapshot_id: snapshot,
      preference: 'BALANCED',
    }),
  });
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const snapshot = (await request<{ network_snapshot_id: string }>('config'))
      .network_snapshot_id;
    const [aPlans, bPlans] = await Promise.all([
      plan(
        snapshot,
        { latitude: -6.108205, longitude: 106.89982 },
        { latitude: -6.205627, longitude: 106.822295 },
        '2026-10-02T08:11:00+07:00',
      ),
      plan(
        snapshot,
        { latitude: -6.5942887, longitude: 106.7907695 },
        { latitude: -6.2892744, longitude: 106.7749355 },
        '2026-10-02T04:00:00+07:00',
      ),
    ]);
    const b = bPlans[0];
    assert.ok(b, 'unrelated real journey unavailable');
    const bIds = new Set(
      b.segments.flatMap((leg) =>
        leg.entity_bindings.map((binding) => binding.mobility_entity_id),
      ),
    );
    const targets = aPlans.flatMap((journey) =>
      journey.segments
        .filter((leg) => leg.sequence >= 3 && leg.mode !== 'WALK')
        .flatMap((leg) =>
          leg.entity_bindings
            .filter(
              (binding) =>
                binding.entity_type === 'ROUTE' &&
                binding.mobility_entity_id &&
                !bIds.has(binding.mobility_entity_id),
            )
            .map((binding) => ({
              journey,
              leg,
              entityId: binding.mobility_entity_id!,
            })),
        ),
    );
    const target = targets[0];
    assert.ok(target, 'no independent future transit dependency');
    const ownerA = `passenger-test:${randomUUID()}`;
    const ownerB = `passenger-test:${randomUUID()}`;
    const a = await request<Journey>(
      `journeys/${target.journey.journey_id}/activate`,
      {
        method: 'POST',
        headers: { 'x-journey-owner': ownerA },
        body: JSON.stringify({
          selected_journey: target.journey,
          activated_at: target.journey.segments[0]?.start_at,
        }),
      },
    );
    const unrelated = await request<Journey>(
      `journeys/${b.journey_id}/activate`,
      {
        method: 'POST',
        headers: { 'x-journey-owner': ownerB },
        body: JSON.stringify({
          selected_journey: b,
          activated_at: b.segments[0]?.start_at,
        }),
      },
    );
    const progressAt = a.segments[2]?.start_at;
    assert.ok(progressAt, 'no recovery anchor');
    const progressed = await request<Journey>(
      `journeys/${a.journey_id}/progress`,
      {
        method: 'PATCH',
        headers: { 'x-journey-owner': ownerA },
        body: JSON.stringify({
          completed_segment_count: 2,
          current_segment_sequence: 2,
          recorded_at: progressAt,
        }),
      },
    );
    assert.deepEqual(
      progressed.segments,
      a.segments,
      'progress mutated selected plan',
    );
    const gateway = app.get(LiveOperationalGateway);
    const impacts = app.get(JourneyImpactService);
    const observation = simulated(target.entityId, target.leg.mode);
    await gateway.ingestObservations([observation], new Date());
    await impacts.whenIdle();
    const alertsA = await request<Alert[]>(`journeys/${a.journey_id}/alerts`, {
      headers: { 'x-journey-owner': ownerA },
    });
    const alertsB = await request<Alert[]>(
      `journeys/${unrelated.journey_id}/alerts`,
      { headers: { 'x-journey-owner': ownerB } },
    );
    assert.ok(alertsA.length > 0, 'affected journey has no alert');
    assert.equal(alertsB.length, 0, 'unrelated journey received an alert');
    assert.equal(alertsA.at(-1)?.evidence_type, 'SIMULATED');
    await gateway.ingestObservations([observation], new Date());
    await impacts.whenIdle();
    assert.equal(
      (
        await request<Alert[]>(`journeys/${a.journey_id}/alerts`, {
          headers: { 'x-journey-owner': ownerA },
        })
      ).length,
      alertsA.length,
      'duplicate alert generated',
    );
    const recovery = await request<Recovery>('recoveries', {
      method: 'POST',
      headers: {
        'x-journey-owner': ownerA,
        'idempotency-key': `passenger-test:${a.journey_id}:${alertsA.at(-1)!.impact_id}`,
      },
      body: JSON.stringify({
        original_journey_id: a.journey_id,
        impact_id: alertsA.at(-1)!.impact_id,
        recovery_at: progressed.progress?.recorded_at,
      }),
    });
    assert.ok(
      !recovery.proposed_journey?.segments.some((leg) =>
        leg.entity_bindings.some(
          (binding) => binding.mobility_entity_id === target.entityId,
        ),
      ),
      'blocked entity leaked into recovery',
    );
    console.log(
      JSON.stringify({
        status: recovery.status === 'COMPLETED' ? 'PASS' : 'PARTIAL',
        evidence:
          'real OTP and API via web proxy; controlled SIMULATED Twin observation',
        affected_journey: a.journey_id,
        unrelated_journey: unrelated.journey_id,
        alert_count: alertsA.length,
        unrelated_alert_count: alertsB.length,
        recovery_status: recovery.status,
        proposed_segments: recovery.proposed_journey?.segments.length ?? 0,
        snapshot_id: recovery.network_snapshot_id,
      }),
    );
  } finally {
    await app.close();
  }
}

await run();
