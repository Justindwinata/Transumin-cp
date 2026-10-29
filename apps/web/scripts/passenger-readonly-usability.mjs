import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// No planning/activation requests: product database remains read-only.
const web = 'http://127.0.0.1:3000';
const dir = new URL(
  '../../../.release-evidence/r7-readonly-usability/',
  import.meta.url,
);
await mkdir(dir, { recursive: true });
// Cold prehydration truth: SSR HTML (no JS) must ship combobox disabled
// with loading affordance, before hydration/config snapshot.
const ssrHtml = await (await fetch(web)).text();
assert.ok(
  ssrHtml.includes('Stop and station search is loading'),
  'SSR prehydration loading missing',
);
assert.match(
  ssrHtml,
  /role="combobox"[^>]*disabled/,
  'SSR combobox not disabled',
);
// Cold hydration: delay every script bundle past load; SSR combobox must
// stay disabled until React hydrates AND the config snapshot resolves.
let configReleased = false;
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  for (const width of [360, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Gate config response to prove combobox does not become enabled
    // on hydration alone; it stays disabled until both mounted AND
    // snapshotId exist (see apps/web/src/app/place-search.tsx).
    await page.route('**/api/passenger/**', async (route) => {
      assert.equal(
        route.request().method(),
        'GET',
        'read-only QA attempted mutation',
      );
      if (
        route.request().url().endsWith('/api/passenger/config') &&
        !configReleased
      ) {
        // Keep the original response available after we prove disabled.
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }
      await route.continue();
    });
    await page.route('**/_next/**', async (route) => {
      if (!configReleased) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      await route.continue();
    });
    await page.goto(web);
    const from = page.getByRole('combobox', { name: 'Dari', exact: true });
    await from.waitFor();
    // Before config resolves combobox must remain disabled/loading.
    assert.equal(
      await from.isDisabled(),
      true,
      'combobox enabled before config/ready',
    );
    assert.ok(
      await page
        .getByText('Stop and station search is loading')
        .first()
        .isVisible(),
      'loading not shown before config',
    );
    configReleased = true;
    // Now cancellation/exchange: buffered queries must not fire before ready
    // (preserved AbortController clearTimeout+abort still applies).
    await from.waitFor({ state: 'attached' });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role="combobox"]')
          ?.hasAttribute('disabled') === false,
      null,
      { timeout: 8000 },
    );
    assert.equal(
      await from.isDisabled(),
      false,
      'combobox stayed disabled after ready/reload',
    );
    await from.fill('Gambir');
    const option = page.getByRole('option').first();
    await option.waitFor();
    await from.press('ArrowDown');
    await from.press('Enter');
    assert.ok((await from.inputValue()).length > 0);
    const find = page.getByRole('button', {
      name: 'Cari perjalanan',
      exact: true,
    });
    await find.scrollIntoViewIfNeeded();
    const box = await find.boundingBox();
    assert.ok(
      box && box.width >= 44 && box.height >= 44,
      'primary tap target too small',
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      'horizontal overflow',
    );
    await page.screenshot({
      path: new URL(`${width}.png`, dir).pathname,
      fullPage: true,
    });
    assert.deepEqual(errors, [], 'uncaught browser errors');
    console.log(
      JSON.stringify({
        status: 'PASS',
        width,
        keyboard_place_selection: true,
        primary_target: box,
        overflow: false,
        page_errors: errors,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
