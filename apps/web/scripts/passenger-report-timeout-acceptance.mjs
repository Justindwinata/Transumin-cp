import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

const { Pool } = createRequire(
  new URL('../../api/package.json', import.meta.url),
)('pg');

// Fail closed: mutations may target only the owned CP2 scratch runtime.
await assertCp2Runtime();

const web = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLIENT_DEADLINE_FLOOR_MS = 34_000;
const HOLD_COMMITTED_MS = 40_000;
const CASE_DEADLINE_MS = 180_000;
const SUITE_DEADLINE_MS = 540_000;
const REPORT_PATH = '**/api/passenger/passenger-reports*';
const PENDING_PREFIX = 'transumin.passenger.report-pending';
const UNCERTAIN =
  /belum pasti|tidak valid|outcome is unknown|waktu habis|timed out/i;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function withDeadline(label, ms, work) {
  let timer;
  const started = Date.now();
  console.log(
    JSON.stringify({ checkpoint: label, state: 'START', deadline_ms: ms }),
  );
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    console.log(
      JSON.stringify({
        checkpoint: label,
        state: 'END',
        elapsed_ms: Date.now() - started,
      }),
    );
  }
}

function secret(name) {
  if (process.env[name]) return process.env[name];
  const env = readFileSync(
    fileURLToPath(new URL('../../.env', import.meta.url)),
    'utf8',
  );
  for (const line of env.split('\n'))
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  return '';
}
const sessionSecret = secret('PASSENGER_SESSION_SECRET');

function signSession(owner, expiresAt) {
  return createHmac('sha256', sessionSecret)
    .update(`${owner}.${expiresAt}`)
    .digest('base64url');
}

function ownerFromCookie(cookies) {
  const entry = cookies.find(
    (cookie) => cookie.name === 'transumin_proto_session',
  );
  if (!entry?.value) return null;
  const [owner, expiresAt, signature, ...extra] = decodeURIComponent(
    entry.value,
  ).split('.');
  if (extra.length || !owner || !/^\d+$/.test(expiresAt ?? '')) return null;
  return signature === signSession(owner, Number(expiresAt)) ? owner : null;
}

const data = (body) => (body && Object.hasOwn(body, 'data') ? body.data : body);
async function jsonOf(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    body: await response.json().catch(() => null),
  };
}
const submitBtn = (page) =>
  page.getByRole('button', { name: 'Kirim laporan', exact: true });
const reconcileBtn = (page) =>
  page.getByRole('button', { name: 'Periksa status laporan', exact: true });

const sourceHashes = Object.fromEntries(
  [
    './passenger-report-timeout-acceptance.mjs',
    './cp2-runtime-guard.mjs',
    '../src/app/passenger-app.tsx',
    '../src/lib/passenger-api.ts',
    '../src/app/api/passenger/[...path]/route.ts',
    '../../api/src/passenger-reporting/passenger-report.service.ts',
  ].map((path) => [path, sha256(readFileSync(new URL(path, import.meta.url)))]),
);
const runs = [];
let browser;
try {
  browser = await chromium.launch(
    existsSync(chrome)
      ? { executablePath: chrome, headless: true }
      : { headless: true },
  );
  await withDeadline('TIMEOUT suite', SUITE_DEADLINE_MS, async () => {
    for (const width of [390, 1280]) {
      const run = {
        step: width < 600 ? 'mobile-390' : 'desktop-1280',
        width,
        cases: {},
      };
      runs.push(run);
      for (const kind of [
        'before-contact',
        'committed-lost',
        'delayed-commit',
      ]) {
        const context = await browser.newContext({
          viewport: { width, height: width < 600 ? 844 : 900 },
        });
        const evidence = { status: 'RUNNING' };
        run.cases[kind] = evidence;
        try {
          await withDeadline(`${run.step}:${kind}`, CASE_DEADLINE_MS, () =>
            faultCase(browser, context, kind, evidence),
          );
          evidence.status = 'PASS';
        } catch (error) {
          evidence.status = 'FAIL';
          evidence.failure = String(
            error instanceof Error ? error.message : error,
          ).slice(0, 600);
          throw error;
        } finally {
          await context.close();
        }
      }

      const context = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 900 },
      });
      const evidence = { status: 'RUNNING' };
      run.cases['two-tab-lock-replay'] = evidence;
      try {
        await withDeadline(
          `${run.step}:two-tab-lock-replay`,
          CASE_DEADLINE_MS,
          () => twoTabCase(context, evidence),
        );
        evidence.status = 'PASS';
      } catch (error) {
        evidence.status = 'FAIL';
        evidence.failure = String(
          error instanceof Error ? error.message : error,
        ).slice(0, 600);
        throw error;
      } finally {
        await context.close();
      }
    }
  });
  console.log(
    JSON.stringify({
      status: 'PASS',
      suite: 'TIMEOUT',
      runs,
      source_sha256: sourceHashes,
      limitations: [
        'Route interception supplies transport faults only; every asserted commit uses real proxy, API, and scratch DB.',
        'Suite is serial; two-tab coverage uses one browser context and real Web Locks/storage events.',
        'Journey-switch, owner-session-change, and pending-expiry remain outside this focused transport suite.',
        'Browser client and proxy own real 35s/30s deadlines; interception never lowers product deadlines.',
      ],
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      message: String(error instanceof Error ? error.message : error).slice(
        0,
        900,
      ),
      runs,
      source_sha256: sourceHashes,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}

async function faultCase(browser, context, kind, evidence) {
  const page = await context.newPage();
  const posts = [];
  const lookups = [];
  const reportReads = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/api/passenger/passenger-reports')) return;
    if (request.method() === 'POST') {
      posts.push({
        body: request.postData() ?? '',
        key: request.headers()['idempotency-key'] ?? '',
      });
    } else if (request.method() === 'GET') {
      reportReads.push(url);
      if (url.searchParams.has('idempotency_key')) lookups.push(url);
    }
  });
  try {
    const { owner, journeyId } = await activateJourney(page, context);
    evidence.owner_sha256 = sha256(owner);
    evidence.journey_id = journeyId;
    const description = `CP2 TIMEOUT ${kind} ${randomUUID()}`;
    await fillReport(page, description);
    await submitBtn(page).waitFor({ state: 'visible', timeout: 30_000 });

    let backendStatus = null;
    let firstLookupWasNull = false;
    let heldPost = null;
    let releaseHeldPost;
    const heldPostDone = new Promise((resolve) => {
      releaseHeldPost = resolve;
    });
    await page.route(REPORT_PATH, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'POST') {
        if (kind === 'before-contact') return route.abort('failed');
        if (kind === 'committed-lost') {
          const forwarded = await route.fetch();
          backendStatus = forwarded.status();
          await new Promise((resolve) =>
            setTimeout(resolve, HOLD_COMMITTED_MS),
          );
          return route.abort('failed').catch(() => {});
        }
        heldPost = route;
        await heldPostDone;
        return;
      }
      if (
        kind === 'delayed-commit' &&
        request.method() === 'GET' &&
        url.searchParams.has('idempotency_key') &&
        !firstLookupWasNull
      ) {
        const nullLookup = await route.fetch();
        const nullBody = await nullLookup.text();
        assert.equal(nullLookup.status(), 200);
        assert.equal(
          data(JSON.parse(nullBody)),
          null,
          'first delayed lookup was not null',
        );
        firstLookupWasNull = true;
        await route.fulfill({ response: nullLookup, body: nullBody });
        assert.ok(heldPost, 'initial POST was not held');
        const committed = await heldPost.fetch();
        backendStatus = committed.status();
        await heldPost.abort('failed').catch(() => {});
        releaseHeldPost();
        return;
      }
      return route.continue();
    });

    const started = Date.now();
    await submitBtn(page).click();
    await waitUncertain(page);
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed >= CLIENT_DEADLINE_FLOOR_MS || kind === 'before-contact',
      `uncertainty did not use real client deadline (${elapsed}ms)`,
    );
    assert.equal(posts.length, 1, 'UI must issue exactly one report mutation');
    const sent = JSON.parse(posts[0].body);
    const key = posts[0].key;
    assert.match(key, /^[A-Za-z0-9._:-]{8,128}$/);
    assert.equal(sent.active_journey_id, journeyId);
    evidence.idempotency_key_sha256 = sha256(key);
    evidence.request_body_sha256 = sha256(posts[0].body);
    evidence.deadline_elapsed_ms = elapsed;

    const pendingStorageKey = `${PENDING_PREFIX}.${journeyId}`;
    await assertPending(page, pendingStorageKey, key, posts[0].body);
    assert.equal(await submitBtn(page).isDisabled(), true);
    assert.equal(await reconcileBtn(page).count(), 1);

    if (kind === 'committed-lost') {
      // Reload before any reconciliation. Startup must restore hashed pending
      // identity and keep mutation blocked.
      assert.equal(lookups.length, 0, 'lookup happened before required reload');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByRole('heading', { name: 'Perjalanan aktif Anda' })
        .waitFor({ timeout: 30_000 });
      await reconcileBtn(page).waitFor({ timeout: 30_000 });
      await assertPending(page, pendingStorageKey, key, posts[0].body);
      assert.equal(await submitBtn(page).isDisabled(), true);
      evidence.pending_restored_before_reconcile = true;
    }

    const mutationsBeforeReconcile = posts.length;
    const readsBeforeReconcile = reportReads.length;
    await reconcileBtn(page).click();
    if (kind === 'before-contact') {
      await page
        .getByRole('status')
        .filter({ hasText: /3x pemeriksaan|belum terlihat/i })
        .first()
        .waitFor({ timeout: 15_000 });
    } else {
      await page
        .getByRole('status')
        .filter({ hasText: /Laporan tersimpan/i })
        .first()
        .waitFor({ timeout: 20_000 });
    }
    assert.equal(
      posts.length,
      mutationsBeforeReconcile,
      'reconcile mutated report',
    );
    const reconcileReads = reportReads.slice(readsBeforeReconcile);
    assert.ok(
      reconcileReads.length >= 1,
      'no network-observed reconcile lookup',
    );
    assert.ok(
      reconcileReads.every((url) => url.searchParams.has('idempotency_key')),
      'reconcile used content/list fallback instead of key lookup',
    );
    assert.ok(lookups.length >= 1, 'no network-observed key lookup');
    for (const lookup of lookups) {
      assert.equal(lookup.searchParams.get('idempotency_key'), key);
      assert.equal(lookup.searchParams.has('active_journey_id'), false);
    }
    evidence.lookup_reads = lookups.length;
    evidence.first_lookup_null = firstLookupWasNull;

    const rows = await dbRows(owner, key);
    if (kind === 'before-contact') {
      assert.equal(backendStatus, null);
      assert.deepEqual(rows, []);
      await assertPending(page, pendingStorageKey, key, posts[0].body);
      assert.equal(
        await submitBtn(page).isDisabled(),
        true,
        'null reconciliation must retain unknown-outcome mutation guard',
      );
      evidence.pending_retained_after_null_reads = true;

      await page.unroute(REPORT_PATH);
      await page
        .getByRole('button', {
          name: 'Kirim ulang identitas yang sama',
          exact: true,
        })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: /Laporan tersimpan/i })
        .first()
        .waitFor({ timeout: 30_000 });
      assert.equal(
        posts.length,
        2,
        'safe replay did not issue exactly one POST',
      );
      assert.equal(posts[1].key, key, 'safe replay allocated a new key');
      assert.equal(posts[1].body, posts[0].body, 'safe replay changed payload');
      const replayRows = await dbRows(owner, key);
      assert.equal(
        replayRows.length,
        1,
        'safe replay owner+key did not commit exactly one row',
      );
      assert.equal(replayRows[0].owner_ref, owner);
      assert.equal(replayRows[0].idempotency_key, key);
      assert.equal(replayRows[0].active_journey_id, journeyId);
      assert.equal(replayRows[0].description, description);
      assert.equal(
        await page.evaluate(
          (storageKey) => localStorage.getItem(storageKey),
          pendingStorageKey,
        ),
        null,
        'safe replay did not clear pending storage',
      );
      evidence.safe_replay = {
        report_id: replayRows[0].id,
        posts: 1,
        original_key_preserved: true,
        payload_preserved: true,
        exact_rows: replayRows.length,
      };
      return;
    }

    assert.equal(backendStatus, 201, 'real POST did not commit');
    assert.equal(rows.length, 1, 'owner+key DB lookup did not return one row');
    const row = rows[0];
    assert.equal(row.owner_ref, owner);
    assert.equal(row.idempotency_key, key);
    assert.equal(row.active_journey_id, journeyId);
    assert.equal(row.description, description);
    assert.equal(row.source, 'PASSENGER_SELF_REPORT');
    assert.equal(row.verification_status, 'REPORTED_UNVERIFIED');

    const lookupResponse = await apiGet(
      context,
      `passenger-reports?idempotency_key=${encodeURIComponent(key)}`,
    );
    assert.equal(lookupResponse.status, 200);
    const found = data(lookupResponse.body);
    assert.ok(found, 'committed key lookup returned null');
    assert.equal(found.report_id, row.id);
    assert.equal(found.active_journey_id, journeyId);
    assert.equal(found.description, description);
    assert.equal(
      await page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        pendingStorageKey,
      ),
      null,
      'resolved pending storage was not cleared',
    );
    assert.equal(await reconcileBtn(page).count(), 0);
    evidence.report_id = row.id;
    evidence.pending_cleared = true;

    await assertApiContract(browser, context, {
      owner,
      journeyId,
      key,
      reportId: row.id,
      sent,
      evidence,
    });
  } finally {
    await page.unrouteAll({ behavior: 'wait' }).catch(() => {});
    await page.close();
  }
}

async function activateJourney(page, context) {
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  const load = page.getByRole('button', { name: /Muat contoh perjalanan/ });
  await load.waitFor({ timeout: 30_000 });
  const planWait = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await load.click();
  const plan = await jsonOf(await planWait);
  assert.equal(
    plan.status,
    201,
    `plan failed: ${JSON.stringify(plan.body).slice(0, 300)}`,
  );
  assert.ok(Array.isArray(data(plan.body)) && data(plan.body).length > 0);
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  const activateWait = page.waitForResponse(
    (response) =>
      response.url().includes('/activate') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  assert.ok([200, 201].includes((await activateWait).status()));
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30_000 });
  const owner = ownerFromCookie(await context.cookies());
  assert.ok(owner, 'signed HttpOnly owner missing');
  const journeyId = await page.evaluate(() =>
    localStorage.getItem('transumin.passenger.journey'),
  );
  assert.ok(journeyId, 'journey id missing');
  return { owner, journeyId };
}

async function assertPending(page, storageKey, key, rawBody) {
  const pending = await page.evaluate(
    (keyName) => JSON.parse(localStorage.getItem(keyName) ?? 'null'),
    storageKey,
  );
  assert.ok(pending, 'pending storage missing');
  assert.equal(pending.key, key);
  assert.equal(pending.fingerprint, `sha256:${sha256(rawBody)}`);
  assert.ok(Number.isFinite(pending.createdAt));
}

async function dbRows(owner, key) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return (
      await pool.query(
        `select id, owner_ref, active_journey_id, idempotency_key, description,
                verification_status, source, request_fingerprint
           from report.passenger_report
          where owner_ref = $1 and idempotency_key = $2`,
        [owner, key],
      )
    ).rows;
  } finally {
    await pool.end();
  }
}

async function assertApiContract(
  browser,
  context,
  { owner, journeyId, key, reportId, sent, evidence },
) {
  const secondKey = randomUUID();
  const second = await jsonOf(
    await context.request.post(`${web}/api/passenger/passenger-reports`, {
      headers: { origin: web, 'idempotency-key': secondKey },
      data: sent,
      timeout: 30_000,
    }),
  );
  assert.equal(second.status, 201, 'same content with different key failed');
  const secondReport = data(second.body);
  assert.notEqual(secondReport.report_id, reportId);
  const secondRows = await dbRows(owner, secondKey);
  assert.equal(secondRows.length, 1);
  assert.equal(secondRows[0].id, secondReport.report_id);
  assert.equal(secondRows[0].active_journey_id, journeyId);
  evidence.distinct_key_report_id = secondReport.report_id;
  evidence.distinct_key_sha256 = sha256(secondKey);

  const foreign = await browser.newContext();
  try {
    const wrongOwner = await apiGet(
      foreign,
      `passenger-reports?idempotency_key=${encodeURIComponent(key)}`,
    );
    assert.equal(wrongOwner.status, 200);
    assert.equal(data(wrongOwner.body), null, 'wrong owner saw report');
  } finally {
    await foreign.close();
  }

  assert.equal(
    (await apiGet(context, 'passenger-reports?idempotency_key=short')).status,
    400,
  );
  assert.equal((await apiGet(context, 'passenger-reports')).status, 400);

  const expired = await browser.newContext();
  try {
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    const value = `${owner}.${expiredAt}.${signSession(owner, expiredAt)}`;
    await expired.addCookies([
      { name: 'transumin_proto_session', value, url: web, httpOnly: true },
    ]);
    assert.equal(
      (
        await apiGet(
          expired,
          `passenger-reports?idempotency_key=${encodeURIComponent(key)}`,
        )
      ).status,
      403,
    );
  } finally {
    await expired.close();
  }

  const listed = await apiGet(
    context,
    `passenger-reports?active_journey_id=${encodeURIComponent(journeyId)}`,
  );
  assert.equal(listed.status, 200);
  const reports = data(listed.body);
  assert.ok(Array.isArray(reports));
  assert.ok(reports.some((report) => report.report_id === reportId));
  assert.ok(
    reports.some((report) => report.report_id === secondReport.report_id),
  );
  evidence.api_contract = {
    wrong_owner: 'null',
    invalid_key: 400,
    missing_key_and_journey: 400,
    expired_cookie: 403,
    list_compatible: true,
  };
}

async function apiGet(context, resource) {
  return jsonOf(
    await context.request.get(`${web}/api/passenger/${resource}`, {
      headers: { origin: web },
      timeout: 30_000,
    }),
  );
}

async function fillReport(page, description) {
  await page.getByRole('button', { name: 'Gangguan', exact: true }).click();
  await page
    .getByLabel('Lokasi atau layanan pada sisa perjalanan')
    .selectOption({ index: 1 });
  await page.getByLabel('Waktu kejadian (WIB)').fill('2026-10-02T08:04');
  await page.getByLabel('Keterangan').fill(description);
}

async function waitUncertain(page) {
  try {
    await page
      .getByRole('alert')
      .filter({ hasText: UNCERTAIN })
      .first()
      .waitFor({ timeout: 60_000 });
  } catch {
    const text = await page
      .evaluate(() => document.body.innerText.slice(0, 1200))
      .catch(() => '<unavailable>');
    throw new Error(
      `no report-uncertainty alert; body: ${text.replace(/\s+/g, ' ')}`,
    );
  }
}

async function twoTabCase(context, evidence) {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const posts = [];
  const attachCollector = (page, label) => {
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/api/passenger/passenger-reports')) return;
      if (request.method() === 'POST') {
        posts.push({
          label,
          body: request.postData() ?? '',
          key: request.headers()['idempotency-key'] ?? '',
        });
      }
    });
  };
  attachCollector(pageA, 'A');
  attachCollector(pageB, 'B');
  try {
    const { owner, journeyId } = await activateJourney(pageA, context);
    evidence.owner_sha256 = sha256(owner);
    evidence.journey_id = journeyId;
    await pageB.goto(web, { waitUntil: 'domcontentloaded' });
    await pageB
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30_000 });
    const journeyB = await pageB.evaluate(() =>
      localStorage.getItem('transumin.passenger.journey'),
    );
    assert.equal(journeyB, journeyId, 'two-tab same-context journey diverged');
    const descA = `CP2 TIMEOUT two-tab ${randomUUID()}`;
    await fillReport(pageA, descA);
    await fillReport(pageB, descA);
    await submitBtn(pageA).waitFor({ state: 'visible', timeout: 30_000 });
    await submitBtn(pageB).waitFor({ state: 'visible', timeout: 30_000 });
    const pendingKey = `${PENDING_PREFIX}.${journeyId}`;
    // Hold both real POST responses. This exposes native lock allocation and
    // shared-storage convergence before either tab can clear pending identity.
    const held = [];
    const holdPost = async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      held.push(route);
    };
    await pageA.route(REPORT_PATH, holdPost);
    await pageB.route(REPORT_PATH, holdPost);
    await Promise.all([submitBtn(pageA).click(), submitBtn(pageB).click()]);
    await withDeadline('both tab POSTs', 10_000, async () => {
      while (held.length !== 2) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    await Promise.all(held.map((route) => route.continue()));
    await Promise.all([
      pageA
        .getByRole('status')
        .filter({ hasText: /Laporan tersimpan/i })
        .first()
        .waitFor({ timeout: 40_000 }),
      pageB
        .getByRole('status')
        .filter({ hasText: /Laporan tersimpan/i })
        .first()
        .waitFor({ timeout: 40_000 }),
    ]);
    assert.ok(posts.length >= 1, 'two-tab produced no POST');
    const keys = [...new Set(posts.map((p) => p.key).filter(Boolean))];
    assert.equal(
      keys.length,
      1,
      `two-tab Web Locks did not converge: ${keys.join(',')}`,
    );
    const key = keys[0];
    assert.match(key, /^[A-Za-z0-9._:-]{8,128}$/);
    const bodies = [...new Set(posts.map((p) => p.body))];
    assert.equal(bodies.length, 1, 'two-tab logical payload diverged');
    assert.equal(JSON.parse(bodies[0]).description, descA);
    const rows = await dbRows(owner, key);
    assert.equal(rows.length, 1, 'two-tab owner+key DB did not return one row');
    assert.equal(rows[0].description, descA);
    assert.equal(rows[0].active_journey_id, journeyId);
    const lookupA = await apiGet(
      context,
      `passenger-reports?idempotency_key=${encodeURIComponent(key)}`,
    );
    assert.equal(lookupA.status, 200);
    assert.equal(data(lookupA.body)?.report_id, rows[0].id);
    // Both tabs should show same report id in status text
    const statusA = await pageA
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .innerText();
    const statusB = await pageB
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .innerText();
    const uuidRe =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const idA = statusA.match(uuidRe)?.[0] ?? '';
    const idB = statusB.match(uuidRe)?.[0] ?? '';
    assert.equal(idA, rows[0].id, 'tab A report id diverged from DB');
    assert.equal(idB, rows[0].id, 'tab B report id diverged from DB');
    assert.equal(
      await pageA.evaluate((k) => localStorage.getItem(k), pendingKey),
      null,
      'tab A pending not cleared after converge',
    );
    assert.equal(
      await pageB.evaluate((k) => localStorage.getItem(k), pendingKey),
      null,
      'tab B pending not cleared after converge',
    );
    await pageA.unroute(REPORT_PATH);
    await pageB.unroute(REPORT_PATH);
    evidence.two_tab_contention = {
      idempotency_key_sha256: sha256(key),
      request_body_sha256: sha256(bodies[0]),
      posts: posts.length,
      same_key: true,
      report_id: rows[0].id,
      ids_converge: idA === idB && idA === rows[0].id,
      db_exact_rows: rows.length,
    };

    // Storage-event convergence: fault pageA, observe event in pageB, replay in A clears, B rechecks
    const descB = `CP2 TIMEOUT two-tab-storage ${randomUUID()}`;
    posts.length = 0;
    await fillReport(pageA, descB);
    await fillReport(pageB, descB);
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30_000 });
    let abortPosts = [];
    await pageA.route(REPORT_PATH, async (route) => {
      if (route.request().method() === 'POST') {
        abortPosts.push(route.request().headers()['idempotency-key'] ?? '');
        return route.abort('failed');
      }
      return route.continue();
    });
    await submitBtn(pageA).click();
    await waitUncertain(pageA);
    await pageA.unroute(REPORT_PATH).catch(() => {});
    assert.equal(abortPosts.length, 1);
    const stuckKey = posts.length ? posts[0].key : abortPosts[0];
    // Also capture from posts instrumented on pageA (request listener)
    const pendingAfterFault = await pageA.evaluate(
      (k) => localStorage.getItem(k),
      pendingKey,
    );
    assert.ok(pendingAfterFault, 'pending missing after before-contact');
    const parsedPending = JSON.parse(pendingAfterFault);
    assert.equal(parsedPending.key, stuckKey || parsedPending.key);
    const beforeKey = parsedPending.key;
    assert.match(beforeKey, /^[A-Za-z0-9._:-]{8,128}$/);
    // pageB should receive storage event for the new pending
    await pageB.waitForFunction(
      () =>
        document.body.innerText.includes(
          'Status laporan berubah pada tab lain',
        ),
      null,
      { timeout: 10_000 },
    );
    evidence.storage_event_other_tab = true;
    const priorLen = posts.length;
    assert.equal(priorLen, 1, 'before-contact did not issue one logical POST');
    const originalBody = posts[0].body;
    await pageA
      .getByRole('button', {
        name: 'Kirim ulang identitas yang sama',
        exact: true,
      })
      .click();
    await pageA
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .waitFor({ timeout: 30_000 });
    // posts should have exactly one more POST with same key and same body
    assert.equal(
      posts.length,
      priorLen + 1,
      'storage replay mutated count off',
    );
    const replay = posts[posts.length - 1];
    assert.equal(replay.key, beforeKey, 'storage replay allocated new key');
    assert.equal(replay.body, originalBody, 'storage replay changed payload');
    assert.equal(JSON.parse(replay.body).description, descB);
    const replayRows = await dbRows(owner, beforeKey);
    assert.equal(replayRows.length, 1, 'storage replay DB not one row');
    assert.equal(replayRows[0].description, descB);
    assert.equal(
      await pageA.evaluate((k) => localStorage.getItem(k), pendingKey),
      null,
      'pageA pending not cleared after storage replay',
    );
    // Other tab rechecks via existing reconcile infrastructure
    await pageB
      .getByRole('button', { name: 'Periksa status laporan', exact: true })
      .click();
    await pageB
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .waitFor({ timeout: 20_000 });
    const statusAfterRecheck = await pageB
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .innerText();
    assert.ok(
      statusAfterRecheck.includes(replayRows[0].id),
      'other tab recheck did not converge to replay id',
    );
    assert.equal(
      await pageB.evaluate((k) => localStorage.getItem(k), pendingKey),
      null,
      'other tab pending not cleared after recheck',
    );
    evidence.storage_recheck = {
      original_key_sha256: sha256(beforeKey),
      report_id: replayRows[0].id,
      other_tab_converged: true,
      pending_cleared_both: true,
    };
  } finally {
    await pageA.unrouteAll({ behavior: 'wait' }).catch(() => {});
    await pageB.unrouteAll({ behavior: 'wait' }).catch(() => {});
    await pageA.close().catch(() => {});
    await pageB.close().catch(() => {});
  }
}
