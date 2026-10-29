import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
assert.ok(dir);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const summary = {
  status: 'NOT VERIFIED',
  evidence: 'SIMULATED browser geolocation lifecycle; no physical GPS claim',
  cases: [],
};
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      ignoreHTTPSErrors: true,
    });
    await context.addInitScript(() => {
      const watches = new Map();
      let id = 0;
      let count = 0;
      let clears = 0;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          watchPosition(success, error) {
            count++;
            if (window.__gpsThrow) throw new Error('SIMULATED browser failure');
            watches.set(++id, { success, error });
            return id;
          },
          clearWatch(key) {
            clears++;
            watches.delete(key);
          },
        },
      });
      window.__gps = {
        fix({
          latitude = -6.2,
          longitude = 106.8,
          accuracy = 5,
          age = 0,
        } = {}) {
          for (const watch of watches.values())
            watch.success({
              coords: { latitude, longitude, accuracy, heading: null },
              timestamp: Date.now() - age,
            });
        },
        error(code) {
          for (const watch of [...watches.values()]) watch.error({ code });
        },
        stats() {
          return { count, clears, active: watches.size };
        },
        snapshot() {
          return [...watches.values()][0];
        },
      };
    });
    const page = await context.newPage();
    const errors = [];
    let planRequests = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().endsWith('/journeys/plan')) planRequests++;
    });
    await page.goto(process.env.PASSENGER_WEB_URL, {
      waitUntil: 'domcontentloaded',
    });
    const group = page.getByRole('group', {
      name: 'Dari — cara memilih lokasi',
    });
    await group
      .getByRole('button', { name: 'Lokasi saya', exact: true })
      .click();
    const controls = page.getByRole('region', {
      name: 'Kontrol lokasi pencarian',
    });
    const state = async (wanted) => {
      console.log(
        JSON.stringify({ suite: 'GPS_STABILITY', width, waitingFor: wanted }),
      );
      await controls
        .locator(`xpath=self::*[@data-gps-state="${wanted}"]`)
        .waitFor();
    };
    await page.evaluate(() => window.__gps.fix());
    await state('GPS_TRACKING');
    const count = await page.evaluate(() => window.__gps.stats().count);
    await page.evaluate(() => window.__gps.error(3));
    await state('GPS_ERROR');
    assert.equal(
      await page.evaluate(() => window.__gps.stats().active),
      1,
      'timeout must not destroy the watch',
    );
    await page.evaluate(() => window.__gps.fix({ latitude: -6.199 }));
    await state('GPS_TRACKING');
    assert.equal(
      await page.evaluate(() => window.__gps.stats().count),
      count,
      'next fix recovers the same watch',
    );
    await page.evaluate(() => window.__gps.error(1));
    await state('GPS_PERMISSION_DENIED');
    assert.equal(await page.evaluate(() => window.__gps.stats().active), 0);
    await controls.getByRole('button', { name: 'Coba GPS lagi' }).click();
    await page.evaluate(() => window.__gps.fix({ accuracy: 80 }));
    await state('GPS_MAP_CONTEXT');
    await controls
      .getByRole('button', { name: 'Gunakan perkiraan sebagai pin' })
      .click();
    assert.equal(
      await group
        .getByRole('button', { name: 'Titik peta', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await group
      .getByRole('button', { name: 'Lokasi saya', exact: true })
      .click();
    await page.evaluate(() => window.__gps.fix());
    await page.clock.install();
    await page.clock.fastForward(31_000);
    await state('GPS_STALE');
    await controls
      .getByRole('button', { name: 'Berhenti berbagi lokasi' })
      .click();
    await state('GPS_STOPPED');
    await page.evaluate(() => {
      window.__gpsThrow = true;
    });
    await controls.getByRole('button', { name: 'Coba GPS lagi' }).click();
    await state('GPS_ERROR');
    await page.evaluate(() => {
      window.__gpsThrow = false;
    });
    await controls.getByRole('button', { name: 'Coba GPS lagi' }).click();
    await page.evaluate(() => window.__gps.fix());
    await state('GPS_TRACKING');
    await controls
      .getByRole('button', { name: 'Berhenti berbagi lokasi' })
      .click();
    await state('GPS_STOPPED');
    assert.equal(
      planRequests,
      0,
      'geolocation must not send coordinates to planning automatically',
    );
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    assert.ok(overflow <= 1);
    await page.screenshot({
      path: join(dir, `gps-stability-${width}.png`),
      fullPage: true,
    });
    summary.cases.push({
      width,
      status: 'PASS',
      timeoutRecovery: true,
      permissionRevocation: true,
      retry: true,
      coarsePinConsent: true,
      staleRejected: true,
      synchronousFailureHandled: true,
      automaticPlanningRequests: planRequests,
      overflow,
    });
    await context.close();
  }
  summary.status = 'PASS';
} finally {
  await writeFile(
    join(dir, 'gps-stability.json'),
    JSON.stringify(summary, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(summary));
