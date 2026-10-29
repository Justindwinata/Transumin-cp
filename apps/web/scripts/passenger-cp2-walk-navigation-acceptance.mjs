import assert from 'node:assert/strict';

import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';
import { assertActiveSessionExpiry } from './passenger-active-session-expiry-acceptance.mjs';

const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3000';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

async function cardAttrs(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.navigation-card');
    if (!card) return null;
    return {
      text: card.innerText ?? '',
      provenance: card.getAttribute('data-provenance'),
      walkEvidence: card.getAttribute('data-walk-evidence'),
      maneuverIndex: card.getAttribute('data-maneuver-index'),
      maneuverTotal: card.getAttribute('data-maneuver-total'),
      walkStatus: card.getAttribute('data-walk-status'),
      scope: card.getAttribute('data-navigation-scope'),
      paused: card.getAttribute('data-navigation-paused'),
      ariaLabel: card.getAttribute('aria-label'),
      isOffRoute: card.classList.contains('off-route'),
    };
  });
}

// Activation writes journey state. Runner-owned isolated DB only.
await assertCp2Runtime();
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: webUrl.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
});
const summary = {
  status: 'PASS',
  provenance: 'SIMULATED geolocation stub; real OTP plan',
};
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
  });
  await installGpsStub(ctx);
  const page = await ctx.newPage();
  await page.clock.install();
  const emit = (pos) => page.evaluate((p) => window.__gpsWatch(p), pos);

  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page
    .getByText('Status layanan & contoh perjalanan', { exact: true })
    .click();
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).waitFor();
  page.on('request', (request) => {
    if (request.url().includes('/api/passenger/journeys/plan'))
      console.error(
        JSON.stringify({
          url: request.url(),
          origin: request.headers().origin ?? null,
          host: request.headers().host ?? null,
          secFetchSite: request.headers()['sec-fetch-site'] ?? null,
        }),
      );
  });
  const plan = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
  const actualResponse = await plan;
  const planBody = await actualResponse.json().catch(() => null);
  assert.equal(
    actualResponse.status(),
    201,
    `Plan failed: ${JSON.stringify(planBody?.error ?? planBody)}`,
  );
  assert.ok(planBody && Array.isArray(planBody.data));
  const withWalkFirst = planBody.data.find(
    (j) => j.segments?.[0]?.mode === 'WALK',
  );
  assert.ok(withWalkFirst, 'No journey with initial WALK segment.');
  summary.plan_journey_id = withWalkFirst.journey_id;
  const walk = withWalkFirst.segments[0];
  const rawSteps = [...(walk.walking_steps ?? [])];
  assert.ok(rawSteps.length > 1 && rawSteps[0].relative_direction === 'DEPART');
  summary.plan_walk_steps = rawSteps.length;
  const coords = walk.geometry.coordinates;
  assert.ok(coords.length > 1);
  summary.plan_walk_coordinates = coords.length;
  const c = (p) => ({ lat: p[1], lon: p[0] });
  const first = coords[0];
  const last = coords.at(-1);

  const walkFirstIndex = planBody.data.indexOf(withWalkFirst);
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .nth(walkFirstIndex)
    .click();
  // Activate the specifically chosen WALK-first journey via UI (cookies/session aware).
  const activation = page.waitForResponse(
    (r) => r.url().includes('/activate') && r.request().method() === 'POST',
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  const activated = await activation;
  // 201 or 200 both mean success; capture active journey for scope check.
  assert.ok(
    [200, 201].includes(activated.status()),
    `Activate failed: ${activated.status()}`,
  );
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  const activeBody = await activated.json();
  const activeJourney = activeBody.data;
  assert.equal(activeJourney.segments[0].mode, 'WALK');
  assert.deepEqual(
    activeJourney.segments[0].geometry,
    walk.geometry,
    'Activated geometry differs from chosen plan.',
  );
  assert.deepEqual(
    activeJourney.segments[0].walking_steps,
    rawSteps,
    'Activated walking_steps differ from chosen plan.',
  );
  const scopeNow = await page.evaluate(
    () =>
      document
        .querySelector('.navigation-card')
        ?.getAttribute('data-navigation-scope') ?? 'none',
  );
  assert.ok(scopeNow.startsWith(`${activeJourney.journey_id}:`));
  summary.activation_scope = scopeNow;
  summary.activation_status = activated.status();

  await page.getByText('Lokasi perangkat (opsional)').click();
  await page.getByRole('button', { name: 'Aktifkan Lokasi Langsung' }).click();
  await page.waitForTimeout(250);
  const emitReliable = async (position, elapsedMs = 6000) => {
    await page.clock.fastForward(elapsedMs);
    // Stub timestamps from browser clock, never host time or future timestamps.
    await emit(position);
  };
  await emitReliable({ lat: first[1], lon: first[0], acc: 8 });
  await page.waitForFunction(
    () => document.body.innerText.includes('Lokasi langsung aktif'),
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(350);
  await emitReliable({ lat: first[1], lon: first[0], acc: 8 });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(500);
    const check = await cardAttrs(page);
    if (check?.walkStatus === 'TRACKING') break;
    if (attempt === 11) {
      await page.waitForTimeout(1000);
      await emit({ lat: first[1], lon: first[0], acc: 8, t: Date.now() });
    }
  }
  const tracked = await cardAttrs(page);
  const diag = await page.evaluate(() => ({
    body: document.body.innerText.slice(0, 800),
    card:
      document.querySelector('.navigation-card')?.outerHTML?.slice(0, 900) ??
      'no-card',
  }));
  if (tracked?.walkStatus !== 'TRACKING')
    throw new Error(
      `Not TRACKING after retries: ${JSON.stringify(tracked)} body=${diag.body.slice(0, 200)}`,
    );
  assert.equal(tracked?.walkEvidence, 'OTP_DERIVED_MANEUVER');
  const total = Number(tracked?.maneuverTotal);
  assert.ok(Number.isInteger(total) && total > 1);
  assert.equal(total, rawSteps.length);
  summary.maneuver_total = total;
  assert.ok(typeof tracked?.scope === 'string' && tracked.scope.length < 120);
  assert.ok(!/106\./.test(tracked.scope));
  summary.scope_length = tracked?.scope.length;
  const progress = await page
    .getByTestId('walk-progress')
    .first()
    .innerText()
    .catch(() => '');
  assert.ok(/Langkah 1 dari/.test(progress));
  assert.ok(/berikutnya ±/.test(progress));
  summary.first_progress_text = String(progress).slice(0, 120);

  let previous = Number(tracked?.maneuverIndex);
  let advanced = false;
  for (let k = 1; k < coords.length; k += 1) {
    const previousPoint = coords[k - 1];
    // SIMULATED elapsed matches walking pace; otherwise bounded-jump rejects the sample.
    const meters = Math.hypot(
      (coords[k][0] - previousPoint[0]) *
        111000 *
        Math.cos((coords[k][1] * Math.PI) / 180),
      (coords[k][1] - previousPoint[1]) * 111000,
    );
    await emitReliable(
      c(coords[k]),
      Math.max(3000, Math.ceil((meters / 1.4) * 1000)),
    );
    await page.waitForTimeout(100);
    const nowCard = await cardAttrs(page);
    const index = Number(nowCard?.maneuverIndex);
    assert.ok(
      index === previous || index === previous + 1,
      `Jump ${previous} -> ${index}`,
    );
    assert.ok(index >= 0 && index < total);
    if (index > previous) advanced = true;
    previous = index;
  }
  summary.walk_advanced = advanced;
  assert.ok(advanced);

  for (let r = 0; r < 3; r += 1) {
    await emitReliable({ lat: last[1], lon: last[0], acc: 8 }, 6000);
    await page.waitForTimeout(100);
  }
  const atEnd = await cardAttrs(page);
  assert.equal(Number(atEnd?.maneuverIndex), previous);
  summary.final_index = previous;

  await page.getByRole('button', { name: 'Manuver berikutnya' }).click();
  await page.waitForTimeout(300);
  const afterManual = await cardAttrs(page);
  summary.after_manual = Number(afterManual?.maneuverIndex);

  await page.getByRole('button', { name: 'Jeda navigasi' }).click();
  await page.waitForTimeout(300);
  const pausedCard = await cardAttrs(page);
  assert.equal(pausedCard?.walkStatus, 'PAUSED');
  await page.getByRole('button', { name: 'Lanjutkan navigasi' }).click();
  await page.waitForTimeout(400);
  summary.pause_resume_present = true;

  const noisy = { lat: first[1] + 0.02, lon: first[0] + 0.02 };
  for (let r = 0; r < 5; r += 1) {
    await emitReliable({ ...noisy, acc: 8 });
    await page.waitForTimeout(150);
  }
  const offText = await page.evaluate(() => document.body.innerText);
  summary.off_route_detected = /Di luar jalur rute/i.test(offText);
  assert.ok(summary.off_route_detected);

  await emitReliable({ ...c(last), acc: 8 }, 6000);
  await page.waitForTimeout(300);
  await emitReliable({ ...c(last), acc: 8 }, 6000);
  await page.waitForTimeout(400);

  await page.reload();
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  const afterReload = await cardAttrs(page);
  summary.refresh_status = afterReload?.walkStatus;
  assert.equal(Number(afterReload?.maneuverIndex), 0);
  assert.equal(afterReload?.walkStatus, 'ACQUIRING');
  summary.refresh_resets_progress = true;
  assert.match(
    await page
      .getByRole('textbox', {
        name: 'Waktu tahapan perjalanan (WIB, skenario uji)',
        exact: true,
      })
      .inputValue(),
    /^2026-10-02T/,
    'Refresh changed historical progression to today',
  );
  summary.refresh_preserves_journey_clock = true;

  // FR-009/FR-014: signed expiry on server clock, using injected CP2 secret.
  // Run last: refusal must not revive stale navigation or replace its owner.
  summary.session_expiry = await assertActiveSessionExpiry(
    page,
    ctx,
    browser,
    activeJourney.journey_id,
  );

  const storageKeys = await page.evaluate(() =>
    Object.keys({ ...localStorage }),
  );
  assert.ok(!/latitude|longitude|geolocation|gps/i.test(storageKeys.join(',')));
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'NOT VERIFIED',
      message: (error instanceof Error ? error.message : String(error)).replace(
        /(?:cookie|authorization):[^\r\n]*/gi,
        '[REDACTED test credentials]',
      ),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
