import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// This suite uses an isolated CP2 runtime. Planning responses below are
// deliberate FAULT_INJECTION through browser routes, never real outage/NO_PATH.
await assertCp2Runtime();

const web = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const snapshot = '11111111-1111-4111-8111-111111111111';
const cases = [];
let browser;
let context;
let page;

function mark(name) {
  cases.push(name);
  console.log(`PASS ${name}`);
}
async function waitApp() {
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).waitFor();
}
async function submit() {
  await page.getByRole('button', { name: 'Cari perjalanan' }).click();
}
async function planRequest() {
  return page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/passenger/journeys/plan') &&
      request.method() === 'POST',
    { timeout: 10_000 },
  );
}
async function setCoordinates(origin, destination) {
  await page
    .getByRole('button', { name: 'Koordinat', exact: true })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Koordinat', exact: true })
    .nth(1)
    .click();
  await page.getByLabel('Lintang titik awal').fill(String(origin[0]));
  await page.getByLabel('Bujur titik awal').fill(String(origin[1]));
  await page.getByLabel('Lintang tujuan').fill(String(destination[0]));
  await page.getByLabel('Bujur tujuan').fill(String(destination[1]));
}

try {
  browser = await chromium.launch(
    existsSync(chrome)
      ? { executablePath: chrome, headless: true }
      : { headless: true },
  );
  context = await browser.newContext({
    ignoreHTTPSErrors: true, // Owned loopback rehearsal uses a self-signed certificate.
    viewport: { width: 1280, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: -6.2088, longitude: 106.8456, accuracy: 12 },
  });
  page = await context.newPage();

  let configCalls = 0;
  let configRetryAllowed = false;
  await page.route('**/api/passenger/config', async (route) => {
    configCalls += 1;
    if (!configRetryAllowed) {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'FAULT_INJECTION',
            message: 'SIMULATED config failure',
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { data: { network_snapshot_id: snapshot } } });
  });
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('alert')
    .filter({ hasText: 'SIMULATED config failure' })
    .waitFor();
  configRetryAllowed = true;
  const callsBeforeReload = configCalls;
  const configRetry = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/config') &&
      response.status() === 200,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await configRetry;
  await waitApp();
  assert.ok(
    configCalls > callsBeforeReload,
    'config reload retry did not refetch config',
  );
  mark('config failure and explicit reload retry');

  // Search results are routed SAMPLE fixture only; no provider call is made.
  await page.route('**/api/passenger/transit/places?*', async (route) => {
    const q = (
      new URL(route.request().url()).searchParams.get('q') ?? ''
    ).trim();
    const place = (name, id) => ({
      place_id: id,
      external_id: id,
      name,
      kind: 'STATION',
      product_mode: 'MRT_JAKARTA',
      latitude: -6.2,
      longitude: 106.8,
    });
    if (/^old/i.test(q))
      await new Promise((resolve) => setTimeout(resolve, 600));
    const body = /none/i.test(q)
      ? { data: [] }
      : {
          data: [
            place(
              /south/i.test(q)
                ? 'South Station SAMPLE'
                : 'North Station SAMPLE',
              `sample-${q}`,
            ),
          ],
        };
    await route.fulfill({ json: body }).catch(() => undefined);
  });
  const from = page.getByRole('combobox', { name: 'Dari' });
  const to = page.getByRole('combobox', { name: 'Ke' });
  await from.fill('North');
  await page.getByRole('option', { name: /North Station SAMPLE/ }).click();
  await to.fill('South');
  await page.getByRole('option', { name: /South Station SAMPLE/ }).click();
  assert.equal(await page.locator('.place-confirmation').count(), 2);
  mark('stop/station autocomplete selection');

  // Switching methods discards previous method selection. Pin click and drag
  // happen on the map; coordinates stay local to the page.
  await page
    .getByRole('button', { name: 'Titik peta', exact: true })
    .first()
    .click();
  const map = page.getByRole('application', {
    name: /Peta rute terpilih/,
  });
  await map.waitFor();
  await page
    .getByText(/Choose origin and destination/, { exact: false })
    .waitFor();
  const canvas = map.locator('.maplibregl-canvas');
  await canvas.waitFor();
  const bounds = await canvas.boundingBox();
  assert.ok(bounds?.width && bounds.height, 'map canvas has no layout');
  await page.mouse.click(
    bounds.x + bounds.width * 0.45,
    bounds.y + bounds.height * 0.52,
  );
  await page.getByText(/Origin pin selected on map/).waitFor();
  const pin = page.locator('.maplibre-marker.private-pin.origin');
  await pin.waitFor();
  assert.notEqual(await map.getAttribute('data-pin-origin'), 'none');
  assert.equal(
    await page.locator('.place-confirmation').count(),
    1,
    'place not cleared on switch to pin',
  );
  const beforeDrag = await map.getAttribute('data-pin-origin');
  const box = await pin.boundingBox();
  assert.ok(box, 'pin has no layout');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.6,
    bounds.y + bounds.height * 0.48,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDrag = await map.getAttribute('data-pin-origin');
  assert.ok(
    afterDrag && afterDrag !== 'none' && afterDrag !== beforeDrag,
    'pin drag did not move pin',
  );
  await page
    .getByRole('button', { name: 'Koordinat', exact: true })
    .first()
    .click();
  assert.equal(
    await map.getAttribute('data-selection-mode'),
    'none',
    'method switch left map in pin-selection mode',
  );
  assert.equal(
    await page.locator('.maplibre-marker.private-pin.origin').count(),
    1,
    'coordinate switch unexpectedly removed retained pin context',
  );
  mark('pin click, pin drag, method-switch changes authority');

  // No matching stop or station stays empty with its dedicated status cue.
  await page
    .getByRole('button', { name: 'Tempat', exact: true })
    .first()
    .click();
  await from.fill('none');
  await page.getByText(/No matching place\./).waitFor();
  assert.equal(await page.locator('.place-options').count(), 0);
  await from.fill('North');
  await page.getByRole('option', { name: /North Station SAMPLE/ }).waitFor();
  assert.equal(await page.getByText(/No matching place\./).count(), 0);
  mark('empty place results and recovery');

  // Rapid stale query race: the older slower "old" fixture resolves after the
  // newer query and must not replace it. 280ms exceeds the 240ms debounce.
  await from.fill('old');
  await page.waitForTimeout(280);
  await from.fill('North latest');
  await page.getByRole('option', { name: /North Station SAMPLE/ }).waitFor();
  await page.waitForTimeout(700);
  assert.equal(
    (await page.getByText(/North Station SAMPLE/).count()) > 0,
    true,
  );
  mark('rapid stale place-query suppression');

  // Malformed and empty coordinates are rejected client-side before any
  // planning request. Identical endpoints go through and surface validation.
  await setCoordinates(['x', 106.8], [-6.21, 106.81]);
  const noRequestInvalid = planRequest();
  await submit();
  await page
    .getByRole('alert')
    .filter({ hasText: 'valid latitude and longitude' })
    .waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Cari perjalanan' }).isDisabled(),
    false,
  );
  await noRequestInvalid
    .then(() => assert.fail('invalid coordinates sent plan request'))
    .catch((error) => {
      if (error.name !== 'TimeoutError') throw error;
    });
  await page.getByLabel('Lintang titik awal').fill('');
  await submit();
  await page
    .getByRole('alert')
    .filter({ hasText: 'valid latitude and longitude' })
    .waitFor();
  await page.getByLabel('Lintang titik awal').fill('-6.2');
  await page.getByLabel('Lintang tujuan').fill('-6.2');
  await page.getByLabel('Bujur tujuan').fill('106.8');
  await page.getByLabel('Bujur titik awal').fill('106.8');
  let sameRequests = 0;
  const sameHandler = async (route) => {
    sameRequests += 1;
    await route.fulfill({
      status: 422,
      json: {
        error: {
          code: 'FAULT_INJECTION',
          message: 'Origin and destination must be different.',
        },
      },
    });
  };
  await page.route('**/api/passenger/journeys/plan', sameHandler);
  await submit();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Origin and destination must be different.' })
    .waitFor();
  assert.equal(sameRequests, 1);
  await page.unroute('**/api/passenger/journeys/plan', sameHandler);
  mark(
    'invalid and empty rejection before request; same-endpoint validation surfaced',
  );

  // Explicit user consent starts SIMULATED browser location request. Method
  // switches to Current then Coordinates; no device coordinate is persisted.
  await page
    .getByRole('button', { name: 'Lokasi saya', exact: true })
    .first()
    .click();
  await page
    .getByText(/Fresh accurate device location ready/)
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole('button', { name: 'Koordinat', exact: true })
    .first()
    .click();
  assert.deepEqual(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /geo|gps|location/i.test(key)),
    ),
    [],
  );
  mark('SIMULATED geolocation consent, method switching, no persistence');

  // Fault statuses are explicitly injected at same-origin route boundary. Retry
  // once after each failure; retry succeeds only as deterministic empty result.
  for (const status of [400, 422, 500]) {
    let injected = 0;
    const handler = async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      injected += 1;
      if (injected === 1) {
        await route.fulfill({
          status,
          json: {
            error: {
              code: 'FAULT_INJECTION',
              message: `SIMULATED HTTP ${status}`,
            },
          },
        });
      } else {
        await route.fulfill({ status: 201, json: { data: [] } });
      }
    };
    await page.route('**/api/passenger/journeys/plan', handler);
    await setCoordinates([-6.2, 106.8], [-6.21, 106.81]);
    const first = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/passenger/journeys/plan') &&
        response.request().method() === 'POST',
    );
    await submit();
    assert.equal((await first).status(), status);
    await page
      .getByRole('alert')
      .filter({ hasText: `SIMULATED HTTP ${status}` })
      .waitFor();
    const retry = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/passenger/journeys/plan') &&
        response.request().method() === 'POST',
    );
    await submit();
    assert.equal((await retry).status(), 201);
    await page
      .getByRole('status')
      .filter({ hasText: 'No journey was found' })
      .waitFor();
    assert.equal(
      injected,
      2,
      `expected exactly one safe retry after FAULT_INJECTION ${status}`,
    );
    await page.unroute('**/api/passenger/journeys/plan', handler);
    mark(`FAULT_INJECTION HTTP ${status}; safe user retry; empty result state`);
  }

  console.log(
    JSON.stringify({
      status: 'PASS',
      cases,
      provenance:
        'SAMPLE search fixture; SIMULATED browser geolocation; FAULT_INJECTION planning errors only; no provider calls; no protected writes',
    }),
  );
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
