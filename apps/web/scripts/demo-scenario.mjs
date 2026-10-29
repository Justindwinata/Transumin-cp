import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const apiUrl = process.env.PASSENGER_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir =
  process.env.DEMO_SCREENSHOT_DIR ??
  join(repositoryRoot, 'data/processed/demo-20261011');

const ROUTE_6H = 'c95bde93-682f-5742-ab1f-3b0f653ecbae';
const UNRELATED = {
  origin: { latitude: -6.5942887, longitude: 106.7907695 },
  destination: { latitude: -6.2892744, longitude: 106.7749355 },
  departure: '2026-10-02T04:00',
};

if (!process.env.DATABASE_URL || process.env.DEMO_ISOLATED_TEST !== '1')
  throw new Error('Run test:demo through the isolated local database harness.');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.port, '5433');
assert.match(databaseUrl.pathname, /^\/tnx_demo_ci_[0-9a-z]+$/);
assert.equal(apiUrl, 'http://127.0.0.1:3001/api/v1');
assert.equal(webUrl, 'http://127.0.0.1:3000');
assert.equal(process.env.PRODUCT_P1R_PORT ?? '3001', '3001');

async function waitForWeb() {
  const response = await fetch(webUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error(`Passenger web returned ${response.status}.`);
}

async function startAcceptanceApi(extraEnv = {}) {
  const child = spawn('pnpm', ['data:product-p1r:serve'], {
    cwd: repositoryRoot,
    env: { ...process.env, PRODUCT_P1R_ACCEPTANCE: '1', ...extraEnv },
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

/** Send an acceptance-host command and wait for its JSON status line. */
async function harnessEvent(server, payload, statusPattern) {
  const after = server.lines.length;
  server.child.stdin.write(`${JSON.stringify(payload)}\n`);
  const line = await waitForLine(server, statusPattern, after);
  return JSON.parse(line);
}

async function inject(server, entityId, mode, state, ids = {}) {
  const result = await harnessEvent(
    server,
    { entityId, mode, state, ...ids },
    /"status":"INJECTED_SIMULATED"|"status":"ERROR"/,
  );
  if (result.status !== 'INJECTED_SIMULATED') throw new Error(result.message);
  assert.equal(result.unresolvedReferences.length, 0);
  return result;
}

async function apiJourney(resource, owner) {
  const response = await fetch(`${apiUrl}/journeys/${resource}`, {
    headers: { 'x-journey-owner': owner },
  });
  return { response, body: await response.json() };
}

async function loadScenario(page) {
  await page.goto(webUrl);
  // Keyboard-only activation of the primary control (Tab traversal + Enter).
  const demo = page.getByRole('button', {
    name: /Load presentation scenario/,
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    const focused = await demo.evaluate(
      (element) => element === document.activeElement,
    );
    if (focused) break;
    await page.keyboard.press('Tab');
  }
  assert.ok(
    await demo.evaluate((element) => element === document.activeElement),
    'Demo load control must be keyboard reachable',
  );
  await page.keyboard.press('Enter');
  await page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(async (error) => {
      throw new Error(
        `${error.message}\n${(await page.locator('body').innerText()).slice(0, 1800)}`,
      );
    });
}

// Alternative cards show modes only; the selected detail panel carries the
// route short name, so match route there instead of on the card.
async function activateFirst(page, route = null) {
  const buttons = page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button');
  if (route) {
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      await buttons.nth(index).click();
      if ((await page.locator('.journey-detail').innerText()).includes(route))
        break;
    }
    assert.ok(
      (await page.locator('.journey-detail').innerText()).includes(route),
      `No presented journey uses route ${route}.`,
    );
  } else {
    await buttons.first().click();
  }
  await page.getByRole('button', { name: 'Start this journey' }).click();
  await page
    .getByRole('complementary', { name: 'Your active journey' })
    .waitFor();
  await page
    .getByText('Connected to journey-specific updates.')
    .waitFor({ timeout: 30_000 });
  return page.evaluate(() => ({
    owner: localStorage.getItem('transumin.passenger.owner'),
    journeyId: localStorage.getItem('transumin.passenger.journey'),
  }));
}

async function verifyActivationRequiresSelection(page) {
  await page.goto(webUrl);
  assert.equal(
    await page.getByRole('button', { name: 'Start this journey' }).count(),
    0,
    'Activation must be unavailable without a selected journey',
  );
  await page
    .getByText('Search above to see real network routes', { exact: false })
    .waitFor();
}

async function verifyInvalidCoordinates(page) {
  await page.goto(webUrl);
  await page.getByText('Advanced: enter coordinates instead').click();
  await page.getByLabel('Origin latitude').fill('91');
  await page.getByLabel('Origin longitude').fill('106.8');
  await page.getByLabel('Destination latitude').fill('-6.2');
  await page.getByLabel('Destination longitude').fill('106.8');
  await page.getByRole('button', { name: 'Find journeys' }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Enter valid latitude and longitude' })
    .waitFor();
}

async function planUnrelated(page) {
  await page.goto(webUrl);
  await page.getByText('Advanced: enter coordinates instead').click();
  await page
    .getByLabel('Origin latitude')
    .fill(String(UNRELATED.origin.latitude));
  await page
    .getByLabel('Origin longitude')
    .fill(String(UNRELATED.origin.longitude));
  await page
    .getByLabel('Destination latitude')
    .fill(String(UNRELATED.destination.latitude));
  await page
    .getByLabel('Destination longitude')
    .fill(String(UNRELATED.destination.longitude));
  await page
    .getByRole('textbox', { name: 'Depart (Jakarta time)' })
    .fill(UNRELATED.departure);
  await page.getByRole('button', { name: 'Find journeys' }).click();
  await page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  return activateFirst(page);
}

const startedAt = Date.now();
const browserErrors = [];
let faultWindow = false;
let server;
let browser;
try {
  await waitForWeb();
  server = await startAcceptanceApi();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const pageA = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  const pageB = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  const streamRequests = [];
  pageA.on('request', (request) => {
    if (request.url().endsWith('/alerts/stream'))
      streamRequests.push(request.headers()['last-event-id'] ?? null);
  });
  await pageA.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith('/alerts/stream')) {
        const interruption = new AbortController();
        window.__interruptJourneyStream = () => interruption.abort();
        return nativeFetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, interruption.signal])
            : interruption.signal,
        });
      }
      return nativeFetch(input, init);
    };
  });
  for (const page of [pageA, pageB]) {
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Narrow suppression: only expected SSE-abort network noise inside the
      // controlled N3 fault-injection window. §5 of the D8/D9 brief.
      if (
        faultWindow &&
        message.location().url.endsWith('/alerts/stream') &&
        /net::ERR_ABORTED|Failed to load resource/i.test(message.text())
      )
        return;
      browserErrors.push(message.text());
    });
  }

  await verifyActivationRequiresSelection(pageB);
  await verifyInvalidCoordinates(pageB);
  await loadScenario(pageA);
  const a = await activateFirst(pageA, '6H');
  const b = await planUnrelated(pageB);
  assert.notEqual(a.owner, b.owner);
  assert.notEqual(a.journeyId, b.journeyId);
  const crossOwner = await apiJourney(`${a.journeyId}/alerts`, b.owner);
  assert.equal(crossOwner.response.status, 403, 'Cross-owner read must fail');
  assert.equal(crossOwner.body.statusCode, 403);

  await pageA
    .getByRole('textbox', { name: 'Progress time (Jakarta, controlled)' })
    .fill('2026-10-02T08:07');
  await pageA
    .getByRole('button', { name: 'Mark current part complete' })
    .click();
  await pageA.getByText(/1 of \d+ parts complete/).waitFor();

  // P06 real hazard-geometry negative control (bounded polygon, PostGIS).
  const hazard = await harnessEvent(
    server,
    { event: 'hazard_geometry' },
    /"status":"HAZARD_GEOMETRY_RECORDED"/,
  );
  assert.equal(hazard.status, 'HAZARD_GEOMETRY_RECORDED');
  assert.equal(hazard.event.operationalState, 'UNKNOWN');
  assert.equal(hazard.event.evidenceType, 'SIMULATED');
  assert.equal(
    hazard.event.provenanceRef,
    'demo:CONTROLLED:SIMULATED:hazard-geometry',
  );
  assert.notEqual(hazard.routeState, 'UNAVAILABLE');
  assert.equal(hazard.exposure.confirmedUnavailableCount, 0);
  assert.equal(hazard.guards.closureRejected, true);
  assert.equal(hazard.guards.invalidGeometryRejected, true);
  await pageA.waitForTimeout(800);
  assert.equal(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
    'Real hazard geometry must not create a blocking alert',
  );

  // Operational-state negative control retained as separate proxy (UNKNOWN).
  await inject(server, ROUTE_6H, 'TRANSJAKARTA', 'UNKNOWN');
  await pageA.waitForTimeout(1200);
  assert.equal(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
    'UNKNOWN operational state must not create an alert',
  );

  // P12 N1 missing journey selection: no fabricated journey, typed validation.
  const missingId = randomUUID();
  const missingSelection = await fetch(
    `${apiUrl}/journeys/${missingId}/activate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-journey-owner': a.owner,
      },
      body: JSON.stringify({}),
    },
  ).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => ({})),
  }));
  assert.ok(
    [400, 422].includes(missingSelection.status),
    `Missing selection must be rejected: ${missingSelection.status}`,
  );
  assert.ok(
    /selected_journey/i.test(JSON.stringify(missingSelection.body)),
    `Missing-selection response must identify selected_journey: ${JSON.stringify(missingSelection.body)}`,
  );
  const missingJourney = await apiJourney(missingId, a.owner);
  assert.equal(
    missingJourney.response.status,
    404,
    'No journey may be fabricated by a missing selection',
  );

  // P12 recovery without valid selection: typed validation, no persistence.
  const missingRecovery = await fetch(`${apiUrl}/recoveries`, {
    method: 'POST',
    headers: {
      'x-journey-owner': a.owner,
      'content-type': 'application/json',
      'idempotency-key': `n1-${missingId}`,
    },
    body: JSON.stringify({ original_journey_id: a.journeyId }),
  }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => ({})),
  }));
  assert.ok(
    [400, 422].includes(missingRecovery.status),
    `Incomplete recovery must be rejected: ${missingRecovery.status}`,
  );
  assert.ok(
    /original_journey_id.*impact_id.*recovery_at|recovery_at/i.test(
      JSON.stringify(missingRecovery.body),
    ),
  );
  // P12 N2 OTP outage at routing-client boundary (controlled fault, no shared OTP kill).
  let n2 = { status: null, code: null, elapsedMs: null, fabricated: false };
  let faultServer;
  try {
    const faultStarted = Date.now();
    faultServer = await startAcceptanceApi({
      PRODUCT_P1R_PORT: '3002',
      OTP_URL: 'http://127.0.0.1:9',
    });
    const planRes = await fetch('http://127.0.0.1:3002/api/v1/journeys/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: { latitude: -6.174612, longitude: 106.8304 },
        destination: { latitude: -6.278404, longitude: 106.82972 },
        departure_at: '2026-10-02T08:00:00+07:00',
        network_snapshot_id: '07d3393e-e7f4-5708-b467-807406c25a10',
        preference: 'BALANCED',
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const planBody = await planRes.json().catch(() => ({}));
    n2 = {
      status: planRes.status,
      code: planBody?.error?.code ?? planBody?.code ?? null,
      elapsedMs: Date.now() - faultStarted,
      fabricated: Array.isArray(planBody?.data) && planBody.data.length > 0,
    };
    assert.equal(n2.status, 503);
    assert.equal(n2.code, 'ROUTER_UNAVAILABLE');
    assert.equal(n2.fabricated, false);
    assert.ok(n2.elapsedMs < 15_000, 'No stuck loading on router outage');
  } finally {
    if (faultServer) await stopAcceptanceApi(faultServer);
  }
  // Restore: main API still serves after fault cleared (no shared OTP kill).
  {
    const restoreRes = await fetch(`${apiUrl}/journeys/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: { latitude: -6.174612, longitude: 106.8304 },
        destination: { latitude: -6.278404, longitude: 106.82972 },
        departure_at: '2026-10-02T08:00:00+07:00',
        network_snapshot_id: '07d3393e-e7f4-5708-b467-807406c25a10',
        preference: 'BALANCED',
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const restoreBody = await restoreRes.json().catch(() => ({}));
    n2.restoreStatus = restoreRes.status;
    n2.restoreAlternatives = Array.isArray(restoreBody?.data)
      ? restoreBody.data.length
      : 0;
    assert.ok([200, 201].includes(n2.restoreStatus));
    assert.ok(
      n2.restoreAlternatives > 0,
      'Recovery once restored must return alternatives',
    );
  }

  // Verified simulated operational restriction on canonical route 6H (deterministic ids for N4).
  const dupObservationId = randomUUID();
  const dupIncidentId = randomUUID();
  await inject(server, ROUTE_6H, 'TRANSJAKARTA', 'UNAVAILABLE', {
    observationId: dupObservationId,
    incidentId: dupIncidentId,
  });
  await pageA
    .getByRole('article', { name: 'Targeted journey alert' })
    .waitFor({ timeout: 30_000 });
  assert.match(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .innerText(),
    /Controlled simulation/,
  );
  assert.equal(
    await pageB
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
    'Unrelated journey must stay isolated',
  );
  const bAlerts = await apiJourney(`${b.journeyId}/alerts`, b.owner);
  assert.equal(bAlerts.body.data.length, 0);
  const aAlertsBeforeDup = await apiJourney(`${a.journeyId}/alerts`, a.owner);
  assert.equal(aAlertsBeforeDup.body.data.length, 1);

  // P12 N4 same-record duplicate: identical evidence idempotent, no duplicate alert.
  const dupSecond = await inject(
    server,
    ROUTE_6H,
    'TRANSJAKARTA',
    'UNAVAILABLE',
    {
      observationId: dupObservationId,
      incidentId: dupIncidentId,
    },
  );
  assert.equal(dupSecond.duplicates, 1);
  await pageA.waitForTimeout(1200);
  const aAlertsAfterDup = await apiJourney(`${a.journeyId}/alerts`, a.owner);
  assert.equal(
    aAlertsAfterDup.body.data.length,
    1,
    'No duplicate alert on identical re-ingest',
  );
  assert.equal(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    1,
  );
  // Conflicting evidence on same incidentId must be typed conflict, not silent overwrite.
  let conflictError = null;
  try {
    await inject(server, ROUTE_6H, 'TRANSJAKARTA', 'UNKNOWN', {
      observationId: dupObservationId,
      incidentId: dupIncidentId,
    });
  } catch (e) {
    conflictError = String(e.message ?? e);
  }
  assert.ok(
    conflictError &&
      conflictError.includes('CONTROLLED_OBSERVATION_IDENTITY_CONFLICT'),
    `Expected typed identity conflict, got ${conflictError}`,
  );
  // Lifecycle duplicate control (typed INCIDENT_IDENTITY_CONFLICT, no silent overwrite).
  const lifecycleDup = await harnessEvent(
    server,
    { event: 'incident_duplicate' },
    /"status":"INCIDENT_DUPLICATE_CONTROL"/,
  );
  assert.equal(lifecycleDup.conflict, 'INCIDENT_IDENTITY_CONFLICT');

  // Recovery proposal excludes the blocked canonical entity.
  const recoveryResponse = pageA.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/recoveries') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await pageA.getByRole('button', { name: 'Find another way' }).click();
  const recovery = (await (await recoveryResponse).json()).data;
  assert.equal(recovery.status, 'COMPLETED');
  assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
  for (const segment of recovery.proposed_journey?.segments ?? [])
    for (const binding of segment.entity_bindings)
      assert.notEqual(binding.canonical_entity_id, ROUTE_6H);
  await pageA.getByRole('region', { name: 'Recovery option' }).waitFor();

  // P12 N3: abort the established browser SSE read, not the shared API.
  const n3 = {
    interrupted: false,
    reconnected: false,
    requestsBefore: streamRequests.length,
    requestsAfter: null,
    replayCursor: null,
    alertsAfterReconnect: null,
  };
  assert.ok(
    n3.requestsBefore > 0,
    'SSE connection must exist before interruption',
  );
  faultWindow = true; // deliberate N3 abort window begins
  await pageA.evaluate(() => window.__interruptJourneyStream());
  await pageA
    .getByText(/Reconnecting to journey updates/)
    .waitFor({ timeout: 15_000 });
  n3.interrupted = true;
  await pageA
    .getByText('Connected to journey-specific updates.')
    .waitFor({ timeout: 45_000 });
  n3.reconnected = true;
  faultWindow = false; // controlled fault window closed
  n3.requestsAfter = streamRequests.length;
  n3.replayCursor = streamRequests.at(-1);
  assert.ok(n3.requestsAfter > n3.requestsBefore, 'SSE must subscribe again');
  assert.ok(n3.replayCursor, 'SSE must replay from last-event-id cursor');
  // Reconciled state: still exactly one current alert, no dupes, unrelated isolated.
  assert.equal(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    1,
    'Reconnect must reconcile to one current alert, no duplicate',
  );
  assert.equal(
    await pageB
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
  );
  const aAlertsAfterReconnect = await apiJourney(
    `${a.journeyId}/alerts`,
    a.owner,
  );
  assert.equal(aAlertsAfterReconnect.body.data.length, 1);
  n3.alertsAfterReconnect = aAlertsAfterReconnect.body.data.length;

  // Resolution: restriction clears, current alert closes, history retained.
  await inject(server, ROUTE_6H, 'TRANSJAKARTA', 'UNKNOWN');
  await pageA
    .getByText('No current disruption alert for this journey', {
      exact: false,
    })
    .waitFor({ timeout: 35_000 });
  assert.equal(
    await pageA
      .getByRole('article', { name: 'Targeted journey alert' })
      .count(),
    0,
  );
  await pageA.getByText(/Retained incident history/).click();
  await pageA.getByText('Resolved', { exact: false }).first().waitFor();

  await mkdir(evidenceDir, { recursive: true });
  const screenshots = [];
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 834, 1112],
    ['desktop', 1440, 900],
  ]) {
    await pageA.setViewportSize({ width, height });
    const overflow = await pageA.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, `${name} has horizontal overflow.`);
    const path = join(evidenceDir, `demo-scenario-${name}.png`);
    await pageA.screenshot({ path, fullPage: true });
    screenshots.push(path);
  }

  assert.deepEqual(
    browserErrors,
    [],
    `Browser console/page errors: ${browserErrors.join(' | ')}`,
  );
  assert.equal(screenshots.length, 3, 'Expected three responsive screenshots');
  const p06 = hazard;
  const p12 = {
    missing_selection_status: missingSelection.status,
    missing_recovery_status: missingRecovery.status,
    n2,
    n3,
    incident_duplicate: {
      secondDuplicates: dupSecond.duplicates,
      typedConflict: conflictError,
      lifecycle: lifecycleDup,
    },
  };
  console.log(
    JSON.stringify({
      status: 'PASS',
      evidence:
        'real OTP Gambir->Pejaten scenario loader, two isolated owners, controlled SIMULATED injection',
      affected_journey: a.journeyId,
      unrelated_journey: b.journeyId,
      hazard_only_no_alert: true,
      hazard_geometry: p06,
      p12,
      affected_alerts: 1,
      unrelated_alerts: 0,
      recovery_status: recovery.status,
      blocked_entity_avoided: true,
      resolutionClosedAlert: true,
      historyRetained: true,
      ownerIsolation: 'cross-owner read 403',
      invalidInputFeedback: true,
      keyboardDemoLoad: true,
      browserErrors: browserErrors.length,
      durationMs: Date.now() - startedAt,
      screenshots,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (server)
    await inject(server, ROUTE_6H, 'TRANSJAKARTA', 'UNKNOWN').catch(
      () => undefined,
    );
  await stopAcceptanceApi(server);
}
