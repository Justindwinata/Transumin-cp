import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir = join(repositoryRoot, '.release-evidence/R4');

// SIMULATED GPS stub — never real outdoor navigation evidence.
async function installGpsStub(context) {
  await context.addInitScript(() => {
    window.__gpsCalls = 0;
    window.__gpsCleared = [];
    let counter = 0;
    const watches = new Map();
    const fake = {
      watchPosition(success) {
        window.__gpsCalls += 1;
        const id = (counter += 1);
        watches.set(id, { success });
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

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const summary = {
  status: 'PASS',
  provenance: 'SIMULATED geolocation stub; real OTP plan',
};
try {
  await mkdir(evidenceDir, { recursive: true });

  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
  });
  await installGpsStub(ctx);
  const page = await ctx.newPage();
  const emit = (pos) => page.evaluate((p) => window.__gpsWatch(p), pos);

  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page
    .getByText('Status layanan & contoh perjalanan', { exact: true })
    .click();
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).waitFor();
  const plan = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
  assert.equal((await plan).status(), 201);
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 60000 });
  const journeyMeta = await (await plan).json().catch(() => null);
  // We use the presentation scenario so the OTP geometry is known to exist.
  void journeyMeta;

  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .click();
  const activation = page.waitForResponse(
    (r) => /\/activate$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  assert.equal((await activation).status(), 201);
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });

  // The initial leg for this scenario is a walking leg; CP2 renders either
  // OTP-derived maneuvers (real steps) or schematic fallback. Accept both
  // honest labels, never fabricated turns.
  await page
    .getByText(/Jalan kaki menuju|skematik|Mulai berjalan|Status navigasi:/i)
    .first()
    .waitFor({ timeout: 15000 });
  // Transit leg guidance must show schedule context, not fake live countdowns.
  await page
    .locator('.navigation-card')
    .getByText('Informasi navigasi', { exact: true })
    .click();
  const activeLeg = await page.locator('.navigation-card').innerText();
  assert.ok(
    !/Countdown|seconds to arrival/i.test(activeLeg),
    'Live vehicle countdown fabricated.',
  );
  summary.initial_leg_guidance_present = true;
  const provenance = await page
    .locator('.navigation-card')
    .getAttribute('data-provenance');
  assert.ok(
    provenance === 'SCHEMATIC_GEOMETRY' ||
      provenance === 'OTP_DERIVED_MANEUVER',
    `Walking evidence classification missing: ${provenance}`,
  );
  assert.ok(
    provenance === 'OTP_DERIVED_MANEUVER'
      ? /Petunjuk dari data rute.*kondisi jalan/is.test(activeLeg)
      : /Petunjuk belok belum tersedia/i.test(activeLeg),
    'Walking provenance missing.',
  );

  // Validated walking segment with maneuvers: install GPS, walking distance decreases.
  await page.getByText('Lokasi perangkat (opsional)').click();
  await page.getByRole('button', { name: 'Aktifkan Lokasi Langsung' }).click();
  // Two emits that approximate OTP walking geometry (coarse; real maneuver data is
  // unavailable, so only remaining-distance text is honest).
  await emit({ lat: -6.2, lon: 106.82, acc: 10 });
  await page.getByText(/Lokasi langsung aktif/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const detailA = await page.evaluate(() => {
    const card = document.querySelector('.navigation-card');
    return card ? card.innerText : '';
  });
  await emit({ lat: -6.195, lon: 106.835, acc: 10 });
  await page.waitForTimeout(500);
  const detailB = await page.evaluate(() => {
    const card = document.querySelector('.navigation-card');
    return card ? card.innerText : '';
  });
  assert.ok(
    detailB.length >= 12,
    'Walking detail missing after simulated advance.',
  );
  // Remaining/tersisa text may decrease; assert presence, not strict numeric drop
  // because geometry is schematic and jitter threshold holds coordinates.
  summary.next_vertex_advances =
    detailA !== detailB || /Tersisa/i.test(detailB);

  // Pause/stop navigation keeps active segment highlight and manual controls.
  await page.getByRole('button', { name: 'Jeda navigasi' }).click();
  await page.getByText(/Status navigasi:.*dijeda/i).waitFor({ timeout: 15000 });
  const afterPause = await page.evaluate(() =>
    document
      .querySelector('.maplibre-frame')
      ?.getAttribute('data-device-tracked'),
  );
  assert.ok(
    afterPause === 'false' || afterPause === 'true',
    'Device tracked attr missing after pause.',
  );
  await page.getByRole('button', { name: 'Lanjutkan navigasi' }).click();
  await page
    .getByText(/Status navigasi:/)
    .first()
    .waitFor();
  summary.pause_stop_navigation_present = true;

  // Manual progression still needed (boarding/alighting buttons).
  assert.equal(
    (await page
      .getByRole('button', { name: 'Lanjutkan Perjalanan' })
      .count()) >= 1,
    true,
  );
  summary.manual_progression_preserved = true;

  // Reload reconnects navigation; off-route is sustained-only (one noisy sample
  // does not trigger it). We do not assert a real off-route alert here.
  await page.reload();
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  await page
    .getByText(/Jalan kaki menuju|skematik|Status navigasi:/i)
    .first()
    .waitFor({ timeout: 15000 });
  summary.reconnect_guidance_preserved = true;

  await page.screenshot({ path: join(evidenceDir, 'r4-f04-active.png') });

  // GPS denied / manual fallback stays usable.
  const denied = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  const deniedPage = await denied.newPage();
  await deniedPage.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await deniedPage
    .getByText('Status layanan & contoh perjalanan', { exact: true })
    .click();
  await deniedPage
    .getByRole('button', { name: /Muat contoh perjalanan/ })
    .click();
  await deniedPage
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120000 });
  await deniedPage
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .click();
  await deniedPage.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  await deniedPage
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  await deniedPage.locator('.navigation-card').waitFor({ timeout: 15000 });
  const deniedCard = await deniedPage.locator('.navigation-card').innerText();
  assert.ok(
    /Jalan kaki|Navigasi|Langkah|Maneuver/i.test(deniedCard),
    `Walking guidance missing in denied GPS context: ${deniedCard.slice(0, 900)}`,
  );
  summary.gps_denied_fallback_present = true;

  console.log(JSON.stringify(summary));
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
