import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Fail closed: this suite mutates journeys/reports and must never target the
// shared product runtime. Run via `pnpm data:browser:isolated --suite=V20`.
await assertCp2Runtime();

const web = process.env.M7_WEB_URL ?? 'http://127.0.0.1:3000';
const api = process.env.M7_API_URL ?? 'http://127.0.0.1:3001/api/v1';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const envFile = (() => {
  try {
    return readFileSync(
      fileURLToPath(new URL('../../../.env', import.meta.url)),
      'utf8',
    );
  } catch {
    return '';
  }
})();
const env = (name) =>
  process.env[name] ??
  envFile
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim() ??
  '';
const token = env('CONTROLLED_REVIEW_TOKEN');
const reviewer = `r1-${randomUUID()}`;
const cases = [];
const evidence = {
  suite: 'passenger-r1-full-workflow',
  requirement: 'R3',
  web,
  departure_input_jakarta: '2026-10-02T08:11',
  ui_steps: [],
  snapshot: null,
  place_identities: {},
  plan_responses: {},
  all_plan_ids: [],
  selected_journey_id: null,
  active_instance_uuid: null,
  progress_events: [],
  report: null,
  review: null,
  alerts: { affected: null, unaffected_context: null },
  second_context: null,
  recovery_lineage: null,
  preferences: {},
  easiest: null,
  acceptance_map_timeline_parity: null,
  persisted_completed: null,
};
const evidenceDir = join(
  process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR ||
    fileURLToPath(new URL('../../../.release-evidence/R3', import.meta.url)),
);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
// R3 final artifact is fail-closed: a write error aborts, not returns a soft string.
async function recordEvidence(label) {
  await mkdir(evidenceDir, { recursive: true });
  const artifact = { evidence, completed_cases: cases, captured_label: label };
  await writeFile(
    join(evidenceDir, `${label}.json`),
    JSON.stringify(artifact, null, 2),
    'utf8',
  );
  return artifact;
}
async function recordEvidenceOrThrow(label) {
  try {
    return await recordEvidence(label);
  } catch (error) {
    failure = `evidence write failed: ${safe(String(error))}`;
    throw new Error(failure);
  }
}
async function snapshotScreenshot(label, selector = 'body') {
  await mkdir(evidenceDir, { recursive: true });
  await page
    .locator(selector)
    .first()
    .screenshot({
      path: join(evidenceDir, `${label}.png`),
    });
  return `screenshot ${label}.png recorded`;
}
let browser,
  context,
  other,
  page,
  active,
  plans,
  target,
  reportId,
  recovery,
  acceptance,
  otherJourney;
let reviewed = false;
let branch = null;
let failure = null;

function safe(value) {
  let text = String(value);
  for (const name of [
    'CONTROLLED_REVIEW_TOKEN',
    'PASSENGER_SERVICE_TOKEN',
    'PASSENGER_SESSION_SECRET',
  ]) {
    const secret = env(name);
    if (secret) text = text.replaceAll(secret, '[REDACTED]');
  }
  return text.slice(0, 700);
}
function mark(name, verdict, detail = '') {
  cases.push({ case: name, verdict, detail: safe(detail) });
  process.stderr.write(
    `[case] ${name}: ${verdict}${detail ? ` — ${safe(detail)}` : ''}\n`,
  );
}
// R3-B: 20 executable UI steps, sequential mapping. uiStep index asserted.
async function step(name, uiStep, fn) {
  try {
    const result = await fn();
    mark(name, 'PASS', typeof result === 'string' ? result : '');
    evidence.ui_steps.push({ n: uiStep, case: name, verdict: 'PASS' });
    return result;
  } catch (error) {
    mark(name, 'FAIL', error.message);
    evidence.ui_steps.push({ n: uiStep, case: name, verdict: 'FAIL' });
    throw error;
  }
}
const data = (body) => body?.data ?? body;
async function jsonResponse(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    body: await response.json().catch(() => null),
  };
}
async function proxy(path, options = {}, ownerContext = context) {
  return jsonResponse(
    await ownerContext.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      timeout: 120_000,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
function ok(result, statuses = [200, 201]) {
  assert.ok(
    statuses.includes(result.status),
    `HTTP ${result.status}: ${JSON.stringify(result.body?.error ?? result.body)}`,
  );
  return data(result.body);
}
async function controlled(action, payload) {
  return jsonResponse(
    await fetch(
      `${process.env.CONTROLLED_REVIEW_API_URL ?? api}/controlled/passenger-reports/${reportId}/${action}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-controlled-reviewer': reviewer,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      },
    ),
  );
}
async function uiMutation(button, suffix, method) {
  const wait = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/passenger/${suffix}`) &&
      response.request().method() === method,
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  return ok(await jsonResponse(await wait));
}
function jakarta(at) {
  return new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
}
async function choosePlace(field, query, option) {
  const input = page.getByRole('combobox', { name: field });
  const wait = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/api/passenger/transit/places') &&
      url.searchParams.get('q') === query
    );
  });
  await input.fill(query);
  const response = await wait;
  const matches = ok(await jsonResponse(response));
  const chosen = page.getByRole('option', { name: option }).first();
  const externalId = (await chosen.locator('small').innerText())
    .split(' · ')
    .at(-1);
  const place = matches.find(
    (item) =>
      item.external_id === externalId &&
      item.name === (field === 'From' ? 'Kelapa Gading' : 'Gambir') &&
      item.kind === 'STATION',
  );
  assert.ok(
    place,
    'selected option identity missing from actual search response',
  );
  const snapshotId = new URL(response.url()).searchParams.get('snapshot_id');
  assert.equal(snapshotId, evidence.snapshot);
  await chosen.click();
  assert.equal(await input.inputValue(), place.name);
  evidence.place_identities[field] = place;
}
async function planFromUi(preference) {
  await page.getByLabel('Urutkan berdasarkan').selectOption(preference);
  const wait = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page
    .getByRole('button', { name: 'Cari perjalanan', exact: true })
    .click();
  const response = await wait;
  const result = await jsonResponse(response);
  const payload = response.request().postDataJSON();
  assert.ok(payload, 'plan request JSON missing');
  {
    assert.deepEqual(
      payload.origin,
      {
        latitude: evidence.place_identities.From.latitude,
        longitude: evidence.place_identities.From.longitude,
      },
      'plan request origin did not use selected place coordinates',
    );
    assert.deepEqual(
      payload.destination,
      {
        latitude: evidence.place_identities.To.latitude,
        longitude: evidence.place_identities.To.longitude,
      },
      'plan request destination did not use selected place coordinates',
    );
    assert.equal(
      payload.network_snapshot_id,
      evidence.snapshot,
      'plan request did not use the exact live snapshot',
    );
    assert.equal(
      payload.departure_at,
      '2026-10-02T08:11:00+07:00',
      'plan request did not use the entered Jakarta departure',
    );
    assert.equal(
      payload.preference,
      preference,
      'plan request preference mismatch',
    );
  }
  const list = ok(result);
  assert.ok(Array.isArray(list), 'plan response must be a list');
  for (const journey of list) {
    assert.match(
      journey.journey_id,
      uuid,
      'planned journey UUID must be valid',
    );
  }
  evidence.plan_responses[preference] = {
    response_sha256: hash(list),
    duration_seconds: list.map((journey) => journey.duration_seconds),
    transfer_count: list.map((journey) => journey.transfer_count),
    walking_distance_meters: list.map(
      (journey) => journey.walking_distance_meters,
    ),
    journey_ids: list.map((journey) => journey.journey_id),
    segments_count: list.map((journey) => journey.segments.length),
  };
  evidence.all_plan_ids.push(...list.map((journey) => journey.journey_id));
  assert.ok(
    Array.isArray(list) && list.length > 0,
    `${preference}: no OTP alternatives`,
  );
  for (const journey of list) {
    assert.equal(journey.routing_context.provider, 'OTP');
    assert.match(journey.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
    assert.ok(
      journey.segments.every(
        (segment) =>
          Array.isArray(segment.geometry?.coordinates) &&
          segment.geometry.coordinates.length >= 2,
      ),
      'segment geometry missing',
    );
  }
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  return list;
}
async function advanceCurrent() {
  const leg = active.segments[active.progress.completed_segment_count];
  assert.ok(leg, 'no current leg');
  const time = page.getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)');
  if (leg.mode !== 'WALK') {
    await time.fill(jakarta(leg.start_at));
    active = await uiMutation(
      'Saya Sudah Naik',
      `journeys/${active.journey_id}/boarding/${leg.sequence}`,
      'POST',
    );
    assert.equal(
      active.progress.boarding_confirmed_segment_sequence,
      leg.sequence,
    );
    await time.fill(jakarta(leg.end_at));
    active = await uiMutation(
      'Saya Sudah Turun',
      `journeys/${active.journey_id}/alighting/${leg.sequence}`,
      'POST',
    );
    assert.equal(
      active.progress.alighting_confirmed_segment_sequence,
      leg.sequence,
    );
  }
  const next = active.segments[leg.sequence + 1];
  await time.fill(jakarta(next?.start_at ?? leg.end_at));
  active = await uiMutation(
    next ? 'Lanjutkan Perjalanan' : 'Selesaikan Perjalanan',
    `journeys/${active.journey_id}/progress`,
    'PATCH',
  );
  assert.equal(
    active.progress.completed_segment_count,
    leg.sequence + 1,
    'progress not advanced to next leg',
  );
  evidence.progress_events.push({
    leg_sequence: leg.sequence,
    leg_mode: leg.mode,
    leg_end_at: leg.end_at,
    alighting_confirmed: active.progress.alighting_confirmed_segment_sequence,
    boarding_confirmed: active.progress.boarding_confirmed_segment_sequence,
    alighting_at: active.progress.alighting_confirmed_at,
    progress_revision: active.progress.revision,
    completed_segment_count: active.progress.completed_segment_count,
    recorded_at: active.progress.recorded_at,
  });
  return leg.mode !== 'WALK';
}
async function mapChecks() {
  await page
    .getByRole('application', { name: /Peta rute terpilih/ })
    .waitFor({ timeout: 30_000 });
  await page
    .getByRole('status')
    .filter({ hasText: 'Peta perjalanan siap.' })
    .waitFor({ timeout: 30_000 });
  await page.locator('.maplibregl-canvas').first().waitFor({ timeout: 15_000 });
  await page
    .getByRole('figure', { name: 'Interactive route geometry:' })
    .getByRole('link', { name: '© OpenStreetMap contributors' })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.maplibre-marker').length >= 2,
    null,
    { timeout: 30_000 },
  );
  assert.ok(await page.getByRole('list', { name: 'Map markers' }).count());
  assert.equal(
    await page
      .getByText('Route geometry is unavailable.', { exact: false })
      .count(),
    0,
  );
  await page
    .getByRole('application', { name: /Peta rute terpilih/ })
    .locator('canvas')
    .hover();
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.maplibre-frame canvas').count());
}
// R3-B: 20 executable UI steps. Order enforced, no branch-skip. 1..20 indexed.
try {
  await step('runtime-ready', 1, async () => {
    assert.equal(env('CONTROLLED_REVIEW_ENABLED'), 'true');
    assert.ok(token.length >= 32, 'controlled review token unavailable');
    assert.ok((await fetch(web, { signal: AbortSignal.timeout(20_000) })).ok);
    assert.ok(
      (
        await fetch(`${new URL(api).origin}/health/ready`, {
          signal: AbortSignal.timeout(20_000),
        })
      ).ok,
    );
    return `runtime ready on ${web}/${new URL(api).origin}`;
  });
  browser = await chromium.launch(
    existsSync(chrome)
      ? {
          executablePath: chrome,
          headless: true,
          args: web.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
        }
      : { headless: true },
  );
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();

  await step('ui-place-search-runtime-ready-map-initial', 2, async () => {
    await page.goto(web, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll('button')].find(
          (item) => item.textContent?.trim() === 'Cari perjalanan',
        );
        return button && !button.disabled;
      },
      null,
      { timeout: 30_000 },
    );
    evidence.snapshot = ok(await proxy('config')).network_snapshot_id;
    assert.match(
      evidence.snapshot,
      /^[0-9a-f-]{36}$/,
      'config did not return a real network snapshot id',
    );
    await choosePlace(
      'From',
      'Kelapa Gading',
      /^Kelapa Gading LRT Jakarta · station/,
    );
    assert.ok(
      (await context.cookies()).some(
        (cookie) =>
          cookie.name === 'transumin_proto_session' && cookie.httpOnly,
      ),
    );
    return `snapshot ${evidence.snapshot}; From ${evidence.place_identities.From.name} (${evidence.place_identities.From.external_id})`;
  });

  await step('ui-place-search-destination-identity-coords', 3, async () => {
    await choosePlace('To', 'Gambir', /^Gambir TransJakarta · station/);
    assert.match(
      evidence.place_identities.To.external_id,
      /^\S+$/,
      'destination external identity missing',
    );
    assert.equal(
      typeof evidence.place_identities.To.latitude,
      'number',
      'destination identity coords missing',
    );
    assert.equal(
      typeof evidence.place_identities.To.longitude,
      'number',
      'destination identity coords missing',
    );
    const forbidden = page.getByText('Masukkan koordinat');
    assert.ok(await forbidden.count(), 'destination search UI missing');
    return `To ${evidence.place_identities.To.name} (${evidence.place_identities.To.external_id}) coords (${evidence.place_identities.To.latitude}, ${evidence.place_identities.To.longitude})`;
  });

  await step('ui-preference-otp-plan-fewest-transfers', 4, async () => {
    await page.getByLabel('Berangkat (WIB)').fill('2026-10-02T08:11');
    evidence.preferences.FEWEST_TRANSFERS = (
      await planFromUi('FEWEST_TRANSFERS')
    ).length;
    return `FEWEST_TRANSFERS OTP alternatives=${evidence.preferences.FEWEST_TRANSFERS}`;
  });

  await step('ui-preference-otp-plan-least-walking', 5, async () => {
    evidence.preferences.LEAST_WALKING = (
      await planFromUi('LEAST_WALKING')
    ).length;
    return `LEAST_WALKING OTP alternatives=${evidence.preferences.LEAST_WALKING}`;
  });

  await step('ui-preference-otp-plan-fastest-easiest-badge', 6, async () => {
    plans = await planFromUi('FASTEST');
    evidence.preferences.FASTEST = plans.length;
    assert.ok(plans.length > 0, 'FASTEST: no OTP alternatives');
    const transfers = Math.min(...plans.map((item) => item.transfer_count));
    const simplest = plans.filter(
      (journey) => journey.transfer_count === transfers,
    );
    const walking = Math.min(
      ...simplest.map((item) => item.walking_distance_meters),
    );
    const easiest = simplest.filter(
      (journey) => journey.walking_distance_meters === walking,
    );
    assert.ok(easiest.length > 0, 'easiest subset empty');
    const easiestIds = easiest.map((journey) => journey.journey_id);
    evidence.easiest = {
      transfer_count: transfers,
      walking_distance_meters: walking,
      journey_ids: easiestIds,
    };
    if (plans.length > 1) {
      const rendered = page.getByText('Easiest among shown', { exact: false });
      assert.ok((await rendered.count()) > 0, 'easiest subset not rendered');
      const flagged = await page
        .getByRole('region', { name: 'Pilihan perjalanan' })
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons
            .filter((button) =>
              button.textContent?.includes('Easiest among shown'),
            )
            .map((button) =>
              button.textContent?.includes('Option') ? button.textContent : '',
            ),
        );
      assert.equal(
        flagged.length,
        easiestIds.length,
        'rendered easiest flags do not match fewest-then-least-walking subset',
      );
    } else
      assert.equal(easiestIds.length, 1, 'single-candidate easiest mismatch');
    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .first()
      .waitFor({ timeout: 120_000 });
    const shot = await snapshotScreenshot('choices-three-preferences');
    active = plans.find((journey) =>
      journey.segments.some(
        (segment) =>
          segment.sequence >= 2 &&
          segment.entity_bindings.some(
            (binding) =>
              binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
          ),
      ),
    );
    assert.ok(active, 'no FASTEST candidate with future route dependency');
    evidence.selected_journey_id = active.journey_id;
    return `3 preferences; FASTEST ${plans.length} candidates; easiest ${easiestIds.length}; ${shot}`;
  });

  await step('ui-alternatives-display-ranking-map-parity', 7, async () => {
    assert.ok(
      (await page.getByLabel('Berangkat (WIB)').inputValue()) ===
        '2026-10-02T08:11',
      'departure control did not retain the entered Jakarta time',
    );
    assert.equal(
      await page.getByLabel('Urutkan berdasarkan').inputValue(),
      'FASTEST',
      'preference control did not retain FASTEST',
    );
    assert.ok(
      await page.getByRole('combobox', { name: 'Dari' }).count(),
      'From place control missing',
    );
    assert.ok(
      await page.getByRole('combobox', { name: 'Ke' }).count(),
      'To place control missing',
    );
    assert.ok(
      (
        await page.getByRole('combobox', { name: 'Dari' }).inputValue()
      ).includes('Kelapa Gading'),
      'From control did not retain the chosen place',
    );
    assert.ok(
      (await page.getByRole('combobox', { name: 'Ke' }).inputValue()).includes(
        'Gambir',
      ),
      'To control did not retain the chosen place',
    );
    assert.ok(
      await page
        .getByRole('button', { name: 'Cari perjalanan', exact: true })
        .count(),
      'Cari perjalanan button missing',
    );
    assert.ok(
      await page
        .getByRole('button', { name: /Muat contoh perjalanan/ })
        .count(),
      'demo-scenario button missing from full UI control path',
    );
    assert.ok(
      await page.getByText('Masukkan koordinat').count(),
      'coordinate-entry control missing from full UI control path',
    );
    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .nth(plans.indexOf(active))
      .click();
    await page.locator('.leg-list').first().waitFor();
    target = active.segments.find(
      (segment) =>
        segment.sequence >= 2 &&
        segment.entity_bindings.some(
          (binding) =>
            binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
        ),
    );
    await mapChecks();
    await page.waitForFunction(
      (count) => document.querySelectorAll('.leg-list li').length >= count,
      active.segments.length,
      { timeout: 15_000 },
    );
    assert.ok(await page.getByText(/Router: OTP/).count());
    const before = await page.locator('.leg-list li').evaluateAll((items) =>
      items.map((item) => ({
        text: item.innerText
          .replace(/ · (completed|current|upcoming)/g, '')
          .trim(),
        position:
          [...item.classList].find((name) =>
            ['completed', 'current', 'upcoming'].includes(name),
          ) ?? null,
      })),
    );
    const map = page.locator('.maplibre-frame');
    const parity = await map.evaluate((node) => ({
      route_sources: Number(node.getAttribute('data-route-source-count')),
      route_points: Number(node.getAttribute('data-route-point-count')),
      markers: Number(node.getAttribute('data-marker-count')),
      fit_bounds: node.getAttribute('data-fit-bounds'),
    }));
    assert.equal(
      parity.route_sources,
      active.segments.length,
      'map route-source count differs from itinerary legs',
    );
    assert.ok(
      parity.route_points >= 2 * active.segments.length,
      'map route points do not cover itinerary geometry',
    );
    assert.ok(parity.markers >= 2, 'map endpoint markers missing');
    assert.ok(parity.fit_bounds, 'map did not fit returned geometry');
    const shot = await snapshotScreenshot('selected-itinerary-map-timeline');
    evidence.acceptance_map_timeline_parity = {
      journey_id: active.journey_id,
      map: parity,
      timeline: before,
      screenshot: shot,
    };
    return 'alternatives displayed and map/timeline parity asserted';
  });

  await step('activate-unique-uuid-anchored', 8, async () => {
    active = await uiMutation(
      'Mulai Perjalanan',
      `journeys/${active.journey_id}/activate`,
      'POST',
    );
    assert.equal(active.status, 'ACTIVE');
    assert.match(active.journey_id, uuid, 'activation UUID must be valid');
    if (typeof active.plan_fingerprint === 'string')
      assert.equal(active.plan_fingerprint.length, 64);
    assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
    assert.equal(
      active.progress.completed_segment_count,
      0,
      'activation did not anchor at origin',
    );
    assert.equal(
      active.network_snapshot_id,
      evidence.snapshot,
      'active journey left the exact network snapshot',
    );
    assert.equal(
      active.routing_context.common_service_date,
      '2026-10-02',
      'active journey service-date mismatch',
    );
    evidence.active_instance_uuid = active.journey_id;
    return `active instance ${active.journey_id} anchored at origin`;
  });

  await step('independent-second-context-activation', 9, async () => {
    const otherPage = await other.newPage();
    await otherPage.goto(web, { waitUntil: 'domcontentloaded' });
    // Independent browser establishes its own server-derived cookie; unrelated OD corridor.
    const snapshotId = ok(await proxy('config', {}, other)).network_snapshot_id;
    const places = async (query) =>
      ok(
        await proxy(
          `transit/places?q=${encodeURIComponent(query)}&snapshot_id=${encodeURIComponent(snapshotId)}`,
          {},
          other,
        ),
      );
    const harmoni = (await places('Harmoni')).find(
      (place) =>
        place.kind === 'STATION' && place.product_mode === 'TRANSJAKARTA',
    );
    const lebak = (await places('Lebak Bulus Bank Syariah Indonesia')).find(
      (place) =>
        place.kind === 'STATION' && place.product_mode === 'MRT_JAKARTA',
    );
    assert.ok(
      harmoni && lebak,
      'unrelated second-context stops unavailable from supported search',
    );
    const planned = ok(
      await proxy(
        'journeys/plan',
        {
          method: 'POST',
          data: {
            origin: {
              latitude: harmoni.latitude,
              longitude: harmoni.longitude,
            },
            destination: {
              latitude: lebak.latitude,
              longitude: lebak.longitude,
            },
            departure_at: active.start_at,
            network_snapshot_id: snapshotId,
            preference: 'BALANCED',
          },
        },
        other,
      ),
    );
    otherJourney = ok(
      await proxy(
        `journeys/${planned[0].journey_id}/activate`,
        {
          method: 'POST',
          headers: { 'idempotency-key': randomUUID() },
          data: { selected_journey: planned[0] },
        },
        other,
      ),
    );
    const cookieA = (await context.cookies()).find(
      (cookie) => cookie.name === 'transumin_proto_session',
    );
    const cookieB = (await other.cookies()).find(
      (cookie) => cookie.name === 'transumin_proto_session',
    );
    assert.ok(
      cookieA?.httpOnly && cookieB?.httpOnly && cookieA.value !== cookieB.value,
      'independent contexts must not share a session cookie',
    );
    assert.notEqual(otherJourney.journey_id, active.journey_id);
    assert.ok(
      [403, 404].includes(
        (await proxy(`journeys/${active.journey_id}`, {}, other)).status,
      ),
      'second context reached the first owner journey',
    );
    evidence.second_context = {
      alias: 'independent-browser-context',
      journey_id: otherJourney.journey_id,
      shares_session_cookie: false,
      has_owner_access: false,
    };
    return otherJourney.journey_id;
  });

  await step('boarding-alighting-walk-progress-prefix', 10, async () => {
    let transit = 0;
    while (active.progress.completed_segment_count < target.sequence - 1)
      if (await advanceCurrent()) transit++;
    assert.ok(transit > 0, 'no boarding/alighting before report');
    assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
    assert.deepEqual(
      ok(await proxy(`journeys/${active.journey_id}`)).progress,
      active.progress,
      'server progress did not match UI progress',
    );
    return `progressed to leg ${target.sequence - 1}; ${transit} transit legs confirmed (${evidence.progress_events.length} progress events)`;
  });

  await step('ui-report-reporting-unverified-target-anchor', 11, async () => {
    const binding = target.entity_bindings.find(
      (item) => item.entity_type === 'ROUTE' && item.mobility_entity_id,
    );
    const selector = page.getByLabel(
      'Lokasi atau layanan pada sisa perjalanan',
    );
    const value = await selector
      .locator('option')
      .evaluateAll(
        (options, id) =>
          options.find((option) => option.value.includes(id))?.value,
        binding.mobility_entity_id,
      );
    assert.ok(value, 'report target anchor missing from UI options');
    await selector.selectOption(value);
    await page
      .getByLabel('Waktu kejadian (WIB)')
      .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
    await page
      .getByLabel('Keterangan')
      .fill(`R1 SIMULATED acceptance ${randomUUID()}`);
    const report = await uiMutation(
      'Kirim laporan',
      'passenger-reports',
      'POST',
    );
    reportId = report.report_id;
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
    evidence.report = {
      report_id: report.report_id,
      target_mobility_entity_id: binding.mobility_entity_id,
      entity_type: binding.entity_type,
      verification_status: report.verification_status,
    };
    assert.ok(
      await page.getByText(/Belum diverifikasi/, { exact: false }).count(),
      'REPORTED_UNVERIFIED not shown in UI',
    );
    return `report ${report.report_id} anchored to ${binding.mobility_entity_id}`;
  });

  await step('controlled-review-protected-unverified', 12, async () => {
    assert.ok(
      [403, 404].includes(
        (await proxy(`passenger-reports/${reportId}`, {}, other)).status,
      ),
      'other context must not read foreign report',
    );
    assert.equal(
      (
        await proxy(`controlled/passenger-reports/${reportId}/verify`, {
          method: 'POST',
          data: {
            operational_state: 'UNAVAILABLE',
            incident_type: 'SERVICE_SUSPENSION',
            reason: 'proxy denied',
          },
        })
      ).status,
      403,
      'unauthorized controlled review must be rejected',
    );
    return 'foreign report and unauthorized verify both denied';
  });

  await step(
    'controlled-review-verify-simulated-alert-anchor',
    13,
    async () => {
      reviewed = true;
      const review = ok(
        await controlled('verify', {
          operational_state: 'UNAVAILABLE',
          incident_type: 'SERVICE_SUSPENSION',
          reason: `R1 ${reportId}`,
        }),
      );
      assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
      evidence.review = {
        report_id: reportId,
        verification_status: review.verification_status,
        reviewer_alias: 'controlled-reviewer-r1',
      };
      const alerts = ok(await proxy(`journeys/${active.journey_id}/alerts`));
      const alert = alerts.find(
        (item) =>
          item.mobility_entity_id ===
            evidence.report.target_mobility_entity_id &&
          item.evidence_type === 'SIMULATED' &&
          !item.resolved_at,
      );
      assert.ok(alert, 'affected SIMULATED alert missing');
      assert.ok(
        alert.affected_segment_sequences.includes(target.sequence),
        'affected segment sequences missing the disrupted leg',
      );
      evidence.alerts.affected = {
        alert_id: alert.alert_id,
        impact_id: alert.impact_id,
        mobility_entity_id: alert.mobility_entity_id,
        affected_segment_sequences: alert.affected_segment_sequences,
        evidence_type: alert.evidence_type,
      };
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByText('SIMULASI terkontrol', { exact: false })
        .first()
        .waitFor({ timeout: 30_000 });
      return `alert ${alert.alert_id} SIMULATED and anchored to leg ${target.sequence}`;
    },
  );

  await step('independent-second-context-alert-isolation', 14, async () => {
    assert.ok(otherJourney, 'second context journey missing');
    const alerts = ok(
      await proxy(`journeys/${otherJourney.journey_id}/alerts`, {}, other),
    );
    assert.equal(
      alerts.filter(
        (item) =>
          item.mobility_entity_id === evidence.report.target_mobility_entity_id,
      ).length,
      0,
      'unrelated journey received the reviewed-entity alert',
    );
    assert.ok(
      [403, 404].includes(
        (await proxy(`passenger-reports/${reportId}`, {}, other)).status,
      ),
      'unrelated context still sees foreign report',
    );
    evidence.alerts.unaffected_context = {
      alias: evidence.second_context?.alias ?? 'independent',
      journey_id: otherJourney.journey_id,
      has_reviewed_entity_alert: false,
      has_report_access: false,
    };
    return 'second context unaffected; report access denied';
  });

  await step('genuine-otp-recovery-proposal-anchor', 15, async () => {
    recovery = await uiMutation('Cari rute pengganti', 'recoveries', 'POST');
    branch =
      recovery.status === 'COMPLETED'
        ? 'COMPLETED'
        : recovery.rejoin_status === 'NO_PATH'
          ? 'NO_PATH'
          : null;
    assert.ok(
      branch,
      `recovery produced unsupported status=${recovery.status}`,
    );
    evidence.recovery_lineage = {
      recovery_id: recovery.recovery_id,
      original_journey_id: recovery.original_journey_id,
      impact_id: recovery.impact_id,
      recovery_anchor: recovery.recovery_anchor,
      completed_segment_count: recovery.completed_segment_count,
      preserved_segment_count: recovery.preserved_segment_count,
      changed_segment_count: recovery.changed_segment_count,
      invalidated_segments: recovery.invalidated_segments,
      repaired_segments: recovery.repaired_segments,
      rejoin_status: recovery.rejoin_status,
      network_snapshot_id: recovery.network_snapshot_id,
    };
    if (branch === 'COMPLETED') {
      assert.ok(recovery.proposed_journey, 'proposed recovery journey missing');
      assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
      assert.equal(
        recovery.proposed_journey.routing_context.provider,
        'OTP',
        'recovery proposal came from a non-OTP router',
      );
      evidence.recovery_lineage.proposed_journey = {
        journey_id: recovery.proposed_journey.journey_id,
        routing_provider: recovery.proposed_journey.routing_context.provider,
        routing_snapshot_id:
          recovery.proposed_journey.routing_context.routing_snapshot_id,
        graph_sha256: recovery.proposed_journey.routing_context.graph_sha256,
        common_service_date:
          recovery.proposed_journey.routing_context.common_service_date,
        timezone: recovery.proposed_journey.routing_context.timezone,
      };
      void hash;
      void uuid;
      return `recovery ${recovery.recovery_id} proposed OTP reroute (COMPLETED)`;
    }
    // R3-B: genuine OTP recovery must complete; NO_PATH is a fail, not a pass.
    throw new Error(
      'genuine OTP recovery did not complete; R3 requires COMPLETED with a proposed OTP reroute',
    );
  });

  await step('recovery-acceptance-lineage-persist', 16, async () => {
    assert.equal(branch, 'COMPLETED', 'no accepted route to continue');
    acceptance = await uiMutation(
      'Gunakan rute pengganti ini',
      `recoveries/${recovery.recovery_id}/accept`,
      'POST',
    );
    assert.equal(acceptance.original_plan_preserved, true);
    assert.equal(acceptance.current_pointer_advanced, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persisted = ok(await proxy(`recoveries/${recovery.recovery_id}`));
    assert.equal(persisted.accepted, true);
    evidence.recovery_lineage.acceptance = {
      recovery_id: acceptance.recovery_id,
      accepted_progress_revision: acceptance.accepted_progress_revision,
      accepted_impact_id: acceptance.accepted_impact_id,
      accepted_state_transition_id: acceptance.accepted_state_transition_id,
      accepted_mobility_projection_version:
        acceptance.accepted_mobility_projection_version,
      accepted_journey_fingerprint: acceptance.accepted_journey_fingerprint,
      original_plan_preserved: acceptance.original_plan_preserved,
      current_pointer_advanced: acceptance.current_pointer_advanced,
      current_replacement_journey_id:
        acceptance.current_replacement_journey?.journey_id ?? null,
      accepted: persisted.accepted,
    };
    void hash;
    return `accepted ${acceptance.recovery_id}; revision lineage persisted`;
  });

  await step('accepted-map-timeline-parity-after-reload', 17, async () => {
    active = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(active.status, 'ACTIVE');
    await page
      .getByText('Rute pengganti diterima', { exact: false })
      .first()
      .waitFor({ timeout: 30_000 });
    await page
      .locator('.maplibregl-canvas')
      .first()
      .waitFor({ timeout: 30_000 });
    await page.locator('.leg-list').first().waitFor({ timeout: 30_000 });
    // After reload the journey fetch and the map source effect complete
    // asynchronously; wait for the expected source count instead of racing on
    // an unset attribute.
    await page
      .waitForFunction(
        (expected) =>
          Number(
            document
              .querySelector('.maplibre-frame')
              ?.getAttribute('data-route-source-count'),
          ) === expected,
        active.segments.length,
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    const acceptedMap = await page
      .locator('.maplibre-frame')
      .evaluate((node) => ({
        route_sources: Number(node.getAttribute('data-route-source-count')),
        route_points: Number(node.getAttribute('data-route-point-count')),
        markers: Number(node.getAttribute('data-marker-count')),
      }));
    assert.equal(
      acceptedMap.route_sources,
      active.segments.length,
      'accepted map does not match accepted itinerary leg count',
    );
    assert.ok(
      acceptedMap.markers >= 2,
      'accepted map endpoint markers missing',
    );
    const acceptedTimeline = await page.locator('.leg-list li').count();
    assert.equal(
      acceptedTimeline,
      active.segments.length,
      'accepted timeline does not match accepted itinerary',
    );
    evidence.acceptance_map_timeline_parity.accepted = {
      journey_id: active.journey_id,
      map: acceptedMap,
      timeline_count: acceptedTimeline,
    };
    // R3-B: intermediate artifact written since all lineage is final here.
    const recorded = await recordEvidenceOrThrow('post-acceptance');
    void recorded;
    return 'accepted map/timeline parity persisted after reload';
  });

  await step('continue-boarding-alighting-walk-to-completion', 18, async () => {
    const remainingTransit = active.segments
      .slice(active.progress.completed_segment_count)
      .filter((segment) => segment.mode !== 'WALK').length;
    let transit = 0;
    let steps = 0;
    try {
      while (active.status !== 'COMPLETED' && steps < 50) {
        if (await advanceCurrent()) transit++;
        steps++;
      }
    } catch (error) {
      const current = ok(await proxy(`journeys/${active.journey_id}`));
      throw new Error(
        `${safe(error.message)} (server progress=${current.progress.completed_segment_count}/${current.segments.length} status=${current.status})`,
      );
    }
    assert.ok(steps > 0, 'accepted continuation advanced no leg');
    assert.equal(
      transit,
      remainingTransit,
      'not every remaining transit leg was boarded and alighted',
    );
    const completed = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(
      completed.progress.completed_segment_count,
      completed.segments.length,
    );
    await page
      .getByText('perjalanan ini sudah selesai.', { exact: false })
      .waitFor();
    void hash;
    return `${steps} legs continued (${transit} transit); journey COMPLETED`;
  });

  await step('journey-completed-reload-continuity', 19, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30_000 });
    await page
      .getByText('perjalanan ini sudah selesai.', { exact: false })
      .waitFor({ timeout: 30_000 });
    const reloaded = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(
      reloaded.status,
      'COMPLETED',
      'journey status did not persist COMPLETED after reload',
    );
    assert.equal(
      reloaded.progress.completed_segment_count,
      reloaded.segments.length,
      'completed segment count did not persist after reload',
    );
    assert.deepEqual(
      reloaded.progress,
      active.progress,
      'progress mutated across reload',
    );
    evidence.persisted_completed = {
      journey_id: active.journey_id,
      status: reloaded.status,
      active_instance_uuid: evidence.active_instance_uuid,
      completed_segment_count: reloaded.progress.completed_segment_count,
      segments: reloaded.segments.length,
      progress_events: evidence.progress_events.length,
    };
    const shot = await snapshotScreenshot('journey-completed-reloaded');
    const recorded = await recordEvidenceOrThrow('final');
    void recorded;
    return `persisted COMPLETED after reload; ${shot}`;
  });

  await step('final-artifact-all-cases-complete', 20, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByText('perjalanan ini sudah selesai.', { exact: false })
      .waitFor();
    const reloaded = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(reloaded.status, 'COMPLETED');
    await page.locator('.leg-list').first().waitFor();
    assert.equal(
      await page.locator('.leg-list li').count(),
      reloaded.segments.length,
    );
    assert.deepEqual(
      evidence.ui_steps.map((item) => item.n),
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
    return 'second reload: COMPLETED and timeline parity; steps 1–19 executed in order';
  });
} catch (error) {
  failure = failure ?? safe(error.message);
} finally {
  if (reportId && reviewed) {
    try {
      const closed = ok(
        await controlled('close', {
          decision: 'RESOLVED',
          reason: `R1 finally cleanup ${reportId}`,
        }),
      );
      assert.equal(closed.lifecycle_status, 'RESOLVED');
      mark(
        'controlled-close-finally',
        'PASS',
        'RESOLVED through controlled endpoint',
      );
    } catch (error) {
      mark('controlled-close-finally', 'FAIL', error.message);
    }
  }
  await browser?.close().catch(() => {});
  // Final fail-closed artifact even on failure paths, so evidence always lands.
  try {
    if (typeof recordEvidence === 'function') await recordEvidence('final');
  } catch (error) {
    process.stderr.write(
      `[finally] evidence write failed: ${safe(String(error))}\n`,
    );
  }
  process.exitCode = Number(process.env.R3_EXIT_CODE ?? 0);
}
const failed = cases.filter((item) => item.verdict === 'FAIL');
const status = failed.length ? 'FAIL' : failure ? 'NOT_VERIFIED' : 'PASS';
const sanitized = {
  snapshot: evidence.snapshot,
  place_identities: evidence.place_identities,
  departure_input_jakarta: evidence.departure_input_jakarta,
  ui_steps: evidence.ui_steps,
  plan_responses: evidence.plan_responses,
  all_plan_ids: evidence.all_plan_ids,
  selected_journey_id: evidence.selected_journey_id,
  active_instance_uuid: evidence.active_instance_uuid,
  progress_events: evidence.progress_events,
  report: evidence.report,
  review: evidence.review,
  alerts: evidence.alerts,
  second_context: evidence.second_context,
  recovery_lineage: evidence.recovery_lineage,
  preferences: evidence.preferences,
  easiest: evidence.easiest,
  acceptance_map_timeline_parity: evidence.acceptance_map_timeline_parity,
  persisted_completed: evidence.persisted_completed,
  evidenceDir: evidenceDir,
};
console.log(
  JSON.stringify({
    status,
    branch,
    cases,
    failure,
    sanitized,
    evidence:
      'real Playwright UI place search, OTP plans, controlled SIMULATED review, genuine recovery lineage; fail-closed evidence; no SQL cleanup',
  }),
);
if (status !== 'PASS') process.exitCode = 1;
