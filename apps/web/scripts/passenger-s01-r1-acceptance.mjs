import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

// Fail closed: mutable harness, never target the shared product runtime.
// Run via `pnpm data:browser:isolated --suite=<name>`; S01/S09 stay out of the
// isolated set until their corridors are proven on the scratch corpus.
await assertCp2Runtime();

// S01-R1 coordinate-variant acceptance. Origin resolves dynamically through supported
// Manggarai place search. Destination is the exact coordinate in
// scripts/acceptance/v1-multi-od.mjs:42-50 (no POI). Full named Kemang Village /
// Lippo Mall Kemang POI stays BLOCKED_BY_DATA (no accepted source/identifier/license).
const web = process.env.S01_WEB_URL ?? 'http://127.0.0.1:3000';
const api = (process.env.S01_API_URL ?? 'http://127.0.0.1:3001/api/v1').replace(
  /\/$/,
  '',
);
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
const reviewer = `s01-r1-${randomUUID()}`;
const snapshot = process.env.PASSENGER_NETWORK_SNAPSHOT_ID ?? '';
const departure = '2026-10-02T08:11';
// Coordinate variant: same values recorded by scripts/acceptance/v1-multi-od.mjs
// (MANGGARAI_KEMANG_COORDINATE). Explicitly labeled; never a named POI result.
// destinationCoordinate: { latitude: -6.2607, longitude: 106.8135 },
// per scripts/acceptance/v1-multi-od.mjs:47.
const coordinateVariant = {
  id: 'MANGGARAI_KEMANG_COORDINATE',
  label: 'Kemang Raya street area (approximate coordinate, no POI source)',
  destination: { latitude: -6.2607, longitude: 106.8135 },
  sourceLines: 'scripts/acceptance/v1-multi-od.mjs:42-50',
  sourceCommit: 'de3677273292398ffeb8af7bf681480bdc3379a2',
};
let originFixture = null;
const cases = [];
let browser, context, page, active, target, reportId, recovery, branch;
let reviewed = false;
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
  cases.push({ name, verdict, detail: safe(detail) });
  process.stderr.write(
    `[case] ${name}: ${verdict}${detail ? ` — ${safe(detail)}` : ''}\n`,
  );
}
async function step(name, fn) {
  try {
    const value = await fn();
    mark(name, 'PASS', value ?? '');
    return value;
  } catch (error) {
    mark(name, 'FAIL', error.message);
    throw error;
  }
}
const data = (body) => body?.data ?? body;
async function json(response) {
  return {
    status:
      typeof response.status === 'function'
        ? response.status()
        : response.status,
    body: await response.json().catch(() => null),
  };
}
async function proxy(path, options = {}) {
  return json(
    await context.request.fetch(`${web}/api/passenger/${path}`, {
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
async function uiMutation(button, suffix, method) {
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/passenger/${suffix}`) &&
      r.request().method() === method,
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: button, exact: true }).click();
  return ok(await json(await wait));
}
const jakarta = (at) =>
  new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
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
  assert.equal(active.progress.completed_segment_count, leg.sequence + 1);
  return leg.mode !== 'WALK';
}
async function transitSearch(query) {
  assert.ok(snapshot, 'PASSENGER_NETWORK_SNAPSHOT_ID required');
  const response = await fetch(
    `${api}/transit/places?q=${encodeURIComponent(query)}&snapshot_id=${snapshot}&limit=25`,
    { signal: AbortSignal.timeout(120_000) },
  );
  const body = await response.json();
  assert.equal(response.status, 200, `${query}: HTTP ${response.status}`);
  return data(body) ?? [];
}
const placeEvidence = (place) => ({
  place_id: place.place_id,
  external_id: place.external_id,
  name: place.name,
  kind: place.kind,
  product_mode: place.productMode,
  latitude: place.latitude,
  longitude: place.longitude,
  provenance: place.provenance,
  dataset_version_id: place.datasetVersionId,
});
try {
  await step('runtime-ready', async () => {
    assert.equal(env('CONTROLLED_REVIEW_ENABLED'), 'true');
    assert.ok(token.length >= 32, 'controlled review token unavailable');
    const [w, a] = await Promise.all([
      fetch(web),
      fetch('http://127.0.0.1:3001/health/ready', {
        signal: AbortSignal.timeout(20_000),
      }),
    ]);
    assert.ok(w.ok, `web HTTP ${w.status}`);
    assert.ok(a.ok, `API readiness HTTP ${a.status}`);
  });
  const [manggaraiMatches, kemangMatches, villageMatches, lippoMatches] =
    await Promise.all([
      transitSearch('Manggarai'),
      transitSearch('Kemang'),
      transitSearch('Kemang Village'),
      transitSearch('Lippo Mall Kemang'),
    ]);
  let originStop, originName;
  await step('supported-search-manggarai-and-kemang', async () => {
    const lowered = (x) => x.name?.toLowerCase?.() ?? String(x.name ?? '');
    const exactManggarai = manggaraiMatches.filter(
      (x) => lowered(x) === 'manggarai',
    );
    assert.ok(
      exactManggarai.length,
      'no exact Manggarai transit stop from supported place search',
    );
    originStop =
      exactManggarai.find(
        (x) => x.place_id === 'ad2af2fb-2f6b-58d7-a851-0cb554225463',
      ) ?? exactManggarai[0];
    originName = originStop.name;
    assert.equal(
      originStop.place_id,
      'ad2af2fb-2f6b-58d7-a851-0cb554225463',
      `Manggarai place identity mismatch: got ${originStop.place_id}`,
    );
    originFixture = {
      latitude: originStop.latitude,
      longitude: originStop.longitude,
      name: originStop.name,
      place_id: originStop.place_id,
      external_id: originStop.external_id,
      kind: originStop.kind,
      product_mode: originStop.productMode,
      provenance: originStop.provenance,
      dataset_version_id: originStop.datasetVersionId,
    };
    const kemangTransit = kemangMatches.filter((x) =>
      ['STATION', 'STOP'].includes(x.kind),
    );
    const namedPoi = [...villageMatches, ...lippoMatches].filter((x) =>
      /kemang village|lippo mall kemang/i.test(x.name ?? ''),
    );
    return `Manggarai=${JSON.stringify(exactManggarai.map(placeEvidence))}; Kemang generic transit stops=${kemangTransit.length} (e.g. ${kemangTransit
      .slice(0, 7)
      .map((x) => x.name)
      .join(
        '; ',
      )}); Kemang Village query=${villageMatches.length} rows, Lippo Mall Kemang query=${lippoMatches.length} rows, named POI matches=${namedPoi.length} BLOCKED_BY_DATA`;
  });
  await step('coordinate-variant-source-boundary', async () => {
    assert.ok(snapshot, 'snapshot id required for provenance');
    assert.deepEqual(coordinateVariant.destination, {
      latitude: -6.2607,
      longitude: 106.8135,
    });
    assert.equal(
      coordinateVariant.label,
      'Kemang Raya street area (approximate coordinate, no POI source)',
    );
    return JSON.stringify({
      variant_id: coordinateVariant.id,
      destination_label: coordinateVariant.label,
      destination: coordinateVariant.destination,
      source: coordinateVariant.sourceLines,
      source_commit: coordinateVariant.sourceCommit,
      provenance:
        'scripts/acceptance/v1-multi-od.mjs:42-50 recorded approximate street coordinate (not a named POI)',
      status:
        'BLOCKED_BY_DATA for full named POI; coordinate variant explicitly labeled, not equal named POI',
    });
  });
  browser = await chromium.launch(
    existsSync(chrome)
      ? { executablePath: chrome, headless: true }
      : { headless: true },
  );
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  await step('real-otp-plan-activate-coordinate-variant', async () => {
    await page.goto(web, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /Muat contoh perjalanan/ })
      .waitFor({ timeout: 30_000 });
    await page.getByText('Masukkan koordinat').click();
    for (const [label, value] of [
      ['Lintang titik awal', String(originFixture.latitude)],
      ['Bujur titik awal', String(originFixture.longitude)],
      ['Lintang tujuan', String(coordinateVariant.destination.latitude)],
      ['Bujur tujuan', String(coordinateVariant.destination.longitude)],
      ['Berangkat (WIB)', departure],
    ])
      await page.getByLabel(label).fill(value);
    const plans = await uiMutation('Cari perjalanan', 'journeys/plan', 'POST');
    assert.ok(Array.isArray(plans) && plans.length, 'OTP returned no plans');
    for (const plan of plans) {
      assert.equal(plan.routing_context.provider, 'OTP');
      assert.match(plan.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
    }
    const hasFutureRoute = (plan) =>
      plan.segments.some(
        (leg) =>
          leg.sequence >= 1 &&
          leg.entity_bindings.some(
            (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
          ),
      );
    const maxRouteSeq = (plan) =>
      Math.max(
        ...plan.segments
          .filter((leg) =>
            leg.entity_bindings.some(
              (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
            ),
          )
          .map((leg) => leg.sequence),
      );
    const candidates = plans.filter(hasFutureRoute);
    assert.ok(
      candidates.length,
      'real OTP returned no candidate with future route dependency',
    );
    candidates.sort((a, b) => maxRouteSeq(b) - maxRouteSeq(a));
    const chosen = candidates[0];
    assert.ok(
      chosen,
      'real OTP returned no candidate with future route dependency',
    );
    active = chosen;
    await page
      .getByRole('region', { name: 'Pilihan perjalanan' })
      .getByRole('button')
      .nth(plans.indexOf(chosen))
      .click();
    await page.locator('.maplibregl-canvas').first().waitFor();
    await page.locator('.leg-list').first().waitFor();
    target = [...active.segments]
      .filter(
        (leg) =>
          leg.sequence >= 1 &&
          leg.entity_bindings.some(
            (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
          ),
      )
      .sort((a, b) => b.sequence - a.sequence)[0];
    active = await uiMutation(
      'Mulai Perjalanan',
      `journeys/${active.journey_id}/activate`,
      'POST',
    );
    assert.equal(active.status, 'ACTIVE');
    return JSON.stringify({
      journey_id: active.journey_id,
      origin_searched_place: originFixture,
      destination_coordinate_variant: coordinateVariant.destination,
      provider: active.routing_context.provider,
      graph_sha256: active.routing_context.graph_sha256,
    });
  });
  await step('manual-boundary-before-disruption', async () => {
    let transit = 0;
    while (active.progress.completed_segment_count < target.sequence - 1)
      if (await advanceCurrent()) transit++;
    assert.ok(
      transit > 0,
      'no explicit transit boarding/alighting before disruption',
    );
    assert.equal(active.progress.method, 'CONTROLLED_MANUAL');
  });
  const binding = target.entity_bindings.find(
    (b) => b.entity_type === 'ROUTE' && b.mobility_entity_id,
  );
  await step('simulated-closure-review', async () => {
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
      .fill(jakarta(new Date().toISOString()));
    await page
      .getByLabel('Keterangan')
      .fill(`S01 R1 SIMULATED closure ${randomUUID()}`);
    const report = await uiMutation(
      'Kirim laporan',
      'passenger-reports',
      'POST',
    );
    reportId = report.report_id;
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
    const verify = await fetch(
      `${api}/controlled/passenger-reports/${reportId}/verify`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-controlled-reviewer': reviewer,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operational_state: 'UNAVAILABLE',
          incident_type: 'SERVICE_SUSPENSION',
          reason: `S01 R1 SIMULATED ${reportId}`,
        }),
      },
    );
    const verifyBody = await verify.json().catch(() => null);
    assert.ok(
      [200, 201].includes(verify.status),
      `HTTP ${verify.status}: ${JSON.stringify(verifyBody)}`,
    );
    reviewed = true;
    return JSON.stringify({
      report_id: reportId,
      disrupted_entity: binding.mobility_entity_id,
      operational_state: 'UNAVAILABLE',
      evidence_type: 'SIMULATED',
    });
  });
  await step('recovery-real-otp-or-truthful-no-path', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
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
  await step('accept-and-continue-or-no-path-refusal', async () => {
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
              data: { progress_revision: recovery.progress_revision },
            })
          ).status,
        ),
      );
      return 'truthful NO_PATH; acceptance refused';
    }
    const accepted = await uiMutation(
      'Gunakan rute pengganti ini',
      `recoveries/${recovery.recovery_id}/accept`,
      'POST',
    );
    assert.equal(accepted.original_plan_preserved, true);
    assert.equal(accepted.current_pointer_advanced, true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persisted = ok(await proxy(`recoveries/${recovery.recovery_id}`));
    assert.equal(persisted.accepted, true);
    active = ok(await proxy(`journeys/${active.journey_id}`));
    await page.locator('.leg-list').first().waitFor();
    while (active.status !== 'COMPLETED') await advanceCurrent();
    const completed = ok(await proxy(`journeys/${active.journey_id}`));
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(
      completed.progress.completed_segment_count,
      completed.segments.length,
    );
    return 'recovery accepted; continuation reached journey completion';
  });
} catch (error) {
  mark('harness', 'FAIL', error.message);
} finally {
  if (reportId && reviewed) {
    try {
      const closed = await fetch(
        `${api}/controlled/passenger-reports/${reportId}/close`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'x-controlled-reviewer': reviewer,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'RESOLVED',
            reason: `S01 R1 finally close ${reportId}`,
          }),
        },
      );
      mark(
        'controlled-close-finally',
        closed.ok ? 'PASS' : 'FAIL',
        `${closed.status}; same reviewer; no SQL cleanup`,
      );
    } catch (error) {
      mark('controlled-close-finally', 'FAIL', error.message);
    }
  }
  await browser?.close().catch(() => {});
}
const blocker =
  'BLOCKED_BY_DATA: Kemang Village/Lippo Mall Kemang named POI has no accepted source/identifier/license/ingest authorization; no accepted known coordinate exists for the named POI. Coordinate variant is not equal to the named POI.';
const failed = cases.filter((x) => x.verdict === 'FAIL');
const status = failed.length ? 'FAIL' : 'PASS';
console.log(
  JSON.stringify({
    status,
    full_s01_status: blocker,
    coordinate_variant_id: coordinateVariant.id,
    origin_fixture: originFixture,
    destination_fixture: coordinateVariant.destination,
    branch: branch ?? null,
    cases,
    evidence:
      'real Playwright/product proxy/API/OTP; closure and controlled review SIMULATED; no SQL cleanup or data ingest',
    command: 'node apps/web/scripts/passenger-s01-r1-acceptance.mjs',
  }),
);
process.exitCode = status === 'PASS' ? 0 : 1;
