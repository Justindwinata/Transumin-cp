import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';
await assertCp2Runtime();
await mkdir(process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR, { recursive: true });
const web = process.env.PASSENGER_WEB_URL;
const contexts = [];
let reportId;
let admin;
async function context() {
  const c = await request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { origin: web },
  });
  contexts.push(c);
  return c;
}
async function post(c, path, data, status = 201) {
  const r = await c.fetch(`${web}${path}`, {
    method: path.endsWith('/progress') ? 'PATCH' : 'POST',
    data,
    headers: { 'idempotency-key': randomUUID() },
    timeout: 125000,
  });
  const body = await r.json();
  assert.equal(
    r.status(),
    path.endsWith('/progress') ? 200 : status,
    JSON.stringify(body.error ?? {}),
  );
  return body.data;
}
const summary = {
  suite: 'RECOVERY_CLOCK',
  status: 'NOT VERIFIED',
  provenance:
    'SIMULATED historical progress/date corruption in owned scratch only',
};
try {
  admin = await context();
  await post(
    admin,
    '/api/v1/auth/login',
    { email: 'admin.sample@local.test', password: 'SAMPLE-Admin-123456' },
    200,
  );
  const riders = [];
  for (const bad of [true, false]) {
    const client = await context();
    const config = (
      await (await client.get(`${web}/api/passenger/config`)).json()
    ).data;
    const choices = await post(client, '/api/passenger/journeys/plan', {
      origin: { latitude: -6.174612, longitude: 106.8304 },
      destination: { latitude: -6.278404, longitude: 106.82972 },
      departure_at: '2026-10-02T08:00:00+07:00',
      network_snapshot_id: config.network_snapshot_id,
      preference: 'FEWEST_TRANSFERS',
    });
    const selected = choices.find((row) =>
      row.segments.some((leg) => leg.route_short_name === '6H'),
    );
    assert.ok(selected);
    const journey = await post(
      client,
      `/api/passenger/journeys/${selected.journey_id}/activate`,
      { selected_journey: selected, activated_at: selected.start_at },
    );
    const transit = selected.segments.find(
      (leg) => leg.route_short_name === '6H',
    );
    assert.equal(transit.sequence, 1);
    const time = bad ? new Date().toISOString() : '2026-10-02T08:05:00+07:00';
    const progressed = await post(
      client,
      `/api/passenger/journeys/${journey.journey_id}/progress`,
      {
        completed_segment_count: 1,
        current_segment_sequence: 1,
        recorded_at: time,
      },
    );
    riders.push({ client, journey: progressed, transit, time });
  }
  const binding = riders[0].transit.entity_bindings.find(
    (b) => b.entity_type === 'ROUTE',
  );
  assert.ok(binding);
  const report = await post(
    riders[0].client,
    '/api/passenger/passenger-reports',
    {
      active_journey_id: riders[0].journey.journey_id,
      category: 'SERVICE',
      observed_at: new Date().toISOString(),
      mobility_entity_id: binding.mobility_entity_id,
      entity_type: 'ROUTE',
      description:
        'SIMULATED UAT ONLY: recovery clock regression, not a real service suspension.',
    },
  );
  reportId = report.report_id;
  await post(admin, `/api/v1/admin/passenger-reports/${reportId}/restrict`, {
    operational_state: 'UNAVAILABLE',
    incident_type: 'SERVICE_SUSPENSION',
    evidence_reference: 'SAMPLE local software-test evidence only',
    observed_at: new Date().toISOString(),
    valid_for_minutes: 5,
    reason: 'SIMULATED UAT ONLY: temporary restriction for regression testing.',
  });
  for (let i = 0; i < riders.length; i++) {
    const { client, journey, time } = riders[i];
    const alerts = (
      await (
        await client.get(
          `${web}/api/passenger/journeys/${journey.journey_id}/alerts`,
        )
      ).json()
    ).data;
    const alert = alerts.find(
      (a) =>
        a.mobility_entity_id === binding.mobility_entity_id &&
        a.operational_state === 'UNAVAILABLE',
    );
    assert.ok(alert);
    const r = await client.post(`${web}/api/passenger/recoveries`, {
      headers: { 'idempotency-key': randomUUID() },
      data: {
        original_journey_id: journey.journey_id,
        impact_id: alert.impact_id,
        recovery_at: time,
      },
      timeout: 125000,
    });
    const body = await r.json();
    if (i === 0) {
      assert.equal(r.status(), 422, JSON.stringify(body.error ?? {}));
      assert.equal(body.error.code, 'INVALID_TIME');
      summary.corrupt_date_structured_refusal = 'PASS';
    } else {
      assert.equal(r.status(), 201, JSON.stringify(body.error ?? {}));
      const recovery = body.data;
      assert.equal(recovery.status, 'COMPLETED');
      assert.ok(recovery.proposed_journey);
      summary.replacement_modes = recovery.proposed_journey.segments.map(
        (leg) => leg.mode,
      );
      summary.replacement_duration_seconds =
        recovery.proposed_journey.duration_seconds;
      summary.replacement_walking_meters =
        recovery.proposed_journey.walking_distance_meters;
      assert.ok(
        summary.replacement_modes.some((mode) => mode !== 'WALK'),
        'This corridor has an unaffected rail alternative; recovery returned only walking',
      );
      assert.equal(recovery.completed_segment_count, 1);
      await post(
        client,
        `/api/passenger/recoveries/${recovery.recovery_id}/accept`,
        {
          progress_revision: recovery.progress_revision,
          accepted_at: new Date().toISOString(),
        },
      );
      const restored = (
        await (
          await client.get(
            `${web}/api/passenger/journeys/${journey.journey_id}`,
          )
        ).json()
      ).data;
      assert.equal(restored.accepted_recovery_id, recovery.recovery_id);
      assert.equal(restored.progress.completed_segment_count, 1);
      summary.valid_clock_recovery_accept_reload = 'PASS';
    }
  }
  summary.status = 'PASS';
} finally {
  if (reportId && admin)
    await post(admin, `/api/v1/admin/passenger-reports/${reportId}/close`, {
      decision: 'RETRACTED',
      reason: 'SIMULATED UAT ONLY: regression fixture finished.',
    });
  await writeFile(
    join(process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR, 'recovery-clock.json'),
    JSON.stringify(summary, null, 2),
  );
  for (const c of contexts) await c.dispose();
}
console.log(JSON.stringify(summary));
