import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { PassengerReportService } from './passenger-report.service.js';
import { ControlledReviewGuard } from './controlled-review.guard.js';
import { PassengerServiceGuard } from '../journey/interface/passenger-service.guard.js';

function service(): PassengerReportService {
  return new PassengerReportService(
    {
      transaction: () => {
        throw new Error('database unavailable');
      },
    } as never,
    {
      ingest: async () => {
        throw new Error('lifecycle unavailable');
      },
    } as never,
    { whenIdle: async () => undefined } as never,
  );
}

const entityId = '00000000-0000-4000-8000-000000000000';
const base = {
  ownerRef: 'owner-0001',
  journeyId: null,
  category: 'SAFETY',
  observedAt: new Date().toISOString(),
  entityId,
  entityType: 'STOP',
  description: 'ok',
  key: 'key-abcdef01',
};

describe('Passenger reporting boundary', () => {
  it('rejects unsupported categories, targets and control characters before database access', async () => {
    const reports = service();
    await assert.rejects(
      reports.submit({ ...base, category: 'RUMOR' }),
      /Unsupported category/,
    );
    await assert.rejects(
      reports.submit({ ...base, description: 'bad\tchar' }),
      /control characters/,
    );
    await assert.rejects(
      reports.submit({ ...base, entityType: 'BUS' }),
      /Unsupported target entity/,
    );
  });

  it('rejects malformed, future, and non-canonical observation timestamps', async () => {
    const reports = service();
    await assert.rejects(
      reports.submit({ ...base, observedAt: '2026-13-40T00:00:00Z' }),
      /observed_at/,
    );
    await assert.rejects(
      reports.submit({
        ...base,
        observedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      /not be in the future/,
    );
    await assert.rejects(
      reports.submit({ ...base, observedAt: ' 2020-01-01T00:00:00Z ' }),
      /observed_at/,
    );
  });

  it('rejects journey-associated list requests without a valid owner or journey id', async () => {
    const reports = service();
    await assert.rejects(
      reports.list('bad owner!', randomUUID()),
      /Invalid owner/,
    );
    await assert.rejects(reports.list('owner-0001', 'not-a-uuid'), /UUID/);
  });

  it('rejects malformed reconciliation lookups before database access', async () => {
    const reports = service();
    await assert.rejects(
      reports.lookupByIdempotencyKey('bad owner!', 'key-abcdef01'),
      /Invalid owner/,
    );
    await assert.rejects(
      reports.lookupByIdempotencyKey('owner-0001', 'short'),
      /idempotency_key/,
    );
  });

  it('requires deterministic controlled review input', async () => {
    const reports = service();
    await assert.rejects(
      reports.verify({
        reportId: 'not-a-uuid',
        reviewer: 'reviewer',
        state: 'DEGRADED',
        reason: 'ok',
        incidentType: 'STOP_CLOSURE',
      }),
      /Invalid controlled verification fields/,
    );
    await assert.rejects(
      reports.verify({
        reportId: randomUUID(),
        reviewer: 'reviewer',
        state: 'DEGRADED',
        reason: 'ok',
        incidentType: 'FLOOD',
      }),
      /Invalid controlled verification fields/,
    );
  });

  it('requires deterministic controlled close input', async () => {
    const reports = service();
    await assert.rejects(
      reports.close({
        reportId: 'not-a-uuid',
        reviewer: 'reviewer',
        decision: 'RESOLVED',
        reason: 'ok',
      }),
      /Invalid controlled close fields/,
    );
    await assert.rejects(
      reports.close({
        reportId: randomUUID(),
        reviewer: 'reviewer',
        decision: 'REOPEN',
        reason: 'ok',
      }),
      /Invalid controlled close fields/,
    );
    await assert.rejects(
      reports.close({
        reportId: randomUUID(),
        reviewer: 'reviewer',
        decision: 'RESOLVED',
        reason: '',
      }),
      /Invalid controlled close fields/,
    );
  });

  it('controlled review is fail-closed outside explicit development opt-in', () => {
    const guard = new ControlledReviewGuard();
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as never;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.CONTROLLED_REVIEW_ENABLED;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.CONTROLLED_REVIEW_ENABLED;
      assert.throws(
        () => guard.canActivate(context),
        /CONTROLLED_REVIEW_DISABLED/,
      );
      process.env.NODE_ENV = 'production';
      process.env.CONTROLLED_REVIEW_ENABLED = 'true';
      assert.throws(
        () => guard.canActivate(context),
        /CONTROLLED_REVIEW_DISABLED/,
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined)
        delete process.env.CONTROLLED_REVIEW_ENABLED;
      else process.env.CONTROLLED_REVIEW_ENABLED = previousFlag;
    }
    const passenger = new PassengerServiceGuard();
    const previousServiceToken = process.env.PASSENGER_SERVICE_TOKEN;
    try {
      delete process.env.PASSENGER_SERVICE_TOKEN;
      assert.throws(
        () => passenger.canActivate(context),
        /PASSENGER_SERVICE_TOKEN_REQUIRED/,
      );
      process.env.PASSENGER_SERVICE_TOKEN = 's'.repeat(64);
      assert.throws(() => passenger.canActivate(context), /AUTH_REQUIRED/);
    } finally {
      if (previousServiceToken === undefined)
        delete process.env.PASSENGER_SERVICE_TOKEN;
      else process.env.PASSENGER_SERVICE_TOKEN = previousServiceToken;
    }
  });

  it('controlled reviewer rejects a passenger service credential', () => {
    const guard = new ControlledReviewGuard();
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.CONTROLLED_REVIEW_ENABLED;
    const previousToken = process.env.CONTROLLED_REVIEW_TOKEN;
    try {
      process.env.NODE_ENV = 'test';
      process.env.CONTROLLED_REVIEW_ENABLED = 'true';
      process.env.CONTROLLED_REVIEW_TOKEN = 'r'.repeat(64);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              authorization: `Bearer ${'r'.repeat(64)}`,
              'x-passenger-service-token': 'p'.repeat(64),
            },
          }),
        }),
      } as never;
      assert.throws(
        () => guard.canActivate(context),
        /CONTROLLED_REVIEW_CREDENTIAL_REQUIRED/,
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined)
        delete process.env.CONTROLLED_REVIEW_ENABLED;
      else process.env.CONTROLLED_REVIEW_ENABLED = previousFlag;
      if (previousToken === undefined)
        delete process.env.CONTROLLED_REVIEW_TOKEN;
      else process.env.CONTROLLED_REVIEW_TOKEN = previousToken;
    }
  });
});

describe('ADR-010 admin field review boundary', () => {
  it('rejects undocumented, future/stale or unbounded evidence before database access', async () => {
    const reports = service();
    const actor = randomUUID();
    const input = {
      reportId: randomUUID(),
      reviewer: `admin:${actor}`,
      state: 'UNAVAILABLE',
      reason: 'SAMPLE UAT public reason',
      incidentType: 'SERVICE_SUSPENSION',
    };
    const review = {
      actorUserId: actor,
      evidenceReference: 'SAMPLE fixture reference',
      observedAt: new Date().toISOString(),
      validForMinutes: 30,
    };
    for (const invalid of [
      { evidenceReference: '' },
      { validForMinutes: 0 },
      { validForMinutes: 61 },
      { validForMinutes: 5.5 },
      { actorUserId: randomUUID() },
      { observedAt: new Date(Date.now() + 60_000).toISOString() },
      { observedAt: new Date(Date.now() - 31 * 60_000).toISOString() },
    ])
      await assert.rejects(
        reports.restrictAdmin(input, { ...review, ...invalid }),
        /Admin review requires/,
      );
  });
});
