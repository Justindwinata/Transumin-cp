import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();
const web = process.env.PASSENGER_WEB_URL;
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
assert.ok(web && dir);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const preferences = [
  'BALANCED',
  'FASTEST',
  'FEWEST_TRANSFERS',
  'LEAST_WALKING',
];
const summary = {
  suite: 'ROUTING_CORE',
  status: 'NOT VERIFIED',
  policy: 'PRODUCT_PORTFOLIO_V2',
  evidence:
    'Actual UI/API/OTP on historical 2026-10-02; public coordinate fixture, not GPS',
  results: [],
};
try {
  for (const [width, height] of [
    [390, 900],
    [1280, 900],
    [1280, 600],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true,
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(web, { waitUntil: 'domcontentloaded' });
      assert.equal(
        await page
          .getByRole('group', { name: 'Preferensi perjalanan', exact: true })
          .count(),
        0,
        'Duplicate ranking controls remain',
      );
      await page.getByText('Masukkan koordinat', { exact: true }).click();
      for (const [label, value] of [
        ['Lintang titik awal', '-6.302391'],
        ['Bujur titik awal', '106.85775'],
        ['Lintang tujuan', '-6.224996'],
        ['Bujur tujuan', '106.82937'],
      ])
        await page
          .getByRole('textbox', { name: label, exact: true })
          .fill(value);
      const results = [];
      async function search(preference, explicit = false) {
        console.log(
          JSON.stringify({
            suite: 'ROUTING_CORE',
            width,
            preference,
            stage: 'search',
          }),
        );
        const pending = page.waitForResponse(
          (r) =>
            r.url().endsWith('/journeys/plan') &&
            r.request().method() === 'POST',
          { timeout: 120000 },
        );
        const started = Date.now();
        if (explicit)
          await page
            .getByRole('button', { name: 'Cari perjalanan', exact: true })
            .click();
        else
          await page
            .getByRole('combobox', { name: /^Urutkan berdasarkan/ })
            .selectOption(preference);
        const response = await pending;
        const envelope = await response.json();
        assert.equal(
          response.status(),
          201,
          `${preference}: ${JSON.stringify(envelope.error)}`,
        );
        const elapsed = Date.now() - started;
        assert.ok(
          elapsed < 35000,
          `Search exceeded client deadline: ${elapsed}ms`,
        );
        const input = response.request().postDataJSON();
        assert.equal(input.preference, preference);
        assert.equal(input.departure_at, '2026-10-02T08:00:00+07:00');
        assert.deepEqual(input.origin, {
          latitude: -6.302391,
          longitude: 106.85775,
        });
        const rows = envelope.data;
        assert.ok(rows.length > 0 && rows.length <= 3);
        const key =
          preference === 'LEAST_WALKING'
            ? 'walking_distance_meters'
            : preference === 'FEWEST_TRANSFERS'
              ? 'transfer_count'
              : 'duration_seconds';
        if (preference !== 'BALANCED')
          assert.equal(rows[0][key], Math.min(...rows.map((r) => r[key])));
        const signatures = rows.map((r) =>
          JSON.stringify(
            r.segments
              .filter((l) => l.mode !== 'WALK')
              .map((l) => [
                l.mode,
                l.route_id,
                l.from.otp_stop_id ?? l.from.name,
                l.to.otp_stop_id ?? l.to.name,
              ]),
          ),
        );
        assert.equal(
          new Set(signatures).size,
          rows.length,
          'Duplicate transit combination shown',
        );
        const choices = page
          .getByRole('region', { name: 'Pilihan perjalanan' })
          .getByRole('button');
        await choices.first().waitFor();
        assert.equal(await choices.count(), rows.length);
        for (let i = 0; i < rows.length; i++) {
          const text = await choices.nth(i).innerText();
          for (const leg of rows[i].segments)
            if (leg.route_short_name && leg.route_short_name !== leg.mode)
              assert.ok(
                text.includes(leg.route_short_name),
                'Route card hides actual service number',
              );
        }
        assert.equal(
          await page
            .getByRole('alert')
            .filter({ hasText: /Sesi sudah berakhir|Session is invalid/ })
            .count(),
          0,
        );
        await page.waitForFunction(
          (id) => {
            const map = document.querySelector('.maplibre-frame');
            return (
              map?.getAttribute('data-route-render-journey') === id &&
              Number(map?.getAttribute('data-route-rendered-count') ?? 0) > 0 &&
              Number(map?.getAttribute('data-route-loaded-count') ?? 0) > 0
            );
          },
          rows[0].journey_id,
          { timeout: 45000 },
        );
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1, `${width}px overflow ${overflow}`);
        results.push({
          preference,
          elapsed_ms: elapsed,
          options: rows.length,
          combinations: signatures,
          first: {
            duration: rows[0].duration_seconds,
            walking: rows[0].walking_distance_meters,
            transfers: rows[0].transfer_count,
          },
        });
        return rows;
      }
      await search('BALANCED', true);
      if (width === 1280 && height === 900) {
        const finalResponse = page.waitForResponse(
          (r) =>
            r.url().endsWith('/journeys/plan') &&
            r.request().method() === 'POST' &&
            r.request().postDataJSON().preference === 'FASTEST',
          { timeout: 120000 },
        );
        for (const preference of [
          'FEWEST_TRANSFERS',
          'LEAST_WALKING',
          'BALANCED',
          'FASTEST',
        ])
          await page
            .getByRole('combobox', { name: /^Urutkan berdasarkan/ })
            .selectOption(preference);
        assert.equal((await finalResponse).status(), 201);
        await page
          .getByRole('region', { name: 'Pilihan perjalanan' })
          .getByRole('button')
          .first()
          .waitFor();
        assert.equal(
          await page
            .getByRole('combobox', { name: /^Urutkan berdasarkan/ })
            .inputValue(),
          'FASTEST',
        );
        summary.rapid_preference_changes = 'PASS';
      }
      for (const preference of preferences.slice(1)) await search(preference);
      await page
        .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Perjalanan aktif Anda', exact: true })
        .waitFor();
      const id = await page.evaluate(() =>
        localStorage.getItem('transumin.passenger.journey'),
      );
      assert.ok(id);
      async function active() {
        const r = await context.request.get(
          `${web}/api/passenger/journeys/${id}`,
        );
        assert.equal(r.status(), 200);
        return (await r.json()).data;
      }
      const before = await active();
      await page
        .getByRole('button', { name: 'Rencanakan', exact: true })
        .click();
      await page.waitForFunction(() =>
        [null, 'none'].includes(
          document
            .querySelector('.maplibre-frame')
            ?.getAttribute('data-route-render-journey') ?? null,
        ),
      );
      assert.equal(
        await page.getByRole('region', { name: 'Panduan pada peta' }).count(),
        0,
        'Planner leaked active navigation',
      );
      // Regression: changing ranking must replan even with an ACTIVE journey;
      // it must never mutate/replace that journey or implicitly accept recovery.
      for (const preference of preferences) {
        await search(preference);
        assert.deepEqual(
          await active(),
          before,
          'Draft ranking changed active journey',
        );
      }
      // Switching workspaces must not replace the selected draft with the
      // active trip's map while leaving the draft cards on screen.
      const draftMapId = await page
        .locator('.maplibre-frame')
        .getAttribute('data-route-render-journey');
      await page
        .getByRole('button', { name: 'Perjalanan Aktif', exact: true })
        .click();
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('.maplibre-frame')
            ?.getAttribute('data-route-render-journey') === id,
        before.journey_id,
      );
      await page
        .getByRole('button', { name: 'Rencanakan', exact: true })
        .click();
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('.maplibre-frame')
            ?.getAttribute('data-route-render-journey') === id,
        draftMapId,
      );
      // Reference UI controls must preserve both the draft and active trip.
      const routeSources = await page
        .locator('.maplibre-frame')
        .getAttribute('data-route-source-fingerprint');
      await page
        .getByRole('button', { name: 'Lihat peta lebih luas', exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('.passenger-layout')
            ?.getAttribute('data-view') === 'map',
      );
      await page.getByRole('button', { name: 'Kembali', exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('.passenger-layout')
            ?.getAttribute('data-view') === 'plan',
      );
      assert.equal(
        await page
          .locator('.maplibre-frame')
          .getAttribute('data-route-source-fingerprint'),
        routeSources,
        'Expanding map changed routing data',
      );
      await page
        .getByRole('button', { name: 'Detail setiap langkah', exact: true })
        .click();
      await page.locator('.leg-list').waitFor({ state: 'visible' });
      await page
        .getByRole('button', { name: 'Ringkasan rute', exact: true })
        .click();
      await page.waitForFunction(
        () => {
          const frame = document.querySelector('.maplibre-frame');
          const rect = frame?.getBoundingClientRect();
          const caption = frame
            ?.closest('figure')
            ?.querySelector('figcaption')
            ?.getBoundingClientRect();
          if (!rect || !frame?.getAttribute('data-map-overview-revision'))
            return false;
          const bottom =
            Math.min(rect.bottom, caption?.top ?? rect.bottom) - 10;
          return ['origin', 'destination'].every((kind) => {
            const marker = frame
              .querySelector(`.map-marker.${kind}`)
              ?.getBoundingClientRect();
            if (!marker) return false;
            const x = marker.left + marker.width / 2,
              y = marker.top + marker.height / 2;
            return (
              x > rect.left + 10 &&
              x < rect.right - 10 &&
              y > rect.top + 10 &&
              y < bottom
            );
          });
        },
        null,
        { timeout: 15000 },
      );
      if (width >= 900) {
        const fits = await page
          .locator('.maplibre-frame')
          .evaluate(
            (node) => node.getBoundingClientRect().bottom <= innerHeight + 1,
          );
        assert.ok(fits, 'Map is clipped below the short desktop viewport');
      }
      const beforeSwap = await page
        .getByRole('textbox', { name: 'Lintang titik awal', exact: true })
        .inputValue();
      const destinationBeforeSwap = await page
        .getByRole('textbox', { name: 'Lintang tujuan', exact: true })
        .inputValue();
      await page
        .getByRole('button', {
          name: 'Tukar titik awal dan tujuan',
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Lintang titik awal', exact: true })
          .inputValue(),
        destinationBeforeSwap,
      );
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Lintang tujuan', exact: true })
          .inputValue(),
        beforeSwap,
      );
      assert.equal(
        await page
          .getByRole('region', { name: 'Pilihan perjalanan' })
          .getByRole('button')
          .count(),
        0,
        'Swap kept stale route choices',
      );
      await page
        .getByRole('button', {
          name: 'Tukar titik awal dan tujuan',
          exact: true,
        })
        .click();
      await search('LEAST_WALKING', true);
      assert.deepEqual(
        await active(),
        before,
        'Map/detail/swap controls changed active trip',
      );
      await page
        .getByRole('textbox', { name: 'Lintang titik awal', exact: true })
        .fill('-6.302390');
      await page
        .getByRole('button', { name: 'Perjalanan Aktif', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Perjalanan aktif Anda', exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Rencanakan', exact: true })
        .click();
      assert.equal(
        await page
          .getByRole('region', { name: 'Pilihan perjalanan' })
          .getByRole('button')
          .count(),
        0,
        'Input edit retained stale draft choices',
      );
      await page
        .getByRole('textbox', { name: 'Lintang titik awal', exact: true })
        .fill('-6.302391');
      await search('LEAST_WALKING', true);
      assert.deepEqual(await active(), before);
      await page.screenshot({
        path: join(dir, `routing-core-${width}-${height}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      summary.results.push({
        width,
        height,
        status: 'PASS',
        active_unchanged: true,
        searches: results,
      });
      console.log(
        JSON.stringify({
          suite: 'ROUTING_CORE',
          width,
          status: 'PASS',
          searches: results.length,
        }),
      );
    } finally {
      await context.close();
    }
  }
  summary.status = 'PASS';
} catch (error) {
  summary.error = String(error?.stack ?? error);
  throw error;
} finally {
  await writeFile(
    join(dir, 'routing-core.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  await browser.close();
}
console.log(JSON.stringify(summary));
