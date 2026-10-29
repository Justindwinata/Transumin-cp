import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allowedResource,
  apiBase,
  originAllowed,
  rewrittenSessionCookie,
  sessionCookie,
} from './ops-proxy.ts';

test('ops/auth proxy allowlist is method- and resource-specific', () => {
  assert.equal(allowedResource('POST', 'auth/login'), true);
  assert.equal(allowedResource('POST', 'auth/users'), true);
  assert.equal(allowedResource('GET', 'auth/me'), true);
  assert.equal(allowedResource('POST', 'auth/me'), false);
  assert.equal(
    allowedResource(
      'GET',
      'simulation-runs/123e4567-e89b-42d3-a456-426614174000/impact',
    ),
    true,
  );
  assert.equal(allowedResource('GET', 'simulation-runs/../auth/users'), false);
  assert.equal(allowedResource('GET', 'scenarios'), true);
  assert.equal(allowedResource('DELETE', 'auth/users'), false);
});

test('proxy upstream config cannot escape fixed loopback API', () => {
  assert.equal(apiBase(), 'http://127.0.0.1:3001/api/v1');
  assert.throws(() => apiBase('https://evil.example/api/v1'));
  assert.throws(() => apiBase('http://127.0.0.1:3001/other'));
  assert.throws(() => apiBase('http://user:secret@localhost/api/v1'));
});

test('mutation Origin must be same-origin and present', () => {
  assert.equal(
    originAllowed('http://localhost:3000/', 'localhost:3000', false),
    true,
  );
  assert.equal(
    originAllowed('http://evil.example/', 'localhost:3000', false),
    false,
  );
  assert.equal(originAllowed(null, 'localhost:3000', false), false);
  assert.equal(
    originAllowed('http://localhost:3000/', 'localhost:3000', true),
    false,
  );
});

test('only opaque tnx_session crosses proxy; browser cookie scope is secure and HttpOnly', () => {
  const token = 'a'.repeat(64);
  assert.equal(
    sessionCookie(`other=x; tnx_session=${token}; user=y`),
    `tnx_session=${token}`,
  );
  assert.throws(() =>
    sessionCookie(`tnx_session=${token}; tnx_session=${token}`),
  );
  assert.throws(() => sessionCookie('tnx_session=not-a-session'));
  assert.equal(
    rewrittenSessionCookie(
      `tnx_session=${token}; Path=/api/v1/auth; HttpOnly`,
      true,
    ),
    `tnx_session=${token}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=43200; Secure`,
  );
  assert.equal(
    rewrittenSessionCookie(
      `tnx_session=${token}; Path=/api/v1/auth; HttpOnly`,
      false,
    ),
    `tnx_session=${token}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=43200`,
  );
  assert.equal(rewrittenSessionCookie('other=value', false), null);
  assert.equal(
    rewrittenSessionCookie('tnx_session=; Max-Age=0', false),
    'tnx_session=; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=0',
  );
});

test('route returns no-store body and allowlists auth endpoints without forwarding caller identity', () => {
  const source = readFileSync(
    new URL('../app/api/v1/[...path]/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /allowedResource\(request.method/);
  assert.doesNotMatch(source, /export const (?:PATCH|PUT|DELETE)/);
});

test('proxy allows only known research resources and rejects unrelated paths', () => {
  assert.equal(allowedResource('GET', 'scenarios?limit=25'), true);
  assert.equal(allowedResource('GET', 'scenarios?cursor=bogus'), true);
  assert.equal(allowedResource('POST', 'scenarios'), true);
  assert.equal(allowedResource('GET', 'simulation-runs?limit=25'), true);
  assert.equal(
    allowedResource('GET', 'experiments?limit=100&cursor=abc'),
    true,
  );
  assert.equal(
    allowedResource(
      'GET',
      'network/snapshots/123e4567-e89b-42d3-a456-426614174000/geometry?bbox=1,2,3,4',
    ),
    true,
  );
  assert.equal(
    allowedResource(
      'GET',
      'scenarios/123e4567-e89b-42d3-a456-426614174000/impact',
    ),
    false,
  );
  assert.equal(allowedResource('DELETE', 'scenarios'), false);
  assert.equal(allowedResource('GET', 'auth/login'), false);
  assert.equal(allowedResource('POST', 'simulation-runs'), false);
  assert.equal(allowedResource('GET', 'experiments/../../auth/users'), false);
});

test('admin report proxy bounds paths and methods without accepting credentials or arbitrary routes', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(allowedResource('GET', 'admin/passenger-reports'), true);
  assert.equal(
    allowedResource('POST', `admin/passenger-reports/${id}/restrict`),
    true,
  );
  assert.equal(
    allowedResource('POST', `admin/passenger-reports/${id}/close`),
    true,
  );
  for (const path of [
    `admin/passenger-reports/${id}/delete`,
    'admin/passenger-reports?owner=another',
    'admin/passenger-reports/../auth/users',
  ])
    assert.equal(allowedResource('POST', path), false);
  assert.equal(
    allowedResource('DELETE', `admin/passenger-reports/${id}/close`),
    false,
  );
});
