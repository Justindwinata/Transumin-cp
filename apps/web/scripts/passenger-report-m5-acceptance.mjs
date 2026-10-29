import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Fail closed: this suite mutates journeys/reports and must never target the
// shared product runtime. Run via `pnpm data:browser:isolated --suite=M5`.
await assertCp2Runtime();

const web = process.env.M5_WEB_URL ?? 'http://127.0.0.1:3000';
const api = process.env.M5_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChrome = existsSync(chrome);

const cases = [];
const mark = (name, verdict, detail = '') => {
  cases.push({ case: name, verdict, detail });
  process.stderr.write(
    `[case] ${name}: ${verdict}${detail ? ` — ${detail}` : ''}\n`,
  );
};
async function step(name, fn) {
  try {
    const value = await fn();
    mark(name, 'PASS', typeof value === 'string' ? value : '');
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mark(name, 'FAIL', message.slice(0, 700));
    return undefined;
  }
}

function readEnv(name) {
  if (process.env[name] !== undefined) return process.env[name];
  try {
    const envPath = join(root, '.env');
    if (!existsSync(envPath)) return '';
    for (const line of readFileSync(envPath, 'utf8').split('\n'))
      if (line.startsWith(`${name}=`))
        return line.slice(name.length + 1).trim();
  } catch {}
  return '';
}
const sessionSecret = readEnv('PASSENGER_SESSION_SECRET');
const reviewerToken = readEnv('CONTROLLED_REVIEW_TOKEN');
const reviewEnabled =
  readEnv('CONTROLLED_REVIEW_ENABLED') === 'true' && reviewerToken.length >= 32;
const reviewerRef = 'm5-controlled-reviewer';

// Playwright APIResponse exposes status() as a method; native fetch exposes status as a number.
async function jsonOf(response) {
  const status =
    typeof response.status === 'function' ? response.status() : response.status;
  const body = await response.json().catch(() => null);
  return { status, body };
}
async function direct(path, options = {}) {
  const response = await fetch(`${api}/${path}`, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  return jsonOf(response);
}
// Passenger proxy requires a same-origin Origin header for mutations.
async function proxyVia(context, path, options = {}) {
  return jsonOf(
    await context.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
function envelopeData(body) {
  return body?.data ?? body ?? null;
}
async function ownerFromCookie(context) {
  const entry = (await context.cookies()).find(
    (cookie) => cookie.name === 'transumin_proto_session',
  );
  if (!entry?.value) return null;
  // Next percent-encodes the cookie value; the signature is over the decoded owner.
  const raw = decodeURIComponent(entry.value);
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const owner = raw.slice(0, dot);
  if (!sessionSecret) return owner;
  const expected = createHmac('sha256', sessionSecret)
    .update(owner)
    .digest('base64url');
  return raw.slice(dot + 1) === expected ? owner : null;
}

async function loadDemoActivation(page) {
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: /Muat contoh perjalanan/ })
    .waitFor({ timeout: 30_000 });
  const planWait = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
  const plan = await planWait;
  const planJson = await plan.json().catch(() => null);
  assert.equal(
    plan.status(),
    201,
    `plan ${plan.status()} ${JSON.stringify(planJson?.error ?? planJson).slice(0, 300)}`,
  );
  const plans = envelopeData(planJson);
  assert.ok(Array.isArray(plans) && plans.length > 0, 'no alternatives');
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  return activateSelected(page, plan.status === 201 ? plans.length : 0);
}

// Independent itinerary: real place search (existing browser acceptance convention), not the demo replay.
async function loadIndependentActivation(page) {
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: /Muat contoh perjalanan/ })
    .waitFor({ timeout: 30_000 });
  await page.getByRole('combobox', { name: 'Dari' }).fill('Harmoni');
  await page
    .getByRole('option', { name: /^Harmoni TransJakarta · station/ })
    .click();
  await page
    .getByRole('combobox', { name: 'Ke' })
    .fill('Lebak Bulus Bank Syariah Indonesia');
  await page
    .getByRole('option', {
      name: /^Lebak Bulus Bank Syariah Indonesia MRT Jakarta · station/,
    })
    .click();
  await page
    .getByRole('textbox', { name: 'Berangkat (WIB)' })
    .fill('2026-10-02T08:00');
  const planWait = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Cari perjalanan' }).click();
  const plan = await planWait;
  const planJson = await plan.json().catch(() => null);
  assert.equal(
    plan.status(),
    201,
    `independent plan ${plan.status()} ${JSON.stringify(planJson?.error ?? planJson).slice(0, 300)}`,
  );
  const plans = envelopeData(planJson);
  assert.ok(
    Array.isArray(plans) && plans.length > 0,
    'no independent alternatives',
  );
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  return activateSelected(page, plans.length);
}

async function activateSelected(page, _count) {
  const activateWait = page.waitForResponse(
    (r) => /\/activate$/.test(r.url()) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  const activation = await activateWait;
  assert.equal(activation.status(), 201, `activate ${activation.status()}`);
  const journey = envelopeData(await activation.json().catch(() => null));
  assert.ok(journey?.journey_id, 'activation missing journey_id');
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30_000 });
  return journey;
}

function incidentTypeFor(entityType) {
  if (entityType === 'STOP') return 'STOP_CLOSURE';
  if (entityType === 'STATION') return 'STATION_CLOSURE';
  return 'SERVICE_SUSPENSION';
}

let browser;
let contextA;
let contextB;
try {
  await step('web-reachable', async () => {
    const response = await fetch(web, { signal: AbortSignal.timeout(20_000) });
    assert.ok(response.ok, `web ${response.status}`);
    return web;
  });

  browser = await chromium.launch(
    hasChrome
      ? {
          executablePath: chrome,
          headless: true,
          args: String(web).startsWith('https:')
            ? ['--ignore-certificate-errors']
            : [],
        }
      : {
          headless: true,
          args: String(web).startsWith('https:')
            ? ['--ignore-certificate-errors']
            : [],
        },
  );
  contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const journeyA = await step('ui-plan-activate', async () => {
    const journey = await loadDemoActivation(pageA);
    return journey.journey_id.slice(0, 8);
  });
  const journeyB = await step('independent-context-itinerary', async () => {
    const journey = await loadIndependentActivation(pageB);
    assert.notEqual(
      journey.plan_journey_id,
      journeyA?.plan_journey_id ?? null,
      'context B reused the demo itinerary',
    );
    return journey.journey_id.slice(0, 8);
  });
  const journeyAId = journeyA
    ? await pageA.evaluate(() =>
        localStorage.getItem('transumin.passenger.journey'),
      )
    : null;
  const journeyBId = journeyB
    ? await pageB.evaluate(() =>
        localStorage.getItem('transumin.passenger.journey'),
      )
    : null;

  const ownerA = await ownerFromCookie(contextA);
  const ownerB = await ownerFromCookie(contextB);
  await step('server-derived-cookie-contexts', async () => {
    assert.ok(ownerA && ownerB, 'server-derived cookie missing');
    assert.notEqual(ownerA, ownerB, 'contexts share an owner');
    return 'distinct signed HttpOnly owners';
  });

  const journeyAData = journeyAId
    ? await proxyVia(contextA, `journeys/${journeyAId}`)
    : null;
  const target =
    envelopeData(journeyAData?.body)?.dependencies?.find(
      (item) => item.entity_type === 'ROUTE',
    ) ?? envelopeData(journeyAData?.body)?.dependencies?.[0];
  // The UI selects its own remaining-journey target; the authoritative entity is the
  // one persisted on the submitted report, so re-read it after submit.
  let targetId = target?.mobility_entity_id ?? null;
  let targetType = target?.entity_type ?? null;

  // ---- UI report submit (valid) ----------------------------------------
  let reportId = null;
  await step('proxy-report-valid', async () => {
    assert.ok(
      targetId && targetType,
      'no canonical dependency for report target',
    );
    await pageA.getByRole('button', { name: 'Gangguan', exact: true }).click();
    await pageA
      .getByLabel('Lokasi atau layanan pada sisa perjalanan')
      .selectOption({ index: 1 });
    await pageA.getByLabel('Waktu kejadian (WIB)').fill('2026-10-02T08:04');
    await pageA.getByLabel('Keterangan').fill(`M5 acceptance ${randomUUID()}`);
    const submitWait = pageA.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/passenger-reports') &&
        r.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await pageA.getByRole('button', { name: 'Kirim laporan' }).click();
    const submitted = await submitWait;
    const payload = await submitted.json().catch(() => null);
    assert.equal(
      submitted.status(),
      201,
      `report ${submitted.status()} ${JSON.stringify(payload?.error ?? payload).slice(0, 400)}`,
    );
    const report = envelopeData(payload);
    assert.ok(report?.report_id, 'report_id missing');
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
    reportId = report.report_id;
    if (report.mobility_entity_id || report.entity_type) {
      targetId = report.mobility_entity_id ?? targetId;
      targetType = report.entity_type ?? targetType;
    } else {
      const reread = await proxyVia(contextA, `passenger-reports/${reportId}`);
      const stored = envelopeData(reread.body);
      assert.ok(stored?.mobility_entity_id, 'stored report target missing');
      targetId = stored.mobility_entity_id;
      targetType = stored.entity_type;
    }
    return `${reportId.slice(0, 8)} unverified`;
  });

  await step('invalid-report-rejected', async () => {
    const invalid = await proxyVia(contextA, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      data: {
        active_journey_id: journeyAId,
        category: 'NOT_A_CATEGORY',
        observed_at: 'not-a-time',
        mobility_entity_id: targetId,
        entity_type: targetType,
        description: '',
      },
    });
    assert.ok(
      [400, 422].includes(invalid.status),
      `invalid expected 400/422 got ${invalid.status}`,
    );
    return `${invalid.status}`;
  });

  await step('refresh-status', async () => {
    assert.ok(reportId, 'blocked: report not submitted');
    const refreshWait = pageA.waitForResponse(
      (r) =>
        r.url().includes(`/api/passenger/passenger-reports/${reportId}`) &&
        r.request().method() === 'GET',
      { timeout: 30_000 },
    );
    await pageA
      .getByRole('button', { name: /Muat ulang status/ })
      .first()
      .click();
    const refreshed = await refreshWait;
    assert.equal(refreshed.status(), 200, `refresh ${refreshed.status()}`);
    const report = envelopeData(await refreshed.json().catch(() => null));
    assert.equal(report.report_id, reportId);
    return report.verification_status;
  });

  await step('idempotency-replay-conflict', async () => {
    const key = randomUUID();
    const payload = {
      active_journey_id: journeyAId,
      category: 'SERVICE',
      observed_at: '2026-10-02T01:05:00Z',
      mobility_entity_id: targetId,
      entity_type: targetType,
      description: `idem ${randomUUID()}`,
    };
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': key,
    };
    const first = await proxyVia(contextA, 'passenger-reports', {
      method: 'POST',
      headers,
      data: payload,
    });
    assert.equal(
      first.status,
      201,
      `first ${first.status} ${JSON.stringify(first.body?.error ?? first.body).slice(0, 300)}`,
    );
    const firstId = envelopeData(first.body)?.report_id;
    const replay = await proxyVia(contextA, 'passenger-reports', {
      method: 'POST',
      headers,
      data: payload,
    });
    assert.equal(replay.status, 201, `replay ${replay.status}`);
    assert.equal(
      envelopeData(replay.body)?.report_id,
      firstId,
      'replay returned a different report',
    );
    const conflict = await proxyVia(contextA, 'passenger-reports', {
      method: 'POST',
      headers,
      data: { ...payload, description: `different ${randomUUID()}` },
    });
    assert.equal(conflict.status, 409, `conflict ${conflict.status}`);
    return `replay ${firstId.slice(0, 8)} + 409`;
  });

  await step('cross-context-report-isolation', async () => {
    assert.ok(reportId, 'blocked: report not submitted');
    const isolated = await proxyVia(contextB, `passenger-reports/${reportId}`);
    assert.ok(
      [403, 404].includes(isolated.status),
      `cross-context got ${isolated.status}`,
    );
    return `${isolated.status}`;
  });

  await step('proxy-controlled-403', async () => {
    assert.ok(reportId, 'blocked: report not submitted');
    const controlled = await proxyVia(
      contextA,
      `controlled/passenger-reports/${reportId}/verify`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        data: {
          operational_state: 'DISRUPTED',
          incident_type: 'SERVICE_SUSPENSION',
          reason: 'proxy must not expose controlled review',
        },
      },
    );
    assert.equal(
      controlled.status,
      403,
      `expected proxy 403 for verify got ${controlled.status}`,
    );
    const proxyClose = await proxyVia(
      contextA,
      `controlled/passenger-reports/${reportId}/close`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        data: {
          decision: 'RESOLVED',
          reason: 'proxy must not expose controlled close',
        },
      },
    );
    assert.equal(
      proxyClose.status,
      403,
      `expected proxy 403 for close got ${proxyClose.status}`,
    );
    return '403';
  });

  for (const [name, token] of [
    ['direct-missing-service-token', undefined],
    ['direct-wrong-service-token', 'x'.repeat(64)],
  ]) {
    await step(name, async () => {
      const headers = {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      };
      if (token !== undefined) headers['x-passenger-service-token'] = token;
      if (ownerA) headers['x-journey-owner'] = ownerA;
      const result = await direct('passenger-reports', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          active_journey_id: journeyAId,
          category: 'SERVICE',
          observed_at: '2026-10-02T08:05:00+07:00',
          mobility_entity_id: targetId,
          entity_type: targetType,
          description: 'negative',
        }),
      });
      assert.equal(result.status, 401, `expected 401 got ${result.status}`);
      return result.body?.error?.code ?? '401';
    });
  }

  for (const [name, auth] of [
    ['reviewer-missing-token', undefined],
    ['reviewer-wrong-token', `Bearer ${'y'.repeat(64)}`],
  ]) {
    await step(name, async () => {
      const headers = {
        'content-type': 'application/json',
        'x-controlled-reviewer': reviewerRef,
      };
      if (auth) headers.authorization = auth;
      const result = await direct(
        `controlled/passenger-reports/${reportId ?? randomUUID()}/verify`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            operational_state: 'DISRUPTED',
            incident_type: incidentTypeFor(targetType),
            reason: name,
          }),
        },
      );
      assert.equal(result.status, 401, `expected 401 got ${result.status}`);
      return result.body?.error?.code ?? '401';
    });
  }

  for (const [name, auth] of [
    ['reviewer-close-missing-token', undefined],
    ['reviewer-close-wrong-token', `Bearer ${'y'.repeat(64)}`],
  ]) {
    await step(name, async () => {
      const headers = {
        'content-type': 'application/json',
        'x-controlled-reviewer': reviewerRef,
      };
      if (auth) headers.authorization = auth;
      const result = await direct(
        `controlled/passenger-reports/${reportId ?? randomUUID()}/close`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ decision: 'RESOLVED', reason: name }),
        },
      );
      assert.equal(result.status, 401, `expected 401 got ${result.status}`);
      return result.body?.error?.code ?? '401';
    });
  }

  // Controlled review is the only source of the relevant SIMULATED alert; no separate injector.
  // The network entity may already carry the same state from an earlier run: without a
  // state change there is no transition and therefore no new fan-out, so pick a
  // contrasting state relative to the currently projected entity state.
  let reviewedAlertEntity = null;
  if (reviewEnabled && reportId) {
    await step('reviewer-authorized-controlled-verify', async () => {
      const current = await direct(`network/entities/${targetId}`);
      const projected = envelopeData(current.body)?.availability ?? null;
      const state = projected === 'DISRUPTED' ? 'UNAVAILABLE' : 'DISRUPTED';
      const result = await direct(
        `controlled/passenger-reports/${reportId}/verify`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${reviewerToken}`,
            'x-controlled-reviewer': reviewerRef,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operational_state: state,
            incident_type: incidentTypeFor(targetType),
            reason: `M5 authorized verify ${reportId}`,
          }),
        },
      );
      assert.equal(
        result.status,
        201,
        `verify ${result.status} ${JSON.stringify(result.body?.error ?? result.body).slice(0, 400)}`,
      );
      const review = envelopeData(result.body);
      assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
      reviewedAlertEntity = targetId;
      return `incident ${String(review.incident_id).slice(0, 8)} target ${String(targetId).slice(0, 8)} projected ${projected} asserted ${state}`;
    });

    await step('review-generated-alert-simulated-relevant', async () => {
      const alerts = await proxyVia(contextA, `journeys/${journeyAId}/alerts`);
      assert.equal(alerts.status, 200, `alerts ${alerts.status}`);
      const list = envelopeData(alerts.body) ?? [];
      const alert = list.find(
        (item) => item.mobility_entity_id === reviewedAlertEntity,
      );
      assert.ok(
        alert,
        `no alert for the reviewed dependency ${reviewedAlertEntity} (alerts: ${list.map((item) => item.mobility_entity_id).join(',') || 'none'})`,
      );
      assert.equal(
        alert.evidence_type,
        'SIMULATED',
        `evidence_type ${alert.evidence_type}`,
      );
      assert.ok(
        Array.isArray(alert.affected_segment_sequences) &&
          alert.affected_segment_sequences.length > 0,
        'alert does not affect a remaining dependency segment',
      );
      const fresh = await proxyVia(contextA, `journeys/${journeyAId}`);
      const segments =
        envelopeData(fresh.body)?.segments ??
        envelopeData(journeyAData.body)?.segments ??
        [];
      const remaining = segments.some((segment) =>
        alert.affected_segment_sequences.includes(segment.sequence),
      );
      assert.ok(
        remaining,
        'affected segments are not part of the active journey',
      );
      return `SIMULATED ${alert.operational_state}`;
    });

    await step('unrelated-context-alert-isolation', async () => {
      const alerts = await proxyVia(contextB, `journeys/${journeyBId}/alerts`);
      assert.equal(alerts.status, 200, `alerts ${alerts.status}`);
      const list = envelopeData(alerts.body) ?? [];
      assert.equal(
        list.filter((item) => item.mobility_entity_id === reviewedAlertEntity)
          .length,
        0,
        'unrelated journey received the reviewed-department alert',
      );
      return 'no reviewed alert on context B';
    });

    await step('controlled-close-releases-blocking-state', async () => {
      const result = await direct(
        `controlled/passenger-reports/${reportId}/close`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${reviewerToken}`,
            'x-controlled-reviewer': reviewerRef,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'RESOLVED',
            reason: `M5 acceptance close ${reportId}`,
          }),
        },
      );
      assert.equal(
        result.status,
        201,
        `close ${result.status} ${JSON.stringify(result.body?.error ?? result.body).slice(0, 400)}`,
      );
      const closed = envelopeData(result.body);
      assert.equal(
        closed.lifecycle_status,
        'RESOLVED',
        `lifecycle ${closed.lifecycle_status}`,
      );
      const entity = await direct(`network/entities/${reviewedAlertEntity}`);
      const projected = envelopeData(entity.body)?.availability ?? null;
      assert.ok(
        !['DISRUPTED', 'UNAVAILABLE'].includes(projected),
        `resolved controlled evidence still projects ${projected}`,
      );
      return `RESOLVED projected ${projected}`;
    });
  } else {
    mark(
      'reviewer-authorized-controlled-verify',
      'NOT_VERIFIED',
      'CONTROLLED_REVIEW_ENABLED != true or token unavailable',
    );
    mark(
      'review-generated-alert-simulated-relevant',
      'NOT_VERIFIED',
      'requires authorized controlled verify',
    );
    mark(
      'unrelated-context-alert-isolation',
      'NOT_VERIFIED',
      'requires authorized controlled verify',
    );
    mark(
      'controlled-close-releases-blocking-state',
      'NOT_VERIFIED',
      'requires authorized controlled verify',
    );
  }

  await step('page-reload-persistence', async () => {
    assert.ok(journeyAId && ownerA, 'blocked: no active journey/owner');
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30_000 });
    const stored = await pageA.evaluate(() =>
      localStorage.getItem('transumin.passenger.journey'),
    );
    assert.equal(
      stored,
      journeyAId,
      'active journey id not restored from localStorage',
    );
    assert.equal(
      await ownerFromCookie(contextA),
      ownerA,
      'server-derived owner changed after reload',
    );
    if (reportId) {
      const fetched = await proxyVia(contextA, `passenger-reports/${reportId}`);
      assert.equal(
        fetched.status,
        200,
        `report not retrievable after reload: ${fetched.status}`,
      );
    }
    return 'active journey + owner + report persisted';
  });

  await step('sse-reconnect', async () => {
    await pageA.route('**/api/passenger/journeys/*/alerts/stream', (route) =>
      route.abort(),
    );
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA
      .getByText(/Reconnecting to journey updates/)
      .waitFor({ timeout: 45_000 });
    await pageA.unroute('**/api/passenger/journeys/*/alerts/stream');
    await pageA
      .getByText(/Connected to journey-specific updates/)
      .waitFor({ timeout: 60_000 });
    return 'abort -> reconnecting -> connected';
  });

  const failed = cases.filter((item) => item.verdict === 'FAIL');
  const incomplete = cases.filter((item) => item.verdict === 'NOT_VERIFIED');
  const status =
    failed.length > 0
      ? 'FAIL'
      : incomplete.length > 0
        ? 'NOT_VERIFIED'
        : 'PASS';
  console.log(
    JSON.stringify({
      status,
      cases,
      evidence: `real Playwright two-context execution through ${web} proxy and direct API ${api}; server-derived HttpOnly cookie contexts; controlled review is the only alert source`,
    }),
  );
  process.exitCode = status === 'PASS' ? 0 : 1;
} catch (error) {
  mark(
    'harness',
    'FAIL',
    (error instanceof Error ? error.message : String(error)).slice(0, 700),
  );
  console.log(
    JSON.stringify({
      status: 'FAIL',
      cases,
      failure: (error instanceof Error ? error.message : String(error)).slice(
        0,
        2000,
      ),
    }),
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
