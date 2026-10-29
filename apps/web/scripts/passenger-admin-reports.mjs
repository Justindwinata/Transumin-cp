import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();
const web = process.env.PASSENGER_WEB_URL;
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
assert.ok(web && dir);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const summary = {
  suite: 'ADMIN_REPORTS',
  status: 'NOT VERIFIED',
  evidence:
    'SAMPLE accounts and SIMULATED field-review fixture in owned scratch; actual auth/API/OTP/Twin pipeline, not real flood evidence',
  results: [],
};
const contexts = [];
async function context(width = 1280) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { origin: web },
  });
  contexts.push(ctx);
  return ctx;
}
async function login(ctx, email, password) {
  const response = await ctx.request.post(`${web}/api/v1/auth/login`, {
    data: { email, password },
  });
  assert.equal(response.status(), 200, JSON.stringify(await response.json()));
}
try {
  const anonymous = await context();
  assert.equal(
    (
      await anonymous.request.get(`${web}/api/v1/admin/passenger-reports`)
    ).status(),
    401,
  );
  for (const [email, password] of [
    ['passenger.sample@local.test', 'SAMPLE-Passenger-123'],
    ['researcher.sample@local.test', 'SAMPLE-Researcher-123'],
  ]) {
    const ctx = await context();
    await login(ctx, email, password);
    assert.equal(
      (await ctx.request.get(`${web}/api/v1/admin/passenger-reports`)).status(),
      403,
    );
    assert.equal(
      (
        await ctx.request.post(
          `${web}/api/v1/admin/passenger-reports/${randomUUID()}/restrict`,
          { data: {} },
        )
      ).status(),
      403,
    );
  }
  for (const width of [390, 1280]) {
    console.log(
      JSON.stringify({ suite: 'ADMIN_REPORTS', width, stage: 'begin' }),
    );
    const rider = await context(width);
    const admin = await context(width);
    await login(admin, 'admin.sample@local.test', 'SAMPLE-Admin-123456');
    const page = await rider.newPage();
    const adminPage = await admin.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    adminPage.on('pageerror', (e) => errors.push(e.message));
    const config = (
      await (await rider.request.get(`${web}/api/passenger/config`)).json()
    ).data;
    const input = {
      origin: { latitude: -6.174612, longitude: 106.8304 },
      destination: { latitude: -6.278404, longitude: 106.82972 },
      departure_at: '2026-10-02T08:00:00+07:00',
      network_snapshot_id: config.network_snapshot_id,
      preference: 'FEWEST_TRANSFERS',
    };
    const planned = await rider.request.post(
      `${web}/api/passenger/journeys/plan`,
      { data: input, timeout: 120000 },
    );
    assert.equal(planned.status(), 201, JSON.stringify(await planned.json()));
    const choices = (await planned.json()).data;
    const selected = choices.find((row) =>
      row.segments.some((leg) => leg.route_short_name === '6H'),
    );
    assert.ok(selected, 'Actual 6H route required for closure fixture');
    const activated = await rider.request.post(
      `${web}/api/passenger/journeys/${selected.journey_id}/activate`,
      {
        headers: { 'idempotency-key': randomUUID() },
        data: { selected_journey: selected, activated_at: selected.start_at },
      },
    );
    assert.equal(activated.status(), 201);
    const journey = (await activated.json()).data;
    const transit = selected.segments.find(
      (leg) => leg.route_short_name === '6H',
    );
    const binding = transit.entity_bindings.find(
      (b) => b.entity_type === 'ROUTE',
    );
    assert.ok(binding);
    const reportResponse = await rider.request.post(
      `${web}/api/passenger/passenger-reports`,
      {
        headers: { 'idempotency-key': randomUUID() },
        data: {
          active_journey_id: journey.journey_id,
          category: 'SERVICE',
          observed_at: new Date().toISOString(),
          mobility_entity_id: binding.mobility_entity_id,
          entity_type: 'ROUTE',
          description:
            'SIMULATED UAT ONLY: documented field restriction fixture, not a real service suspension.',
        },
      },
    );
    assert.equal(reportResponse.status(), 201);
    const report = (await reportResponse.json()).data;
    await adminPage.goto(`${web}/ops/admin/reports`);
    await adminPage
      .getByRole('button', { name: new RegExp(report.report_id) })
      .click();
    const review = {
      operational_state: 'UNAVAILABLE',
      incident_type: 'SERVICE_SUSPENSION',
      reason: 'SIMULATED UAT ONLY — temporary restriction test.',
      evidence_reference: `PRIVATE-SAMPLE-REFERENCE-${randomUUID()}`,
      observed_at: new Date().toISOString(),
      valid_for_minutes: 5,
    };
    const endpoint = `${web}/api/v1/admin/passenger-reports/${report.report_id}/restrict`;
    for (const invalid of [
      { ...review, valid_for_minutes: 61 },
      { ...review, evidence_reference: '' },
      { ...review, observed_at: new Date(Date.now() + 60_000).toISOString() },
    ]) {
      assert.equal(
        (await admin.request.post(endpoint, { data: invalid })).status(),
        400,
      );
    }
    assert.equal(
      (
        await admin.request.post(endpoint, {
          headers: { origin: 'https://untrusted.invalid' },
          data: review,
        })
      ).status(),
      403,
    );
    await adminPage
      .getByRole('textbox', {
        name: 'Alasan publik (hindari data pribadi)',
        exact: true,
      })
      .fill(review.reason);
    await adminPage
      .getByRole('textbox', { name: 'Referensi bukti lapangan', exact: true })
      .fill(review.evidence_reference);
    const localObservation = await adminPage.evaluate((value) => {
      const d = new Date(value);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }, review.observed_at);
    await adminPage
      .getByLabel('Waktu observasi (waktu perangkat)', { exact: true })
      .fill(localObservation);
    await adminPage
      .getByRole('spinbutton', { name: 'Masa berlaku (menit)', exact: true })
      .fill('5');
    const restricted = adminPage.waitForResponse(
      (r) => r.url() === endpoint && r.request().method() === 'POST',
    );
    await adminPage
      .getByRole('button', {
        name: 'Tetapkan pembatasan sementara',
        exact: true,
      })
      .click();
    const response = await restricted;
    const body = await response.json();
    assert.equal(response.status(), 201, JSON.stringify(body));
    assert.equal(body.data.verification_status, 'ADMIN_RESTRICTED');
    const submitted = response.request().postDataJSON();
    const replay = await admin.request.post(endpoint, { data: submitted });
    assert.equal(replay.status(), 201);
    assert.equal((await replay.json()).data.review_replay, true);
    assert.equal(
      (
        await admin.request.post(endpoint, {
          data: {
            ...submitted,
            evidence_reference: 'DIFFERENT-SAMPLE-REFERENCE',
          },
        })
      ).status(),
      409,
    );
    const queue = (
      await (
        await admin.request.get(`${web}/api/v1/admin/passenger-reports`)
      ).json()
    ).data;
    const reviewed = queue.find((r) => r.report_id === report.report_id);
    assert.equal(reviewed.review_authority, 'ADMIN_FIELD_REVIEW');
    assert.equal(reviewed.restriction_active, true);
    assert.equal(reviewed.evidence_reference, review.evidence_reference);
    assert.ok(reviewed.actor_user_id);
    console.log(
      JSON.stringify({
        suite: 'ADMIN_REPORTS',
        width,
        stage: 'restriction-and-replay-verified',
      }),
    );
    const newRider = await context(width);
    const replanned = await newRider.request.post(
      `${web}/api/passenger/journeys/plan`,
      { data: input, timeout: 120000 },
    );
    assert.equal(
      replanned.status(),
      201,
      JSON.stringify(await replanned.json()),
    );
    const replanText = await replanned.text();
    assert.ok(
      !replanText.includes(review.evidence_reference),
      'Private evidence reference leaked into passenger route',
    );
    const alternatives = (await replanned.json()).data;
    assert.ok(
      alternatives.every((r) =>
        r.segments.every((l) => l.route_short_name !== '6H'),
      ),
      'New passenger plan used blocked route',
    );
    const alertResponse = await rider.request.get(
      `${web}/api/passenger/journeys/${journey.journey_id}/alerts`,
    );
    assert.equal(alertResponse.status(), 200);
    const alerts = (await alertResponse.json()).data;
    assert.ok(
      alerts.some(
        (alert) =>
          alert.mobility_entity_id === binding.mobility_entity_id &&
          alert.source_id === report.report_id &&
          alert.journey_id === journey.journey_id &&
          alert.evidence_type === 'OBSERVED' &&
          alert.operational_state === 'UNAVAILABLE' &&
          alert.alert_type === 'BLOCKING' &&
          alert.resolved_at === null &&
          Date.parse(alert.expires_at) > Date.now(),
      ),
      'Affected active journey received no current owner-scoped blocking field-review alert',
    );
    await adminPage.screenshot({
      path: join(dir, `admin-review-${width}.png`),
      fullPage: true,
    });
    await adminPage
      .getByRole('button', { name: new RegExp(report.report_id) })
      .click();
    await adminPage
      .getByRole('textbox', {
        name: 'Alasan publik (hindari data pribadi)',
        exact: true,
      })
      .fill('SIMULATED UAT ONLY — retract fixture after checks.');
    const closePending = adminPage.waitForResponse((r) =>
      r.url().endsWith(`/${report.report_id}/close`),
    );
    await adminPage
      .getByRole('button', { name: 'Cabut pembatasan', exact: true })
      .click();
    const closed = await closePending;
    assert.equal(closed.status(), 201, JSON.stringify(await closed.json()));
    const restored = await newRider.request.post(
      `${web}/api/passenger/journeys/plan`,
      { data: input, timeout: 120000 },
    );
    assert.equal(restored.status(), 201);
    assert.ok(
      (await restored.json()).data.some((r) =>
        r.segments.some((l) => l.route_short_name === '6H'),
      ),
      'Retracted route did not return',
    );
    assert.deepEqual(errors, []);
    if (width === 1280) {
      const expiryReportResponse = await rider.request.post(
        `${web}/api/passenger/passenger-reports`,
        {
          headers: { 'idempotency-key': randomUUID() },
          data: {
            active_journey_id: journey.journey_id,
            category: 'SERVICE',
            observed_at: new Date().toISOString(),
            mobility_entity_id: binding.mobility_entity_id,
            entity_type: 'ROUTE',
            description: 'SIMULATED UAT ONLY: real elapsed expiry test.',
          },
        },
      );
      assert.equal(expiryReportResponse.status(), 201);
      const expiryReport = (await expiryReportResponse.json()).data;
      const expiryRestriction = await admin.request.post(
        `${web}/api/v1/admin/passenger-reports/${expiryReport.report_id}/restrict`,
        { data: { ...review, observed_at: new Date().toISOString() } },
      );
      assert.equal(expiryRestriction.status(), 201);
      const queue = (
        await (
          await admin.request.get(`${web}/api/v1/admin/passenger-reports`)
        ).json()
      ).data;
      const expiryRecord = queue.find(
        (r) => r.report_id === expiryReport.report_id,
      );
      assert.equal(expiryRecord.restriction_active, true);
      const during = await newRider.request.post(
        `${web}/api/passenger/journeys/plan`,
        { data: input, timeout: 120000 },
      );
      assert.equal(during.status(), 201);
      assert.ok(
        (await during.json()).data.every((r) =>
          r.segments.every((l) => l.route_short_name !== '6H'),
        ),
      );
      while (Date.now() <= Date.parse(expiryRecord.expires_at) + 1500) {
        console.log(
          JSON.stringify({
            suite: 'ADMIN_REPORTS',
            stage: 'waiting-real-expiry',
            expires_at: expiryRecord.expires_at,
          }),
        );
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(
              30000,
              Math.max(
                1,
                Date.parse(expiryRecord.expires_at) + 1501 - Date.now(),
              ),
            ),
          ),
        );
      }
      const after = await newRider.request.post(
        `${web}/api/passenger/journeys/plan`,
        { data: input, timeout: 120000 },
      );
      assert.equal(after.status(), 201);
      assert.ok(
        (await after.json()).data.some((r) =>
          r.segments.some((l) => l.route_short_name === '6H'),
        ),
        'Expired restriction still blocks routing',
      );
      const history = (
        await (
          await admin.request.get(`${web}/api/v1/admin/passenger-reports`)
        ).json()
      ).data.find((r) => r.report_id === expiryReport.report_id);
      assert.ok(history.actor_user_id && history.evidence_reference);
      assert.equal(history.restriction_active, false);
      summary.expiry = {
        status: 'PASS',
        expires_at: expiryRecord.expires_at,
        historical_review_retained: true,
        route_restored: true,
      };
    }
    summary.results.push({
      width,
      status: 'PASS',
      report_id: report.report_id,
      incident_id: body.data.incident_id,
      roles_csrf_validation: 'PASS',
      idempotency: 'PASS',
      new_passenger_avoids_route: true,
      targeted_alert: true,
      private_evidence_not_public: true,
      retract_restores_route: true,
    });
    console.log(
      JSON.stringify({ suite: 'ADMIN_REPORTS', width, status: 'PASS' }),
    );
  }
  summary.status = 'PASS';
} catch (e) {
  summary.error = String(e?.stack ?? e);
  throw e;
} finally {
  await writeFile(
    join(dir, 'admin-reports.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  for (const ctx of contexts) await ctx.close();
  await browser.close();
}
console.log(JSON.stringify(summary));
