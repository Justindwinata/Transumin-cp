import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage();
const snapshot = '11111111-1111-4111-8111-111111111111';
const place = (name, id) => ({
  place_id: id,
  external_id: id,
  name,
  kind: 'STOP',
  product_mode: 'TRANSJAKARTA',
  latitude: -6.2,
  longitude: 106.8,
});

try {
  await page.route('**/api/passenger/config', (route) =>
    route.fulfill({ json: { data: { network_snapshot_id: snapshot } } }),
  );
  await page.route('**/api/passenger/transit/places?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'old')
      await new Promise((resolve) => setTimeout(resolve, 600));
    await route
      .fulfill({
        json: {
          data: [
            query === 'old'
              ? place('Old stale stop', 'old-stop')
              : place('New current station', 'new-station'),
          ],
        },
      })
      .catch(() => undefined);
  });
  await page.goto(process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000');
  const input = page.getByRole('combobox', { name: 'From' });
  await input.fill('old');
  await page.waitForTimeout(300);
  await input.fill('new');
  await input.press('Enter');
  assert.equal(await input.inputValue(), 'new', 'Enter selected stale result');
  assert.equal(await page.locator('.place-confirmation').count(), 0);
  await page.getByRole('option', { name: /New current station/ }).waitFor();
  assert.equal(await page.getByText('Old stale stop').count(), 0);
  await page
    .getByRole('button', { name: /Load presentation scenario/ })
    .click();
  assert.equal(await input.inputValue(), 'Gambir');
  assert.match(await input.getAttribute('aria-describedby'), /-hint$/);
  assert.equal(
    await page.getByText(/sparse historical OSM addresses and POIs/).count(),
    2,
  );
  console.log('PASS: SIMULATED place-search cancellation and UI state only');
} finally {
  await browser.close();
}
