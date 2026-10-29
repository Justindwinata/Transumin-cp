import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();
const web = (process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302').replace(
  /\/$/,
  '',
);
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const manifest = JSON.parse(
  readFileSync(
    new URL('../../../data/manifests/LOCAL-PLACE-INDEX.json', import.meta.url),
    'utf8',
  ),
);
const indexBytes = readFileSync(
  new URL('../../../.local/geocoder/local-places.json', import.meta.url),
);
assert.equal(
  createHash('sha256').update(indexBytes).digest('hex'),
  manifest.index_sha256,
  'local index checksum differs from manifest',
);
const index = JSON.parse(indexBytes);
assert.equal(index.datasetVersionId, manifest.dataset_version_id);
const browser = await chromium.launch(
  chrome && existsSync(chrome)
    ? { executablePath: chrome, headless: true }
    : { headless: true },
);

async function choosePlace(page, snapshot, label, query, kind) {
  const input = page.getByRole('combobox', { name: label });
  const wait = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/api/passenger/transit/places') &&
        url.searchParams.get('q') === query &&
        url.searchParams.get('snapshot_id') === snapshot
      );
    },
    { timeout: 30000 },
  );
  await input.fill(query);
  const response = await wait;
  assert.ok(response.ok(), `places ${query}: HTTP ${response.status()}`);
  const body = await response.json();
  const place = body.data.find(
    (item) =>
      item.kind === kind &&
      item.name.toLowerCase().includes(query.toLowerCase()),
  );
  assert.ok(
    place,
    `no ${kind} for ${query}: ${JSON.stringify(body.data.slice(0, 5))}`,
  );
  assert.equal(place.kind, kind);
  if (kind === 'ADDRESS' || kind === 'POI') {
    assert.equal(place.product_mode, null, `${kind} product_mode must be null`);
    assert.equal(
      place.provenance,
      'OSM_LOCAL_BOUNDED_INDEX',
      `${kind} provenance`,
    );
    assert.match(place.external_id, /^osm:n\d+$/, `${kind} external_id`);
  }
  const option = page
    .getByRole('option')
    .filter({ hasText: place.external_id });
  await option.waitFor({ timeout: 15000 });
  await option.click();
  assert.equal(await input.inputValue(), place.name);
  return place;
}

try {
  for (const viewport of [390, 1280]) {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: viewport, height: viewport < 600 ? 844 : 900 },
      hasTouch: viewport < 600,
      isMobile: viewport < 600,
    });
    const page = await ctx.newPage();
    const configWait = page.waitForResponse(
      (r) => r.url().endsWith('/api/passenger/config'),
      { timeout: 30000 },
    );
    await page.goto(web, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page
      .getByRole('combobox', { name: 'Dari' })
      .waitFor({ timeout: 30000 });
    const config = await (await configWait).json();
    const snapshot = config.data.network_snapshot_id;
    assert.match(
      snapshot,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'config snapshot_id',
    );

    // Validate address search, then route from actual ADDRESS and POI endpoints.
    const addressSearch = await choosePlace(
      page,
      snapshot,
      'From',
      'Jalan Nangka',
      'ADDRESS',
    );
    assert.equal(addressSearch.kind, 'ADDRESS');
    const addressEntry = index.entries.find(
      (entry) => entry.externalId === addressSearch.external_id,
    );
    assert.ok(
      addressEntry,
      'address external ID absent from checksummed local index',
    );
    assert.equal(addressSearch.dataset_version_id, manifest.dataset_version_id);
    const origin = await choosePlace(
      page,
      snapshot,
      'From',
      'Mall Kelapa Gading',
      'ADDRESS',
    );
    assert.equal(origin.kind, 'ADDRESS');
    const addrEntry = index.entries.find(
      (entry) => entry.externalId === origin.external_id,
    );
    assert.ok(
      addrEntry,
      'address external ID absent from checksummed local index',
    );
    assert.equal(origin.dataset_version_id, manifest.dataset_version_id);
    // clear To to then test POI path used for routing
    await page.getByRole('combobox', { name: 'Ke' }).fill('');
    const poi = await choosePlace(page, snapshot, 'To', 'Emporium', 'POI');
    assert.equal(poi.kind, 'POI');
    const poiEntry = index.entries.find(
      (entry) => entry.externalId === poi.external_id,
    );
    assert.ok(poiEntry, 'POI external ID absent from checksummed local index');
    assert.equal(poi.dataset_version_id, manifest.dataset_version_id);

    await page.getByLabel('Berangkat (WIB)').fill('2026-10-02T08:11');
    const planWait = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/journeys/plan') &&
        r.request().method() === 'POST',
      { timeout: 120000 },
    );
    await page
      .getByRole('button', { name: 'Cari perjalanan', exact: true })
      .click();
    const planResponse = await planWait;
    assert.ok(planResponse.ok(), `plan HTTP ${planResponse.status()}`);
    const payload = planResponse.request().postDataJSON();
    assert.equal(
      payload.network_snapshot_id,
      snapshot,
      'plan snapshot mismatch',
    );
    assert.equal(
      payload.departure_at,
      '2026-10-02T08:11:00+07:00',
      'plan departure not Jakarta historical date',
    );
    assert.deepEqual(
      payload.origin,
      { latitude: origin.latitude, longitude: origin.longitude },
      'plan must use selected address coordinates',
    );
    assert.deepEqual(
      payload.destination,
      { latitude: poi.latitude, longitude: poi.longitude },
      'plan must use selected POI coordinates',
    );
    const journeys = (await planResponse.json()).data;
    assert.ok(
      Array.isArray(journeys) && journeys.length >= 1,
      'OTP no alternatives for POI destination',
    );
    const selected = journeys[0];
    assert.equal(selected.routing_context.provider, 'OTP');
    assert.equal(selected.routing_context.common_service_date, '2026-10-02');
    assert.match(
      selected.journey_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .first()
      .waitFor({ timeout: 120000 });
    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .first()
      .click();
    await page.locator('.leg-list').first().waitFor({ timeout: 30000 });
    assert.ok(
      await page.locator('.leg-list').isVisible(),
      'selected itinerary is not visible',
    );

    const activateWait = page.waitForResponse(
      (r) =>
        r.url().includes('/api/passenger/journeys/') &&
        r.url().endsWith('/activate') &&
        r.request().method() === 'POST',
      { timeout: 30000 },
    );
    await page
      .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
      .click();
    const activateBody = await (await activateWait).json();
    const active = activateBody.data;
    assert.equal(
      active.status,
      'ACTIVE',
      `activate not ACTIVE: ${JSON.stringify(activateBody).slice(0, 600)}`,
    );
    assert.equal(active.network_snapshot_id, snapshot);
    assert.equal(active.routing_context.common_service_date, '2026-10-02');
    assert.equal(active.routing_context.provider, 'OTP');

    await page.reload({ waitUntil: 'domcontentloaded' });
    if (active.status === 'ACTIVE') {
      await page
        .getByRole('heading', { name: 'Perjalanan aktif Anda' })
        .waitFor({ timeout: 30000 });
    }
    await page.locator('.leg-list').first().waitFor({ timeout: 30000 });
    assert.equal(
      await page.locator('.leg-list li').count(),
      active.segments.length,
      `${viewport}px timeline count mismatch after reload`,
    );

    // viewport sanity: no horizontal overflow
    const overflow = await page.evaluate(
      () =>
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `${viewport}px overflow ${overflow}px`);
    await ctx.close();
    console.log(
      JSON.stringify({
        status: 'PASS',
        step: `ADDR_${viewport}`,
        origin: origin.name,
        poi: poi.name,
        choices: journeys.length,
        snapshot,
      }),
    );
  }
  console.log(JSON.stringify({ status: 'PASS', suite: 'ADDR' }));
} finally {
  await browser.close();
}
