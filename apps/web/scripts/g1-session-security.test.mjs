import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import test, { afterEach, beforeEach } from 'node:test';
import { NextRequest } from 'next/server.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === 'next/server' ? 'next/server.js' : specifier,
      context,
    );
  },
});
const { GET, POST } =
  await import('../src/app/api/passenger/[...path]/route.ts');

const secret = 'g1-synthetic-session-secret-0123456789';
const obsoleteSecret = 'g1-obsolete-session-secret-012345';
const serviceToken = 'g1-synthetic-service-token-0123456789';
const journeyId = '00000000-0000-4000-8000-000000000001';
const ownerA = 'passenger:00000000-0000-4000-8000-00000000000a';
const ownerB = 'passenger:00000000-0000-4000-8000-00000000000b';
const apiBase = 'http://127.0.0.1:39871/api/v1';

const sign = (owner, expiresAt, key) =>
  createHmac('sha256', key).update(`${owner}.${expiresAt}`).digest('base64url');
const cookie = (
  owner,
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  key = secret,
) => `${owner}.${expiresAt}.${sign(owner, expiresAt, key)}`;
const context = (path) => ({
  params: Promise.resolve({ path: path.split('/') }),
});
const request = (method, path, headers = {}, body) =>
  new NextRequest(`http://127.0.0.1/api/passenger/${path}`, {
    method,
    headers: { host: '127.0.0.1', ...headers },
    body,
  });

let originalFetch;
let originalEnv;
let upstreamCalls;

beforeEach(() => {
  originalEnv = Object.fromEntries(
    [
      'PASSENGER_SESSION_SECRET',
      'PASSENGER_SERVICE_TOKEN',
      'PASSENGER_API_BASE_URL',
      'NODE_ENV',
    ].map((name) => [name, process.env[name]]),
  );
  process.env.PASSENGER_SESSION_SECRET = secret;
  process.env.PASSENGER_SERVICE_TOKEN = serviceToken;
  process.env.PASSENGER_API_BASE_URL = apiBase;
  process.env.NODE_ENV = 'test';
  upstreamCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { accepted: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function assertInvalidSession(value, method = 'GET') {
  const path =
    method === 'GET'
      ? `journeys/${journeyId}`
      : `journeys/${journeyId}/progress`;
  const response = await (method === 'GET' ? GET : POST)(
    request(
      method,
      path,
      {
        cookie: `transumin_proto_session=${value}`,
        ...(method === 'POST' ? { origin: 'http://127.0.0.1' } : {}),
      },
      method === 'POST' ? '{}' : undefined,
    ),
    context(path),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: { code: 'INVALID_SESSION', message: 'Session is invalid.' },
  });
  assert.equal(upstreamCalls.length, 0);
}

test('invalid signature fails closed before mutation reaches upstream', async () => {
  await assertInvalidSession(`${cookie(ownerA)}x`, 'POST');
});

test('obsolete-secret cookie fails closed before upstream fetch', async () => {
  await assertInvalidSession(
    cookie(ownerA, Math.floor(Date.now() / 1000) + 3600, obsoleteSecret),
  );
});

test('expired signed cookie fails closed before upstream fetch', async () => {
  await assertInvalidSession(cookie(ownerA, Math.floor(Date.now() / 1000) - 1));
});

test('malformed expiry fails closed before upstream fetch', async () => {
  await assertInvalidSession(`${ownerA}.NaN.signature`);
});

test('tampered expiry fails closed before mutation', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  await assertInvalidSession(
    `${ownerA}.${expiry + 1}.${sign(ownerA, expiry, secret)}`,
    'POST',
  );
});

test('old-format cookie fails closed before upstream fetch', async () => {
  const signature = createHmac('sha256', secret)
    .update(ownerA)
    .digest('base64url');
  await assertInvalidSession(`${ownerA}.${signature}`);
});

test('signed far-future expiry is rejected before protected mutation', async () => {
  await assertInvalidSession(
    cookie(ownerA, Math.floor(Date.now() / 1000) + 86400),
    'POST',
  );
});

test('changing owner without resigning fails closed', async () => {
  await assertInvalidSession(cookie(ownerA).replace(ownerA, ownerB), 'POST');
});

test('valid session derives upstream owner and ignores spoofed owner header', async () => {
  const response = await GET(
    request('GET', `journeys/${journeyId}`, {
      cookie: `transumin_proto_session=${cookie(ownerB)}`,
      'x-journey-owner': ownerA,
    }),
    context(`journeys/${journeyId}`),
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].init.headers.get('x-journey-owner'), ownerB);
  assert.notEqual(upstreamCalls[0].init.headers.get('x-journey-owner'), ownerA);
});

test('new planning with obsolete cookie mints a distinct guest, never the invalid owner', async () => {
  const obsolete = cookie(
    ownerA,
    Math.floor(Date.now() / 1000) + 3600,
    obsoleteSecret,
  );
  const response = await POST(
    request(
      'POST',
      'journeys/plan',
      {
        cookie: `transumin_proto_session=${obsolete}`,
        origin: 'http://127.0.0.1',
        'x-journey-owner': ownerA,
      },
      '{}',
    ),
    context('journeys/plan'),
  );
  assert.equal(response.status, 200);
  assert.equal(upstreamCalls.length, 1);
  const freshOwner = upstreamCalls[0].init.headers.get('x-journey-owner');
  assert.match(freshOwner, /^passenger:[0-9a-f-]{36}$/);
  assert.notEqual(freshOwner, ownerA);
  assert.equal(response.headers.get('x-passenger-session-renewed'), 'true');
  const minted = response.cookies.get('transumin_proto_session');
  assert.ok(minted?.httpOnly);
  assert.ok(minted.value.startsWith(`${freshOwner}.`));
  assert.notEqual(minted.value, obsolete);
  // This replacement only happens at a new-search boundary, never on an
  // existing journey read, boarding, recovery acceptance or progress mutation.
  upstreamCalls = [];
  await assertInvalidSession(obsolete, 'POST');
});

test('public lookup works with stale cookie without rotating ownership on startup', async () => {
  for (const path of ['transit/places', 'journeys/planning-health']) {
    const response = await GET(
      request('GET', path, {
        cookie: `transumin_proto_session=${cookie(ownerA, 1)}`,
      }),
      context(path),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.notEqual(
      upstreamCalls.at(-1).init.headers.get('x-journey-owner'),
      ownerA,
    );
  }
});

test('parallel first-visit public reads cannot overwrite the planning cookie', async () => {
  const responses = await Promise.all(
    ['transit/places', 'journeys/planning-health'].map((path) =>
      GET(request('GET', path), context(path)),
    ),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('obsolete cookie cannot bypass origin guard or missing server secret', async () => {
  const headers = {
    cookie: `transumin_proto_session=${cookie(ownerA, 1)}`,
    origin: 'https://attacker.invalid',
  };
  const rejected = await POST(
    request('POST', 'journeys/plan', headers, '{}'),
    context('journeys/plan'),
  );
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('set-cookie'), null);
  assert.equal(upstreamCalls.length, 0);
  delete process.env.PASSENGER_SESSION_SECRET;
  const unavailable = await POST(
    request(
      'POST',
      'journeys/plan',
      { ...headers, origin: 'http://127.0.0.1' },
      '{}',
    ),
    context('journeys/plan'),
  );
  assert.equal(unavailable.status, 503);
  assert.equal(upstreamCalls.length, 0);
});
