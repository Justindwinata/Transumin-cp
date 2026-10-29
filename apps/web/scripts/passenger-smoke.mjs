import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as playwrightRequest } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Fail closed: this harness mutates journeys and must never target the
// shared product runtime. Run via `pnpm data:browser:isolated --suite=<name>`;
// S01/S09 suites stay out of the isolated set until their corridors are
// proven on the scratch corpus (see R7 closeout).
await assertCp2Runtime();

const base = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const originLatitude = -6.108205;

const client = await playwrightRequest.newContext({
  baseURL: base,
  extraHTTPHeaders: { origin: base },
});
const otherClient = await playwrightRequest.newContext({
  baseURL: base,
  extraHTTPHeaders: { origin: base },
});

async function request(context, path, options = {}) {
  const response = await context.fetch(`/api/passenger/${path}`, options);
  const body = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(body)}`);
  return { status: response.status(), data: body.data };
}

async function rejected(context, path, options, statuses, pattern) {
  const response = await context.fetch(`/api/passenger/${path}`, options);
  const body = await response.json();
  assert.ok(
    statuses.includes(response.status()),
    `${path}: ${response.status()} ${JSON.stringify(body.error ?? {})}`,
  );
  if (pattern)
    assert.match(
      JSON.stringify(body),
      pattern,
      `${path}: rejection did not explain the contract`,
    );
  return body;
}

async function sessionCookie(context) {
  return (await context.storageState()).cookies.find(
    (cookie) => cookie.name === 'transumin_proto_session',
  );
}

try {
  const config = await request(client, 'config');
  const planned = await request(client, 'journeys/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    data: {
      origin: { latitude: originLatitude, longitude: 106.89982 },
      destination: { latitude: -6.205627, longitude: 106.822295 },
      departure_at: '2026-10-02T08:00:00+07:00',
      network_snapshot_id: config.data.network_snapshot_id,
      preference: 'BALANCED',
    },
  });
  assert.ok(planned.data.length > 0, 'OTP returned no journey');
  const selected = planned.data[0];
  assert.ok(selected.segments.length > 1, 'No usable multi-leg plan');

  const signedSession = await sessionCookie(client);
  assert.ok(
    signedSession?.httpOnly,
    'Proxy did not mint HttpOnly session cookie',
  );
  const invalidSelected = { ...selected, journey_id: randomUUID() };
  await rejected(
    client,
    `journeys/${selected.journey_id}/activate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `smoke-invalid-${randomUUID()}`,
      },
      data: {
        selected_journey: invalidSelected,
        activated_at: selected.start_at,
      },
    },
    [400],
    /Path journeyId must match selected_journey/,
  );

  const activated = await request(
    client,
    `journeys/${selected.journey_id}/activate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `smoke-${randomUUID()}`,
      },
      data: {
        selected_journey: selected,
        activated_at: selected.start_at,
      },
    },
  );
  assert.equal(activated.data.status, 'ACTIVE');
  assert.ok(activated.data.dependencies.length > 0);
  assert.equal(
    activated.data.routing_context.network_snapshot_id,
    selected.routing_context.network_snapshot_id,
  );
  assert.equal((await sessionCookie(client))?.value, signedSession.value);

  await request(otherClient, 'journeys/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    data: {
      origin: { latitude: originLatitude, longitude: 106.89982 },
      destination: { latitude: -6.205627, longitude: 106.822295 },
      departure_at: '2026-10-02T08:00:00+07:00',
      network_snapshot_id: config.data.network_snapshot_id,
      preference: 'BALANCED',
    },
  });
  const otherSession = await sessionCookie(otherClient);
  assert.ok(otherSession?.httpOnly);
  assert.notEqual(otherSession.value, signedSession.value);
  await rejected(
    otherClient,
    `journeys/${activated.data.journey_id}`,
    {},
    [403, 404],
  );

  const firstLeg = selected.segments[0];
  if (firstLeg.mode !== 'WALK') {
    const boarded = await request(
      client,
      `journeys/${activated.data.journey_id}/boarding/${firstLeg.sequence}`,
      { method: 'POST', data: { confirmed_at: firstLeg.start_at } },
    );
    assert.equal(
      boarded.data.progress.boarding_confirmed_segment_sequence,
      firstLeg.sequence,
    );
    const alighted = await request(
      client,
      `journeys/${activated.data.journey_id}/alighting/${firstLeg.sequence}`,
      { method: 'POST', data: { confirmed_at: firstLeg.end_at } },
    );
    assert.equal(
      alighted.data.progress.alighting_confirmed_segment_sequence,
      firstLeg.sequence,
    );
  }
  const progressed = await request(
    client,
    `journeys/${activated.data.journey_id}/progress`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `smoke-progress-${randomUUID()}`,
      },
      data: {
        completed_segment_count: 1,
        current_segment_sequence: 1,
        recorded_at: selected.segments[1].start_at,
      },
    },
  );
  assert.equal(progressed.data.progress.completed_segment_count, 1);
  assert.deepEqual(
    progressed.data.segments,
    activated.data.segments,
    'Progress mutated the original plan',
  );
  console.log(
    JSON.stringify({
      status: 'PASS',
      source: 'real OTP and API via web proxy',
      alternatives: planned.data.length,
      plan_journey_id: selected.journey_id,
      active_journey_id: activated.data.journey_id,
      segments: selected.segments.length,
      dependencies: activated.data.dependencies.length,
      completed: progressed.data.progress.completed_segment_count,
      network_snapshot_id: selected.routing_context.network_snapshot_id,
    }),
  );
} finally {
  await client.dispose();
  await otherClient.dispose();
}
