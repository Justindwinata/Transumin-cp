import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

const { Pool } = createRequire(
  new URL('../../api/package.json', import.meta.url),
)('pg');

await assertCp2Runtime();

const web = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RATE_LIMIT_TEXT = /Batas pengiriman laporan/i;
const widths = [390, 1280];

function secret(name) {
  if (process.env[name]) return process.env[name];
  const env = readFileSync(
    fileURLToPath(new URL('../../.env', import.meta.url)),
    'utf8',
  );
  return (
    env
      .split('\n')
      .find((line) => line.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim() ?? ''
  );
}
const sessionSecret = secret('PASSENGER_SESSION_SECRET');

function signSession(owner, expiresAt) {
  return createHmac('sha256', sessionSecret)
    .update(`${owner}.${expiresAt}`)
    .digest('base64url');
}

function ownerFromCookies(cookies) {
  const cookie = cookies.find(
    (item) => item.name === 'transumin_proto_session',
  );
  if (!cookie) return null;
  const [owner, expiresAt, signature, ...extra] = decodeURIComponent(
    cookie.value,
  ).split('.');
  if (extra.length || !owner || !/^\d+$/.test(expiresAt ?? '')) return null;
  return signature === signSession(owner, Number(expiresAt)) ? owner : null;
}

function bodyData(body) {
  if (!body || typeof body !== 'object') return null;
  if ('data' in body) return body.data;
  return body;
}

async function jsonOf(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    headers:
      typeof response.headers === 'function'
        ? response.headers()
        : response.headers,
    body: await response.json().catch(() => null),
  };
}

async function proxy(context, path, options = {}) {
  return jsonOf(
    await context.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      headers: { origin: web, ...(options.headers ?? {}) },
      timeout: 30_000,
    }),
  );
}

async function activate(page, context) {
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  const activateWait = page.waitForResponse(
    (r) => /\/activate$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  const activated = await activateWait;
  assert.ok(
    [200, 201].includes(activated.status()),
    `activate ${activated.status()}`,
  );
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30_000 });
  const owner = ownerFromCookies(await context.cookies());
  const journeyId = await page.evaluate(() =>
    localStorage.getItem('transumin.passenger.journey'),
  );
  assert.ok(owner && journeyId, 'signed session or journey missing');
  const journey = await proxy(context, `journeys/${journeyId}`);
  assert.equal(journey.status, 200, `journey read ${journey.status}`);
  const dependency = bodyData(journey.body)?.dependencies?.[0];
  assert.ok(dependency?.mobility_entity_id, 'journey target missing');
  return { owner, journeyId, dependency, journeyBody: bodyData(journey.body) };
}

async function fillReport(page, description) {
  await page.getByRole('button', { name: 'Gangguan', exact: true }).click();
  await page
    .getByLabel('Lokasi atau layanan pada sisa perjalanan')
    .selectOption({ index: 1 });
  await page.getByLabel('Waktu kejadian (WIB)').fill('2026-10-02T08:04');
  await page.getByLabel('Keterangan').fill(description);
}

async function dbRows(owner, keys) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return (
      await pool.query(
        `select id, owner_ref, idempotency_key, request_fingerprint,
                verification_status, source, created_at
           from report.passenger_report
          where owner_ref = $1 and idempotency_key = any($2::text[])
          order by created_at`,
        [owner, keys],
      )
    ).rows;
  } finally {
    await pool.end();
  }
}

async function dbCount(owner) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return Number(
      (
        await pool.query(
          `select count(*)::int as count from report.passenger_report where owner_ref=$1`,
          [owner],
        )
      ).rows[0]?.count ?? 0,
    );
  } finally {
    await pool.end();
  }
}

async function backdateOwnedReports(owner, keys, offsetSql) {
  await assertCp2Runtime();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await assertCp2Runtime();
    await pool.query(
      `update report.passenger_report set created_at = ${offsetSql}
        where owner_ref = $1 and idempotency_key = any($2::text[])`,
      [owner, keys],
    );
  } finally {
    await pool.end();
  }
}

function retryAfter(headers) {
  const value = headers?.['retry-after'] ?? headers?.['Retry-After'];
  assert.match(String(value), /^\d+$/, 'Retry-After must be integer seconds');
  const seconds = Number(value);
  assert.ok(seconds >= 0 && seconds <= 600);
  return seconds;
}

async function rateLimitCore(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
  });
  const page = await context.newPage();
  const evidence = { width };
  try {
    const session = await activate(page, context);
    evidence.owner = session.owner.slice(0, 12);
    const keys = [];
    const posts = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/passenger-reports')
      )
        posts.push({
          key: request.headers()['idempotency-key'] ?? '',
          body: request.postData() ?? '',
        });
    });
    for (let index = 0; index < 10; index += 1) {
      const description = `REPORTING_RATE_LIMIT ${width} ${index} ${randomUUID()}`;
      await fillReport(page, description);
      const submitted = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/passenger/passenger-reports') &&
          response.request().method() === 'POST',
        { timeout: 30_000 },
      );
      await page
        .getByRole('button', { name: 'Kirim laporan', exact: true })
        .click();
      assert.equal((await submitted).status(), 201);
      await page
        .getByRole('status')
        .filter({ hasText: /Laporan tersimpan/i })
        .first()
        .waitFor({ timeout: 30_000 });
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    });
    let recentKeys;
    try {
      recentKeys = (
        await pool.query(
          `select idempotency_key from report.passenger_report where owner_ref=$1 order by created_at desc limit 10`,
          [session.owner],
        )
      ).rows.map((row) => row.idempotency_key);
    } finally {
      await pool.end();
    }
    assert.equal(recentKeys.length, 10);
    keys.push(...recentKeys);
    assert.equal(await dbCount(session.owner), 10);
    const rows = await dbRows(session.owner, keys);
    assert.equal(rows.length, 10);
    assert.ok(
      rows.every((row) => row.verification_status === 'REPORTED_UNVERIFIED'),
    );
    assert.ok(rows.every((row) => row.request_fingerprint));
    assert.ok(rows.every((row) => row.source === 'PASSENGER_SELF_REPORT'));

    const blockedDescription = `REPORTING_RATE_LIMIT blocked ${randomUUID()}`;
    await fillReport(page, blockedDescription);
    await page
      .getByRole('button', { name: 'Kirim laporan', exact: true })
      .click();
    const alert = page
      .getByRole('alert')
      .filter({ hasText: RATE_LIMIT_TEXT })
      .first();
    await alert.waitFor({ timeout: 30_000 });
    const text = await alert.innerText();
    const displayed = Number(text.match(/(\d+)\s*(?:detik|seconds)/i)?.[1]);
    assert.ok(Number.isInteger(displayed), `wait seconds missing: ${text}`);
    const preserved = await page.getByLabel('Keterangan').inputValue();
    assert.equal(preserved, blockedDescription);
    assert.equal(
      await page
        .getByRole('button', { name: 'Kirim laporan', exact: true })
        .isDisabled(),
      false,
    );
    assert.equal(await page.locator('[aria-busy="true"]').count(), 0);
    const pendingKey = await page.evaluate(
      (journeyId) =>
        JSON.parse(
          localStorage.getItem(
            `transumin.passenger.report-pending.${journeyId}`,
          ) ?? 'null',
        )?.key ?? null,
      session.journeyId,
    );
    const blockedPost = posts.at(-1);
    const blockedKey = pendingKey ?? blockedPost?.key ?? null;
    assert.ok(blockedKey, 'blocked idempotency key missing');
    assert.match(blockedKey, /^[A-Za-z0-9._:-]{8,128}$/);
    const payload = JSON.parse(blockedPost?.body ?? 'null') ?? {
      active_journey_id: session.journeyId,
      category: 'SERVICE',
      observed_at: '2026-10-02T01:05:00Z',
      mobility_entity_id: session.dependency.mobility_entity_id,
      entity_type: session.dependency.entity_type,
      description: blockedDescription,
    };
    const response = await proxy(context, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': blockedKey,
      },
      data: payload,
    });
    assert.equal(response.status, 429);
    assert.equal(bodyData(response.body)?.error?.code, 'RATE_LIMITED');
    const retry = retryAfter(response.headers);
    assert.ok(
      Math.abs(retry - displayed) <= 2,
      `UI ${displayed}s differs Retry-After ${retry}s`,
    );
    assert.equal((await dbRows(session.owner, [blockedKey])).length, 0);
    assert.equal(await dbCount(session.owner), 10);

    await backdateOwnedReports(
      session.owner,
      keys,
      `now() - interval '9 minutes 45 seconds'`,
    );
    const nearExpiry = await proxy(context, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': blockedKey,
      },
      data: payload,
    });
    assert.equal(nearExpiry.status, 429);
    const nearRetry = retryAfter(nearExpiry.headers);
    assert.ok(
      nearRetry > 0 && nearRetry <= 20,
      `near expiry Retry-After ${nearRetry}s`,
    );
    await backdateOwnedReports(
      session.owner,
      keys,
      `now() - interval '10 minutes' - interval '2 seconds'`,
    );
    // Intentional retry with same payload; should insert once (same idempotency key), not distinct.
    const retrySubmit = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/passenger/passenger-reports') &&
        response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page
      .getByRole('button', { name: 'Kirim laporan', exact: true })
      .click();
    const retryStatus = (await retrySubmit).status();
    assert.equal(retryStatus, 201, `retry after expiry got ${retryStatus}`);
    // Wait for the pending POST payload to be observable
    const retryPost = posts[posts.length - 1];
    if (blockedKey && retryPost?.key !== blockedKey) {
      assert.fail(
        `retry should reuse idempotency key ${blockedKey} got ${retryPost?.key}`,
      );
    }
    await page
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .waitFor({ timeout: 30_000 });
    const afterRows = await dbRows(session.owner, [blockedKey]);
    assert.equal(afterRows.length, 1);
    assert.equal(afterRows[0].verification_status, 'REPORTED_UNVERIFIED');
    assert.equal(await dbCount(session.owner), 11);
    evidence.retry_after = retry;
    evidence.near_expiry_retry = nearRetry;

    const postsBeforeStorage = posts.length;
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      };
      window.__restoreStorage = () => {
        Storage.prototype.setItem = original;
      };
    });
    await fillReport(page, `storage unavailable ${randomUUID()}`);
    await page
      .getByRole('button', { name: 'Kirim laporan', exact: true })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: /penyimpanan|storage|gagal/i })
      .first()
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    assert.equal(
      posts.length,
      postsBeforeStorage,
      'POST issued despite storage failure',
    );
    await page.evaluate(() => window.__restoreStorage?.());

    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
      window.__locksDescriptor = descriptor ?? null;
      window.__locksValue = navigator.locks;
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });
    });
    await fillReport(page, `locks unavailable ${randomUUID()}`);
    await page
      .getByRole('button', { name: 'Kirim laporan', exact: true })
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: /Laporan tersimpan/i })
      .first()
      .waitFor({ timeout: 30_000 });
    await page.evaluate(() => {
      const descriptor = window.__locksDescriptor;
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
      else
        Object.defineProperty(navigator, 'locks', {
          value: window.__locksValue,
          configurable: true,
        });
    });

    const invalid = await proxy(context, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      data: {
        active_journey_id: session.journeyId,
        category: 'NOT_A_CATEGORY',
        observed_at: 'not-a-time',
        mobility_entity_id: session.dependency.mobility_entity_id,
        entity_type: session.dependency.entity_type,
        description: '',
      },
    });
    assert.ok([400, 422].includes(invalid.status));

    const segments = session.journeyBody?.segments ?? [];
    if (!segments.length) throw new Error('completed NOT_VERIFIED no segments');
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const setTime = async (iso) => {
        const time = new Date(Date.parse(iso) + 7 * 60 * 60 * 1000);
        await page
          .getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)')
          .fill(time.toISOString().slice(0, 16));
      };
      const clickMutation = async (name, suffix, method) => {
        const [response] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r
                .url()
                .endsWith(
                  `/api/passenger/journeys/${session.journeyId}/${suffix}`,
                ) && r.request().method() === method,
          ),
          page.getByRole('button', { name, exact: true }).click(),
        ]);
        const result = await jsonOf(response);
        assert.ok(
          [200, 201].includes(result.status),
          `completion ${suffix} ${JSON.stringify(result)}`,
        );
        return bodyData(result.body);
      };
      await setTime(segment.start_at);
      const board = page.getByRole('button', {
        name: 'Saya Sudah Naik',
        exact: true,
      });
      if (await board.count()) {
        await clickMutation('Saya Sudah Naik', `boarding/${index}`, 'POST');
        await page
          .getByRole('button', { name: 'Saya Sudah Turun', exact: true })
          .waitFor();
        await setTime(segment.end_at);
        await clickMutation('Saya Sudah Turun', `alighting/${index}`, 'POST');
      }
      await setTime(segment.end_at);
      const advance = page.getByRole('button', {
        name: /^(Lanjutkan Perjalanan|Selesaikan Perjalanan)$/,
      });
      await advance.waitFor();
      const name = await advance.innerText();
      const progressed = await clickMutation(name, 'progress', 'PATCH');
      assert.equal(
        progressed?.progress?.completed_segment_count,
        index + 1,
        `completion progress ${JSON.stringify(progressed)}`,
      );
    }
    await page
      .getByRole('status')
      .filter({ hasText: /perjalanan ini sudah selesai/i })
      .waitFor();
    const completed = await proxy(context, `journeys/${session.journeyId}`);
    assert.equal(completed.status, 200, JSON.stringify(completed));
    assert.equal(
      bodyData(completed.body)?.status,
      'COMPLETED',
      JSON.stringify(completed.body),
    );
    const afterCompleted = await proxy(context, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      data: { ...payload },
    });
    assert.ok(
      [400, 403, 404, 409, 429].includes(afterCompleted.status),
      `completed journey report must not 201, got ${afterCompleted.status} body ${JSON.stringify(afterCompleted.body)}`,
    );
    evidence.completed_journey = `COMPLETED ${afterCompleted.status}`;

    return evidence;
  } finally {
    await context.close();
  }
}

async function boundaryViaContexts(browser) {
  const contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const a = await activate(pageA, contextA);
    const b = await activate(pageB, contextB);
    assert.notEqual(a.owner, b.owner, 'distinct owners required');
    const bValid = await proxy(contextB, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      data: {
        active_journey_id: b.journeyId,
        category: 'SERVICE',
        observed_at: '2026-10-02T01:05:00Z',
        mobility_entity_id: b.dependency.mobility_entity_id,
        entity_type: b.dependency.entity_type,
        description: `boundary owner B valid ${randomUUID()}`,
      },
    });
    assert.equal(
      bValid.status,
      201,
      `B own journey must 201 got ${bValid.status}`,
    );
    const wrongOwner = await proxy(contextB, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      data: {
        active_journey_id: a.journeyId,
        category: 'SERVICE',
        observed_at: '2026-10-02T01:05:00Z',
        mobility_entity_id: a.dependency.mobility_entity_id,
        entity_type: a.dependency.entity_type,
        description: `boundary wrong owner ${randomUUID()}`,
      },
    });
    assert.equal(
      wrongOwner.status,
      403,
      `wrong owner submit to A journey must 403 got ${wrongOwner.status}`,
    );

    const fillerPayload = {
      active_journey_id: a.journeyId,
      category: 'SERVICE',
      observed_at: '2026-10-02T01:05:00Z',
      mobility_entity_id: a.dependency.mobility_entity_id,
      entity_type: a.dependency.entity_type,
    };
    for (let index = 0; index < 9; index += 1) {
      const filler = await proxy(contextA, 'passenger-reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        data: {
          ...fillerPayload,
          description: `quota ${index} ${randomUUID()}`,
        },
      });
      assert.equal(
        filler.status,
        201,
        `filler ${index} ${filler.status} ${JSON.stringify(filler.body)}`,
      );
    }
    const countBeforeBoundary = await dbCount(a.owner);
    assert.equal(
      countBeforeBoundary,
      9,
      `boundary setup count ${countBeforeBoundary}`,
    );
    const secondTab = await contextA.newPage();
    await secondTab.goto(web, { waitUntil: 'domcontentloaded' });
    await secondTab
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30_000 });
    const boundaryKeys = [randomUUID(), randomUUID()];
    const boundaryPayloads = boundaryKeys.map((_, index) => ({
      ...fillerPayload,
      description: `concurrent boundary ${index}`,
    }));
    const boundaryResults = await Promise.all(
      [pageA, secondTab].map((tab, index) =>
        proxy(tab.context(), 'passenger-reports', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': boundaryKeys[index],
          },
          data: boundaryPayloads[index],
        }),
      ),
    );
    assert.deepEqual(
      boundaryResults.map((result) => result.status).sort(),
      [201, 429],
      `concurrent distinct-key boundary ${JSON.stringify(boundaryResults)}`,
    );
    assert.equal(await dbCount(a.owner), 10);
    assert.equal((await dbRows(a.owner, boundaryKeys)).length, 1);
    const winner = boundaryResults.findIndex((result) => result.status === 201);
    const concurrentKey = boundaryKeys[winner];
    const concurrentPayload = boundaryPayloads[winner];
    const winningId = bodyData(boundaryResults[winner].body)?.report_id;
    assert.ok(
      winningId,
      `boundary winner missing report_id ${JSON.stringify(boundaryResults[winner])}`,
    );
    const [first, second] = await Promise.all([
      proxy(contextA, 'passenger-reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': concurrentKey,
        },
        data: concurrentPayload,
      }),
      proxy(contextA, 'passenger-reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': concurrentKey,
        },
        data: concurrentPayload,
      }),
    ]);
    assert.equal(
      first.status,
      201,
      `same-key replay first ${first.status} ${JSON.stringify(first.body)}`,
    );
    assert.equal(
      second.status,
      201,
      `same-key replay second ${second.status} ${JSON.stringify(second.body)}`,
    );
    assert.equal(
      bodyData(first.body)?.report_id,
      bodyData(second.body)?.report_id,
      `concurrent same-key replays IDs differ ${JSON.stringify({ first: bodyData(first.body), second: bodyData(second.body) })}`,
    );
    assert.equal(bodyData(first.body)?.report_id, winningId);
    assert.equal((await dbRows(a.owner, [concurrentKey])).length, 1);
    assert.equal(await dbCount(a.owner), 10);

    const conflict = await proxy(contextA, 'passenger-reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': concurrentKey,
      },
      data: { ...concurrentPayload, description: 'conflict payload' },
    });
    assert.equal(
      conflict.status,
      409,
      `conflict wrong payload ${conflict.status} ${JSON.stringify(conflict.body)}`,
    );
    assert.equal(await dbCount(a.owner), 10);

    const expired = await browser.newContext();
    try {
      const expiry = Math.floor(Date.now() / 1000) - 60;
      await expired.addCookies([
        {
          name: 'transumin_proto_session',
          value: `${a.owner}.${expiry}.${signSession(a.owner, expiry)}`,
          url: web,
          httpOnly: true,
        },
      ]);
      const denied = await proxy(expired, 'passenger-reports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        data: concurrentPayload,
      });
      assert.equal(denied.status, 403);
    } finally {
      await expired.close();
    }
    return {
      distinct_owners: true,
      replay: 201,
      conflict: 409,
      wrong_owner: 403,
      expired: 403,
      concurrent_same_id: true,
    };
  } finally {
    await contextA.close();
    await contextB.close();
  }
}

let browser;
const runs = [];
try {
  browser = await chromium.launch(
    existsSync(chrome)
      ? { executablePath: chrome, headless: true }
      : { headless: true },
  );
  for (const width of widths) {
    runs.push({ width, core: await rateLimitCore(browser, width) });
  }
  runs.push({ boundary: await boundaryViaContexts(browser) });
  console.log(
    JSON.stringify({ status: 'PASS', suite: 'REPORTING_RATE_LIMIT', runs }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      suite: 'REPORTING_RATE_LIMIT',
      runs,
      message: String(error).slice(0, 2200),
      stack: error instanceof Error ? error.stack?.slice(0, 5000) : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
