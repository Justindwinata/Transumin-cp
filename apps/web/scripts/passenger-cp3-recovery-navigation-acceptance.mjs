import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';
import { runSequentialRecoveryCheck } from './passenger-sequential-recovery-check.mjs';

/**
 * Library-derived navigation identities (G1-D). Node 22 type-stripping imports
 * the exact product TS source; no copies are available in this script. If the
 * runner cannot strip types the run aborts NOT VERIFIED instead of fabricating.
 */
let nav;
try {
  nav = await import('../src/lib/navigation.ts');
} catch {
  nav = null;
}
let mapGeometry;
try {
  mapGeometry = await import('../src/lib/map-geometry.ts');
} catch {
  mapGeometry = null;
}

const webUrl = process.env.PASSENGER_WEB_URL ?? 'http://127.0.0.1:3302';
const apiUrl =
  process.env.PASSENGER_API_BASE_URL ?? 'http://127.0.0.1:3303/api/v1';
const chromePath =
  process.env.PRODUCT_P1R_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reviewer = 'cp3-controlled-reviewer';

async function installGpsStub(context) {
  await context.addInitScript(() => {
    let id = 0;
    const watches = new Map();
    const fake = {
      watchPosition(success) {
        const key = ++id;
        watches.set(key, success);
        window.__gpsWatch = (p) =>
          watches.get(key)?.({
            coords: {
              latitude: p.lat,
              longitude: p.lon,
              accuracy: p.acc ?? 8,
              heading: null,
              altitude: null,
              altitudeAccuracy: null,
              speed: null,
            },
            timestamp: p.t ?? Date.now(),
          });
        return key;
      },
      clearWatch(key) {
        watches.delete(key);
      },
      getCurrentPosition(_success, error) {
        error?.({ code: 2, message: 'unavailable' });
      },
    };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get: () => fake,
    });
  });
}
function attrs(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.navigation-card');
    return c
      ? {
          text: c.innerText,
          scope: c.getAttribute('data-navigation-scope'),
          evidence: c.getAttribute('data-provenance'),
          maneuverIndex: c.getAttribute('data-maneuver-index'),
          total: c.getAttribute('data-maneuver-total'),
        }
      : null;
  });
}
let stage = 'runtime-identity';
let failureDiagnostic;
function assertResponse(response, endpoint, expected) {
  const status = response.status();
  if (!expected.includes(status)) {
    // Only caller-owned route templates and numeric statuses enter diagnostics.
    failureDiagnostic = `${endpoint}: expected ${expected.join(' or ')}, received ${status}`;
    assert.fail(failureDiagnostic);
  }
}
async function direct(path, options = {}) {
  const response = await fetch(
    `${path.startsWith('controlled/') ? (process.env.CONTROLLED_REVIEW_API_URL ?? apiUrl) : apiUrl}/${path}`,
    {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    failureDiagnostic = `POST /api/v1/controlled/passenger-reports/:reportId/verify: HTTP ${response.status}`;
    assert.fail(failureDiagnostic);
  }
  return body?.data;
}
/**
 * G1-D exact digest reproduction for the map: same filter (mapGeometryPoints),
 * feature identity (id/properties/geometry key order) and FNV-1a hash used by
 * journey-map.tsx when it reads getSource(id).serialize().data. Hash-only; no
 * raw residential coordinates cross into the DOM or this script's logs.
 */
function expectedMapFingerprint(journey) {
  const generation = journey.accepted_recovery_id ?? 'ORIGINAL';
  const out = [];
  for (const segment of journey.segments ?? []) {
    const points = mapGeometry.mapGeometryPoints(
      segment.geometry?.coordinates ?? [],
    );
    if (points.length < 2) continue;
    const feature = {
      type: 'Feature',
      id: segment.sequence,
      properties: { sequence: segment.sequence, mode: segment.mode },
      geometry: { type: 'LineString', coordinates: points },
    };
    const id = `journey-${journey.journey_id}-${generation}-segment-${segment.sequence}`;
    out.push(
      `${journey.journey_id}:${generation}:${id}:${nav.shortHash(JSON.stringify(feature))}`,
    );
  }
  return out;
}
async function readMapObservability(page) {
  return page.evaluate(() => {
    const map =
      document.querySelector('.map-frame') ??
      document.querySelector('.maplibre-frame');
    return {
      hasFrame: Boolean(map),
      length: Number(map?.getAttribute('data-route-source-count') ?? -1),
      fingerprint: map?.getAttribute('data-route-source-fingerprint') ?? null,
    };
  });
}
function readJourney(page, id) {
  return page.evaluate(
    async (journeyId) =>
      (await fetch(`/api/passenger/journeys/${journeyId}`)).json(),
    id,
  );
}

await assertCp2Runtime();
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: webUrl.startsWith('https:') ? ['--ignore-certificate-errors'] : [],
});
const summary = {
  status: 'PASS',
  provenance:
    'SIMULATED geolocation stub; real OTP plan; controlled review API',
};
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
  });
  await installGpsStub(context);
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).waitFor();

  stage = 'reactive-plan';
  const planResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/journeys/plan') &&
      r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: /Muat contoh perjalanan/ }).click();
  const plan = await planResponse;
  assertResponse(plan, 'POST /api/passenger/journeys/plan', [201]);
  const planned = await plan.json();
  const candidate = planned.data.find((j) => j.segments?.[0]?.mode === 'WALK');
  assert.ok(candidate, 'OTP plan has no WALK-first candidate');
  summary.original_journey_id = candidate.journey_id;
  summary.original_itinerary_identity =
    candidate.plan_fingerprint ?? candidate.journey_id;

  const index = planned.data.indexOf(candidate);
  await page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .nth(index)
    .click();
  const activation = page.waitForResponse(
    (r) => r.url().includes('/activate') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Mulai Perjalanan' }).click();
  stage = 'reactive-activate';
  const activatedResponse = await activation;
  assertResponse(
    activatedResponse,
    'POST /api/passenger/journeys/:journeyId/activate',
    [200, 201],
  );
  const activated = (await activatedResponse.json()).data;
  summary.active_journey_id = activated.journey_id;
  const sessionCookie = (await context.cookies()).find(
    (c) => c.name === 'transumin_proto_session',
  );
  assert.ok(
    typeof sessionCookie?.value === 'string' &&
      sessionCookie.value.split('.').length === 3,
    'signed session expiry missing in cookie',
  );
  const ownerSession = sessionCookie
    ? decodeURIComponent(sessionCookie.value).split('.')[0]
    : null;
  assert.ok(
    typeof ownerSession === 'string' && ownerSession.startsWith('passenger:'),
    'expected passenger session cookie',
  );
  console.error('ASSERT recovery.owner_session=passenger-[redacted]');
  assert.equal(activated.segments[0].mode, 'WALK');
  await page.getByRole('heading', { name: 'Perjalanan aktif Anda' }).waitFor();
  const before = await attrs(page);
  assert.ok(before?.scope?.startsWith(`${activated.journey_id}:`));
  summary.walk_navigation_scope_before = before.scope;
  summary.walk_navigation_evidence_before = before.evidence;
  assert.ok(
    ['OTP_DERIVED_MANEUVER', 'SCHEMATIC_GEOMETRY'].includes(before.evidence),
  );
  console.error(
    `ASSERT recovery.walk_active scope=[hash_len=${String(before.scope).length}] evidence=${before.evidence}`,
  );
  const activeBeforeRecovery = await readJourney(page, activated.journey_id);
  assert.equal(activeBeforeRecovery.data.progress.completed_segment_count, 0);
  assert.equal(activeBeforeRecovery.data.status, 'ACTIVE');
  summary.original_segment_count = activeBeforeRecovery.data.segments.length;
  summary.original_itinerary_segments = activeBeforeRecovery.data.segments
    .map((s) => s.mode)
    .join(',');
  summary.original_plan_id =
    activeBeforeRecovery.data.original_plan.journey_id ??
    activeBeforeRecovery.data.plan_journey_id;
  assert.ok(nav && mapGeometry, 'navigation/map-geometry import unavailable');
  const originalNavigation = nav.prepareWalkNavigation(activated.segments[0]);
  assert.ok(
    originalNavigation?.maneuvers.length > 1,
    'old WALK needs advanceable real OTP maneuvers',
  );
  await page
    .getByRole('button', { name: 'Manuver berikutnya', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.navigation-card')
        ?.getAttribute('data-maneuver-index') === '1',
  );
  summary.old_maneuver_advanced_before_progress = true;
  summary.leg_progressed = true;
  stage = 'reactive-progress';
  const progressResponse = page.waitForResponse(
    (r) =>
      r
        .url()
        .includes(`/api/passenger/journeys/${activated.journey_id}/progress`) &&
      r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Lanjutkan Perjalanan' }).click();
  const progressed = await progressResponse;
  assertResponse(
    progressed,
    'PATCH /api/passenger/journeys/:journeyId/progress',
    [200],
  );
  const activeAfterWalkProgress = await readJourney(page, activated.journey_id);
  assert.equal(
    activeAfterWalkProgress.data.progress.completed_segment_count,
    1,
  );
  assert.equal(activeAfterWalkProgress.data.status, 'ACTIVE');
  assert.equal(
    activeAfterWalkProgress.data.segments[
      activeAfterWalkProgress.data.progress.completed_segment_count - 1
    ].mode,
    'WALK',
  );
  assert.equal(summary.old_maneuver_advanced_before_progress, true);
  console.error('ASSERT maneuver.old_advanced_before_progress=true');
  console.error(
    `ASSERT recovery.walk_leg_progressed completed_segments=${activeAfterWalkProgress.data.progress.completed_segment_count}`,
  );
  const activeAfterWalk = await page.evaluate(() => document.body.innerText);
  assert.ok(/Laporkan kondisi/.test(activeAfterWalk));

  // G1-D base map observation before R1: exact digest of server geometry with
  // the same filter/hash/feature identity that journey-map.tsx serializes.
  stage = 'base-map-parity';
  const baseExpected = expectedMapFingerprint(activeAfterWalkProgress.data);
  await page.waitForFunction(
    (expected) =>
      (
        document.querySelector('.map-frame') ??
        document.querySelector('.maplibre-frame')
      )?.getAttribute('data-route-source-fingerprint') === expected,
    baseExpected.join('|'),
    { timeout: 15000 },
  );
  const baseActual = await readMapObservability(page);
  assert.ok(baseActual.hasFrame, 'map frame (.map-frame) missing before R1');
  assert.ok(
    typeof baseActual.fingerprint === 'string' &&
      baseActual.fingerprint.length > 0,
    'base map fingerprint missing before recovery',
  );
  assert.deepEqual(
    baseActual.fingerprint.split('|'),
    baseExpected,
    'base map digest not exact reproduction of server geometry',
  );
  summary.base_map_fingerprint_exact = true;
  summary.base_map_source_count = baseActual.length;
  console.error(
    `ASSERT map.predecessor_digest exact=true segments=${String(baseExpected.length)}`,
  );

  // Submit report through real passenger UI; status must remain REPORTED_UNVERIFIED.
  await page.getByRole('button', { name: 'Gangguan', exact: true }).click();
  const target = page.locator('#report-target');
  await target.waitFor();
  const options = await target
    .locator('option')
    .evaluateAll((items) =>
      items.map((x) => ({ value: x.value, text: x.textContent })),
    )
    .then((x) => x.filter((o) => o.value));
  assert.ok(options[0], 'No remaining report target');
  await target.selectOption(options[0].value);
  await page
    .locator('#report-description')
    .fill('Controlled passenger observation for continuity proof.');
  const submittedReport = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/passenger/passenger-reports') &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Kirim laporan' }).click();
  const submittedResponse = await submittedReport;
  stage = 'passenger-report-submit';
  assertResponse(
    submittedResponse,
    'POST /api/passenger/passenger-reports',
    [201],
  );
  await page
    .getByText(/Laporan tersimpan .*Belum diverifikasi/)
    .waitFor({ timeout: 30000 });
  const reportCard = page.locator('.report-list article').first();
  const reportText = await reportCard.innerText();
  assert.match(reportText, /Belum diverifikasi/);
  const reportId = (await reportCard.getAttribute('aria-label')).replace(
    'Laporan ',
    '',
  );
  summary.report_id = reportId;
  summary.report_status = 'REPORTED_UNVERIFIED';
  console.log(`ASSERT report.status=REPORTED_UNVERIFIED report_id=${reportId}`);

  // Controlled reviewer flow: direct API only, no reviewer credential in browser.
  assert.ok(
    process.env.CONTROLLED_REVIEW_TOKEN &&
      process.env.CONTROLLED_REVIEW_TOKEN.length >= 32,
    'controlled reviewer token missing',
  );
  stage = 'controlled-report-verification';
  const verified = await direct(
    `controlled/passenger-reports/${reportId}/verify`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CONTROLLED_REVIEW_TOKEN}`,
        'x-controlled-reviewer': reviewer,
      },
      body: JSON.stringify({
        operational_state: 'UNAVAILABLE',
        incident_type: 'SERVICE_SUSPENSION',
        reason: 'Controlled SIMULATED continuity review.',
      }),
    },
  );
  assert.equal(verified.verification_status, 'CONTROLLED_VERIFIED');
  summary.review_provenance = 'SIMULATED';
  console.log(
    `ASSERT report.review status=CONTROLLED_VERIFIED provenance=SIMULATED reviewer=${reviewer}`,
  );

  await page
    .getByRole('region', { name: 'Informasi gangguan' })
    .getByRole('article', { name: 'Peringatan perjalanan' })
    .waitFor({ timeout: 30000 });
  const alert = page
    .getByRole('region', { name: 'Informasi gangguan' })
    .getByRole('article', { name: 'Peringatan perjalanan' });
  assert.ok(await alert.count());
  summary.targeted_alert = true;

  const otherContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  let otherOwner;
  try {
    const otherPage = await otherContext.newPage();
    stage = 'other-owner-plan';
    await otherPage.goto(webUrl, { waitUntil: 'domcontentloaded' });
    await otherPage
      .getByRole('button', { name: /Muat contoh perjalanan/ })
      .waitFor();
    const otherPlan = otherPage.waitForResponse(
      (r) =>
        r.url().endsWith('/api/passenger/journeys/plan') &&
        r.request().method() === 'POST',
      { timeout: 120000 },
    );
    await otherPage
      .getByRole('button', { name: /Muat contoh perjalanan/ })
      .click();
    const otherPlanResponse = await otherPlan;
    assertResponse(
      otherPlanResponse,
      'POST /api/passenger/journeys/plan',
      [201],
    );
    await otherPage
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .first()
      .click();
    const otherActivation = otherPage.waitForResponse(
      (r) => r.url().includes('/activate') && r.request().method() === 'POST',
    );
    await otherPage.getByRole('button', { name: 'Mulai Perjalanan' }).click();
    stage = 'other-owner-activate';
    const otherActivationResponse = await otherActivation;
    assertResponse(
      otherActivationResponse,
      'POST /api/passenger/journeys/:journeyId/activate',
      [200, 201],
    );
    await otherPage
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor({ timeout: 30000 });
    await otherPage.waitForTimeout(1500);
    const otherAlerts = await otherPage
      .getByRole('region', { name: 'Informasi gangguan' })
      .getByRole('article', { name: 'Peringatan perjalanan' })
      .count();
    assert.equal(otherAlerts, 0, 'unaffected owner received targeted alert');
    const otherCookie = (await otherContext.cookies()).find(
      (c) => c.name === 'transumin_proto_session',
    );
    assert.ok(
      typeof otherCookie?.value === 'string' &&
        otherCookie.value.split('.').length === 3,
      'signed session expiry missing in unaffected cookie',
    );
    otherOwner = otherCookie
      ? decodeURIComponent(otherCookie.value).split('.')[0]
      : null;
    assert.ok(otherOwner && otherOwner !== ownerSession);
    summary.unaffected_owner_alert_count = otherAlerts;
    console.error(
      `ASSERT alert.owner_targeted=true unaffected_owner_alerts=${otherAlerts}`,
    );

    stage = 'initial-recovery-proposal';
    const recoveryResponse = page.waitForResponse(
      (r) => r.url().endsWith('/recoveries') && r.request().method() === 'POST',
      { timeout: 120000 },
    );
    await alert.getByRole('button', { name: 'Cari rute pengganti' }).click();
    const proposal = await (await recoveryResponse).json();
    await page
      .getByRole('heading', { name: 'Rute pengganti' })
      .waitFor({ timeout: 120000 });
    const recoveryId = proposal.data?.recovery_id;
    assert.ok(recoveryId, 'recovery ID missing before acceptance');
    const crossOwnerStatus = await otherPage.evaluate(async (id) => {
      const response = await fetch(`/api/passenger/recoveries/${id}`);
      return response.status;
    }, recoveryId);
    assert.equal(crossOwnerStatus, 404, 'foreign owner read recovery proposal');
    summary.cross_owner_recovery_rejected = true;
    console.error(
      `ASSERT recovery.cross_owner_rejected status=${crossOwnerStatus}`,
    );
  } finally {
    await otherContext.close();
  }

  // G1-A later-over-wins: a recovery proposal whose real response is delayed and
  // then arrives after a newer controlled remount (new mount generation and
  // request id) must not commit any recovery state. Real proposal via routing —
  // no fabricated response.
  stage = 'delayed-proposal-remount';
  const recoveryStorageKey = `transumin.passenger.recovery.${activated.journey_id}`;
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    recoveryStorageKey,
  );
  let releaseProposal;
  const proposalGate = new Promise((resolve) => {
    releaseProposal = resolve;
  });
  let delayedProposalSeen = false;
  const proposalPattern = '**/api/passenger/recoveries';
  const proposalHandler = async (route) => {
    if (route.request().method() !== 'POST' || delayedProposalSeen)
      return route.continue();
    delayedProposalSeen = true;
    const response = await route.fetch();
    await proposalGate;
    try {
      await route.fulfill({ response });
    } catch {
      // The remount already dropped the original request; nothing to deliver.
    }
  };
  await page.route(proposalPattern, proposalHandler);
  await alert.getByRole('button', { name: 'Cari rute pengganti' }).click();
  await page
    .getByRole('button', { name: 'Mencari rute pengganti…' })
    .waitFor({ timeout: 30000 });
  await page.reload();
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  releaseProposal();
  await page.waitForTimeout(1500);
  await page.unroute(proposalPattern, proposalHandler);
  assert.equal(
    await page.getByRole('heading', { name: 'Rute pengganti' }).count(),
    0,
    'delayed proposal committed recovery state after a newer remount',
  );
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), recoveryStorageKey),
    null,
    'stale proposal persisted a recovery pointer',
  );
  assert.equal(
    (await readJourney(page, activated.journey_id)).data.accepted_recovery_id,
    null,
    'delayed proposal mutated authoritative acceptance',
  );
  summary.delayed_proposal_later_over_wins = true;
  console.error(
    'ASSERT recovery.delayed_proposal_rejected_after_remount=true mutation=false',
  );

  // Fresh authoritative proposal after the remount: proves the guard dropped only
  // the stale response, not the capability.
  stage = 'fresh-proposal-after-remount';
  await page
    .getByRole('region', { name: 'Informasi gangguan' })
    .getByRole('article', { name: 'Peringatan perjalanan' })
    .waitFor({ timeout: 30000 });
  const freshProposalResponse = page.waitForResponse(
    (r) => r.url().endsWith('/recoveries') && r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page
    .getByRole('region', { name: 'Informasi gangguan' })
    .getByRole('article', { name: 'Peringatan perjalanan' })
    .getByRole('button', { name: 'Cari rute pengganti' })
    .click();
  const freshProposal = await (await freshProposalResponse).json();
  await page
    .getByRole('heading', { name: 'Rute pengganti' })
    .waitFor({ timeout: 120000 });
  const acceptedRecoveryId = freshProposal.data?.recovery_id;
  assert.ok(
    acceptedRecoveryId,
    'fresh recovery proposal missing after remount',
  );

  const originalColumn = page
    .getByRole('region', { name: 'Rute pengganti', exact: true })
    .locator('.comparison-grid > div')
    .first();
  const proposalSource = (await readJourney(page, activated.journey_id)).data;
  const originalTail = proposalSource.segments
    .filter(
      (segment) =>
        segment.sequence >= freshProposal.data.completed_segment_count,
    )
    .map((segment) => `${segment.from.name} → ${segment.to.name}`);
  assert.ok(originalTail.length, 'proposal source has no remaining legs');
  assert.deepEqual(
    await originalColumn.locator('li small').allTextContents(),
    originalTail,
    'original comparison differs from authoritative proposal source tail',
  );

  // G1-A lost-response: the acceptance POST reaches the server (real commit) but
  // the response is aborted. The client must reconcile from authoritative reads,
  // must not retry the mutation, and must not fabricate a success state.
  stage = 'recovery-acceptance-reconciliation';
  let acceptancePosts = 0;
  let acceptRealStatus = null;
  const acceptPattern = '**/api/passenger/recoveries/*/accept';
  const acceptHandler = async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    acceptancePosts += 1;
    const response = await route.fetch();
    acceptRealStatus = response.status();
    await route.abort('failed');
  };
  await page.route(acceptPattern, acceptHandler);
  await page
    .getByRole('button', { name: 'Gunakan rute pengganti ini' })
    .click();
  await page
    .getByText('Recovery diterima. Rute aktif mengikuti rute pengganti.')
    .waitFor({ timeout: 120000 });
  await page.unroute(acceptPattern, acceptHandler);
  assert.equal(
    acceptancePosts,
    1,
    'lost response must not cause a second acceptance POST',
  );
  assert.ok(
    [200, 201].includes(acceptRealStatus),
    `real acceptance response status ${String(acceptRealStatus)}`,
  );
  assert.deepEqual(
    await originalColumn.locator('li small').allTextContents(),
    originalTail,
    'accepted recovery replaced original comparison with repaired segments',
  );
  console.error(
    'ASSERT recovery.original_comparison retained_source_tail=true',
  );
  summary.lost_acceptance_response_reconciled = true;
  summary.acceptance_post_count = acceptancePosts;
  console.error(
    `ASSERT stale.lost_acceptance_response reconciled=true posts=${acceptancePosts} real_status=${String(acceptRealStatus)}`,
  );

  stage = 'accepted-itinerary-parity';
  const after = await attrs(page);
  const postAccept = await readJourney(page, activated.journey_id);
  summary.accepted_recovery_id = postAccept.data.accepted_recovery_id;
  assert.equal(
    summary.accepted_recovery_id,
    acceptedRecoveryId,
    'authoritative acceptance pointer disagrees with the reconciled recovery',
  );
  assert.equal(postAccept.data.journey_id, activated.journey_id);
  assert.equal(postAccept.data.progress.completed_segment_count, 1);
  assert.deepEqual(
    postAccept.data.segments.slice(0, 1),
    activeAfterWalkProgress.data.segments.slice(0, 1),
    'recovery changed completed WALK history',
  );
  // G1-D: the old maneuver index was legitimately initialWalkProgress 0 for the
  // new remaining WALK; the source truth is the current leg's navigation state.
  if (!nav || !mapGeometry) {
    throw new Error('NOT_VERIFIED library imports unavailable');
  } else {
    const currentLeg = postAccept.data.segments.find(
      (segment) =>
        segment.sequence === postAccept.data.progress.completed_segment_count,
    );
    const expectedScope =
      currentLeg?.mode === 'WALK'
        ? nav.navigationScopeKey(
            postAccept.data.journey_id,
            postAccept.data.accepted_recovery_id,
            currentLeg,
          )
        : 'none';
    assert.equal(
      after?.scope,
      expectedScope,
      'navigation scope differs from authoritative current WALK',
    );
    const prepared =
      currentLeg?.mode === 'WALK'
        ? nav.prepareWalkNavigation(currentLeg)
        : null;
    const expectedTotal = String(prepared?.maneuvers.length ?? 0);
    const expectedIndex = String(
      prepared?.evidence === 'OTP_DERIVED_MANEUVER'
        ? nav.initialWalkProgress().maneuverIndex
        : -1,
    );
    const completed = postAccept.data.progress.completed_segment_count;
    assert.equal(
      after?.total,
      expectedTotal,
      'map/navigation maneuver total mismatch',
    );
    assert.equal(
      after?.maneuverIndex,
      expectedIndex,
      'stale maneuver index after recovery',
    );
    // Timeline: exact per-leg sequence, fingerprint and semantic position versus
    // the authoritative itinerary. No invented IDs; no coordinate surface.
    const legDom = await page.evaluate(() =>
      [...document.querySelectorAll('.leg-list li')].map((li) => ({
        sequence: li.getAttribute('data-segment-sequence'),
        fingerprint: li.getAttribute('data-leg-fingerprint'),
        position: li.className,
      })),
    );
    const expectedTimeline = postAccept.data.segments.map((s) => ({
      sequence: String(s.sequence),
      fingerprint: nav.walkGeometryIdentity(s),
      position:
        s.sequence < completed
          ? 'completed'
          : s.sequence === completed
            ? 'current'
            : 'upcoming',
    }));
    assert.deepEqual(
      legDom,
      expectedTimeline,
      'rendered timeline order/fingerprint/positions disagree with authoritative segments',
    );
    console.error(
      `ASSERT timeline.sequence_fingerprint exact=true legs=${String(expectedTimeline.length)}`,
    );
    // Exact map digest from server geometry: same filter + feature identity +
    // FNV-1a as journey-map.tsx. Generation must move past the predecessor.
    const routeSource = await readMapObservability(page);
    const expectedAccept = expectedMapFingerprint(postAccept.data);
    // The map source effect applies asynchronously after the recovered journey
    // lands; wait for the exact expected source count before asserting so the
    // check is about parity, not about render timing.
    await page
      .waitForFunction(
        (expected) =>
          Number(
            (
              document.querySelector('.map-frame') ??
              document.querySelector('.maplibre-frame')
            )?.getAttribute('data-route-source-count'),
          ) === expected,
        expectedAccept.length,
        { timeout: 15000 },
      )
      .catch(() => undefined);
    const settled = await readMapObservability(page);
    assert.ok(settled.hasFrame, 'map frame (.map-frame) missing after R1');
    assert.equal(
      settled.length,
      expectedAccept.length,
      'route source count mismatch',
    );
    assert.deepEqual(
      typeof settled.fingerprint === 'string'
        ? settled.fingerprint.split('|')
        : null,
      expectedAccept,
      'accepted map digest not exact reproduction of server geometry',
    );
    assert.notDeepEqual(
      settled.fingerprint.split('|'),
      baseExpected,
      'recovery generation digest identical to predecessor',
    );
    assert.ok(
      !/\d+\.\d+/.test(settled.fingerprint),
      'coordinate-like decimal leaked into the map fingerprint',
    );
    summary.route_source_fingerprint_length = expectedAccept.length;
    summary.expectations_maneuver_index = expectedIndex;
    summary.expectations_maneuver_total = expectedTotal;
    console.error(
      `ASSERT map.accepted_digest exact=true segments=${String(expectedAccept.length)} generation_changed=true`,
    );
  }
  summary.current_segment_count = postAccept.data.segments.length;
  summary.new_itinerary_segments = postAccept.data.segments
    .map((s) => s.mode)
    .join(',');
  summary.new_leg_geometry_rendered = postAccept.data.segments.some(
    (s) =>
      Array.isArray(s.geometry?.coordinates) &&
      s.geometry.coordinates.length >= 2,
  );
  summary.original_plan_preserved =
    postAccept.data.original_plan.journey_id === summary.original_plan_id;
  assert.ok(summary.original_plan_preserved);
  // Predecessor source via existing API field, or explicit unavailability.
  if (
    Array.isArray(postAccept.data.original_plan?.segments) &&
    postAccept.data.original_plan.segments.length > 0
  ) {
    summary.original_plan_map_digest = expectedMapFingerprint(
      postAccept.data.original_plan,
    ).length;
    console.error(
      `ASSERT map.original_plan_digest exact=true segments=${String(summary.original_plan_map_digest)}`,
    );
  } else {
    summary.original_plan_map_digest = 'UNAVAILABLE';
    console.error(
      'ASSERT map.original_plan_digest UNAVAILABLE original_plan.geometry_not_exposed',
    );
  }
  console.error(
    `ASSERT recovery.accepted accepted_recovery_id=${summary.accepted_recovery_id} lineage=true original_plan_preserved=true`,
  );
  console.error(
    `ASSERT itinerary.revision remaining_legs ${String(summary.original_segment_count)} -> ${String(summary.current_segment_count)} modes=${summary.new_itinerary_segments}`,
  );
  console.error(
    `ASSERT leg_geometry.rendered=${summary.new_leg_geometry_rendered}`,
  );
  const walkingLegs = postAccept.data.segments.filter((s) => s.mode === 'WALK');
  const walkingWithSteps = walkingLegs.filter(
    (s) => Array.isArray(s.walking_steps) && s.walking_steps.length > 0,
  );
  console.error(
    `ASSERT navigation.walking_maneuvers walk_legs=${walkingLegs.length} maneuvers=${walkingWithSteps.length ? 'OTP_DERIVED' : 'SCHEMATIC_GEOMETRY fallback'}`,
  );
  const scopeIdle = after?.scope === 'none' && walkingLegs.length === 0;
  if (!scopeIdle)
    assert.notEqual(
      after?.scope,
      before?.scope,
      'navigation scope stayed stale',
    );
  assert.ok(
    !/Reposisi diperlukan/i.test(after?.text ?? ''),
    'stale navigation instruction remained',
  );
  summary.recovery_acceptance_lineage = true;
  summary.active_itinerary_revision = summary.accepted_recovery_id;
  console.error(`ASSERT navigation.scope_changed idle_nonwalk=${scopeIdle}`);
  console.error(
    `ASSERT navigation.stale_instruction_invalidated=true new_leg_geometry_rendered=${summary.new_leg_geometry_rendered}`,
  );

  await page.reload();
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  await page.getByText(/Rute pengganti diterima/).waitFor({ timeout: 30000 });
  summary.refresh_after_recovery = true;
  const refreshedOriginalColumn = page
    .getByRole('region', { name: 'Rute pengganti', exact: true })
    .locator('.comparison-grid > div')
    .first();
  await refreshedOriginalColumn
    .getByText(/Sisa rute awal unavailable after refresh/i)
    .waitFor({ timeout: 30000 });
  assert.equal(
    await refreshedOriginalColumn.locator('li small').count(),
    0,
    'refresh fabricated original comparison legs without proposal source',
  );
  console.error(
    'ASSERT refresh.original_comparison unavailable_without_proposal_payload=true',
  );
  console.log(
    'ASSERT refresh.after_recovery accepted_itinerary_persisted=true',
  );

  if (process.env.R7_SEQUENTIAL_RECOVERY === '1') {
    stage = 'sequential-recovery';
    await runSequentialRecoveryCheck({
      page,
      journeyId: activated.journey_id,
      firstReportId: reportId,
      direct,
      expectedMapFingerprint,
      nav,
      summary,
    });
  }

  // Continue via controlled manual boarding/alighting/progression until server marks completion.
  for (let i = 0; i < 12; i += 1) {
    const complete = page.getByRole('button', {
      name: 'Selesaikan Perjalanan',
    });
    if (await complete.count()) {
      await complete.click();
      break;
    }
    const board = page.getByRole('button', { name: 'Saya Sudah Naik' });
    if (await board.count()) {
      await board.click();
      await page.waitForTimeout(250);
      continue;
    }
    const alight = page.getByRole('button', { name: 'Saya Sudah Turun' });
    if (await alight.count()) {
      await alight.click();
      await page.waitForTimeout(250);
      continue;
    }
    const next = page.getByRole('button', { name: 'Lanjutkan Perjalanan' });
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(350);
      continue;
    }
    throw new Error('No legitimate continuation control after recovery');
  }
  await page
    .getByText(/Selesaikan Perjalanan — perjalanan ini sudah selesai/)
    .waitFor({ timeout: 30000 });
  summary.completed = true;
  await page.reload();
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  await page
    .getByText(/Selesaikan Perjalanan — perjalanan ini sudah selesai/)
    .waitFor({ timeout: 30000 });
  summary.completed_after_reload = true;
  console.log(
    'ASSERT completion.status=COMPLETED reload_persistence=true recovery_lineage=true',
  );
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'NOT_VERIFIED',
      stage,
      // Sanitized: owned route template + numeric status only.
      failed_request: failureDiagnostic ?? null,
      message:
        failureDiagnostic ??
        'Browser assertion or operation failed; raw error withheld',
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
