import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3002';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir = join(
  repositoryRoot,
  'data/processed/product-v1-map-browser',
);

async function choosePlace(page, field, query, option) {
  await page.getByRole('combobox', { name: field }).fill(query);
  await page.getByRole('option', { name: option }).click();
}

function assertGeometry(journey) {
  assert.ok(journey.segments.length > 0, 'Itinerary has no segments.');
  for (const segment of journey.segments) {
    const points = segment.geometry?.coordinates;
    assert.ok(
      Array.isArray(points) && points.length >= 2,
      `Segment ${segment.sequence} geometry missing.`,
    );
    assert.ok(
      points.length <= 10_000,
      `Segment ${segment.sequence} geometry exceeds limit.`,
    );
    for (const point of points) {
      assert.equal(
        point.length,
        2,
        'Geometry coordinate must be [longitude, latitude].',
      );
      assert.ok(
        Number.isFinite(point[0]) && point[0] >= -180 && point[0] <= 180,
      );
      assert.ok(Number.isFinite(point[1]) && point[1] >= -90 && point[1] <= 90);
    }
  }
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.goto(webUrl);
  await choosePlace(
    page,
    'From',
    'Bogor',
    /^Bogor KRL Commuter Line · station/,
  );
  await choosePlace(
    page,
    'To',
    'Cilebut',
    /^Cilebut KRL Commuter Line · station/,
  );
  await page
    .getByRole('textbox', { name: 'Depart (Jakarta time)' })
    .fill('2026-10-02T08:00');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Find journeys' }).click();
  const response = await responsePromise;
  assert.equal(
    response.status(),
    201,
    'Real journey plan HTTP status must be 201.',
  );
  const journeys = (await response.json()).data;
  assert.ok(
    journeys.length >= 2,
    'Alternative switching needs at least two real itineraries.',
  );
  journeys.forEach(assertGeometry);
  assert.equal(
    await journeys.filter((journey) =>
      journey.segments.every(
        (segment) => segment.geometry?.coordinates?.length >= 2,
      ),
    ).length,
    journeys.length,
    'Selected real itineraries are missing segment geometry.',
  );

  const choices = page
    .getByRole('region', { name: 'Journey choices' })
    .getByRole('button');
  await choices.first().waitFor({ timeout: 120_000 });
  await choices.nth(1).focus();
  await page.keyboard.press('Enter');
  assert.equal(await choices.nth(1).getAttribute('aria-pressed'), 'true');

  const map = page.getByRole('application', {
    name: /Interactive selected route map/,
  });
  await map.waitFor({ timeout: 30_000 });
  await page
    .getByText('Interactive route map ready.')
    .waitFor({ timeout: 30_000 });
  const canvas = map.locator('.maplibregl-canvas');
  await canvas.waitFor();
  const renderedSources = Number(
    await map.getAttribute('data-route-source-count'),
  );
  const renderedPoints = Number(
    await map.getAttribute('data-route-point-count'),
  );
  assert.equal(
    renderedSources,
    journeys[1].segments.length,
    'Rendered source count differs from selected timeline.',
  );
  assert.equal(
    renderedPoints,
    journeys[1].segments.reduce(
      (count, segment) => count + segment.geometry.coordinates.length,
      0,
    ),
    'Rendered point count differs from selected real API geometry.',
  );
  assert.ok(
    await map.getAttribute('data-fit-bounds'),
    'Selected itinerary was not fit to bounds.',
  );
  const markers = await page.locator('.maplibre-marker').count();
  assert.ok(markers >= 2, 'Origin/destination markers missing.');
  assert.equal(
    markers,
    Number(await map.getAttribute('data-marker-count')),
    'Rendered marker count differs from the text marker list.',
  );
  assert.ok(
    await page
      .getByRole('figure', { name: 'Interactive route geometry:' })
      .getByRole('link', { name: '© OpenStreetMap contributors' })
      .count(),
    'OSM attribution missing.',
  );
  assert.ok(
    await page
      .getByText(/unverified schematic OTP geometry, not validated navigation/)
      .count(),
    'Walking uncertainty label missing.',
  );
  assert.ok(
    await page.getByRole('list', { name: 'Map markers' }).count(),
    'Text marker equivalent missing.',
  );

  const before = await canvas.boundingBox();
  assert.ok(before?.width && before.height, 'Map canvas has no layout.');
  const beforeView = await map.getAttribute('data-map-view');
  await canvas.hover();
  await page.mouse.wheel(0, -320);
  await page.mouse.move(
    before.x + before.width * 0.7,
    before.y + before.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width * 0.4,
    before.y + before.height * 0.5,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.ok(
    (await canvas.boundingBox())?.width,
    'Map disappeared after pan/zoom.',
  );
  const afterView = await map.getAttribute('data-map-view');
  assert.ok(
    beforeView && afterView && beforeView !== afterView,
    'Pan/zoom did not change the map camera view.',
  );

  await mkdir(evidenceDir, { recursive: true });
  const screenshots = [];
  for (const [name, width, height] of [
    ['mobile', 390, 844],
    ['tablet', 768, 900],
    ['desktop', 1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
      `${name} has horizontal overflow.`,
    );
    const path = join(evidenceDir, `map-${name}.png`);
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
  }
  // Isolated negative UI case: replay the real response with corrupt geometry.
  // Not evidence of real routing; confirms frontend safely rejects whole legs.
  await page.route('**/api/passenger/journeys/plan', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: journeys.map((journey) => ({
          ...journey,
          segments: journey.segments.map((segment) => ({
            ...segment,
            geometry: {
              type: 'LineString',
              coordinates: [
                [106.8, -6.2],
                [181, -6.2],
              ],
            },
          })),
        })),
      }),
    }),
  );
  await page.getByRole('button', { name: 'Find journeys' }).click();
  await page
    .getByText(
      'Route geometry is unavailable. No inferred line is shown; use textual itinerary below.',
    )
    .waitFor();
  assert.equal(await page.locator('.maplibregl-canvas').count(), 0);
  await page.unroute('**/api/passenger/journeys/plan');
  assert.deepEqual(browserErrors, [], 'Browser console/page errors detected.');
  console.log(
    JSON.stringify({
      status: 'PASS',
      evidence: 'read-only browser flow through real API, product DB, and OTP',
      plan_http_status: response.status(),
      alternatives: journeys.length,
      selected_journey_id: journeys[1].journey_id,
      segment_geometry_points: journeys[1].segments.map(
        (segment) => segment.geometry.coordinates.length,
      ),
      markers,
      keyboard_selection: true,
      pan_zoom: true,
      attribution: true,
      walking_accuracy: 'UNVERIFIED_SCHEMATIC',
      invalid_geometry_fallback: true,
      screenshots,
    }),
  );
} finally {
  await browser.close();
}
