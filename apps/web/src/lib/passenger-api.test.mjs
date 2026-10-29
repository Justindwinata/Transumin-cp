import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PassengerApiError,
  passengerApi,
  reportAttemptHash,
} from './passenger-api.ts';

// Run the internal timeout instantly and capture the deadline it requested.
function withImmediateTimers(run, onTimer = () => {}) {
  const timers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    onTimer(delay);
    return timers.setTimeout(callback, 0, ...args);
  };
  globalThis.clearTimeout = () => {};
  return Promise.resolve()
    .then(run)
    .finally(() => Object.assign(globalThis, timers));
}

test('write timeout aborts a hung fetch and reports an unknown outcome', async () => {
  const originalFetch = globalThis.fetch;
  let deadline = null;
  await withImmediateTimers(
    async () => {
      globalThis.fetch = (_input, options) =>
        new Promise((_resolve, reject) => {
          if (options.signal.aborted) return reject(options.signal.reason);
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true },
          );
        });
      try {
        await assert.rejects(
          passengerApi.submitReport(
            {
              active_journey_id: null,
              category: 'FLOODING',
              observed_at: '2026-10-16T00:00:00Z',
              mobility_entity_id: 'test',
              entity_type: 'STOP',
              description: 'sample test',
            },
            'test-key',
          ),
          (error) => {
            assert.ok(error instanceof PassengerApiError);
            assert.equal(error.code, 'REQUEST_TIMEOUT');
            assert.equal(error.status, 408);
            assert.match(error.message, /Outcome is unknown/);
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    (delay) => {
      deadline = delay;
    },
  );
  assert.equal(deadline, 35_000);
});

test('recovery proposal uses the longer proxy-aware deadline', async () => {
  const originalFetch = globalThis.fetch;
  let deadline = null;
  await withImmediateTimers(
    async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      try {
        await passengerApi.recovery(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'test-key',
          '2026-10-16T00:00:00Z',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    (delay) => {
      deadline = delay;
    },
  );
  assert.equal(deadline, 125_000);
});

test('invalid success JSON is rejected instead of treated as success', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = async () =>
      new Response('<html>not json</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    try {
      await assert.rejects(passengerApi.config(), (error) => {
        assert.ok(error instanceof PassengerApiError);
        assert.equal(error.code, 'INVALID_RESPONSE');
        assert.equal(error.status, 502);
        return true;
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('missing data envelope on success is rejected instead of read as success', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    try {
      await assert.rejects(passengerApi.config(), (error) => {
        assert.ok(error instanceof PassengerApiError);
        assert.equal(error.code, 'INVALID_RESPONSE');
        assert.equal(error.status, 502);
        return true;
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('proxy unavailability keeps its status and domain code', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'ROUTER_UNAVAILABLE',
            message: 'Passenger service is temporarily unavailable.',
          },
        }),
        { status: 503 },
      );
    try {
      await assert.rejects(passengerApi.config(), (error) => {
        assert.ok(error instanceof PassengerApiError);
        assert.equal(error.code, 'ROUTER_UNAVAILABLE');
        assert.equal(error.status, 503);
        return true;
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('rate-limited report preserves status, code, and retry seconds', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Passenger report limit reached.',
          },
        }),
        {
          status: 429,
          headers: { 'retry-after': '420' },
        },
      );
    try {
      await assert.rejects(
        passengerApi.submitReport(
          {
            active_journey_id: null,
            category: 'SERVICE',
            observed_at: '2026-10-16T00:00:00Z',
            mobility_entity_id: 'test',
            entity_type: 'STOP',
            description: 'sample test',
          },
          'test-key-long-enough',
        ),
        (error) => {
          assert.ok(error instanceof PassengerApiError);
          assert.equal(error.code, 'RATE_LIMITED');
          assert.equal(error.status, 429);
          assert.equal(error.retryAfterSeconds, 420);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('rate-limit retry header ignores HTTP-date and invalid values', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
        status: 429,
        headers: { 'retry-after': 'Sun, 06 Nov 1994 08:49:37 GMT' },
      });
    try {
      await assert.rejects(
        passengerApi.submitReport(
          {
            active_journey_id: null,
            category: 'SERVICE',
            observed_at: '2026-10-16T00:00:00Z',
            mobility_entity_id: 'test',
            entity_type: 'STOP',
            description: 'sample test',
          },
          'test-key-long-enough',
        ),
        (error) => {
          assert.ok(error instanceof PassengerApiError);
          assert.equal(error.status, 429);
          assert.equal(error.retryAfterSeconds, null);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('mutation network loss is unknown outcome but read network loss remains native', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      await assert.rejects(
        passengerApi.submitReport(
          {
            active_journey_id: null,
            category: 'FLOODING',
            observed_at: '2026-10-16T00:00:00Z',
            mobility_entity_id: 'test',
            entity_type: 'STOP',
            description: 'sample test',
          },
          'test-key',
        ),
        (error) => {
          assert.ok(error instanceof PassengerApiError);
          assert.equal(error.code, 'NETWORK_ERROR');
          assert.match(error.message, /Outcome is unknown/);
          return true;
        },
      );
      await assert.rejects(passengerApi.config(), (error) => {
        assert.ok(error instanceof PassengerApiError);
        assert.equal(error.code, 'NETWORK_ERROR');
        assert.match(error.message, /Check your connection/);
        assert.doesNotMatch(error.message, /Outcome is unknown/);
        return true;
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('report attempt hash is deterministic and hides the payload text', async () => {
  const input = {
    active_journey_id: 'j-1',
    category: 'SERVICE',
    observed_at: '2026-10-16T00:00:00.000Z',
    mobility_entity_id: 'e-1',
    entity_type: 'STOP',
    description: 'sensitive observation text',
  };
  const first = await reportAttemptHash(input);
  const second = await reportAttemptHash({ ...input });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(first, /sensitive/);
  assert.notEqual(
    first,
    await reportAttemptHash({ ...input, description: 'other text' }),
  );
});

test('reconcile lookup returns the committed report or a null body', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  await withImmediateTimers(async () => {
    globalThis.fetch = async (input, options) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          data: {
            report_id: 'r-1',
            active_journey_id: null,
            category: 'SERVICE',
            observed_at: '2026-10-16T00:00:00.000Z',
            received_at: '2026-10-16T00:00:01.000Z',
            mobility_entity_id: 'e-1',
            entity_type: 'STOP',
            description: 'sample',
            source: 'PASSENGER_SELF_REPORT',
            verification_status: 'REPORTED_UNVERIFIED',
            created_at: '2026-10-16T00:00:01.000Z',
          },
        }),
        { status: 200 },
      );
    };
    try {
      const found = await passengerApi.lookupReport('key-12345678');
      assert.equal(found?.report_id, 'r-1');
      assert.match(seen[0], /idempotency_key=key-12345678/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('caller abort stays an AbortError rather than a timeout', async () => {
  const originalFetch = globalThis.fetch;
  await withImmediateTimers(async () => {
    globalThis.fetch = (_input, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(options.signal.reason),
          { once: true },
        );
      });
    const controller = new AbortController();
    const pending = passengerApi.getJourney(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      controller.signal,
    );
    controller.abort(new DOMException('user navigated away', 'AbortError'));
    try {
      await assert.rejects(pending, (error) => {
        assert.ok(!(error instanceof PassengerApiError));
        assert.equal(error.name, 'AbortError');
        return true;
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
