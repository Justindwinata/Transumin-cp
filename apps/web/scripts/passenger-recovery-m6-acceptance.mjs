import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Fail closed: this suite mutates journeys/reports and must never target the
// shared product runtime. Run via `pnpm data:browser:isolated --suite=M6`.
await assertCp2Runtime();

const web = process.env.M6_WEB_URL ?? 'http://127.0.0.1:3000';
const api = process.env.M6_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cases = [];
const reviewerRef = 'm6-controlled-reviewer';
let browser;
let context;
let page;
let reportId = null;
let reviewActive = false;
let owner = null;
let journeyId = null;
let impactId = null;
let recovery = null;
let recoveryKey = null;
let acceptanceKey = null;
let acceptance = null;

function env(name) {
  if (process.env[name] !== undefined) return process.env[name];
  try {
    const line = readFileSync(join(root, '.env'), 'utf8')
      .split('\n')
      .find((x) => x.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() ?? '';
  } catch {
    return '';
  }
}
const sessionSecret = env('PASSENGER_SESSION_SECRET');
const reviewerToken = env('CONTROLLED_REVIEW_TOKEN');
const serviceToken = env('PASSENGER_SERVICE_TOKEN');
const reviewEnabled =
  env('CONTROLLED_REVIEW_ENABLED') === 'true' && reviewerToken.length >= 32;

function mark(name, verdict, detail = '') {
  cases.push({ case: name, verdict, detail });
  process.stderr.write(
    `[case] ${name}: ${verdict}${detail ? ` — ${detail}` : ''}\n`,
  );
}
async function step(name, fn) {
  try {
    const value = await fn();
    mark(name, 'PASS', typeof value === 'string' ? value : '');
    return value;
  } catch (error) {
    mark(name, 'FAIL', String(error?.message ?? error).slice(0, 700));
    return undefined;
  }
}
function data(body) {
  return body?.data ?? body;
}
async function json(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    body: await response.json().catch(() => null),
  };
}
async function direct(path, options = {}) {
  return json(
    await fetch(`${api}/${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(serviceToken ? { 'x-passenger-service-token': serviceToken } : {}),
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(120_000),
    }),
  );
}
async function proxy(path, options = {}) {
  return json(
    await context.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
function ownerFromCookie() {
  const cookie = context
    .cookies()
    .then((xs) => xs.find((x) => x.name === 'transumin_proto_session'));
  return cookie.then((entry) => {
    if (!entry?.value) return null;
    const raw = decodeURIComponent(entry.value);
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [owner, expiry, signature] = parts;
    if (!/^passenger:[0-9a-f-]{36}$/.test(owner) || !/^\d+$/.test(expiry))
      return null;
    if (!sessionSecret) return owner;
    const expected = createHmac('sha256', sessionSecret)
      .update(`${owner}.${expiry}`)
      .digest('base64url');
    return expected === signature ? owner : null;
  });
}
function incidentType(type) {
  return type === 'STOP'
    ? 'STOP_CLOSURE'
    : type === 'STATION'
      ? 'STATION_CLOSURE'
      : 'SERVICE_SUSPENSION';
}
function futureRoute(journey) {
  return journey.segments.find(
    (segment) =>
      segment.sequence >= 3 &&
      segment.entity_bindings.some(
        (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
      ),
  );
}
async function planAndActivate() {
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: /Muat contoh perjalanan/ })
    .waitFor({ timeout: 30_000 });
  await page.getByText('Masukkan koordinat').click();
  await page.getByLabel('Lintang titik awal').fill('-6.108205');
  await page.getByLabel('Bujur titik awal').fill('106.89982');
  await page.getByLabel('Lintang tujuan').fill('-6.205627');
  await page.getByLabel('Bujur tujuan').fill('106.822295');
  await page.getByLabel('Berangkat (WIB)').fill('2026-10-02T08:11');
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Cari perjalanan' }).click();
  const response = await wait;
  const body = await response.json();
  assert.equal(response.status(), 201, JSON.stringify(body));
  const plans = data(body);
  assert.ok(plans.length, 'OTP returned no plans');
  const chosen =
    plans.find((x) => futureRoute(x)) ??
    plans.find(
      (x) =>
        new Set(x.segments.filter((s) => s.mode !== 'WALK').map((s) => s.mode))
          .size >= 2,
    );
  assert.ok(chosen, 'no multimodal plan with future ROUTE dependency');
  const buttons = page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button');
  await buttons.first().waitFor({ timeout: 120_000 });
  const index = plans.findIndex((x) => x.journey_id === chosen.journey_id);
  await buttons.nth(index).click();
  const activate = page.waitForResponse(
    (r) => /\/activate$/.test(r.url()) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  const activated = await activate;
  const activatedBody = await activated.json();
  assert.equal(activated.status(), 201, JSON.stringify(activatedBody));
  const journey = data(activatedBody);
  assert.ok(journey.journey_id);
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30_000 });
  return journey;
}
async function controlled(path, body) {
  return json(
    await fetch(`${api}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${reviewerToken}`,
        'x-controlled-reviewer': reviewerRef,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }),
  );
}
try {
  await step('web-api-ready', async () => {
    const [w, a] = await Promise.all([fetch(web), fetch(`${api}/config`)]);
    assert.ok(w.ok, `web ${w.status}`);
    assert.notEqual(a.status, 503, `api ${a.status}`);
    return `${web} + ${api}`;
  });
  assert.ok(reviewEnabled, 'CONTROLLED_REVIEW_ENABLED/token unavailable');
  assert.ok(serviceToken.length >= 32, 'PASSENGER_SERVICE_TOKEN unavailable');
  browser = await chromium.launch(
    existsSync(chrome)
      ? {
          executablePath: chrome,
          headless: true,
          args:
            String(web).startsWith('https:') || String(api).startsWith('https:')
              ? ['--ignore-certificate-errors']
              : [],
        }
      : {
          headless: true,
          args:
            String(web).startsWith('https:') || String(api).startsWith('https:')
              ? ['--ignore-certificate-errors']
              : [],
        },
  );
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  const active = await step('real-otp-ui-plan-activate', planAndActivate);
  if (!active) throw new Error('blocked: activation failed');
  journeyId = active.journey_id;
  owner = await ownerFromCookie();
  await step('server-owner-and-otp-boundary', async () => {
    assert.ok(owner && /^passenger:[0-9a-f-]{36}$/.test(owner));
    assert.ok(
      active.segments.length >= 4,
      `need >=4 segments, got ${active.segments.length}`,
    );
    assert.ok(futureRoute(active), 'no future route dependency');
    return `${owner.slice(0, 17)}… ${active.segments.length} segments`;
  });
  const targetSegment = futureRoute(active);
  const targetBinding = targetSegment.entity_bindings.find(
    (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
  );
  const targetId = targetBinding.mobility_entity_id;
  const completed = Math.max(2, targetSegment.sequence - 1);
  let progressed;
  await step('manual-boundary-anchor', async () => {
    for (let sequence = 0; sequence < completed; sequence += 1) {
      const leg = active.segments[sequence];
      if (leg.mode !== 'WALK') {
        for (const [action, at] of [
          ['boarding', leg.start_at],
          ['alighting', leg.end_at],
        ]) {
          const confirmation = await proxy(
            `journeys/${journeyId}/${action}/${sequence}`,
            { method: 'POST', data: { confirmed_at: at } },
          );
          assert.equal(
            confirmation.status,
            201,
            JSON.stringify(confirmation.body),
          );
        }
      }
      const result = await proxy(`journeys/${journeyId}/progress`, {
        method: 'PATCH',
        data: {
          completed_segment_count: sequence + 1,
          current_segment_sequence: sequence + 1,
          recorded_at: active.segments[sequence + 1].start_at,
        },
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      progressed = data(result.body);
    }
    assert.equal(progressed.progress.completed_segment_count, completed);
    assert.equal(progressed.progress.method, 'CONTROLLED_MANUAL');
    return `segment ${completed}; revision ${progressed.progress.revision}`;
  });
  await step('controlled-report-and-relevant-alert', async () => {
    const target = [...active.segments]
      .slice(completed)
      .flatMap((s) => s.entity_bindings)
      .find((b) => b.mobility_entity_id === targetId);
    assert.ok(target, 'future target not remaining');
    const submitted = await proxy('passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      data: {
        active_journey_id: journeyId,
        category: 'SERVICE',
        observed_at: new Date(Date.now() - 1000).toISOString(),
        mobility_entity_id: targetId,
        entity_type: 'ROUTE',
        description: `M6 controlled acceptance ${randomUUID()}`,
      },
    });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    reportId = data(submitted.body).report_id;
    const reviewed = await controlled(
      `controlled/passenger-reports/${reportId}/verify`,
      {
        operational_state: 'UNAVAILABLE',
        incident_type: incidentType('ROUTE'),
        reason: `M6 controlled review ${reportId}`,
      },
    );
    assert.equal(reviewed.status, 201, JSON.stringify(reviewed.body));
    reviewActive = true;
    const alerts =
      data((await proxy(`journeys/${journeyId}/alerts`)).body) ?? [];
    const alert = alerts.find(
      (x) =>
        x.mobility_entity_id === targetId && x.evidence_type === 'SIMULATED',
    );
    assert.ok(alert, `no relevant SIMULATED alert for ${targetId}`);
    impactId = alert.impact_id;
    assert.ok(
      alert.affected_segment_sequences.includes(targetSegment.sequence),
    );
    return `${reportId.slice(0, 8)} → ${impactId.slice(0, 8)} SIMULATED`;
  });
  await step('recovery-proposal-real-otp', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: 'Cari rute pengganti' })
      .first()
      .waitFor({ timeout: 30_000 });
    const wait = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/recoveries') &&
        r.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page
      .getByRole('button', { name: 'Cari rute pengganti' })
      .first()
      .click();
    const response = await wait;
    const body = await response.json();
    assert.equal(response.status(), 201, JSON.stringify(body));
    recovery = data(body);
    recoveryKey = response.request().headers()['idempotency-key'] ?? null;
    assert.ok(
      recoveryKey,
      'product recovery request carried no idempotency key',
    );
    assert.equal(recovery.status, 'COMPLETED');
    assert.ok(recovery.proposed_journey);
    assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
    assert.equal(recovery.recovery_at, progressed.progress.recorded_at);
    return `${recovery.recovery_id.slice(0, 8)} ${recovery.rejoin_status}`;
  });
  await step('recovery-ui-visible-and-accept', async () => {
    await page
      .getByRole('heading', { name: 'Rute pengganti' })
      .waitFor({ timeout: 120_000 });
    const wait = page.waitForResponse(
      (r) =>
        r
          .url()
          .endsWith(
            `/api/passenger/recoveries/${recovery.recovery_id}/accept`,
          ) && r.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page
      .getByRole('button', { name: 'Gunakan rute pengganti ini' })
      .click();
    const response = await wait;
    const acceptanceBody = await response.json();
    assert.ok(
      [200, 201].includes(response.status()),
      JSON.stringify(acceptanceBody),
    );
    acceptance = data(acceptanceBody);
    acceptanceKey = response.request().headers()['idempotency-key'] ?? null;
    assert.ok(acceptanceKey);
    await page
      .getByText('Rute pengganti diterima', { exact: false })
      .waitFor({ timeout: 120_000 });
    assert.ok(acceptance, 'no acceptance body');
    const current = data((await proxy(`journeys/${journeyId}`)).body);
    assert.equal(current.status, 'ACTIVE');
    assert.equal(acceptance.original_plan_preserved, true);
    assert.equal(acceptance.current_pointer_advanced, true);
    return `UI accepted ${recovery.recovery_id}; active ${journeyId}; replacement ${acceptance.current_replacement_journey.journey_id}`;
  });
  await step('refresh-route-map-timeline-continuation', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 60_000 });
    await page
      .getByRole('heading', { name: 'Rute pengganti' })
      .waitFor({ timeout: 60_000 });
    assert.ok(
      (await page.locator('[class*="journey-map"]').count()) > 0,
      'map not rendered after refresh',
    );
    assert.ok(
      (await page.locator('.leg-list').count()) > 0,
      'timeline not rendered after refresh',
    );
    const persisted = data(
      (await proxy(`recoveries/${recovery.recovery_id}`)).body,
    );
    assert.equal(
      persisted.accepted,
      true,
      'server acceptance lineage missing after refresh',
    );
    const restored = await page.evaluate(
      (id) => localStorage.getItem(`transumin.passenger.recovery.${id}`),
      journeyId,
    );
    assert.ok(
      restored,
      'UI did not restore recovery proposal ID after refresh',
    );
    assert.ok(
      (await page
        .getByText('Rute pengganti diterima', { exact: false })
        .count()) > 0,
      `UI did not restore accepted continuation after refresh; localStorage recovery=${restored}`,
    );
    return 'active route + map + timeline + accepted continuation persisted';
  });
  await step('negative-accept-idempotency', async () => {
    assert.ok(acceptanceKey, 'blocked: no acceptance idempotency key');
    const replay = await proxy(`recoveries/${recovery.recovery_id}/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': acceptanceKey,
      },
      data: { progress_revision: recovery.progress_revision },
    });
    assert.ok([200, 201].includes(replay.status), JSON.stringify(replay.body));
    assert.equal(data(replay.body).recovery_id, recovery.recovery_id);
    return 'same-key accept replay returns same acceptance';
  });
  await step('negative-foreign-owner', async () => {
    const result = await direct(`recoveries/${recovery.recovery_id}`, {
      headers: { 'x-journey-owner': `passenger:${randomUUID()}` },
    });
    assert.ok([403, 404].includes(result.status), `got ${result.status}`);
    return `${result.status}`;
  });
  await step('negative-stale-revision', async () => {
    const result = await proxy(`recoveries/${recovery.recovery_id}/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `m6-stale-${randomUUID()}`,
      },
      data: { progress_revision: recovery.progress_revision + 1 },
    });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    return `${result.status} RECOVERY_STALE`;
  });
  await step('negative-recovery-idempotency', async () => {
    const replay = await proxy('recoveries', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': recoveryKey,
      },
      data: {
        original_journey_id: journeyId,
        impact_id: impactId,
        recovery_at: progressed.progress.recorded_at,
      },
    });
    assert.equal(replay.status, 201, JSON.stringify(replay.body));
    assert.equal(
      data(replay.body).recovery_id,
      recovery.recovery_id,
      'replay returned a different recovery',
    );
    const conflict = await proxy('recoveries', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': recoveryKey,
      },
      data: {
        original_journey_id: journeyId,
        impact_id: impactId,
        recovery_at: new Date(
          Date.parse(progressed.progress.recorded_at) + 1000,
        ).toISOString(),
      },
    });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    return 'replay 201 + changed-input 409';
  });
} catch (error) {
  mark('harness', 'FAIL', String(error?.message ?? error).slice(0, 700));
} finally {
  if (reviewActive && reportId && reviewEnabled) {
    const closed = await controlled(
      `controlled/passenger-reports/${reportId}/close`,
      { decision: 'RESOLVED', reason: `M6 acceptance cleanup ${reportId}` },
    );
    if (closed.status !== 201 && closed.status !== 200)
      mark('controlled-close-finally', 'FAIL', `close ${closed.status}`);
    else mark('controlled-close-finally', 'PASS', 'RESOLVED by same reviewer');
  }
  await browser?.close().catch(() => {});
}
const failed = cases.filter((x) => x.verdict === 'FAIL');
const status = failed.length ? 'FAIL' : 'PASS';
console.log(
  JSON.stringify({
    status,
    cases,
    evidence: `real Playwright UI + real OTP/API against scratch-isolated runtime (${web} / ${api}); controlled report evidence SIMULATED; no SQL cleanup`,
  }),
);
process.exitCode = status === 'PASS' ? 0 : 1;
