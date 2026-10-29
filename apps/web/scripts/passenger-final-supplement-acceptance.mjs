import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Mutable journeys: isolated CLI --suite=FINAL only. Never run beside other
// fixed-port suites. SIMULATED device coordinates; genuine API/OTP responses.
await assertCp2Runtime();
const web = process.env.PASSENGER_WEB_URL ?? process.env.M7_WEB_URL;
assert.ok(web, 'Isolated runner web URL required');
const evidenceDir =
  process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR ??
  new URL('../../../.release-evidence/FINAL', import.meta.url).pathname;
const origin = { latitude: -6.174612, longitude: 106.8304 };
const destination = { latitude: -6.278404, longitude: 106.82972 };
const summary = {
  suite: 'FINAL',
  status: 'NOT VERIFIED',
  provenance: 'SIMULATED granted geolocation; real scheduled OTP journeys',
  results: [],
};
const browser = await chromium.launch({
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: web.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
});

async function data(response) {
  const body = await response.json();
  assert.ok(
    response.ok(),
    `HTTP ${response.status()}: ${JSON.stringify(body?.error ?? body)}`,
  );
  return body.data ?? body;
}
function jakarta(at) {
  return new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
      permissions: ['geolocation'],
      geolocation: { ...origin, accuracy: 5 },
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const result = { width, preferences: [], provider_clicks: [] };
      summary.results.push(result);
      const responseFor = (suffix, method) =>
        page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/passenger/${suffix}`) &&
            response.request().method() === method,
          { timeout: 120_000 },
        );
      async function mutation(button, suffix, method = 'POST') {
        console.log(JSON.stringify({ width, action: button, suffix, method }));
        const pending = responseFor(suffix, method);
        await page.getByRole('button', { name: button, exact: true }).click();
        try {
          return await data(await pending);
        } catch (error) {
          throw new Error(
            `${suffix}: ${error.message}; alerts=${await page.getByRole('alert').allTextContents()}`,
          );
        }
      }
      async function authoritative(id) {
        return data(
          await context.request.get(`${web}/api/passenger/journeys/${id}`),
        );
      }
      async function plan(preference, action) {
        const pending = responseFor('journeys/plan', 'POST');
        await action();
        const response = await pending;
        const request = response.request().postDataJSON();
        assert.equal(request.preference, preference);
        assert.deepEqual(request.origin, origin);
        assert.deepEqual(request.destination, destination);
        assert.equal(request.departure_at, '2026-10-02T08:00:00+07:00');
        const body = await response.json();
        assert.equal(response.status(), 201, JSON.stringify(body?.error));
        assert.equal(body.meta?.provenance?.evidence_type, 'SCHEDULED');
        const rows = body.data;
        assert.ok(
          Array.isArray(rows) && rows.length,
          'Real OTP returned no routes',
        );
        for (const row of rows) {
          assert.equal(row.routing_context.provider, 'OTP');
          assert.ok(row.segments.length > 0);
        }
        await page
          .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
          .waitFor();
        result.preferences.push({
          preference,
          request,
          journey_ids: rows.map((row) => row.journey_id),
        });
        return rows;
      }
      await page.goto(web, { waitUntil: 'domcontentloaded' });
      await data(await context.request.get(`${web}/api/passenger/config`));
      await page
        .getByRole('button', { name: 'Cari perjalanan', exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          async () =>
            (await navigator.permissions.query({ name: 'geolocation' })).state,
        ),
        'granted',
      );
      await page
        .getByRole('group', { name: 'Dari — cara memilih lokasi', exact: true })
        .getByRole('button', { name: 'Lokasi saya', exact: true })
        .click();
      await page.getByText('Lokasi siap digunakan.', { exact: true }).waitFor();
      await page
        .getByRole('group', { name: 'Ke — cara memilih lokasi', exact: true })
        .getByRole('button', { name: 'Koordinat', exact: true })
        .click();
      await page
        .getByLabel('Lintang tujuan', { exact: true })
        .fill(String(destination.latitude));
      await page
        .getByLabel('Bujur tujuan', { exact: true })
        .fill(String(destination.longitude));
      await page
        .getByLabel('Berangkat (WIB)', { exact: true })
        .fill('2026-10-02T08:00');
      let rows = await plan('BALANCED', () =>
        page
          .getByRole('button', { name: 'Cari perjalanan', exact: true })
          .click(),
      );
      for (const preference of [
        'FASTEST',
        'FEWEST_TRANSFERS',
        'LEAST_WALKING',
      ]) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page
          .getByRole('button', { name: 'Cari perjalanan', exact: true })
          .waitFor();
        await page
          .getByRole('group', {
            name: 'Dari — cara memilih lokasi',
            exact: true,
          })
          .getByRole('button', { name: 'Koordinat', exact: true })
          .click();
        await page
          .getByLabel('Lintang titik awal', { exact: true })
          .fill(String(origin.latitude));
        await page
          .getByLabel('Bujur titik awal', { exact: true })
          .fill(String(origin.longitude));
        await page
          .getByRole('group', { name: 'Ke — cara memilih lokasi', exact: true })
          .getByRole('button', { name: 'Koordinat', exact: true })
          .click();
        await page
          .getByLabel('Lintang tujuan', { exact: true })
          .fill(String(destination.latitude));
        await page
          .getByLabel('Bujur tujuan', { exact: true })
          .fill(String(destination.longitude));
        await page
          .getByLabel('Berangkat (WIB)', { exact: true })
          .fill('2026-10-02T08:00');
        await page.getByLabel('Urutkan berdasarkan').selectOption(preference);
        rows = await plan(preference, () =>
          page
            .getByRole('button', { name: 'Cari perjalanan', exact: true })
            .click(),
        );
      }
      let active = await mutation(
        'Mulai Perjalanan',
        `journeys/${rows[0].journey_id}/activate`,
      );
      assert.equal(active.status, 'ACTIVE');
      const firstId = active.journey_id;
      const beforeOffline = await authoritative(firstId);

      // Real offline network failure after explicit progress action, not fake API data.
      const leg = active.segments[active.progress.completed_segment_count];
      const offlineButton =
        leg.mode === 'WALK'
          ? active.segments.length === 1
            ? 'Selesaikan Perjalanan'
            : 'Lanjutkan Perjalanan'
          : 'Saya Sudah Naik';
      await page
        .getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)', {
          exact: true,
        })
        .fill(jakarta(leg.start_at));
      await context.setOffline(true);
      try {
        assert.equal(await page.evaluate(() => navigator.onLine), false);
        await page
          .getByRole('button', { name: offlineButton, exact: true })
          .click();
        await page
          .getByRole('alert')
          .filter({
            hasText:
              /fetch|network|offline|request|Connection interrupted|Outcome is unknown/i,
          })
          .first()
          .waitFor();
        result.offline_error = await page
          .getByRole('alert')
          .filter({
            hasText:
              /fetch|network|offline|request|Connection interrupted|Outcome is unknown/i,
          })
          .first()
          .innerText();
      } finally {
        await context.setOffline(false);
      }
      assert.equal(await page.evaluate(() => navigator.onLine), true);
      assert.deepEqual(
        await authoritative(firstId),
        beforeOffline,
        'Offline action changed authoritative journey',
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByRole('heading', { name: 'Perjalanan aktif Anda', exact: true })
        .waitFor();
      assert.deepEqual(
        await authoritative(firstId),
        beforeOffline,
        'Reconnect changed authoritative journey',
      );
      result.offline_authoritative_unchanged = true;

      const providers = [
        ['Gojek', 'https://gojek.com'],
        ['Grab', 'https://grab.com'],
        ['Bluebird', 'https://bluebirdgroup.com/'],
      ];
      // Context routes include initial popup requests. Abort before provider network.
      const intercepted = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (providers.some(([, href]) => new URL(href).origin === url.origin)) {
          intercepted.push(route.request().url());
          await route.abort('blockedbyclient');
        } else await route.continue();
      });
      for (const [name, href] of providers) {
        const link = page.getByRole('link', {
          name: `Lanjutkan dengan ${name}`,
          exact: true,
        });
        assert.equal(await link.getAttribute('href'), href);
        assert.equal(await link.getAttribute('target'), '_blank');
        const rel = (await link.getAttribute('rel')).split(/\s+/);
        assert.ok(rel.includes('noopener') && rel.includes('noreferrer'));
        const count = intercepted.length;
        const popupPending = page.waitForEvent('popup');
        const requestPending = context.waitForEvent('request', {
          predicate: (request) =>
            new URL(request.url()).origin === new URL(href).origin,
        });
        await link.click();
        const popup = await popupPending;
        await requestPending;
        // Route handler completion, not an arbitrary delay.
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        assert.equal(intercepted.length, count + 1);
        assert.equal(intercepted.at(-1), new URL(href).href);
        await popup.close();
        result.provider_clicks.push({ name, href, intercepted: true });
      }
      assert.deepEqual(
        await authoritative(firstId),
        beforeOffline,
        'Provider handoff changed journey',
      );

      for (let steps = 0; active.status !== 'COMPLETED'; steps++) {
        assert.ok(steps < 50, 'Completion exceeded 50 genuine segments');
        const current =
          active.segments[active.progress.completed_segment_count];
        const time = page.getByLabel(
          'Waktu tahapan perjalanan (WIB, skenario uji)',
          {
            exact: true,
          },
        );
        if (current.mode !== 'WALK') {
          await time.fill(jakarta(current.start_at));
          active = await mutation(
            'Saya Sudah Naik',
            `journeys/${firstId}/boarding/${current.sequence}`,
          );
          await time.fill(jakarta(current.end_at));
          active = await mutation(
            'Saya Sudah Turun',
            `journeys/${firstId}/alighting/${current.sequence}`,
          );
        }
        const next = active.segments[current.sequence + 1];
        await time.fill(jakarta(next?.start_at ?? current.end_at));
        active = await mutation(
          next ? 'Lanjutkan Perjalanan' : 'Selesaikan Perjalanan',
          `journeys/${firstId}/progress`,
          'PATCH',
        );
        assert.equal(
          active.progress.completed_segment_count,
          current.sequence + 1,
        );
      }
      const completed = await authoritative(firstId);
      assert.equal(completed.status, 'COMPLETED');
      assert.equal(
        completed.progress.completed_segment_count,
        completed.segments.length,
      );
      result.completed_journey_id = firstId;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByText('perjalanan ini sudah selesai.', { exact: false })
        .waitFor();
      assert.deepEqual(await authoritative(firstId), completed);
      // Reload resets endpoint inputs. Re-enter both, preserving same signed session.
      await page
        .getByRole('group', { name: 'Dari — cara memilih lokasi', exact: true })
        .getByRole('button', { name: 'Koordinat', exact: true })
        .click();
      await page
        .getByLabel('Lintang titik awal', { exact: true })
        .fill(String(origin.latitude));
      await page
        .getByLabel('Bujur titik awal', { exact: true })
        .fill(String(origin.longitude));
      await page
        .getByRole('group', { name: 'Ke — cara memilih lokasi', exact: true })
        .getByRole('button', { name: 'Koordinat', exact: true })
        .click();
      await page
        .getByLabel('Lintang tujuan', { exact: true })
        .fill(String(destination.latitude));
      await page
        .getByLabel('Bujur tujuan', { exact: true })
        .fill(String(destination.longitude));
      await page
        .getByLabel('Berangkat (WIB)', { exact: true })
        .fill('2026-10-02T08:10');
      const repeated = responseFor('journeys/plan', 'POST');
      await page
        .getByRole('button', { name: 'Cari perjalanan', exact: true })
        .click();
      const repeatResponse = await repeated;
      assert.equal(
        repeatResponse.request().postDataJSON().departure_at,
        '2026-10-02T08:10:00+07:00',
      );
      const repeatRows = await data(repeatResponse);
      assert.ok(repeatRows.length > 0, 'Repeat real OTP plan empty');
      assert.equal(repeatRows[0].routing_context.provider, 'OTP');
      assert.notEqual(repeatRows[0].journey_id, firstId);
      const second = await mutation(
        'Mulai Perjalanan',
        `journeys/${repeatRows[0].journey_id}/activate`,
      );
      assert.equal(second.status, 'ACTIVE');
      assert.notEqual(second.journey_id, firstId);
      assert.deepEqual(
        await authoritative(firstId),
        completed,
        'New journey changed completed journey',
      );
      result.repeat_journey_id = second.journey_id;
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({
        path: join(evidenceDir, `final-${width}.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  }
  summary.status = 'PASS';
} catch (error) {
  summary.status = 'FAIL';
  summary.error = error.message;
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, 'final-supplement.json'),
    JSON.stringify(summary, null, 2),
  );
}
console.log(JSON.stringify(summary));
