import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir = join(repositoryRoot, '.release-evidence/R4');
const departure = '2026-10-02T08:00';

// SIMULATED device stream: overrides navigator.geolocation inside one
// isolated browser context. Never real field navigation evidence.
async function installGpsStub(context) {
  await context.addInitScript(() => {
    window.__gpsCalls = 0;
    window.__gpsCleared = [];
    let counter = 0;
    const watches = new Map();
    const fake = {
      watchPosition(success, error) {
        window.__gpsCalls += 1;
        const id = (counter += 1);
        watches.set(id, { success, error });
        window.__gpsWatch = (pos) => {
          const entry = watches.get(id);
          if (!entry) return;
          entry.success({
            coords: {
              latitude: pos.lat,
              longitude: pos.lon,
              accuracy: pos.acc ?? 10,
              heading: pos.head ?? null,
              altitude: null,
              altitudeAccuracy: null,
              speed: null,
            },
            timestamp: pos.t ?? Date.now(),
          });
        };
        return id;
      },
      clearWatch(id) {
        window.__gpsCleared.push(id);
        watches.delete(id);
      },
      getCurrentPosition(_success, error) {
        if (error) error({ code: 2, message: 'unavailable' });
      },
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: () => fake,
    });
  });
}

async function waitForApp(page) {
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  const config = await page.request.get(`${webUrl}/api/passenger/config`);
  assert.equal(config.status(), 200, 'Passenger routing snapshot not ready.');
  await page.getByRole('button', { name: 'Cari perjalanan' }).waitFor();
  await page
    .locator('.maplibre-frame canvas')
    .first()
    .waitFor({ timeout: 30000 });
}

async function choosePlace(page, field, query, option) {
  await page.getByRole('combobox', { name: field }).fill(query);
  await page.getByRole('option', { name: option }).first().click();
}

async function setMode(page, endpoint, mode) {
  const group = page.getByRole('group', {
    name: `${endpoint === 'origin' ? 'From' : 'To'} input method`,
  });
  await group.getByRole('button', { name: mode }).click();
}

async function clickMap(page, fx, fy) {
  const canvas = page.locator('.maplibre-frame canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert.ok(box && box.width > 0, 'Map canvas has no layout.');
  assert.ok(
    box.y >= 0 && box.y + box.height <= 850,
    'Map canvas not in viewport after scroll.',
  );
  await canvas.hover();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function pinValue(page, endpoint) {
  return page.evaluate((which) => {
    const frame = document.querySelector('.maplibre-frame');
    return frame?.getAttribute(
      which === 'origin' ? 'data-pin-origin' : 'data-pin-destination',
    );
  }, endpoint);
}

async function clickMapForPin(page, endpoint, fx, fy) {
  const attr =
    endpoint === 'origin' ? 'data-pin-origin' : 'data-pin-destination';
  await clickMap(page, fx, fy);
  await page
    .waitForFunction(
      (name) => {
        const value = document
          .querySelector('.maplibre-frame')
          ?.getAttribute(name);
        return !!value && value !== 'none';
      },
      attr,
      { timeout: 8000 },
    )
    .catch(() => undefined);
  return pinValue(page, endpoint);
}

async function submitPlan(page) {
  const planning = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: 'Cari perjalanan' }).click();
  const response = await planning;
  const body = await response.json().catch(() => null);
  return { status: response.status(), body };
}

// Plan 1: supported stop -> arbitrary map pin. Retries a few pin pairs
// against real OTP; pins are ordinary clicks, never hardcoded coords.
async function planStopToPin(page) {
  await choosePlace(page, 'From', 'Harmoni', /^Harmoni TransJakarta · station/);
  await setMode(page, 'destination', 'Map pin');
  await page.getByRole('textbox', { name: 'Berangkat (WIB)' }).fill(departure);
  const pairs = [
    [0.68, 0.58],
    [0.6, 0.45],
    [0.75, 0.65],
  ];
  for (const [fx, fy] of pairs) {
    const value = await clickMapForPin(page, 'destination', fx, fy);
    assert.ok(
      value && value !== 'none',
      'Destination pin not set by map click.',
    );
    const planned = await submitPlan(page);
    if (planned.status === 201 && (planned.body?.data ?? []).length > 0)
      return planned.body.data;
  }
  assert.fail('Real OTP returned no alternatives for stop-to-pin attempts.');
  return [];
}

async function planPinToCurrent(page, emit) {
  await setMode(page, 'origin', 'Map pin');
  await setMode(page, 'destination', 'Current');
  const attempts = [
    [0.35, 0.35],
    [0.5, 0.4],
    [0.6, 0.55],
    [0.3, 0.6],
  ];
  let originValue = await pinValue(page, 'origin');
  for (const [fx, fy] of attempts) {
    if (originValue && originValue !== 'none') break;
    originValue = await clickMapForPin(page, 'origin', fx, fy);
  }
  assert.ok(
    originValue && originValue !== 'none',
    'Origin pin not set by map click.',
  );
  await emit({ lat: -6.2, lon: 106.82, acc: 10 });
  const planned = await submitPlan(page);
  assert.equal(
    planned.status,
    201,
    `Pin-to-current plan failed: ${JSON.stringify(planned.body?.error ?? planned.body)}`,
  );
  assert.ok(
    (planned.body?.data ?? []).length > 0,
    'Real OTP returned no pin-to-current alternative.',
  );
  return planned.body.data;
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--deny-permission-prompts'],
});
const summary = { status: 'PASS' };
try {
  await mkdir(evidenceDir, { recursive: true });

  // ---- F-02 door-to-door + F-03 preference integrity (SIMULATED GPS stub for Current mode) ----
  const stubbed = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
  });
  await installGpsStub(stubbed);
  const page = await stubbed.newPage();
  const emit = (pos) => page.evaluate((p) => window.__gpsWatch(p), pos);
  await waitForApp(page);
  assert.equal(
    await page.evaluate(() => window.__gpsCalls),
    0,
    'watchPosition ran before any user action.',
  );

  const stopToPin = await planStopToPin(page);
  summary.stop_to_pin_alternatives = stopToPin.length;
  const balancedBest = stopToPin[0].journey_id;
  const choices = page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button');
  await choices.first().waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () => {
      const value = document
        .querySelector('.maplibre-frame')
        ?.getAttribute('data-marker-count');
      return value !== null && Number(value) >= 2;
    },
    undefined,
    { timeout: 30000 },
  );
  assert.ok(
    (await page.locator('.maplibre-marker').count()) >= 2,
    'Origin/destination markers missing after pin plan.',
  );

  // F-03: switching preference must replan, not just recolor the button.
  const replan = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page.getByLabel('Urutkan berdasarkan').selectOption('LEAST_WALKING');
  const relearned = await (await replan).json().catch(() => null);
  const relearnedBest = relearned?.data?.[0]?.journey_id ?? null;
  summary.preference_replanned = true;
  if (relearnedBest && relearnedBest !== balancedBest) {
    summary.preference_effect = 'best candidate changed';
  } else {
    await page
      .getByText(/same best candidate/)
      .first()
      .waitFor({ timeout: 15000 });
    summary.preference_effect = 'identical best honestly explained';
  }

  // Fresh pre-plan map for the pin-available flow.
  await page.reload();
  await page.getByRole('button', { name: 'Cari perjalanan' }).waitFor();
  await page
    .locator('.maplibre-frame canvas')
    .first()
    .waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.maplibre-frame')
        ?.getAttribute('data-selection-mode') === 'none',
    undefined,
    { timeout: 30000 },
  );
  const pinToCurrent = await planPinToCurrent(page, emit);
  summary.pin_to_current_alternatives = pinToCurrent.length;

  // Invalid coordinates are rejected client-side, never sent as a route.
  await setMode(page, 'origin', 'Coordinates');
  await page.getByRole('textbox', { name: 'Lintang titik awal' }).fill('999');
  await page.getByRole('textbox', { name: 'Bujur titik awal' }).fill('106.8');
  await page.getByRole('button', { name: 'Cari perjalanan' }).click();
  await page
    .getByText(/valid latitude and longitude/)
    .waitFor({ timeout: 15000 });
  summary.invalid_coordinate_rejected = true;

  // ---- Activate, then F-01 real-time GPS stream (SIMULATED positions) ----
  await page.reload();
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).waitFor();
  const scenarioPlan = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
  assert.equal(
    (await scenarioPlan).status(),
    201,
    'Presentation scenario plan failed.',
  );
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 60000 });
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .click();
  const activation = page.waitForResponse(
    (response) =>
      /\/activate$/.test(response.url()) &&
      response.request().method() === 'POST',
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  assert.equal((await activation).status(), 201, 'Real activation failed.');
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });

  await page.getByText('Lokasi perangkat (opsional)').click();
  await page.getByRole('button', { name: 'Aktifkan Lokasi Langsung' }).click();
  await emit({ lat: -6.19, lon: 106.83, acc: 10 });
  await page.getByText(/Lokasi langsung aktif/).waitFor({ timeout: 15000 });
  const first = await page.evaluate(() =>
    document
      .querySelector('.maplibre-frame')
      ?.getAttribute('data-device-tracked-value'),
  );
  assert.ok(
    first && first !== 'none',
    'Device marker missing after first fix.',
  );
  await emit({ lat: -6.1912, lon: 106.8312, acc: 10 });
  await page.waitForFunction(
    (before) =>
      document
        .querySelector('.maplibre-frame')
        ?.getAttribute('data-device-tracked-value') !== before,
    first,
    { timeout: 15000 },
  );
  summary.marker_moved_with_stream = true;

  await emit({ lat: -6.1912, lon: 106.8312, acc: 200 });
  await page.getByText(/untuk konteks peta/).waitFor({ timeout: 15000 });
  summary.map_context_shown = true;
  await emit({ lat: -6.1912, lon: 106.8312, acc: 300 });
  await page.getByText(/Akurasi lokasi rendah/).waitFor({ timeout: 15000 });
  summary.low_accuracy_shown = true;

  await page
    .getByRole('button', { name: 'Kamera bebas (berhenti mengikuti)' })
    .click();
  await page.getByRole('button', { name: 'Ikuti lokasi saya' }).waitFor();
  await page.getByRole('button', { name: 'Ikuti lokasi saya' }).click();
  await page
    .getByRole('button', { name: 'Kamera bebas (berhenti mengikuti)' })
    .waitFor();
  summary.follow_toggle = true;

  await page.getByRole('button', { name: 'Berhenti berbagi lokasi' }).click();
  await page.getByText(/Berbagi lokasi dihentikan/).waitFor();
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector('.maplibre-frame')
        ?.getAttribute('data-device-tracked'),
    ),
    'false',
    'Device marker still shown after opt-out.',
  );
  assert.ok(
    (await page.evaluate(() => window.__gpsCleared)).length >= 1,
    'clearWatch not called on opt-out.',
  );
  summary.opt_out_stops_watch = true;

  // Manual journey survives without GPS.
  await page
    .getByRole('button', { name: /Lanjutkan Perjalanan|Selesaikan Perjalanan/ })
    .click();
  await page.getByText(/1 of \d+ parts complete/).waitFor({ timeout: 30000 });
  summary.manual_progress_after_opt_out = true;

  const storage = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage).filter(([key, value]) =>
        /geo|gps|location/i.test(`${key} ${value}`),
      ),
    ),
  );
  assert.deepEqual(storage, {}, 'GPS/location data persisted in localStorage.');
  await page.screenshot({ path: join(evidenceDir, 'r4-f01-active.png') });

  // Reload must not auto-request permission.
  await page.reload();
  await page.getByRole('button', { name: 'Cari perjalanan' }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__gpsCalls),
    0,
    'watchPosition auto-started after reload.',
  );
  summary.no_auto_permission_after_reload = true;

  // ---- F-01 denied context: journey must survive ----
  const denied = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  const deniedPage = await denied.newPage();
  await waitForApp(deniedPage);
  await deniedPage
    .getByRole('button', { name: /Muat contoh perjalanan/ })
    .click();
  await deniedPage
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120000 });
  const deniedActivation = deniedPage.waitForResponse(
    (response) =>
      /\/activate$/.test(response.url()) &&
      response.request().method() === 'POST',
    { timeout: 60000 },
  );
  await deniedPage.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  await deniedActivation;
  await deniedPage
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  await deniedPage.getByText('Lokasi perangkat (opsional)').click();
  await deniedPage
    .getByRole('button', { name: 'Aktifkan Lokasi Langsung' })
    .click();
  await deniedPage.getByText(/Izin lokasi ditolak/).waitFor({ timeout: 15000 });
  await deniedPage
    .getByRole('button', { name: /Lanjutkan Perjalanan|Selesaikan Perjalanan/ })
    .click();
  await deniedPage
    .getByText(/1 of \d+ parts complete/)
    .waitFor({ timeout: 30000 });
  summary.denied_journey_survives = true;

  console.log(
    JSON.stringify({
      ...summary,
      gps_provenance:
        'SIMULATED geolocation stub in isolated contexts; real OTP plan/activate through 127.0.0.1:3000 proxy',
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
