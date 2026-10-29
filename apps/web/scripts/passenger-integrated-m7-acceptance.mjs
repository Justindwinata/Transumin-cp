import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Fail closed: this suite mutates journeys/reports and must never target the
// shared product runtime. Run via `pnpm data:browser:isolated --suite=M7`.
await assertCp2Runtime();

// M5/M6 conventions, real historical OTP corridor; no routing mocks or SQL cleanup.
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
const reviewer = `m7-${randomUUID()}`;
const criteria = [
  ['runtime-ready', ['V20']],
  ['real-otp-plan', ['V02']],
  ['candidate-map-timeline', ['V04', 'V05']],
  ['activate-owner-a', ['V09']],
  ['second-browser-owner-isolation', ['V19']],
  ['manual-prefix-boarding-alighting', ['V08', 'V09']],
  ['recorded-boundary-anchor', ['V13']],
  ['ui-report-unverified', ['V10']],
  ['report-owner-isolation', ['V19']],
  ['passenger-review-denied', ['V11', 'V19']],
  ['controlled-review', ['V11']],
  ['relevant-simulated-alert', ['V12']],
  ['ui-recovery-real-otp-or-no-path', ['V14']],
  ['recovery-owner-isolation', ['V19']],
  ['ui-accept-or-no-path-refusal', ['V14']],
  ['refresh-accepted-lineage-or-no-path', ['V09', 'V14']],
  ['continued-ui-boarding-alighting', ['V08']],
  ['completion-or-truthful-no-path', ['V09', 'V14', 'V20']],
  ['second-browser-state-unchanged', ['V19']],
  ['controlled-close-finally', ['V11']],
];
const cases = [];
let browser,
  context,
  other,
  page,
  active,
  plans,
  target,
  reportId,
  impactId,
  recovery,
  acceptance;
let reviewAttempted = false;
let branch = null;
let failure = null;
function safe(message) {
  let text = String(message);
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
function mark(index, verdict, detail = '') {
  const [name, vs] = criteria[index - 1];
  cases.push({
    step: index,
    case: name,
    criteria: vs,
    verdict,
    detail: safe(detail),
  });
  process.stderr.write(
    `[case] ${index} ${name}: ${verdict}${detail ? ` — ${safe(detail)}` : ''}\n`,
  );
}
async function step(index, fn) {
  try {
    const result = await fn();
    mark(index, 'PASS', typeof result === 'string' ? result : '');
    return result;
  } catch (error) {
    mark(index, 'FAIL', error.message);
    throw error;
  }
}
const data = (body) => body?.data ?? body;
async function response(res) {
  return {
    status: typeof res.status === 'function' ? res.status() : res.status,
    body: await res.json().catch(() => null),
  };
}
async function proxy(path, options = {}, ownerContext = context) {
  return response(
    await ownerContext.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      timeout: 120_000,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
async function controlled(action, payload) {
  return response(
    await fetch(`${api}/controlled/passenger-reports/${reportId}/${action}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-controlled-reviewer': reviewer,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
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
async function uiMutation(button, suffix, method) {
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/passenger/${suffix}`) &&
      r.request().method() === method,
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  return ok(await response(await wait));
}
const jakarta = (at) =>
  new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
async function advanceCurrent() {
  const leg = active.segments[active.progress.completed_segment_count];
  assert.ok(leg, 'no current leg');
  const progressTime = page.getByLabel(
    'Waktu tahapan perjalanan (WIB, skenario uji)',
  );
  if (leg.mode !== 'WALK') {
    await progressTime.fill(jakarta(leg.start_at));
    active = await uiMutation(
      'Saya Sudah Naik',
      `journeys/${active.journey_id}/boarding/${leg.sequence}`,
      'POST',
    );
    assert.equal(
      active.progress.boarding_confirmed_segment_sequence,
      leg.sequence,
    );
    await progressTime.fill(jakarta(leg.end_at));
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
  await progressTime.fill(jakarta(next?.start_at ?? leg.end_at));
  active = await uiMutation(
    next ? 'Lanjutkan Perjalanan' : 'Selesaikan Perjalanan',
    `journeys/${active.journey_id}/progress`,
    'PATCH',
  );
  assert.equal(active.progress.completed_segment_count, leg.sequence + 1);
  return leg.mode !== 'WALK';
}
try {
  await step(1, async () => {
    assert.ok(
      env('CONTROLLED_REVIEW_ENABLED') === 'true' && token.length >= 32,
      'controlled review runtime not enabled',
    );
    const [w, a] = await Promise.all([
      fetch(web, { signal: AbortSignal.timeout(20_000) }),
      fetch(`${new URL(api).origin}/health/ready`, {
        signal: AbortSignal.timeout(20_000),
      }),
    ]);
    assert.ok(w.ok, `web HTTP ${w.status}`);
    assert.ok(a.ok, `API readiness HTTP ${a.status}`);
  });
  browser = await chromium.launch(
    existsSync(chrome)
      ? {
          executablePath: chrome,
          headless: true,
          args:
            String(web).startsWith('https:') || String(api).startsWith('https:')
              ? ['--ignore-certificate-errors']
              : [],
        }
      : {
          headless: true,
          args:
            String(web).startsWith('https:') || String(api).startsWith('https:')
              ? ['--ignore-certificate-errors']
              : [],
        },
  );
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  await step(2, async () => {
    await page.goto(web, { waitUntil: 'domcontentloaded' });
    // React-controlled <details open> makes a single summary click a
    // nondeterministic open/close pair; select both endpoints explicitly
    // through the stable mode buttons instead. [input-state]
    await page
      .getByRole('group', { name: 'Dari — cara memilih lokasi' })
      .getByRole('button', { name: 'Koordinat', exact: true })
      .click();
    await page
      .getByRole('group', { name: 'Ke — cara memilih lokasi' })
      .getByRole('button', { name: 'Koordinat', exact: true })
      .click();
    for (const [label, value] of [
      ['Lintang titik awal', '-6.108205'],
      ['Bujur titik awal', '106.89982'],
      ['Lintang tujuan', '-6.205627'],
      ['Bujur tujuan', '106.822295'],
      ['Berangkat (WIB)', '2026-10-02T08:11'],
    ])
      await page.getByLabel(label).fill(value);
    plans = await uiMutation('Cari perjalanan', 'journeys/plan', 'POST');
    assert.ok(Array.isArray(plans) && plans.length);
    for (const plan of plans) {
      assert.equal(plan.routing_context.provider, 'OTP');
      assert.match(plan.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
    }
    const chosen = plans.find((plan) =>
      plan.segments.some(
        (leg) =>
          leg.sequence >= 3 &&
          leg.entity_bindings.some(
            (binding) =>
              binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
          ),
      ),
    );
    assert.ok(
      chosen,
      'real OTP returned no candidate with future route dependency',
    );
    active = chosen;
  });
  await step(3, async () => {
    const buttons = page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button');
    await buttons.nth(plans.indexOf(active)).click();
    await page.locator('.maplibregl-canvas').first().waitFor();
    await page.locator('.leg-list').first().waitFor();
    target = active.segments.find(
      (leg) =>
        leg.sequence >= 3 &&
        leg.entity_bindings.some(
          (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
        ),
    );
  });
  await step(4, async () => {
    active = await uiMutation(
      'Mulai Perjalanan',
      `journeys/${active.journey_id}/activate`,
      'POST',
    );
    assert.equal(active.status, 'ACTIVE');
    await page
      .getByRole('heading', { name: 'Perjalanan aktif Anda' })
      .waitFor();
  });
  let otherJourney, otherBefore;
  await step(5, async () => {
    const pageB = await other.newPage();
    await pageB.goto(web, { waitUntil: 'domcontentloaded' });
    // Independent browser establishes its own server-derived cookie through planning.
    const planned = ok(
      await proxy(
        'journeys/plan',
        {
          method: 'POST',
          data: {
            origin: active.origin,
            destination: active.destination,
            departure_at: active.start_at,
            network_snapshot_id: active.network_snapshot_id,
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
    otherBefore = ok(
      await proxy(`journeys/${otherJourney.journey_id}`, {}, other),
    );
    const cookieA = (await context.cookies()).find(
      (c) => c.name === 'transumin_proto_session',
    );
    const cookieB = (await other.cookies()).find(
      (c) => c.name === 'transumin_proto_session',
    );
    assert.ok(cookieA?.httpOnly && cookieB?.httpOnly);
    assert.notEqual(cookieA.value, cookieB.value);
    assert.notEqual(otherJourney.journey_id, active.journey_id);
    assert.ok(
      [403, 404].includes(
        (await proxy(`journeys/${active.journey_id}`, {}, other)).status,
      ),
    );
  });
  await step(6, async () => {
    let transit = 0;
    while (active.progress.completed_segment_count < target.sequence - 1)
      if (await advanceCurrent()) transit++;
    assert.ok(
      transit > 0,
      'no explicit transit boarding/alighting before disruption',
    );
  });
  await step(7, async () => {
    assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
    assert.ok(active.progress.completed_segment_count >= 2);
    const stored = ok(await proxy(`journeys/${active.journey_id}`));
    assert.deepEqual(stored.progress, active.progress);
  });
  const binding = target.entity_bindings.find(
    (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
  );
  await step(8, async () => {
    const selector = page.getByLabel(
      'Lokasi atau layanan pada sisa perjalanan',
    );
    const value = await selector
      .locator('option')
      .evaluateAll(
        (options, id) => options.find((o) => o.value.includes(id))?.value,
        binding.mobility_entity_id,
      );
    assert.ok(value, 'future report target absent from UI');
    await selector.selectOption(value);
    await page
      .getByLabel('Waktu kejadian (WIB)')
      .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
    await page
      .getByLabel('Keterangan')
      .fill(`M7 SIMULATED acceptance ${randomUUID()}`);
    const report = await uiMutation(
      'Kirim laporan',
      'passenger-reports',
      'POST',
    );
    reportId = report.report_id;
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
  });
  await step(9, async () =>
    assert.ok(
      [403, 404].includes(
        (await proxy(`passenger-reports/${reportId}`, {}, other)).status,
      ),
    ),
  );
  await step(10, async () => {
    assert.equal(
      (
        await proxy(`controlled/passenger-reports/${reportId}/verify`, {
          method: 'POST',
          data: {
            operational_state: 'UNAVAILABLE',
            incident_type: 'SERVICE_SUSPENSION',
            reason: 'must not authorize passenger',
          },
        })
      ).status,
      403,
    );
  });
  await step(11, async () => {
    reviewAttempted = true; // Close even if verify response fails after server mutation.
    const review = ok(
      await controlled('verify', {
        operational_state: 'UNAVAILABLE',
        incident_type: 'SERVICE_SUSPENSION',
        reason: `M7 SIMULATED ${reportId}`,
      }),
    );
    assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
  });
  await step(12, async () => {
    const alerts = ok(await proxy(`journeys/${active.journey_id}/alerts`));
    const alert = alerts.find(
      (a) =>
        a.mobility_entity_id === binding.mobility_entity_id &&
        a.evidence_type === 'SIMULATED' &&
        !a.resolved_at,
    );
    assert.ok(alert);
    assert.ok(alert.affected_segment_sequences.includes(target.sequence));
    impactId = alert.impact_id;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByText('SIMULASI terkontrol', { exact: false })
      .first()
      .waitFor({ timeout: 30_000 });
  });
  await step(13, async () => {
    recovery = await uiMutation('Cari rute pengganti', 'recoveries', 'POST');
    assert.equal(recovery.recovery_at, active.progress.recorded_at);
    branch =
      recovery.status === 'COMPLETED'
        ? 'COMPLETED'
        : recovery.rejoin_status === 'NO_PATH'
          ? 'NO_PATH'
          : null;
    assert.ok(
      branch,
      `unexpected recovery ${recovery.status}/${recovery.rejoin_status}`,
    );
    if (branch === 'COMPLETED') {
      assert.ok(recovery.proposed_journey);
      assert.equal(recovery.metrics.disrupted_entity_avoidance, true);
      assert.equal(recovery.proposed_journey.routing_context.provider, 'OTP');
    } else assert.equal(recovery.proposed_journey, null);
    return branch;
  });
  await step(14, async () =>
    assert.ok(
      [403, 404].includes(
        (await proxy(`recoveries/${recovery.recovery_id}`, {}, other)).status,
      ),
    ),
  );
  await step(15, async () => {
    if (branch === 'NO_PATH') {
      assert.equal(
        await page
          .getByRole('button', { name: 'Gunakan rute pengganti ini' })
          .count(),
        0,
      );
      assert.ok(
        [409, 422].includes(
          (
            await proxy(`recoveries/${recovery.recovery_id}/accept`, {
              method: 'POST',
              headers: { 'idempotency-key': randomUUID() },
              data: { progress_revision: recovery.progress_revision },
            })
          ).status,
        ),
      );
      return 'NO_PATH cannot be accepted; successful acceptance NOT_VERIFIED';
    }
    acceptance = await uiMutation(
      'Gunakan rute pengganti ini',
      `recoveries/${recovery.recovery_id}/accept`,
      'POST',
    );
    assert.equal(acceptance.original_plan_preserved, true);
    assert.equal(acceptance.current_pointer_advanced, true);
  });
  await step(16, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persisted = ok(await proxy(`recoveries/${recovery.recovery_id}`));
    if (branch === 'NO_PATH') {
      assert.equal(persisted.rejoin_status, 'NO_PATH');
      return;
    }
    assert.equal(persisted.accepted, true);
    await page.getByText('Rute pengganti diterima', { exact: false }).waitFor();
    active = ok(await proxy(`journeys/${active.journey_id}`));
    await page.locator('.leg-list').first().waitFor();
  });
  if (branch === 'NO_PATH') {
    mark(
      17,
      'NOT_VERIFIED',
      'NO_PATH: no accepted route exists for continued boarding/alighting',
    );
    await step(18, async () => {
      await page
        .getByText(/No feasible|NO_PATH|no path/i)
        .first()
        .waitFor();
      assert.equal(recovery.proposed_journey, null);
      return 'truthful NO_PATH observed; completion NOT_VERIFIED';
    });
  } else {
    await step(17, async () => {
      let transit = 0;
      while (active.status !== 'COMPLETED')
        if (await advanceCurrent()) transit++;
      assert.ok(
        transit > 0,
        'accepted continuation had no transit boarding/alighting',
      );
    });
    await step(18, async () => {
      const completed = ok(await proxy(`journeys/${active.journey_id}`));
      assert.equal(completed.status, 'COMPLETED');
      assert.equal(
        completed.progress.completed_segment_count,
        completed.segments.length,
      );
      await page.getByText('Perjalanan selesai.', { exact: true }).waitFor();
    });
  }
  await step(19, async () => {
    const after = ok(
      await proxy(`journeys/${otherJourney.journey_id}`, {}, other),
    );
    assert.equal(after.status, otherBefore.status);
    assert.deepEqual(after.progress, otherBefore.progress);
    assert.deepEqual(after.segments, otherBefore.segments);
  });
} catch (error) {
  failure = safe(error.message);
} finally {
  if (reportId && reviewAttempted) {
    try {
      const closed = ok(
        await controlled('close', {
          decision: 'RESOLVED',
          reason: `M7 finally cleanup ${reportId}`,
        }),
      );
      assert.equal(closed.lifecycle_status, 'RESOLVED');
      mark(
        20,
        'PASS',
        'controlled incident RESOLVED through endpoint; no SQL cleanup',
      );
    } catch (error) {
      mark(20, 'FAIL', `cleanup: ${error.message}`);
    }
  }
  await browser?.close().catch(() => {});
}
for (let i = 1; i <= 20; i++)
  if (!cases.some((c) => c.step === i))
    mark(
      i,
      'NOT_VERIFIED',
      failure ? `blocked after failure: ${failure}` : 'not executed',
    );
cases.sort((a, b) => a.step - b.step);
const status = cases.some((c) => c.verdict === 'FAIL')
  ? 'FAIL'
  : cases.some((c) => c.verdict === 'NOT_VERIFIED')
    ? 'NOT_VERIFIED'
    : 'PASS';
console.log(
  JSON.stringify({
    status,
    branch,
    cases,
    failure,
    scope: 'checkpoint-local V criteria evidence, not full V1 acceptance',
    unmapped_criteria: {
      S01_S14:
        'NOT_VERIFIED: S definitions unavailable in repository; no invented mappings',
      V01: 'NOT_VERIFIED: POI source blocked',
      V06_V07: 'NOT_VERIFIED: GPS not exercised',
      V15: 'NOT_VERIFIED: Phase 4A-R blocked',
      V16: 'NOT_VERIFIED: provider rights blocked',
    },
    evidence: `real Playwright/product proxy/API/OTP against scratch-isolated runtime (${web} / ${api}); controlled report SIMULATED; no SQL cleanup`,
  }),
);
process.exitCode = status === 'PASS' ? 0 : 1;
