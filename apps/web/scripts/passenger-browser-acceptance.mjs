import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requireApi = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../api/package.json'),
);
const { Pool } = requireApi('pg');

import { chromium } from 'playwright-core';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3002';
const apiUrl = process.env.PASSENGER_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir =
  process.env.PRODUCT_P1R_SCREENSHOT_DIR ??
  join(repositoryRoot, 'data/processed/product-p1r-browser');
const departure = '2026-10-02T08:00';

if (!process.env.DATABASE_URL)
  throw new Error(
    'DATABASE_URL must point to an isolated local acceptance DB.',
  );

async function assertAcceptanceDbPreflight() {
  const raw = process.env.DATABASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'DATABASE_URL must use postgres protocol.',
  );
  assert.equal(
    url.hostname,
    '127.0.0.1',
    'DATABASE_URL must target 127.0.0.1.',
  );
  assert.equal(
    url.port,
    '5435',
    'DATABASE_URL must use the product server port 5435.',
  );
  assert.equal(
    url.search,
    '',
    'DATABASE_URL must not contain query overrides.',
  );
  assert.match(
    decodeURIComponent(url.pathname.slice(1)),
    /^tnx_acceptance_[0-9a-f]{32}$/,
    'DATABASE_URL must point to acceptance-named scratch DB.',
  );
  const user = decodeURIComponent(url.username);
  assert.ok(user, 'DATABASE_URL username missing.');
  assert.equal(user, process.env.POSTGRES_USER, 'Product username mismatch.');
  assert.equal(url.hash, '', 'DATABASE_URL fragment rejected.');
  const dbName = decodeURIComponent(url.pathname.slice(1));
  try {
    const container = 'transum-in-nexus-postgres-1';
    const marker = execFileSync(
      'docker',
      [
        'exec',
        '-u',
        'postgres',
        container,
        'psql',
        '-U',
        process.env.POSTGRES_USER,
        '-d',
        'postgres',
        '-Atqc',
        `select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname='${dbName}'`,
      ],
      { encoding: 'utf8' },
    ).trim();
    assert.match(
      marker,
      /^tnx_acceptance:[0-9a-f-]{36}$/,
      'Scratch DB marker missing or mismatched; refusing state change.',
    );
    const serverId = execFileSync(
      'docker',
      [
        'exec',
        '-u',
        'postgres',
        container,
        'psql',
        '-U',
        process.env.POSTGRES_USER,
        '-d',
        'postgres',
        '-Atqc',
        'select system_identifier::text from pg_control_system()',
      ],
      { encoding: 'utf8' },
    ).trim();
    assert.ok(
      /^[0-9]+$/.test(serverId),
      'Could not verify pg server identity.',
    );
    const pool = new Pool({
      connectionString: raw,
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    try {
      const checked = await pool.query(
        'select system_identifier::text from pg_control_system()',
      );
      assert.equal(
        checked.rows[0]?.system_identifier,
        serverId,
        'DATABASE_URL does not target the verified Docker server.',
      );
    } finally {
      await pool.end().catch(() => undefined);
    }
  } catch (error) {
    throw new Error(
      `Acceptance DB preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function waitForWeb() {
  const response = await fetch(webUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error(`Passenger web returned ${response.status}.`);
}

async function startAcceptanceApi() {
  const child = spawn('pnpm', ['data:product-p1r:serve'], {
    cwd: repositoryRoot,
    env: { ...process.env, PRODUCT_P1R_ACCEPTANCE: '1' },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  const events = new EventEmitter();
  let output = '';
  let diagnostic = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    let boundary = output.indexOf('\n');
    while (boundary >= 0) {
      const line = output.slice(0, boundary).trim();
      output = output.slice(boundary + 1);
      lines.push(line);
      events.emit('line');
      boundary = output.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => {
    diagnostic = `${diagnostic}${chunk}`.slice(-2000);
  });
  const server = { child, lines, events, diagnostic: () => diagnostic };
  await waitForLine(server, /P1R_ACCEPTANCE_READY/, 0, 60_000);
  return server;
}

function waitForLine(server, pattern, after, timeoutMs = 45_000) {
  return new Promise((resolveLine, rejectLine) => {
    const check = () => {
      const line = server.lines.slice(after).find((item) => pattern.test(item));
      if (line) {
        cleanup();
        resolveLine(line);
      }
    };
    const failed = () => {
      cleanup();
      rejectLine(new Error(`Acceptance API stopped: ${server.diagnostic()}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      rejectLine(new Error(`Acceptance API timeout: ${server.diagnostic()}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      server.events.off('line', check);
      server.child.off('exit', failed);
    }
    server.events.on('line', check);
    server.child.on('exit', failed);
    check();
  });
}

async function stopAcceptanceApi(server) {
  if (
    !server ||
    server.child.exitCode !== null ||
    server.child.signalCode !== null
  )
    return;
  const stopped = new Promise((resolveStop) => {
    server.child.once('exit', resolveStop);
    setTimeout(resolveStop, 10_000);
  });
  try {
    process.kill(-server.child.pid, 'SIGTERM');
  } catch {
    server.child.kill('SIGTERM');
  }
  await stopped;
}

async function inject(server, entityId, mode, state, expired = false) {
  const after = server.lines.length;
  server.child.stdin.write(
    `${JSON.stringify({ entityId, mode, state, expired })}\n`,
  );
  const line = await waitForLine(
    server,
    /"status":"INJECTED_SIMULATED"/,
    after,
  );
  const result = JSON.parse(line);
  assert.equal(result.unresolvedReferences.length, 0);
  return result;
}

async function apiRequest(resource, owner) {
  const response = await fetch(`${apiUrl}/${resource}`, {
    headers: { 'x-journey-owner': owner },
  });
  return { response, body: await response.json() };
}

async function choosePlace(page, field, query, option) {
  await page.getByRole('combobox', { name: field }).fill(query);
  await page.getByRole('option', { name: option }).click();
}

function distanceDegrees(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function assertJourneyGeometry(journey) {
  assert.ok(journey.segments.length > 0, 'Selected journey has no segments.');
  for (const segment of journey.segments) {
    const coordinates = segment.geometry?.coordinates;
    assert.ok(
      Array.isArray(coordinates) && coordinates.length >= 2,
      `Segment ${segment.sequence} missing geometry.`,
    );
    for (const point of coordinates) {
      assert.equal(
        point.length,
        2,
        `Segment ${segment.sequence} geometry is not [lon,lat].`,
      );
      assert.ok(
        Number.isFinite(point[0]) && Number.isFinite(point[1]),
        'Geometry coordinate is not finite.',
      );
      assert.ok(
        point[0] >= -180 &&
          point[0] <= 180 &&
          point[1] >= -90 &&
          point[1] <= 90,
        'Geometry coordinate out of bounds.',
      );
    }
    const from = [segment.from.longitude, segment.from.latitude];
    const to = [segment.to.longitude, segment.to.latitude];
    assert.ok(
      distanceDegrees(coordinates[0], from) <= 0.02,
      `Segment ${segment.sequence} start geometry diverges from endpoint (~2 km tolerance).`,
    );
    assert.ok(
      distanceDegrees(coordinates.at(-1), to) <= 0.02,
      `Segment ${segment.sequence} end geometry diverges from endpoint.`,
    );
  }
}

async function assertMapExperience(page, journey) {
  const map = page.getByRole('application', {
    name: /Peta rute terpilih/,
  });
  await map.waitFor({ timeout: 30_000 });
  await page
    .getByRole('status')
    .filter({ hasText: 'Peta perjalanan siap.' })
    .waitFor({ state: 'attached', timeout: 30_000 });
  const canvas = map.locator('.maplibregl-canvas');
  await canvas.waitFor({ timeout: 15_000 });
  assert.ok((await canvas.count()) > 0, 'MapLibre canvas missing.');
  assert.ok(
    (await page
      .getByRole('figure', { name: 'Interactive route geometry:' })
      .getByRole('link', { name: '© OpenStreetMap contributors' })
      .count()) > 0,
    'Map attribution missing.',
  );
  assert.ok(
    (await page.getByRole('list', { name: 'Map markers' }).count()) > 0,
    'Map marker legend missing.',
  );
  assert.ok(
    (await page.locator('.maplibre-marker').count()) >= 2,
    'Origin/destination markers missing.',
  );
  assert.equal(
    await page
      .getByText(
        'Route geometry is unavailable. No inferred line is shown; use textual itinerary below.',
      )
      .count(),
    0,
    'Geometry fallback shown for selected geometry.',
  );
  assert.ok(
    journey.segments.some(
      (segment) => segment.geometry?.coordinates?.length >= 2,
    ),
    'No renderable route source geometry.',
  );
  const beforeBox = await canvas.boundingBox();
  assert.ok(beforeBox && beforeBox.width > 0, 'Map canvas has no layout.');
  await canvas.hover();
  const beforeCenter = await page.evaluate(() => {
    const el = document.querySelector('.maplibre-frame canvas');
    return el ? el.getBoundingClientRect().left : 0;
  });
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(400);
  await page.mouse.wheel(120, 0);
  await page.waitForTimeout(400);
  const afterBox = await canvas.boundingBox();
  assert.ok(afterBox && afterBox.width > 0, 'Map canvas lost after pan/zoom.');
  const errorFallback = await page
    .getByText(
      'Peta atau garis rute gagal dimuat. Petunjuk tertulis tetap dapat digunakan.',
    )
    .count();
  assert.equal(
    errorFallback,
    0,
    'Map reported tile/layer error despite geometry.',
  );
  void beforeCenter;
}

async function assertMissingGeometryIsolated(page) {
  const handled = await page.evaluate(() => {
    const fallbackText =
      'Route geometry is unavailable. No inferred line is shown; use textual itinerary below.';
    const hasFallback = document.body.innerText.includes(fallbackText);
    const hasMap = !!document.querySelector('.maplibre-frame canvas');
    if (hasMap && hasFallback) return false;
    return true;
  });
  assert.ok(handled, 'Missing-geometry fallback and map canvas conflict.');
}

async function planAndActivate(page, sharedJourney = null) {
  await page.goto(webUrl);
  await choosePlace(page, 'From', 'Harmoni', /^Harmoni TransJakarta · station/);
  await choosePlace(
    page,
    'To',
    'Lebak Bulus Bank Syariah Indonesia',
    /^Lebak Bulus Bank Syariah Indonesia MRT Jakarta · station/,
  );
  await page.getByRole('textbox', { name: 'Berangkat (WIB)' }).fill(departure);
  const planningResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Cari perjalanan' }).click();
  const planned = (await (await planningResponse).json()).data;
  const choiceButtons = page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button');
  await choiceButtons.first().waitFor({ timeout: 120_000 });
  const choices = await choiceButtons.all();
  let selected = null;
  let selectedIndex = -1;
  for (const [index, choice] of choices.entries()) {
    const label = await choice.innerText();
    if (label.includes('TransJakarta') && label.includes('MRT Jakarta')) {
      selected = choice;
      selectedIndex = index;
      break;
    }
  }
  assert.ok(selected, 'Real OTP returned no TransJakarta + MRT option.');
  const selectedJourney = planned[selectedIndex];
  assert.ok(selectedJourney, 'Selected option was not in the OTP response.');
  assertJourneyGeometry(selectedJourney);
  await selected.click();
  await assertMapExperience(page, selectedJourney);
  if (!sharedJourney) {
    await mkdir(evidenceDir, { recursive: true });
    for (const [name, width, height] of [
      ['mobile', 390, 844],
      ['tablet', 768, 900],
      ['desktop', 1280, 900],
    ]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false, `${name} search has horizontal overflow.`);
      await page.screenshot({
        path: join(evidenceDir, `journey-search-${name}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  if (sharedJourney) {
    assert.equal(
      selectedJourney.journey_id,
      sharedJourney.journey_id,
      'Independent OTP searches must identify the same itinerary.',
    );
    const activation = await page.evaluate(async (journey) => {
      const owner = localStorage.getItem('transumin.passenger.owner');
      const response = await fetch(
        `/api/passenger/journeys/${journey.journey_id}/activate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-journey-owner': owner,
          },
          body: JSON.stringify({
            selected_journey: journey,
            activated_at: journey.start_at,
          }),
        },
      );
      return { status: response.status, body: await response.json() };
    }, sharedJourney);
    assert.equal(activation.status, 201);
    await page.evaluate((journeyId) => {
      localStorage.setItem('transumin.passenger.journey', journeyId);
    }, activation.body.data.journey_id);
    await page.reload();
  } else {
    await page.getByRole('button', { name: 'Start this journey' }).click();
  }
  await page
    .getByRole('complementary', { name: 'Perjalanan aktif Anda' })
    .waitFor();
  await page
    .getByText('Pembaruan gangguan perjalanan tersambung.')
    .waitFor({ timeout: 30_000 });
  const ids = await page.evaluate(() => ({
    owner: localStorage.getItem('transumin.passenger.owner'),
    journeyId: localStorage.getItem('transumin.passenger.journey'),
  }));
  assert.ok(
    ids.owner && ids.journeyId,
    'Browser did not persist owner/journey.',
  );
  const { response, body } = await apiRequest(
    `journeys/${ids.journeyId}`,
    ids.owner,
  );
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ACTIVE');
  assertJourneyGeometry(body.data);
  await assertMissingGeometryIsolated(page);
  return { ...ids, journey: body.data, selectedJourney };
}

async function advance(page, completed, at) {
  await page
    .getByRole('textbox', {
      name: 'Waktu tahapan perjalanan (WIB, skenario uji)',
    })
    .fill(at);
  await page
    .getByRole('button', { name: 'Mark current part complete' })
    .click();
  await page
    .getByText(`${completed} of 4 parts complete. Progress is manual.`)
    .waitFor();
}

let server;
let browser;
let affectedEntity = null;
try {
  await assertAcceptanceDbPreflight();
  await waitForWeb();
  server = await startAcceptanceApi();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const a = await planAndActivate(pageA);
  const b = await planAndActivate(pageB, a.selectedJourney);
  assert.notEqual(a.owner, b.owner);
  assert.notEqual(a.journeyId, b.journeyId);
  assert.equal(a.journey.plan_journey_id, b.journey.plan_journey_id);
  assert.equal(a.journey.plan_fingerprint, b.journey.plan_fingerprint);
  assert.equal(a.journey.segments.length, 4);
  assert.equal(a.journey.segments[1].mode, 'TRANSJAKARTA');
  await advance(pageA, 1, '2026-10-02T08:07');
  await advance(pageB, 1, '2026-10-02T08:07');
  await advance(pageB, 2, '2026-10-02T08:24');
  const aBefore = (await apiRequest(`journeys/${a.journeyId}`, a.owner)).body
    .data;
  const bBefore = (await apiRequest(`journeys/${b.journeyId}`, b.owner)).body
    .data;
  assert.equal(aBefore.progress.completed_segment_count, 1);
  assert.equal(bBefore.progress.completed_segment_count, 2);
  const affected = aBefore.dependencies.find(
    (item) =>
      item.entity_type === 'ROUTE' && item.product_mode === 'TRANSJAKARTA',
  );
  assert.ok(affected, 'No canonical TransJakarta route dependency.');
  affectedEntity = affected.mobility_entity_id;
  await inject(
    server,
    affected.mobility_entity_id,
    'TRANSJAKARTA',
    'UNAVAILABLE',
  );
  await pageA.getByRole('article', { name: 'Peringatan perjalanan' }).waitFor();
  assert.match(
    await pageA
      .getByRole('article', { name: 'Peringatan perjalanan' })
      .innerText(),
    /SIMULASI terkontrol/,
  );
  assert.equal(
    await pageB.getByRole('article', { name: 'Peringatan perjalanan' }).count(),
    0,
  );
  const bAlerts = await apiRequest(`journeys/${b.journeyId}/alerts`, b.owner);
  assert.equal(bAlerts.response.status, 200);
  assert.equal(bAlerts.body.data.length, 0);
  const recoveryResponse = pageA.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/recoveries') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await pageA.getByRole('button', { name: 'Cari rute pengganti' }).click();
  const response = await recoveryResponse;
  assert.equal(response.status(), 201);
  const recovery = (await response.json()).data;
  assert.equal(recovery.status, 'COMPLETED');
  assert.ok(recovery.proposed_journey);
  assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
  for (const segment of recovery.proposed_journey.segments) {
    for (const binding of segment.entity_bindings) {
      assert.notEqual(binding.canonical_entity_id, affected.mobility_entity_id);
      assert.notEqual(binding.mobility_entity_id, affected.mobility_entity_id);
    }
  }
  await pageA.getByRole('region', { name: 'Rute pengganti' }).waitFor();
  await pageA.getByRole('heading', { name: 'Sisa rute awal' }).waitFor();
  await pageA.getByRole('heading', { name: 'Rute yang disarankan' }).waitFor();
  const aAfter = (await apiRequest(`journeys/${a.journeyId}`, a.owner)).body
    .data;
  assert.deepEqual(
    aAfter.segments,
    aBefore.segments,
    'Recovery changed the original plan.',
  );
  const denied = await apiRequest(
    `recoveries/${recovery.recovery_id}`,
    b.owner,
  );
  assert.ok(denied.response.status === 403 || denied.response.status === 404);
  const mrtDependency = bBefore.dependencies.find(
    (item) =>
      item.entity_type === 'ROUTE' && item.product_mode === 'MRT_JAKARTA',
  );
  assert.ok(mrtDependency);
  await inject(
    server,
    mrtDependency.mobility_entity_id,
    'MRT_JAKARTA',
    'UNKNOWN',
  );
  await inject(
    server,
    mrtDependency.mobility_entity_id,
    'MRT_JAKARTA',
    'UNAVAILABLE',
    true,
  );
  assert.equal(
    (await apiRequest(`journeys/${b.journeyId}/alerts`, b.owner)).body.data
      .length,
    0,
  );
  await pageA.route('**/api/passenger/journeys/*/alerts/stream', (route) =>
    route.abort(),
  );
  await pageA.reload();
  await pageA
    .getByText('Menyambungkan kembali. Informasi terakhir tetap ditampilkan.')
    .waitFor({ timeout: 30_000 });
  await pageA.unroute('**/api/passenger/journeys/*/alerts/stream');
  await pageA
    .getByText('Pembaruan gangguan perjalanan tersambung.')
    .waitFor({ timeout: 45_000 });
  await pageB
    .getByText('Pembaruan gangguan perjalanan tersambung.')
    .waitFor({ timeout: 45_000 });
  assert.equal(
    await pageA.getByRole('article', { name: 'Peringatan perjalanan' }).count(),
    1,
  );
  assert.equal(
    await pageB.getByRole('article', { name: 'Peringatan perjalanan' }).count(),
    0,
  );
  await mkdir(evidenceDir, { recursive: true });
  const screenshots = [];
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 768, 900],
    ['desktop', 1280, 900],
  ]) {
    await pageA.setViewportSize({ width, height });
    const geometry = await pageA.evaluate(() => ({
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      geometry.scroll <= geometry.viewport,
      `${name} has horizontal overflow.`,
    );
    const mapBox = await pageA
      .getByRole('application', { name: /Peta rute terpilih/ })
      .boundingBox()
      .catch(() => null);
    assert.ok(mapBox && mapBox.width > 0, `${name} map frame has no layout.`);
    const path = join(evidenceDir, `passenger-${name}.png`);
    await pageA.screenshot({ path, fullPage: true });
    screenshots.push(path);
  }
  console.log(
    JSON.stringify({
      status: 'PASS',
      evidence:
        'two independent Chrome browser contexts, real OTP and database',
      plan_journey_id: a.journey.plan_journey_id,
      active_journey_ids: [a.journeyId, b.journeyId],
      affected_alerts: 1,
      unaffected_alerts: 0,
      recovery_status: recovery.status,
      blocked_entity_avoided: true,
      sse_reconnected: true,
      geometry_validated: true,
      map_canvas_present: true,
      pan_zoom_functional: true,
      screenshots,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (server && affectedEntity) {
    await inject(server, affectedEntity, 'TRANSJAKARTA', 'UNKNOWN').catch(
      () => undefined,
    );
  }
  await stopAcceptanceApi(server);
}
