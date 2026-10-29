import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActiveJourneyError } from './domain/active-journey.js';
import { assertCurrentRoute } from './infrastructure/kysely-active-journey.repository.js';

describe('active journey accepted-route guard', () => {
  it('keeps original route actions valid before recovery', () => {
    assert.doesNotThrow(() => assertCurrentRoute(null, null));
    assert.doesNotThrow(() => assertCurrentRoute(null, undefined));
  });

  it('requires current accepted recovery identity after replacement', () => {
    const recoveryId = '11111111-1111-4111-8111-111111111111';
    assert.doesNotThrow(() => assertCurrentRoute(recoveryId, recoveryId));
    for (const stale of [
      undefined,
      null,
      '22222222-2222-4222-8222-222222222222',
    ])
      assert.throws(
        () => assertCurrentRoute(recoveryId, stale),
        (error: unknown) =>
          error instanceof ActiveJourneyError && error.code === 'STALE_ROUTE',
      );
  });
});
