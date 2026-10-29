import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

const web = process.env.PASSENGER_WEB_URL;
const dir = process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR;
assert.ok(web && dir, 'Owned isolated dispatcher environment required');
await assertCp2Runtime();
await mkdir(dir, { recursive: true });
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const summary = {
  suite: 'PLACE_NEGATIVE',
  status: 'NOT VERIFIED',
  provenance:
    'Actual owned same-origin API; no interception or fabricated places',
  results: [],
};
const browser = await chromium.launch(
  existsSync(chrome)
    ? { executablePath: chrome, headless: true }
    : { headless: true },
);

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
      serviceWorkers: 'block',
    });
    const result = {
      width,
      status: 'NOT VERIFIED',
      outcomes: [],
      requests: [],
      screenshots: [],
      trace: `place-negative-${width}-trace.zip`,
    };
    summary.results.push(result);
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const uiPlaceRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/passenger/transit/places')
        uiPlaceRequests.push(request.url());
    });
    const record = async (response, source) => {
      assert.equal(new URL(response.url()).origin, new URL(web).origin);
      const body = await response.json();
      const requestId =
        body.meta?.request_id ??
        body.error?.request_id ??
        response.headers()['x-request-id'];
      result.requests.push({
        source,
        url: response.url(),
        status: response.status(),
        request_id: requestId ?? null,
        body,
      });
      assert.ok(requestId, 'Actual API request ID missing');
      return body;
    };
    const shot = async (name) => {
      const file = `place-negative-${width}-${name}.png`;
      await page.screenshot({ path: join(dir, file), fullPage: true });
      result.screenshots.push(file);
    };
    try {
      const configWait = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/passenger/config',
      );
      const [, configResponse] = await Promise.all([
        page.goto(web, { waitUntil: 'domcontentloaded' }),
        configWait,
      ]);
      const config = await record(configResponse, 'UI');
      assert.equal(configResponse.status(), 200);
      const snapshot = config.data.network_snapshot_id;
      assert.match(snapshot, /^[0-9a-f-]{36}$/i);
      result.snapshot = snapshot;
      const from = page.getByRole('combobox', { name: 'Dari', exact: true });
      await from.fill('x');
      // Observe more than twice the component's 240ms debounce window.
      await page.waitForTimeout(600);
      assert.equal(
        uiPlaceRequests.length,
        0,
        'Invalid single character sent a places request',
      );
      assert.equal(
        await page.locator('.place-options').getByRole('option').count(),
        0,
      );
      assert.equal(await page.locator('.place-confirmation').count(), 0);
      assert.equal(await from.inputValue(), 'x');
      result.outcomes.push({
        case: 'invalid-ui',
        query: 'x',
        places_requests: 0,
        options: 0,
        confirmed: false,
      });
      await shot('invalid');

      const apiPlaces = async (q, snapshotId = snapshot) => {
        const url = new URL('/api/passenger/transit/places', web);
        url.searchParams.set('q', q);
        url.searchParams.set('snapshot_id', snapshotId);
        const response = await context.request.get(url.toString());
        return {
          response,
          body: await record(response, 'browser-context API'),
        };
      };
      const invalid = await apiPlaces('x');
      assert.equal(invalid.response.status(), 400);
      assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
      result.outcomes.push({
        case: 'invalid-api',
        query: 'x',
        status: invalid.response.status(),
        error: invalid.body.error,
      });

      const search = async (query) => {
        const pending = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.origin === new URL(web).origin &&
            url.pathname === '/api/passenger/transit/places' &&
            url.searchParams.get('q') === query &&
            url.searchParams.get('snapshot_id') === snapshot
          );
        });
        const [, response] = await Promise.all([from.fill(query), pending]);
        const body = await record(response, 'UI');
        assert.equal(response.status(), 200);
        assert.ok(Array.isArray(body.data));
        return body.data;
      };
      const absentQuery = `NoSuchPlace${randomUUID().replaceAll('-', '')}`;
      const absent = await search(absentQuery);
      assert.deepEqual(absent, []);
      await page
        .getByText(
          'Tempat belum ditemukan. Coba nama lain atau pilih titik di peta.',
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page.locator('.place-options').getByRole('option').count(),
        0,
      );
      assert.equal(await page.locator('.place-confirmation').count(), 0);
      assert.equal(await from.inputValue(), absentQuery);
      result.outcomes.push({
        case: 'no-result',
        query: absentQuery,
        data: absent,
        confirmed: false,
      });
      await shot('no-result');

      const places = await search('Gambir');
      assert.ok(
        places.length >= 2,
        `Actual Gambir search returned ${places.length}; ambiguity unavailable`,
      );
      const options = page.locator('.place-options').getByRole('option');
      await options.nth(places.length - 1).waitFor();
      assert.equal(await options.count(), places.length);
      assert.equal(await page.locator('.place-confirmation').count(), 0);
      for (let index = 0; index < places.length; index += 1) {
        assert.equal(
          await options.nth(index).locator('strong').textContent(),
          places[index].name,
        );
        assert.ok(
          (await options.nth(index).textContent()).includes(
            places[index].external_id,
          ),
        );
      }
      result.outcomes.push({
        case: 'ambiguous',
        query: 'Gambir',
        count: places.length,
        auto_confirmed: false,
        places,
      });
      await shot('ambiguous');
      const selectedIndex = 1;
      const selected = places[selectedIndex];
      assert.ok(
        Number.isFinite(selected.latitude) && Math.abs(selected.latitude) <= 90,
      );
      assert.ok(
        Number.isFinite(selected.longitude) &&
          Math.abs(selected.longitude) <= 180,
      );
      await options.nth(selectedIndex).click();
      assert.equal(await from.inputValue(), selected.name);
      const confirmation = page.locator('.place-confirmation');
      await confirmation.waitFor();
      assert.equal(await confirmation.count(), 1);
      const confirmationText = await confirmation.textContent();
      assert.ok(
        confirmationText.includes(`${selected.kind.toLowerCase()} selected`),
      );
      assert.equal(await options.count(), 0);
      result.outcomes.push({
        case: 'explicit-selection',
        selected_index: selectedIndex,
        selected,
        confirmation: confirmationText,
        coordinate_verification:
          'API coordinates finite and in range; confirmation UI exposes kind, not lat/lon. No journey request made.',
      });
      await shot('selected');
      await from.fill('');
      assert.equal(await from.inputValue(), '');
      assert.equal(await confirmation.count(), 0);
      result.outcomes.push({ case: 'clear-selection', confirmed: false });

      const wrongSnapshot = randomUUID();
      assert.notEqual(wrongSnapshot, snapshot);
      const wrong = await apiPlaces('Gambir', wrongSnapshot);
      assert.equal(wrong.response.status(), 200);
      assert.deepEqual(wrong.body.data, []);
      result.outcomes.push({
        case: 'wrong-snapshot',
        snapshot: wrongSnapshot,
        status: wrong.response.status(),
        data: wrong.body.data,
      });
      const overflow = await page.evaluate(
        () =>
          Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${width}px overflow ${overflow}px`);
      result.overflow_px = overflow;
      await shot('cleared');
      result.status = 'PASS';
      console.log(JSON.stringify({ suite: 'PLACE_NEGATIVE', ...result }));
    } catch (error) {
      result.status = 'FAIL';
      result.error = error.message;
      await shot('failure').catch(() => {});
      throw error;
    } finally {
      await context.tracing.stop({ path: join(dir, result.trace) });
      await context.close();
      await writeFile(
        join(dir, 'place-negative-summary.json'),
        JSON.stringify(summary, null, 2),
      );
    }
  }
  summary.status = 'PASS';
} catch (error) {
  summary.status = 'FAIL';
  summary.error = error.message;
  throw error;
} finally {
  await browser.close();
  await writeFile(
    join(dir, 'place-negative-summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
}
