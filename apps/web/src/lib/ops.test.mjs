import assert from 'node:assert/strict';
import test from 'node:test';
import { opsApi } from './ops-api.ts';

test('FR-011 exposes operator API read models through same-origin fetch', async () => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        data: [{ scenario_id: '123e4567-e89b-42d3-a456-426614174000' }],
        meta: { next_cursor: 'next', availability: 'AVAILABLE' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const page = await opsApi.listScenarios({ limit: 25, cursor: 'after' });
    assert.deepEqual(
      page.data[0]?.scenario_id,
      '123e4567-e89b-42d3-a456-426614174000',
    );
    assert.equal(page.nextCursor, 'next');
    assert.equal(calls[0], '/api/v1/scenarios?limit=25&cursor=after');

    const experiments = await opsApi.listExperiments({ limit: 10 });
    assert.equal(experiments.availability, 'AVAILABLE');
    assert.equal(calls[1], '/api/v1/experiments?limit=10');
  } finally {
    globalThis.fetch = previous;
  }
});

test('FR-011 keeps API failures authoritative', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'AUTH_REQUIRED' } }), {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/json' },
    });
  try {
    await assert.rejects(
      opsApi.listRuns(),
      (error) => error.status === 401 && error.message === 'AUTH_REQUIRED',
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test('admin login unwraps the actual auth API user envelope before choosing a destination', async () => {
  const previous = globalThis.fetch;
  const principal = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    email: 'admin.sample@local.test',
    roles: ['ADMIN'],
  };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: { user: principal } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    assert.deepEqual(
      await opsApi.login(principal.email, 'SAMPLE-Password-123'),
      principal,
    );
    assert.equal(calls[0].url, '/api/v1/auth/login');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.credentials, 'include');
    assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)).sort(), [
      'email',
      'password',
    ]);
  } finally {
    globalThis.fetch = previous;
  }
});
