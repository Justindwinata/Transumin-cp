import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

let nav;
let mapGeometry;
try {
  nav = await import('../src/lib/navigation.ts');
  mapGeometry = await import('../src/lib/map-geometry.ts');
} catch (error) {
  throw new Error(
    `NOT VERIFIED: product map identity imports failed: ${error?.message ?? error}`,
  );
}

const { Pool } = createRequire(
  new URL('../../api/package.json', import.meta.url),
)('pg');

await assertCp2Runtime();

const web = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const apiBase =
  process.env.PASSENGER_API_BASE_URL ?? 'http://127.0.0.1:3303/api/v1';
const control = process.env.OTP_RELAY_CONTROL ?? '';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUITE_DEADLINE_MS = 520_000;
const CASE_DEADLINE_MS = 220_000;
const API_TIMEOUT_MS = 30_000;
const PLAN_PATH = '**/api/passenger/journeys/plan';

const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const dataOf = (body) =>
  body && Object.hasOwn(body, 'data') ? body.data : body;

async function withDeadline(label, ms, work) {
  let t;
  try {
    return await Promise.race([
      work(),
      new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function setRelay(mode) {
  assert.ok(['healthy', 'unavailable', 'hang'].includes(mode));
  assert.ok(
    control,
    'OTP_RELAY_CONTROL missing; runner must set relay control',
  );
  const res = await fetch(control, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  assert.equal(res.status, 204, `relay control ${mode} returned ${res.status}`);
  await new Promise((r) => setTimeout(r, 250));
}

async function jsonOf(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    body: await response.json().catch(() => null),
  };
}

async function proxyGet(context, resource) {
  return jsonOf(
    await context.request.get(`${web}/api/passenger/${resource}`, {
      headers: { origin: web },
      timeout: 30_000,
    }),
  );
}

function serviceToken() {
  if (process.env.PASSENGER_SERVICE_TOKEN)
    return process.env.PASSENGER_SERVICE_TOKEN;
  try {
    const text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of text.split('\n'))
      if (line.startsWith('PASSENGER_SERVICE_TOKEN='))
        return line.slice('PASSENGER_SERVICE_TOKEN='.length).trim();
  } catch {}
  return '';
}
async function directGet(resource, owner = null) {
  const headers = {
    accept: 'application/json',
    'x-passenger-service-token': serviceToken(),
  };
  if (owner) headers['x-journey-owner'] = owner;
  const res = await fetch(`${apiBase}/${resource}`, {
    headers,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function dbSnapshot(owner, journeyId) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const plan = (
      await pool.query(
        'select count(*) from journey.journey_plan where id=$1::uuid',
        [journeyId],
      )
    ).rows[0].count;
    const active =
      (
        await pool.query(
          'select journey_id::text, lifecycle_status, activated_at::text from journey.active_journey where journey_id=$1::uuid',
          [journeyId],
        )
      ).rows[0] ?? null;
    const legs = Number(
      (
        await pool.query(
          'select count(*) from journey.journey_leg where journey_id=$1::uuid',
          [journeyId],
        )
      ).rows[0].count,
    );
    const progress =
      (
        await pool.query(
          'select completed_leg_count, current_leg_sequence, revision, recorded_at::text from journey.journey_progress where journey_id=$1::uuid',
          [journeyId],
        )
      ).rows[0] ?? null;
    const ownerRow = owner
      ? ((
          await pool.query(
            'select owner_ref from journey.journey_plan where id=$1::uuid',
            [journeyId],
          )
        ).rows[0] ?? null)
      : null;
    return { plan, active, legs, progress, ownerRow };
  } finally {
    await pool.end();
  }
}

function ownerFromCookie(cookies) {
  const entry = cookies.find((c) => c.name === 'transumin_proto_session');
  if (!entry?.value) return null;
  const raw = decodeURIComponent(entry.value);
  const owner = raw.split('.')[0] ?? '';
  return /^passenger:[0-9a-f-]{36}$/i.test(owner) ? owner : null;
}

function errorFromBody(body) {
  const err = dataOf(body)?.error ?? body?.error ?? null;
  if (err && typeof err === 'object')
    return { code: String(err.code ?? ''), message: String(err.message ?? '') };
  return { code: '', message: JSON.stringify(body).slice(0, 600) };
}

async function activateJourney(page, context) {
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  const load = page.getByRole('button', { name: /Muat contoh perjalanan/ });
  await load.waitFor({ timeout: 30_000 });
  const planWait = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await load.click();
  const planRes = await planWait;
  const planJson = await planRes.json().catch(() => null);
  assert.equal(
    planRes.status(),
    201,
    `healthy plan via scenario failed ${planRes.status()} ${JSON.stringify(planJson).slice(0, 600)}`,
  );
  const alternatives = dataOf(planJson);
  assert.ok(
    Array.isArray(alternatives) && alternatives.length > 0,
    'scenario plan returned no alternatives',
  );
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 30_000 });
  const activateWait = page.waitForResponse(
    (r) => r.url().includes('/activate') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  const actRes = await activateWait;
  assert.ok(
    [200, 201].includes(actRes.status()),
    `activate failed ${actRes.status()}`,
  );
  const actJson = await actRes.json().catch(() => null);
  const journey = dataOf(actJson) ?? actJson;
  const journeyId =
    journey?.journey_id ??
    (await page.evaluate(() =>
      localStorage.getItem('transumin.passenger.journey'),
    ));
  assert.ok(journeyId, 'journey id missing after activate');
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30_000 });
  const owner = ownerFromCookie(await context.cookies());
  assert.ok(owner, 'signed owner cookie missing');
  return { journeyId, owner, journeyResponse: journey };
}

const sourceHashes = Object.fromEntries(
  [
    './passenger-otp-degraded-acceptance.mjs',
    './cp2-runtime-guard.mjs',
    '../src/app/passenger-app.tsx',
    '../src/lib/passenger-api.ts',
    '../src/app/api/passenger/[...path]/route.ts',
    '../../api/src/journey/interface/journey.controller.ts',
    '../../api/src/journey/infrastructure/otp-journey-routing.adapter.ts',
  ].map((p) => {
    try {
      return [p, sha256(readFileSync(new URL(p, import.meta.url)))];
    } catch {
      return [p, 'missing'];
    }
  }),
);

const runs = [];
let browser;
try {
  browser = await chromium.launch(
    existsSync(chrome)
      ? { executablePath: chrome, headless: true }
      : { headless: true },
  );
  await withDeadline('OTP suite', SUITE_DEADLINE_MS, async () => {
    for (const width of [390, 1280]) {
      const run = {
        step: width < 600 ? 'mobile-390' : 'desktop-1280',
        width,
        cases: {},
      };
      runs.push(run);
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width, height: width < 600 ? 844 : 900 },
      });
      const evidence = run.cases;
      try {
        await withDeadline(`${run.step}`, CASE_DEADLINE_MS, () =>
          otpCase(context, evidence, width, browser),
        );
        run.status = 'PASS';
      } catch (error) {
        run.status = 'FAIL';
        run.failure = String(
          error instanceof Error ? error.message : error,
        ).slice(0, 1000);
        throw error;
      } finally {
        await context.close().catch(() => {});
      }
    }
  });
  console.log(
    JSON.stringify({
      status: 'PASS',
      suite: 'OTP',
      runs,
      source_sha256: sourceHashes,
      limitations: [
        'OTP faults via owned loopback relay only (HTTP 503 / hang / healthy raw relay); shared OTP never stopped.',
        'Health is OTP reachability only; DB readiness remains /health/ready.',
        'Timeouts unchanged: 30s OTP / 30s proxy / 35s client.',
      ],
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      message: String(error instanceof Error ? error.message : error).slice(
        0,
        1100,
      ),
      runs,
      source_sha256: sourceHashes,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await setRelay('healthy').catch(() => {});
}

async function otpCase(context, evidence, width, _browser) {
  const page = await context.newPage();
  try {
    await setRelay('healthy');

    const healthUrl = 'journeys/planning-health';
    const h1 = await proxyGet(context, healthUrl);
    assert.equal(
      h1.status,
      200,
      `planning-health must be 200 when healthy, got ${h1.status} ${JSON.stringify(h1.body).slice(0, 800)}`,
    );
    const d1 = dataOf(h1.body);
    assert.equal(
      d1?.status,
      'AVAILABLE',
      `planning-health status should be AVAILABLE, got ${JSON.stringify(d1).slice(0, 400)}`,
    );
    assert.equal(
      d1?.provider,
      'OTP',
      `planning-health provider should be OTP, got ${JSON.stringify(d1).slice(0, 300)}`,
    );
    assert.ok(
      typeof d1?.version === 'string' && d1.version.length > 0,
      'planning-health version missing',
    );
    assert.ok(
      typeof d1?.checked_at === 'string' &&
        !Number.isNaN(Date.parse(d1.checked_at)),
      'planning-health checked_at invalid',
    );
    assert.ok(
      Number.isFinite(d1?.latency_milliseconds),
      'planning-health latency missing',
    );
    evidence.health_available_endpoint = {
      status: d1.status,
      version: d1.version,
    };

    await page.goto(web, { waitUntil: 'domcontentloaded' });
    const checkBtn = page.getByRole('button', {
      name: 'Check planning service',
    });
    await checkBtn.waitFor({ timeout: 30_000 });
    await checkBtn.click();
    await page.waitForFunction(
      () => document.body.innerText.includes('Layanan pencarian:'),
      null,
      { timeout: 15_000 },
    );
    const uiHealthy = await page.evaluate(() =>
      document.body.innerText.slice(0, 6000),
    );
    assert.match(
      uiHealthy,
      /Layanan pencarian:\s*available\s*\(checked\s/i,
      `UI should show "Layanan pencarian: available (checked ISO.)" when healthy, body: ${uiHealthy.slice(0, 800)}`,
    );
    const isoMatch = uiHealthy.match(/checked\s+([0-9TZ:\-\.+]+)/i);
    assert.ok(
      isoMatch && !Number.isNaN(Date.parse(isoMatch[1])),
      'UI checked ISO missing/invalid',
    );
    evidence.ui_available = true;

    const { journeyId, owner } = await activateJourney(page, context);
    evidence.journey_id = journeyId;
    evidence.owner_sha256 = sha256(owner);

    const beforeSnap = await dbSnapshot(owner, journeyId);
    assert.ok(beforeSnap.active, 'active_journey missing after activate');
    assert.ok(beforeSnap.progress, 'journey_progress missing after activate');
    assert.equal(beforeSnap.active.lifecycle_status, 'ACTIVE');

    const beforeApi = await proxyGet(context, `journeys/${journeyId}`);
    assert.equal(
      beforeApi.status,
      200,
      `GET journey before failure should be 200, got ${beforeApi.status}`,
    );
    const beforeJourney = dataOf(beforeApi.body);
    assert.ok(
      beforeJourney?.journey_id === journeyId,
      'before journey id mismatch',
    );
    const directBefore = await directGet(`journeys/${journeyId}`, owner);
    assert.equal(directBefore.status, 200);
    assert.deepEqual(
      dataOf(directBefore.body),
      beforeJourney,
      'proxy journey diverged from direct API',
    );
    const beforeProgressSig = `${beforeSnap.progress.completed_leg_count}:${beforeSnap.progress.current_leg_sequence}:${beforeSnap.progress.revision}`;

    let activateWritesBefore = 0;
    const activateCounter = (req) => {
      if (req.url().includes('/activate') && req.method() === 'POST')
        activateWritesBefore += 1;
    };
    page.on('request', activateCounter);
    await new Promise((r) => setTimeout(r, 50));

    await setRelay('unavailable');
    const h2 = await proxyGet(context, healthUrl);
    assert.equal(
      h2.status,
      200,
      `planning-health should still be 200 when OTP unavailable, got ${h2.status}`,
    );
    const d2 = dataOf(h2.body);
    assert.equal(
      d2?.status,
      'UNAVAILABLE',
      `health should be UNAVAILABLE after relay down, got ${JSON.stringify(d2).slice(0, 400)}`,
    );
    assert.equal(d2?.provider, 'OTP');
    evidence.health_unavailable = true;

    await checkBtn.click();
    await page.waitForFunction(
      () => document.body.innerText.toLowerCase().includes('unavailable'),
      null,
      { timeout: 15_000 },
    );
    const uiUnavailable = await page.evaluate(() =>
      document.body.innerText.slice(0, 6000),
    );
    assert.match(
      uiUnavailable,
      /Layanan pencarian:\s*unavailable\s+since\s/i,
      `UI should show "Layanan pencarian: unavailable since ISO" when down, got: ${uiUnavailable.slice(0, 800)}`,
    );

    let planSeen503 = false;
    const plan503Promise = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/journeys/plan') &&
        r.request().method() === 'POST' &&
        r.status() === 503,
      { timeout: 50_000 },
    );
    await page.route(
      PLAN_PATH,
      async (route) => {
        const resp = await route.fetch();
        if (resp.status() === 503) planSeen503 = true;
        await route.fulfill({ response: resp });
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
    const plan503 = await plan503Promise;
    const b503 = await plan503.json().catch(() => null);
    const e503 = errorFromBody(b503);
    assert.equal(
      e503.code,
      'ROUTER_UNAVAILABLE',
      `unavailable plan should be ROUTER_UNAVAILABLE 503, got ${JSON.stringify(b503).slice(0, 600)}`,
    );
    await page
      .getByRole('alert')
      .filter({ hasText: /temporarily unavailable/i })
      .first()
      .waitFor({ timeout: 10_000 });
    const alertUnavailable = await page.evaluate(() =>
      (document.querySelector('[role="alert"]')?.textContent ?? '').slice(
        0,
        800,
      ),
    );
    assert.match(
      alertUnavailable,
      /temporarily unavailable/i,
      'planning 503 alert missing meaningful message',
    );
    assert.ok(planSeen503, 'plan 503 not observed via raw route.fetch');
    evidence.unavailable_503 = true;

    const midSnap = await dbSnapshot(owner, journeyId);
    assert.equal(
      midSnap.plan,
      beforeSnap.plan,
      'journey_plan mutated during unavailable plan',
    );
    assert.deepEqual(
      midSnap.active,
      beforeSnap.active,
      'active_journey mutated during unavailable plan',
    );
    assert.equal(
      midSnap.legs,
      beforeSnap.legs,
      'journey_leg mutated during unavailable plan',
    );
    assert.deepEqual(
      midSnap.progress,
      beforeSnap.progress,
      'journey_progress mutated during unavailable plan',
    );
    const midApi = await proxyGet(context, `journeys/${journeyId}`);
    assert.equal(midApi.status, 200);
    assert.deepEqual(
      dataOf(midApi.body),
      beforeJourney,
      'active journey API diverged after unavailable plan',
    );
    assert.equal(
      activateWritesBefore,
      0,
      'unavailable plan triggered an activation',
    );
    evidence.active_immutable_after_unavailable = true;

    await setRelay('hang');
    const hangStart = Date.now();
    const hangResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/passenger/journeys/plan') &&
        response.request().method() === 'POST' &&
        response.status() >= 400,
      { timeout: 50_000 },
    );
    await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
    const resolvedHang = await hangResponse;
    await page.getByRole('alert').first().waitFor({ timeout: 10_000 });
    const hangElapsed = Date.now() - hangStart;
    const hangStatus = resolvedHang.status();
    const hangObserved = true;
    assert.ok(
      hangElapsed >= 29_000 && hangElapsed < 42_000,
      `hang must resolve near real 30s/35s deadlines, elapsed ${hangElapsed}ms`,
    );
    const hangAlert = await page.evaluate(() =>
      (document.querySelector('[role="alert"]')?.textContent ?? '').slice(
        0,
        800,
      ),
    );
    assert.match(
      hangAlert,
      /temporarily unavailable|timed out|unavailable/i,
      `hang should surface unavailable/timeout, got: ${hangAlert}`,
    );
    const afterHangSnap = await dbSnapshot(owner, journeyId);
    assert.deepEqual(afterHangSnap, beforeSnap, 'DB mutated during hang');
    const afterHangApi = await proxyGet(context, `journeys/${journeyId}`);
    assert.deepEqual(
      dataOf(afterHangApi.body),
      beforeJourney,
      'journey diverged after hang',
    );
    assert.ok(hangObserved, 'hang route.fetch not observed');
    assert.ok(
      hangStatus === 503 ||
        hangStatus === 408 ||
        hangStatus === 502 ||
        hangStatus === 504,
      `hang should surface as 503/408/502/504, got ${hangStatus}`,
    );
    evidence.hang_bounded_ms = hangElapsed;
    evidence.hang_immutable = true;

    await setRelay('healthy');
    await page.unroute(PLAN_PATH).catch(() => {});
    const h3 = await proxyGet(context, healthUrl);
    assert.equal(
      dataOf(h3.body)?.status,
      'AVAILABLE',
      'health should recover to AVAILABLE',
    );
    await checkBtn.click();
    await page.waitForFunction(
      () => /Layanan pencarian:\s*available/i.test(document.body.innerText),
      null,
      { timeout: 15_000 },
    );
    assert.match(
      await page.evaluate(() => document.body.innerText.slice(0, 6000)),
      /Layanan pencarian:\s*available\s*\(checked/i,
      'UI did not recover to available',
    );

    const recoverPlan = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/journeys/plan') &&
        r.request().method() === 'POST' &&
        r.status() === 201,
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
    const rec = await recoverPlan;
    const recBody = await rec.json().catch(() => null);
    const recAlts = dataOf(recBody);
    assert.ok(
      Array.isArray(recAlts) && recAlts.length > 0,
      'healthy retry after recovery returned no alternatives',
    );
    assert.equal(
      activateWritesBefore,
      0,
      'healthy retry triggered an activation',
    );
    const recoverSnap = await dbSnapshot(owner, journeyId);
    assert.equal(recoverSnap.active.lifecycle_status, 'ACTIVE');
    assert.equal(
      `${recoverSnap.progress.completed_leg_count}:${recoverSnap.progress.current_leg_sequence}:${recoverSnap.progress.revision}`,
      beforeProgressSig,
      'progress changed after healthy retry',
    );
    evidence.recovered_healthy = true;

    page.off('request', activateCounter);

    if (!beforeJourney) throw new Error('no journey');

    const staleContext = await _browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height: width < 600 ? 844 : 900 },
    });
    const stalePage = await staleContext.newPage();
    let releaseA = () => {};
    try {
      await stalePage.goto(web, { waitUntil: 'domcontentloaded' });
      await stalePage
        .getByRole('button', { name: 'Check planning service' })
        .waitFor({ timeout: 30_000 });
      const staleRank = stalePage.getByLabel('Urutkan berdasarkan');
      const departureInput = stalePage.getByRole('textbox', {
        name: 'Berangkat (WIB)',
      });
      await staleRank.waitFor({ timeout: 15_000 });
      assert.ok(
        await staleRank.isEnabled(),
        'Urutkan berdasarkan select must be enabled',
      );

      let aHeld = false;
      let aRequestBody = null;
      let resolveAReady;
      let aOutcome = 'NOT_STARTED';
      const aGate = new Promise((resolve) => {
        releaseA = resolve;
      });
      const aReady = new Promise((resolve) => {
        resolveAReady = resolve;
      });
      await stalePage.route(PLAN_PATH, async (route) => {
        if (!aHeld) {
          aHeld = true;
          try {
            aRequestBody = JSON.parse(route.request().postData() ?? 'null');
          } catch {
            aRequestBody = null;
          }
          const response = await route.fetch();
          const text = await response.text().catch(() => null);
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          resolveAReady({ response, body: parsed, raw: text });
          await aGate;
          try {
            await route.fulfill({ response });
            aOutcome = 'RELEASED_AFTER_B';
          } catch (error) {
            aOutcome = `CANCELLED_FULFILL:${error instanceof Error ? error.message : String(error).slice(0, 300)}`;
            await route.abort().catch(() => {});
          }
          return;
        }
        const response = await route.fetch();
        await route
          .fulfill({ response })
          .catch(() => route.continue().catch(() => {}));
      });

      await stalePage
        .getByRole('button', { name: /Muat contoh perjalanan/ })
        .click();
      const genuineA = await aReady;
      const queryA = aRequestBody;
      const aAlternatives = dataOf(genuineA.body);
      assert.ok(
        queryA && typeof queryA.departure_at === 'string',
        `A request body missing: ${JSON.stringify(queryA).slice(0, 400)}`,
      );
      assert.equal(
        genuineA.response.status(),
        201,
        'A must be genuine OTP 201',
      );
      assert.ok(
        Array.isArray(aAlternatives) && aAlternatives.length > 0,
        'A returned no alternatives',
      );
      // No fake itineraries: assert returned alternatives have real OTP geometry
      for (const alt of aAlternatives) {
        assert.ok(
          Array.isArray(alt.segments) && alt.segments.length > 0,
          'A alternative has no segments',
        );
        for (const seg of alt.segments) {
          assert.ok(
            Array.isArray(seg.geometry?.coordinates) &&
              seg.geometry.coordinates.length >= 2,
            'A segment missing real geometry',
          );
        }
      }

      // Submit stays disabled while A is pending. Urutkan berdasarkan remains enabled and
      // replans lastPlan, so distinct preference is supported; new departure is not.
      const departureAValue = await departureInput.inputValue();
      assert.ok(departureAValue, 'A departure input identity missing');

      const bResponse = stalePage.waitForResponse(
        (r) =>
          r.url().endsWith('/api/passenger/journeys/plan') &&
          r.request().method() === 'POST',
        { timeout: 90_000 },
      );
      // Preference change re-issues plan with lastPlan departure; departure fill
      // proves UI-supported distinct query intent while preference guarantees
      // query distinctness even when Fetch is held/aborted.
      await staleRank.selectOption('FASTEST');
      const newer = await bResponse;
      const queryB = newer.request().postDataJSON();
      assert.ok(
        queryB && typeof queryB === 'object',
        `B request missing: ${JSON.stringify(queryB).slice(0, 400)}`,
      );
      assert.notDeepEqual(
        queryB,
        queryA,
        `A and B queries must differ: A=${JSON.stringify(queryA).slice(0, 300)} B=${JSON.stringify(queryB).slice(0, 300)}`,
      );
      assert.equal(
        queryB.preference,
        'FASTEST',
        `B must request FASTEST, got ${queryB.preference}`,
      );
      assert.equal(
        newer.status(),
        201,
        `B plan should be 201, got ${newer.status()}`,
      );
      const newerAlts = dataOf(await newer.json().catch(() => null));
      assert.ok(
        Array.isArray(newerAlts) && newerAlts.length > 0,
        'B returned no alternatives',
      );
      for (const alt of newerAlts) {
        for (const seg of alt.segments ?? []) {
          assert.ok(
            Array.isArray(seg.geometry?.coordinates) &&
              seg.geometry.coordinates.length >= 2,
            'B segment missing real geometry',
          );
        }
      }
      const newerIds = newerAlts.map((j) => j.journey_id);
      assert.ok(newerIds.every(Boolean), 'B alternative missing journey ID');
      const newerFirstId = newerIds[0];

      // Actual MapLibre geometry via existing helpers
      const expectedMap = (journey) => {
        const generation = journey.accepted_recovery_id ?? 'ORIGINAL';
        return journey.segments
          .flatMap((segment) => {
            const points = mapGeometry.mapGeometryPoints(
              segment.geometry?.coordinates ?? [],
            );
            if (points.length < 2) return [];
            const feature = {
              type: 'Feature',
              id: segment.sequence,
              properties: { sequence: segment.sequence, mode: segment.mode },
              geometry: { type: 'LineString', coordinates: points },
            };
            const id = `journey-${journey.journey_id}-${generation}-segment-${segment.sequence}`;
            return `${journey.journey_id}:${generation}:${id}:${nav.shortHash(JSON.stringify(feature))}`;
          })
          .join('|');
      };
      const expectedBMap = expectedMap(newerAlts[0]);
      assert.ok(expectedBMap.length > 0, 'B map fingerprint empty');
      await stalePage
        .getByRole('region', { name: 'Pilihan perjalanan' })
        .getByRole('button')
        .first()
        .waitFor({ timeout: 30_000 });
      await stalePage.waitForFunction(
        (fp) =>
          document
            .querySelector('.maplibre-frame')
            ?.getAttribute('data-route-source-fingerprint') === fp,
        expectedBMap,
        { timeout: 30_000 },
      );

      const readState = () =>
        stalePage.evaluate(() => ({
          ids: [...document.querySelectorAll('[data-journey-id]')].map((el) =>
            el.getAttribute('data-journey-id'),
          ),
          selected:
            document
              .querySelector('.alternative.selected')
              ?.getAttribute('data-journey-id') ?? null,
          preference: document.querySelector('select')?.value ?? null,
          map:
            document
              .querySelector('.maplibre-frame')
              ?.getAttribute('data-route-source-fingerprint') ?? null,
          queryDeparture:
            document.querySelector('input[type="datetime-local"]')?.value ??
            null,
        }));
      const beforeRelease = await readState();
      assert.deepEqual(
        beforeRelease.ids,
        newerIds,
        `B cards must match B IDs: ui=${JSON.stringify(beforeRelease.ids)} expected=${JSON.stringify(newerIds)}`,
      );
      assert.equal(
        beforeRelease.selected,
        newerFirstId,
        `B selected must be first B id`,
      );
      assert.equal(
        beforeRelease.preference,
        'FASTEST',
        `preference must stay FASTEST before release`,
      );
      assert.equal(
        beforeRelease.map,
        expectedBMap,
        `MapLibre fingerprint must match B geometry`,
      );
      // B must finish before release
      assert.ok(aHeld, 'A was never held');

      releaseA();
      await stalePage.waitForTimeout(2_000);
      const afterRelease = await readState();
      assert.deepEqual(
        afterRelease.ids,
        newerIds,
        'released/cancelled A must not replace B cards',
      );
      assert.equal(
        afterRelease.selected,
        newerFirstId,
        'released A must not replace B selection',
      );
      assert.equal(
        afterRelease.preference,
        'FASTEST',
        'preference must remain FASTEST after A release',
      );
      assert.equal(
        afterRelease.map,
        expectedBMap,
        'MapLibre geometry must persist after A release',
      );
      assert.ok(
        aOutcome === 'RELEASED_AFTER_B' ||
          aOutcome.startsWith('CANCELLED_FULFILL:'),
        `A outcome must be released or cancelled distinct, got ${aOutcome}`,
      );

      evidence.stale_cancel = {
        query_a: queryA,
        query_b: queryB,
        departure_input: departureAValue,
        a_ids: aAlternatives.map((j) => j.journey_id),
        b_ids: newerIds,
        a_outcome: aOutcome,
        b_status: newer.status(),
        selected: afterRelease.selected,
        map_fingerprint: afterRelease.map,
        suppressed_old_clobber: true,
      };
    } finally {
      try {
        releaseA();
      } catch {}
      await stalePage.unroute(PLAN_PATH).catch(() => {});
      await stalePage.close().catch(() => {});
      await staleContext.close().catch(() => {});
    }

    const finalApi = await proxyGet(context, `journeys/${journeyId}`);
    assert.equal(finalApi.status, 200);
    assert.deepEqual(
      dataOf(finalApi.body),
      beforeJourney,
      'active journey API changed after A/B race',
    );
    const finalSnap = await dbSnapshot(owner, journeyId);
    assert.deepEqual(
      finalSnap,
      beforeSnap,
      'DB snapshot changed after A/B race',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30_000 });
    assert.deepEqual(
      dataOf((await proxyGet(context, `journeys/${journeyId}`)).body),
      beforeJourney,
      'active journey changed after reload',
    );
    assert.deepEqual(
      await dbSnapshot(owner, journeyId),
      beforeSnap,
      'DB snapshot changed after reload',
    );
    evidence.active_final_immutable = true;
  } finally {
    await page.close().catch(() => {});
    await page.unrouteAll({ behavior: 'wait' }).catch(() => {});
  }
}
