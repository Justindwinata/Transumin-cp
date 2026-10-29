import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { RecoveryController } from './interface/recovery.controller.js';
import type { RecoveryService } from './application/recovery.service.js';
import { JourneyRoutingError } from './domain/journey.js';
import { JourneyController } from './interface/journey.controller.js';
import { JourneyPlannerService } from './application/journey-planner.service.js';

const snapshotId = '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f';
const validBody = {
  origin: { latitude: -6.2, longitude: 106.8 },
  destination: { latitude: -6.3, longitude: 106.9 },
  departure_at: '2026-10-02T08:00:00+07:00',
  network_snapshot_id: snapshotId,
};
const validBodyMs = { ...validBody, departure_at: '2026-10-02T08:00:00.123Z' };

let plannerCalls = 0;
let plannerImpl: (request: unknown) => Promise<unknown> = async () => ({
  alternatives: [],
  rejectedCandidateCount: 0,
  candidateRejections: [],
  stateValidationMilliseconds: 0,
  routingMilliseconds: 0,
  totalMilliseconds: 0,
  strategy: 'INITIAL_PLAN',
});

@Module({
  controllers: [JourneyController],
  providers: [
    {
      provide: JourneyPlannerService,
      useValue: {
        plan: async (req: unknown) => {
          plannerCalls++;
          return plannerImpl(req);
        },
        health: async () => ({
          status: 'ok',
          provider: 'OTP',
          version: '2.10.0',
          checkedAt: new Date().toISOString(),
          latencyMilliseconds: 0,
        }),
      },
    },
  ],
})
class JourneyBoundaryTestModule {}

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let url: string;

describe('FR-001 journey HTTP boundary (R7/CP3)', () => {
  before(async () => {
    app = await NestFactory.create(JourneyBoundaryTestModule, {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1/journeys/plan`;
  });
  after(async () => {
    await app.close();
  });

  const post = (body: unknown, raw = false) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    });

  it('rejects null and array bodies with 400 and never calls planner', async () => {
    for (const body of [null, []] as unknown[]) {
      plannerCalls = 0;
      const res = await post(body);
      assert.equal(
        res.status,
        400,
        `expected 400 for ${JSON.stringify(body)} got ${res.status} ${await res.text().then((t) => t.slice(0, 400))}`,
      );
      // raw JSON "null" is rejected by the JSON parser before controller; array reaches controller — either way 400 and no planner call
      assert.equal(plannerCalls, 0);
      // controller-shaped errors include INVALID_PARAMETER; parser-shaped errors still must not be 5xx
      assert.ok(res.status >= 400 && res.status < 500);
    }
    // additionally verify controller-level INVALID_PARAMETER when parser allows the payload
    plannerCalls = 0;
    {
      const res = await post([]);
      const json = (await res.json()) as { error?: { code?: string } };
      assert.equal(res.status, 400);
      assert.equal(json.error?.code, 'INVALID_PARAMETER');
    }
  });

  it('rejects invalid departure datetimes with 400 and never calls planner', async () => {
    const invalidDepartures: unknown[] = [
      1711958400000,
      '2026-10-02',
      '2026-10-02T08:00:00',
      '2026-02-30T08:00:00+07:00',
      '2026-02-30T08:00:00Z',
      '2026-10-02T08:00:00+25:00',
      '2026-10-02T08:00:00+07:60',
      '2026-13-01T08:00:00Z',
      '2026-10-02T24:01:00Z',
    ];
    for (const departure_at of invalidDepartures) {
      plannerCalls = 0;
      const res = await post({ ...validBody, departure_at });
      assert.equal(
        res.status,
        400,
        `expected 400 for departure_at=${String(departure_at)}`,
      );
      assert.equal(plannerCalls, 0);
    }
  });

  it('rejects null/non-object coordinates with 400 and never calls planner', async () => {
    const invalidBodies = [
      { ...validBody, origin: null },
      { ...validBody, destination: null },
      { ...validBody, origin: 'not-object' },
      { ...validBody, destination: 123 },
      { ...validBody, origin: { latitude: null, longitude: 106.8 } },
      { ...validBody, destination: { latitude: -6.3, longitude: 'bad' } },
    ] as unknown[];
    for (const body of invalidBodies) {
      plannerCalls = 0;
      const res = await post(body);
      assert.equal(res.status, 400);
      assert.equal(plannerCalls, 0);
    }
  });

  it('accepts valid explicit timezone datetimes including milliseconds', async () => {
    plannerImpl = async () => ({
      alternatives: [
        {
          journeyId: '11111111-1111-4111-8111-111111111111',
          origin: validBody.origin,
          destination: validBody.destination,
          startAt: validBody.departure_at,
          endAt: '2026-10-02T09:00:00+07:00',
          durationSeconds: 3600,
          transferCount: 0,
          walkingDistanceMeters: 0,
          fareStatus: 'UNKNOWN' as const,
          legs: [],
          routingContext: {
            provider: 'OTP' as const,
            providerVersion: '2.10.0',
            routingSnapshotId: 'snap',
            routingManifestSha256: 'a'.repeat(64),
            graphSha256: 'b'.repeat(64),
            networkSnapshotId: snapshotId,
            networkSnapshotHash: 'c'.repeat(64),
            mobilityProjectionVersion: 'v1',
            plannedAt: new Date().toISOString(),
            commonServiceDate: '2026-10-02',
            timezone: 'Asia/Jakarta' as const,
            attemptCount: 1,
            excludedRouteIds: [],
          },
        },
      ],
      rejectedCandidateCount: 0,
      candidateRejections: [],
      stateValidationMilliseconds: 0,
      routingMilliseconds: 0,
      totalMilliseconds: 0,
      strategy: 'INITIAL_PLAN' as const,
    });
    for (const body of [
      validBody,
      validBodyMs,
      { ...validBody, departure_at: '2026-10-02T08:00:00Z' },
      { ...validBody, departure_at: '2026-10-02T08:00:00.999+07:00' },
    ]) {
      plannerCalls = 0;
      const res = await post(body);
      assert.equal(
        res.status,
        201,
        `expected 2xx for ${body.departure_at} got ${res.status} ${await res.text()}`,
      );
      assert.equal(plannerCalls, 1);
    }
  });

  it('maps unexpected planner error to 503 sanitized without secret', async () => {
    plannerImpl = async () => {
      throw new Error('SECRET_DB_PASSWORD=supersecret123');
    };
    plannerCalls = 0;
    const res = await post(validBody);
    assert.equal(res.status, 503);
    assert.equal(plannerCalls, 1);
    const json = (await res.json()) as {
      error: { code: string; message: string; request_id: string };
    };
    assert.equal(json.error.code, 'ROUTER_UNAVAILABLE');
    assert.equal(
      json.error.message,
      'Journey planning could not be completed.',
    );
    assert.match(json.error.request_id, /^[0-9a-f-]{36}$/i);
    const raw = JSON.stringify(json);
    assert.equal(raw.includes('supersecret'), false);
    assert.equal(raw.includes('SECRET_DB'), false);
  });
});

describe('recovery routing error boundary', () => {
  for (const [code, status] of [
    ['INVALID_TIME', 422],
    ['ROUTER_UNAVAILABLE', 503],
  ] as const) {
    it(`returns structured ${code} instead of an unhandled 500`, async () => {
      const controller = new RecoveryController({
        create: async () => {
          throw new JourneyRoutingError(code, 'SIMULATED router refusal');
        },
      } as unknown as RecoveryService);
      await assert.rejects(
        controller.create('sample-owner', 'sample-key-123', {
          original_journey_id: '11111111-1111-4111-8111-111111111111',
          impact_id: '22222222-2222-4222-8222-222222222222',
          recovery_at: '2026-10-02T08:00:00+07:00',
        }),
        (e: unknown) => {
          const error = e as {
            getStatus(): number;
            getResponse(): { error: { code: string } };
          };
          assert.equal(error.getStatus(), status);
          assert.equal(error.getResponse().error.code, code);
          return true;
        },
      );
    });
  }
});
