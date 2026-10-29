import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

/** Exact product guard sources (Node 22 type stripping); identical hash conventions. */
let nav;
try {
  nav = await import('../src/lib/navigation.ts');
} catch (error) {
  throw new Error(
    `NOT VERIFIED: navigation identity import failed: ${error?.message ?? error}`,
  );
}
let mapGeometry;
try {
  mapGeometry = await import('../src/lib/map-geometry.ts');
} catch (error) {
  throw new Error(
    `NOT VERIFIED: map geometry import failed: ${error?.message ?? error}`,
  );
}

await assertCp2Runtime();

const web = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const api =
  process.env.PASSENGER_API_BASE_URL ?? 'http://127.0.0.1:3303/api/v1';
const chrome =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = new URL('../../../', import.meta.url);
const envText = (() => {
  try {
    return readFileSync(new URL('.env', root), 'utf8');
  } catch {
    return '';
  }
})();
const env = (name) =>
  process.env[name] ??
  envText
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim() ??
  '';
const secret = env('PASSENGER_SESSION_SECRET');
const departure = '2026-10-02T08:00';
const modes = [
  {
    mode: 'MIKROTRANS',
    from: 'Term. Tj. Priok 2',
    fromId: 'B05729P',
    to: 'Telkom Tj. Priok',
    toId: 'B05694P',
  },
  {
    mode: 'MRT_JAKARTA',
    from: 'Lebak Bulus Bank Syariah Indonesia',
    to: 'Fatmawati',
  },
  { mode: 'LRT_JAKARTA', from: 'Kelapa Gading', to: 'Velodrome' },
  { mode: 'LRT_JABODEBEK', from: 'Harjamukti', to: 'Ciracas' },
  { mode: 'KRL', from: 'Bogor', to: 'Cilebut' },
];
const data = (body) => body?.data ?? body;
const jakarta = (at) =>
  new Date(Math.ceil(Date.parse(at) / 60_000) * 60_000 + 7 * 3600_000)
    .toISOString()
    .slice(0, 16);
const modeLabel = {
  MIKROTRANS: 'Mikrotrans',
  MRT_JAKARTA: 'MRT Jakarta',
  LRT_JAKARTA: 'LRT Jakarta',
  LRT_JABODEBEK: 'LRT Jabodebek',
  KRL: 'KRL Commuter Line',
};
const envelope = async (response) => ({
  status: response.status(),
  body: data(await response.json().catch(() => null)),
});

async function owner(context) {
  const cookie = (await context.cookies(web)).find(
    (item) => item.name === 'transumin_proto_session',
  );
  assert.ok(cookie, 'passenger session cookie missing from browser context');
  assert.ok(cookie.httpOnly, 'passenger session cookie is not HttpOnly');
  const raw = decodeURIComponent(cookie.value);
  const [value, expiresAt, signature, ...extra] = raw.split('.');
  assert.ok(
    value && expiresAt && signature && extra.length === 0,
    'session cookie format invalid',
  );
  if (secret)
    assert.equal(
      signature,
      createHmac('sha256', secret)
        .update(`${value}.${expiresAt}`)
        .digest('base64url'),
      'session signature invalid',
    );
  assert.ok(
    Number(expiresAt) > Math.floor(Date.now() / 1000),
    'session cookie expired',
  );
  return value;
}
async function proxy(context, path, options = {}) {
  return envelope(
    await context.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      timeout: 120_000,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
async function choose(page, field, query, item) {
  // Config readiness also proves React hydration before input events can be lost.
  await page
    .getByRole('button', { name: 'Cari perjalanan', exact: true })
    .click({ trial: true });
  const wait = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/api/passenger/transit/places') &&
      url.searchParams.get('q') === query
    );
  });
  await page.getByRole('combobox', { name: field }).fill(query);
  const response = await wait;
  assert.equal(response.status(), 200);
  const places = data(await response.json());
  const expectedId = field === 'From' ? item.fromId : item.toId;
  const place = places.find(
    (place) =>
      place.product_mode === item.mode &&
      (expectedId
        ? place.external_id === expectedId
        : place.name.includes(query)),
  );
  assert.ok(
    place,
    `${item.mode} ${field} absent from real place search: ${JSON.stringify(places.map(({ name, external_id, product_mode }) => ({ name, external_id, product_mode })))}`,
  );
  const option = page
    .getByRole('option')
    .filter({ hasText: place.external_id })
    .filter({ hasText: modeLabel[item.mode] })
    .first();
  await option.click();
  assert.equal(
    await page.getByRole('combobox', { name: field }).inputValue(),
    place.name,
  );
  return place;
}
function assertGeometry(journey) {
  assert.ok(journey.segments.length > 0);
  for (const segment of journey.segments) {
    const points = segment.geometry?.coordinates;
    assert.ok(
      Array.isArray(points) && points.length >= 2,
      `missing geometry leg ${segment.sequence}`,
    );
    for (const point of points)
      assert.ok(
        point.length === 2 &&
          point.every(Number.isFinite) &&
          Math.abs(point[0]) <= 180 &&
          Math.abs(point[1]) <= 90,
      );
  }
}
const acceptedSnapshot = '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f';
function assertPlan(selected, active) {
  assert.equal(active.plan_journey_id, selected.journey_id);
  assert.equal(active.network_snapshot_id, acceptedSnapshot);
  assert.deepEqual(active.routing_context, selected.routing_context);
  assert.deepEqual(
    active.segments,
    selected.segments,
    'selected/active segments or bindings changed',
  );
  assert.deepEqual(
    active.original_plan,
    selected,
    'original selected plan changed',
  );
}
async function assertMapTimeline(page, journey, mode, position = null) {
  const generation = journey.accepted_recovery_id ?? 'ORIGINAL';
  const expected = journey.segments
    .map((segment) => {
      const points = mapGeometry.mapGeometryPoints(
        segment.geometry.coordinates,
      );
      assert.ok(points.length >= 2);
      const feature = {
        type: 'Feature',
        id: segment.sequence,
        properties: { sequence: segment.sequence, mode: segment.mode },
        geometry: { type: 'LineString', coordinates: points },
      };
      const id = `journey-${journey.journey_id}-${generation}-segment-${segment.sequence}`;
      return `${journey.journey_id}:${generation}:${id}:${nav.shortHash(JSON.stringify(feature))}`;
    })
    .join('|');
  await page.waitForFunction(
    (fingerprint) =>
      document
        .querySelector('.maplibre-frame')
        ?.getAttribute('data-route-source-fingerprint') === fingerprint,
    expected,
    { timeout: 30_000 },
  );
  const map = await page.locator('.maplibre-frame').evaluate((node) => ({
    sources: Number(node.getAttribute('data-route-source-count')),
    points: Number(node.getAttribute('data-route-point-count')),
    markers: Number(node.getAttribute('data-marker-count')),
    fingerprint: node.getAttribute('data-route-source-fingerprint'),
  }));
  assert.equal(map.fingerprint, expected);
  assert.equal(map.sources, journey.segments.length);
  assert.equal(
    map.points,
    journey.segments.reduce(
      (sum, leg) => sum + leg.geometry.coordinates.length,
      0,
    ),
  );
  assert.ok(map.markers >= 2);
  const timeline = await page.locator('.leg-list li').evaluateAll((nodes) =>
    nodes.map((node) => ({
      sequence: node.getAttribute('data-segment-sequence'),
      fingerprint: node.getAttribute('data-leg-fingerprint'),
      position: node.className,
    })),
  );
  assert.deepEqual(
    timeline,
    journey.segments.map((leg) => ({
      sequence: String(leg.sequence),
      fingerprint: nav.walkGeometryIdentity(leg),
      position:
        position === null
          ? ''
          : leg.sequence < position
            ? 'completed'
            : leg.sequence === position
              ? 'current'
              : 'upcoming',
    })),
  );
  assert.ok(
    (await page.locator('.leg-list').innerText()).includes(modeLabel[mode]),
    'target mode absent from timeline',
  );
  return map;
}
function assertDomainFailure(response, message) {
  assert.equal(response.status, 400);
  // ActiveJourneyController maps domain codes to Nest HTTP errors, without exposing code.
  assert.equal(response.body.statusCode, 400);
  assert.equal(response.body.error, 'Bad Request');
  assert.equal(
    response.body.message,
    message,
    'rejection did not reach intended domain sequencing guard',
  );
  return {
    status: response.status,
    http_error: response.body.error,
    message: response.body.message,
    domain_code_exposed: false,
  };
}
async function runMode(context, other, item) {
  const page = await context.newPage();
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  const originText = await choose(page, 'From', item.from, item);
  const destinationText = await choose(page, 'To', item.to, item);
  await page.getByRole('textbox', { name: 'Berangkat (WIB)' }).fill(departure);
  const planWait = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page
    .getByRole('button', { name: 'Cari perjalanan', exact: true })
    .click();
  const planResponse = await planWait;
  assert.equal(
    planResponse.status(),
    201,
    `${item.mode} plan HTTP ${planResponse.status()}`,
  );
  const plans = data(await planResponse.json());
  assert.ok(
    Array.isArray(plans) && plans.length,
    `${item.mode} no actual itinerary candidates`,
  );
  const buttons = page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button');
  await buttons.first().waitFor({ timeout: 120_000 });
  assert.equal(
    await buttons.count(),
    plans.length,
    'UI alternative count differs from OTP plan response',
  );
  const selectedIndex = plans.findIndex((journey) =>
    journey.segments.some((leg) => leg.mode === item.mode),
  );
  assert.ok(
    selectedIndex >= 0,
    `${item.mode} not returned by routing API; candidates=${plans.map((journey) => journey.segments.map((leg) => leg.mode).join('>')).join('|')}`,
  );
  assert.ok(
    (await buttons.nth(selectedIndex).innerText()).includes(
      modeLabel[item.mode],
    ),
    'selected real mode absent from UI candidate',
  );
  const selected = plans[selectedIndex];
  assert.equal(selected.network_snapshot_id, acceptedSnapshot);
  assert.equal(selected.routing_context.network_snapshot_id, acceptedSnapshot);
  assert.ok(selected.segments.some((leg) => leg.mode === item.mode));
  assertGeometry(selected);
  await buttons.nth(selectedIndex).click();
  const mapCounts = await assertMapTimeline(page, selected, item.mode);

  const activationWait = page.waitForResponse(
    (response) =>
      /\/activate$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Mulai Perjalanan', exact: true })
    .click();
  const activation = await activationWait;
  assert.equal(activation.status(), 201, `${item.mode} activation failed`);
  let active = data(await activation.json());
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
  assert.equal(active.progress.completed_segment_count, 0);
  assertGeometry(active);
  assertPlan(selected, active);
  const activeSegments = active.segments;
  const selectedBindings = selected.segments.flatMap((segment) =>
    segment.entity_bindings.map((entityBinding) => ({
      sequence: segment.sequence,
      mode: segment.mode,
      ...entityBinding,
    })),
  );
  const acceptedSnapshotId = selected.network_snapshot_id;
  await proxy(context, 'config');
  const ownerId = await owner(context);
  const activeId = active.journey_id;
  assert.ok(activeId);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('transumin.passenger.journey'),
    ),
    activeId,
  );

  const journeyRead = await proxy(context, `journeys/${activeId}`);
  assert.equal(journeyRead.status, 200);
  assert.equal(journeyRead.body.journey_id, activeId);
  assert.equal(journeyRead.body.status, 'ACTIVE');
  assertPlan(selected, journeyRead.body);
  assert.deepEqual(journeyRead.body.segments, activeSegments);
  assert.equal(
    journeyRead.body.routing_context.network_snapshot_id,
    acceptedSnapshotId,
  );
  const otherPage = await other.newPage();
  await otherPage.goto(web, { waitUntil: 'domcontentloaded' });
  const sessionBootstrap = await proxy(
    other,
    `transit/places?q=Harmoni&snapshot_id=${selected.network_snapshot_id}`,
  );
  assert.equal(
    sessionBootstrap.status,
    200,
    'independent context session bootstrap failed',
  );
  const otherOwner = await owner(other);
  assert.notEqual(ownerId, otherOwner, 'separate browser contexts share owner');
  assert.ok(
    [403, 404].includes((await proxy(other, `journeys/${activeId}`)).status),
    'cross-owner journey read permitted',
  );
  // Cross-owner mutation denial with otherwise valid headers and idempotency key.
  const otherMutation = await proxy(other, `journeys/${activeId}/boarding/0`, {
    method: 'POST',
    headers: { 'idempotency-key': randomUUID() },
    data: { confirmed_at: active.segments[0].start_at },
  });
  assert.ok(
    [403, 404].includes(otherMutation.status),
    `cross-owner mutation permitted: ${otherMutation.status}`,
  );
  assert.deepEqual(
    (await proxy(context, `journeys/${activeId}`)).body.progress,
    active.progress,
    'cross-owner mutation changed owner progress',
  );

  // Report targets actual route of requested mode, before completing any leg.
  const reportLeg = active.segments.find(
    (segment) => segment.mode === item.mode,
  );
  const binding = reportLeg.entity_bindings.find(
    (binding) => binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
  );
  assert.ok(binding, `${item.mode} lacks canonical route report dependency`);
  const bindingIds = reportLeg.entity_bindings.map((entityBinding) => ({
    entity_type: entityBinding.entity_type,
    mobility_entity_id: entityBinding.mobility_entity_id,
    resolution_method: entityBinding.resolution_method,
  }));
  assert.ok(
    bindingIds.some((entry) => entry.entity_type === 'ROUTE'),
    `${item.mode} selected segment lacks a ROUTE binding`,
  );
  assert.ok(
    bindingIds.some(
      (entry) =>
        entry.entity_type === 'STOP' || entry.entity_type === 'STATION',
    ),
    `${item.mode} selected segment lacks a STOP/STATION binding`,
  );
  assert.ok(
    reportLeg.route_id ?? reportLeg.trip_id,
    `${item.mode} selected segment lacks route/trip identity`,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await owner(context),
    ownerId,
    'signed owner changed after reload',
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('transumin.passenger.journey'),
    ),
    activeId,
  );
  const activeReloadMap = await assertMapTimeline(
    page,
    active,
    item.mode,
    active.progress.completed_segment_count,
  );
  const reloaded = await proxy(context, `journeys/${activeId}`);
  assert.equal(reloaded.status, 200);
  assertPlan(selected, reloaded.body);
  assert.deepEqual(reloaded.body.progress, active.progress);
  const target = page.getByLabel('Lokasi atau layanan pada sisa perjalanan');
  const matching = await target
    .locator('option')
    .evaluateAll(
      (items, id) => items.find((option) => option.value.includes(id))?.value,
      binding.mobility_entity_id,
    );
  assert.ok(
    matching,
    `${item.mode} actual target absent from remaining-report options (${binding.mobility_entity_id})`,
  );
  await target.selectOption(matching);
  await page
    .getByLabel('Waktu kejadian (WIB)')
    .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
  await page
    .getByLabel('Keterangan')
    .fill(`Mode browser acceptance ${item.mode} ${randomUUID()}`);
  const reportWait = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/passenger-reports') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Kirim laporan', exact: true })
    .click();
  const reportResponse = await reportWait;
  assert.equal(reportResponse.status(), 201, `${item.mode} report failed`);
  const report = data(await reportResponse.json());
  assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
  const persistedReport = await proxy(
    context,
    `passenger-reports/${report.report_id}`,
  );
  assert.equal(persistedReport.status, 200);
  assert.equal(
    persistedReport.body.mobility_entity_id,
    binding.mobility_entity_id,
  );
  assert.equal(persistedReport.body.entity_type, 'ROUTE');
  assert.equal(
    persistedReport.body.verification_status,
    report.verification_status,
  );
  assert.equal(persistedReport.body.report_id, report.report_id);
  assert.ok(
    [403, 404].includes(
      (await proxy(other, `passenger-reports/${report.report_id}`)).status,
    ),
    'cross-owner report read permitted',
  );

  const progressEvents = [];
  async function mutate(button, suffix, method) {
    const wait = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/passenger/journeys/${activeId}/${suffix}`) &&
        response.request().method() === method,
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: button, exact: true }).click();
    const response = await wait;
    const body = data(await response.json());
    assert.ok(
      [200, 201].includes(response.status()),
      `${suffix} HTTP ${response.status()}: ${JSON.stringify(body)}`,
    );
    return body;
  }
  // Complete every leg through UI, with explicit invalid transition probes.
  // Canonical negative requires a valid Idempotency-Key; missing key fails before domain sequencing.
  const validIdempotency = () => `p1r-modes-${randomUUID()}`;
  const deniedBoarding = [];
  const deniedProgress = [];
  while (active.progress.completed_segment_count < active.segments.length) {
    const leg = active.segments[active.progress.completed_segment_count];
    const time = page.getByLabel(
      'Waktu tahapan perjalanan (WIB, skenario uji)',
    );
    if (leg.mode !== 'WALK') {
      const before = (await proxy(context, `journeys/${activeId}`)).body
        .progress;
      const gateAt = new Date(
        Math.max(
          Date.parse(leg.end_at),
          Date.parse(active.progress.recorded_at),
          Date.parse(before.recorded_at),
        ),
      ).toISOString();
      const invalidAlighting = await proxy(
        context,
        `journeys/${activeId}/alighting/${leg.sequence}`,
        {
          method: 'POST',
          headers: { 'idempotency-key': validIdempotency() },
          data: { confirmed_at: gateAt },
        },
      );
      deniedBoarding.push(
        assertDomainFailure(
          invalidAlighting,
          'Alighting requires boarding for the same leg first.',
        ),
      );
      const invalidProgress = await proxy(
        context,
        `journeys/${activeId}/progress`,
        {
          method: 'PATCH',
          headers: { 'idempotency-key': validIdempotency() },
          data: {
            completed_segment_count: leg.sequence + 1,
            current_segment_sequence:
              active.segments[leg.sequence + 1]?.sequence ?? null,
            recorded_at: gateAt,
          },
        },
      );
      deniedProgress.push(
        assertDomainFailure(
          invalidProgress,
          'Transit progress requires alighting confirmation for the completed leg.',
        ),
      );
      assert.deepEqual(
        (await proxy(context, `journeys/${activeId}`)).body.progress,
        before,
        'invalid transition changed progress',
      );
      const boardAt = new Date(
        Math.max(
          Date.parse(leg.start_at),
          Date.parse(active.progress.recorded_at),
        ),
      ).toISOString();
      await time.fill(jakarta(boardAt));
      active = await mutate(
        'Saya Sudah Naik',
        `boarding/${leg.sequence}`,
        'POST',
      );
      assert.equal(
        active.progress.boarding_confirmed_segment_sequence,
        leg.sequence,
      );
      await time.fill(
        jakarta(
          new Date(
            Math.max(
              Date.parse(leg.end_at),
              Date.parse(active.progress.recorded_at),
            ),
          ).toISOString(),
        ),
      );
      active = await mutate(
        'Saya Sudah Turun',
        `alighting/${leg.sequence}`,
        'POST',
      );
      assert.equal(
        active.progress.alighting_confirmed_segment_sequence,
        leg.sequence,
      );
    }
    await time.fill(
      jakarta(
        new Date(
          Math.max(
            Date.parse(leg.end_at),
            Date.parse(active.progress.recorded_at),
          ),
        ).toISOString(),
      ),
    );
    active = await mutate(
      leg.mode === 'WALK' && leg.sequence + 1 === active.segments.length
        ? 'Selesaikan Perjalanan'
        : 'Lanjutkan Perjalanan',
      'progress',
      'PATCH',
    );
    assert.equal(active.progress.completed_segment_count, leg.sequence + 1);
    progressEvents.push({
      sequence: leg.sequence,
      mode: leg.mode,
      revision: active.progress.revision,
      recorded_at: active.progress.recorded_at,
      completed: active.progress.completed_segment_count,
    });
  }
  await page
    .getByRole('status')
    .filter({
      hasText: 'Selesaikan Perjalanan — perjalanan ini sudah selesai.',
    })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .getByRole('status')
    .filter({
      hasText: 'Selesaikan Perjalanan — perjalanan ini sudah selesai.',
    })
    .waitFor({ state: 'visible', timeout: 30_000 });
  const final = await proxy(context, `journeys/${activeId}`);
  assert.equal(final.status, 200);
  assert.equal(final.body.status, 'COMPLETED');
  assert.equal(
    final.body.progress.completed_segment_count,
    final.body.segments.length,
  );
  assert.deepEqual(
    final.body.progress,
    active.progress,
    'completion response differs from persisted progress',
  );
  assertPlan(selected, final.body);
  const finalMap = await assertMapTimeline(
    page,
    final.body,
    item.mode,
    final.body.segments.length,
  );
  assert.equal(
    finalMap.fingerprint,
    activeReloadMap.fingerprint,
    'map changed after completion/reload',
  );
  assert.equal(await owner(context), ownerId);
  await otherPage.close();
  await page.close();
  return {
    mode: item.mode,
    origin: `${originText.name} (${originText.external_id})`,
    destination: `${destinationText.name} (${destinationText.external_id})`,
    selected_journey_id: selected.journey_id,
    active_journey_id: activeId,
    network_snapshot_id: acceptedSnapshotId,
    plan_modes: selected.segments.map((leg) => leg.mode),
    segment_count: selected.segments.length,
    map_timeline_parity: mapCounts,
    active_reload_map: activeReloadMap,
    completed_reload_map: finalMap,
    selected_active_persisted_plan_exact: true,
    bindings: selectedBindings,
    transit_ids: selected.segments
      .filter((leg) => leg.mode !== 'WALK')
      .map((leg) => ({
        sequence: leg.sequence,
        mode: leg.mode,
        route_id: leg.route_id,
        trip_id: leg.trip_id,
        from_otp_stop_id: leg.from.otp_stop_id,
        to_otp_stop_id: leg.to.otp_stop_id,
      })),
    report_id: report.report_id,
    report_status: report.verification_status,
    progress_completed: final.body.progress.completed_segment_count,
    completion_visible_after_reload: true,
    owner_isolation: true,
    cross_owner_mutation_status: otherMutation.status,
    invalid_alighting: deniedBoarding,
    invalid_progress: deniedProgress,
    progress_events: progressEvents,
  };
}

assert.ok(existsSync(chrome), `Chrome executable missing: ${chrome}`);
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
});
try {
  const contexts = [];
  for (const item of modes)
    contexts.push(
      await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 390, height: 844 },
      }),
    );
  const results = [];
  for (const [index, item] of modes.entries()) {
    console.log(JSON.stringify({ mode: item.mode, phase: 'START' }));
    const result = await runMode(
      contexts[index],
      contexts[(index + 1) % contexts.length],
      item,
    );
    results.push(result);
    console.log(JSON.stringify({ mode: item.mode, status: 'PASS', ...result }));
  }
  console.log(
    JSON.stringify({
      status: 'PASS',
      suite: 'MODES',
      evidence: `${results.length} serial real UI-search, OTP-backed plans, map/timeline, active journey and passenger report flows in isolated scratch runtime`,
      results,
    }),
  );
} finally {
  await browser.close();
}
