// R3-C S09 deterministic no-alternative acceptance.
// Real passenger UI plans/selects/activates/reports each OTP candidate; controlled
// reviewer verifies route dependencies as SIMULATED UNAVAILABLE.
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

const rawWeb =
  process.env.S09_WEB_URL ??
  process.env.PASSENGER_WEB_URL ??
  process.env.M7_WEB_URL ??
  'http://127.0.0.1:3302';
const web = rawWeb.replace(/\/$/, '');
const controlledBase = (
  process.env.CONTROLLED_REVIEW_API_URL ??
  process.env.S09_API_URL ??
  process.env.M6_API_URL ??
  'http://127.0.0.1:3303/api/v1'
).replace(/\/$/, '');
const api = controlledBase;
const apiHealth = (() => {
  try {
    const u = new URL(api);
    return `${u.protocol}//${u.host}/health/ready`;
  } catch {
    return 'http://127.0.0.1:3304/health/ready';
  }
})();
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
const reviewer = `r3-s09-${randomUUID()}`;
const cases = [];
const sessions = [];
const reports = [];
let browser;
let primary;
let recovery;
let outcome;
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
async function step(name, fn) {
  try {
    const result = await fn();
    mark(name, 'PASS', typeof result === 'string' ? result : '');
    return result;
  } catch (error) {
    mark(name, 'FAIL', error.message);
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
function ok(result, statuses = [200, 201]) {
  assert.ok(
    statuses.includes(result.status),
    `HTTP ${result.status}: ${JSON.stringify(result.body?.error ?? result.body)}`,
  );
  return data(result.body);
}
async function controlled(reportId, action, payload) {
  return jsonResponse(
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
async function proxy(session, path, options = {}) {
  return jsonResponse(
    await session.context.request.fetch(`${web}/api/passenger/${path}`, {
      ...options,
      timeout: 120_000,
      headers: { origin: web, ...(options.headers ?? {}) },
    }),
  );
}
async function uiMutation(session, button, suffix, method) {
  const [response] = await Promise.all([
    session.page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(`/api/passenger/${suffix}`) &&
        candidate.request().method() === method,
      { timeout: 120_000 },
    ),
    session.page
      .getByRole('button', { name: button, exact: true })
      .first()
      .click(),
  ]);
  return jsonResponse(response);
}
function jakarta(at) {
  return new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 16);
}
function routeTargets(journey) {
  const seen = new Set();
  return journey.segments
    .slice(journey.progress?.completed_segment_count ?? 0)
    .flatMap((segment) =>
      segment.mode === 'WALK'
        ? []
        : segment.entity_bindings
            .filter(
              (binding) =>
                binding.entity_type === 'ROUTE' && binding.mobility_entity_id,
            )
            .flatMap((binding) => {
              const key = `${binding.mobility_entity_id}:ROUTE`;
              if (seen.has(key)) return [];
              seen.add(key);
              return [
                { id: binding.mobility_entity_id, type: 'ROUTE', segment },
              ];
            }),
    );
}
async function makeSession() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const session = {
    context,
    page,
    journey: null,
    candidates: null,
    reports: [],
  };
  sessions.push(session);
  await page.goto(web, { waitUntil: 'domcontentloaded' });
  return session;
}
async function plan(session) {
  const wait = session.page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/journeys/plan') &&
      response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await session.page
    .getByRole('button', { name: /Muat contoh perjalanan/ })
    .click();
  const list = ok(await jsonResponse(await wait));
  assert.ok(
    list.length >= 1 && list.length <= 8,
    `expected 1-8 actual OTP candidates, got ${list.length}`,
  );
  for (const journey of list) {
    assert.equal(journey.routing_context.provider, 'OTP');
    assert.match(journey.routing_context.graph_sha256, /^[a-f0-9]{64}$/);
  }
  session.candidates = list;
  await session.page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .first()
    .waitFor({ timeout: 120_000 });
  return list;
}
async function activate(session, index) {
  const choice = session.page
    .getByRole('region', { name: 'Pilihan perjalanan' })
    .getByRole('button')
    .nth(index);
  await choice.click();
  session.journey = ok(
    await uiMutation(
      session,
      'Mulai Perjalanan',
      `journeys/${session.candidates[index].journey_id}/activate`,
      'POST',
    ),
  );
  assert.equal(session.journey.status, 'ACTIVE');
  assert.equal(session.journey.progress.completed_segment_count, 0);
}
async function reportRoutes(session, index) {
  const targets = routeTargets(session.journey);
  assert.ok(
    targets.length > 0,
    `candidate ${index + 1} has no reportable route dependency`,
  );
  assert.ok(
    targets.length <= 8,
    `candidate ${index + 1} exceeds controlled report bound`,
  );
  const selector = session.page.getByLabel(
    'Lokasi atau layanan pada sisa perjalanan',
  );
  for (const target of targets) {
    const value = await selector
      .locator('option')
      .evaluateAll(
        (options, id) =>
          options.find((option) => option.value.includes(id))?.value,
        target.id,
      );
    assert.ok(
      value,
      `route dependency ${target.id} missing from passenger UI dropdown`,
    );
    await selector.selectOption(value);
    await session.page
      .getByLabel('Waktu kejadian (WIB)')
      .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
    await session.page
      .getByLabel('Keterangan')
      .fill(`R3 S09 SIMULATED ROUTE ${randomUUID()}`);
    const report = ok(
      await uiMutation(session, 'Kirim laporan', 'passenger-reports', 'POST'),
    );
    assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
    const item = {
      ...target,
      reportId: report.report_id,
      session,
      candidate: index,
    };
    reports.push(item);
    session.reports.push(item);
  }
  return targets.length;
}

try {
  await step('runtime-ready', async () => {
    assert.equal(env('CONTROLLED_REVIEW_ENABLED'), 'true');
    assert.ok(token.length >= 32, 'controlled review token unavailable');
    assert.ok((await fetch(web, { signal: AbortSignal.timeout(20_000) })).ok);
    assert.ok(
      (
        await fetch(apiHealth, {
          signal: AbortSignal.timeout(20_000),
        })
      ).ok,
    );
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
  primary = await makeSession();
  await step('ui-plan-all-actual-candidates', () => plan(primary));
  for (let index = 0; index < primary.candidates.length; index += 1) {
    const session = index === 0 ? primary : await makeSession();
    if (index > 0) await plan(session);
    await step(`candidate-${index + 1}-ui-select-activate-report`, async () => {
      await activate(session, index);
      return `${await reportRoutes(session, index)} route dependencies reported through passenger UI`;
    });
  }
  await step('controlled-verify-all-candidate-route-dependencies', async () => {
    for (const report of reports) {
      const review = ok(
        await controlled(report.reportId, 'verify', {
          operational_state: 'UNAVAILABLE',
          incident_type: 'SERVICE_SUSPENSION',
          reason: `R3 S09 ${report.reportId}`,
        }),
      );
      assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
      report.verified = true;
      const alerts = ok(
        await proxy(
          report.session,
          `journeys/${report.session.journey.journey_id}/alerts`,
        ),
      );
      assert.ok(
        alerts.some(
          (item) =>
            item.mobility_entity_id === report.id &&
            item.evidence_type === 'SIMULATED' &&
            !item.resolved_at,
        ),
        `no SIMULATED alert for ${report.id}`,
      );
    }
    return `${reports.length} candidate route dependencies CONTROLLED_VERIFIED with SERVICE_SUSPENSION`;
  });

  const before = primary.journey;
  const alert = await proxy(primary, `journeys/${before.journey_id}/alerts`);
  const alerts = ok(alert);
  assert.ok(
    alerts.length > 0,
    'primary journey has no current disruption alert',
  );
  // Bounded exhaustion: genuine fallback is not proof of blocking.
  // If OTP returns a new route (e.g. 6H) not in initial candidates, that
  // fallback's dependencies must be reported via legit UI and
  // CONTROLLED_VERIFIED as SIMULATED, then recovery retried — within a
  // small bound, without forcing result or altering adapter.
  const BOUNDED_REPORTS = 16;
  const BOUNDED_RECOVERY_ATTEMPTS = 3;
  async function reportRouteIdsViaUi(routeIds) {
    // Each routeId must be reported through passenger UI + controlled verify.
    // Create an independent passenger context per exhaustion round so the
    // fallback route is selectable from that journey's remainingReportTargets.
    for (const routeId of routeIds) {
      if (reports.length >= BOUNDED_REPORTS) break;
      // Already verified? skip
      if (reports.some((item) => item.id === routeId && item.verified))
        continue;
      let dedicated = null;
      let found = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        dedicated = await makeSession();
        await plan(dedicated);
        // Find actual OTP candidate containing routeId; don't assume prior plans repeat it.
        let targetIndex = -1;
        for (let index = 0; index < dedicated.candidates.length; index += 1) {
          const candidate = dedicated.candidates[index];
          const hasRoute = candidate.segments?.some((segment) =>
            segment.entity_bindings?.some(
              (binding) => binding.mobility_entity_id === routeId,
            ),
          );
          if (hasRoute) {
            targetIndex = index;
            break;
          }
        }
        if (targetIndex === -1) {
          // No candidate with this route; this graph state cannot surface it — try again with fresh plan.
          await dedicated.context.close().catch(() => {});
          sessions.pop();
          continue;
        }
        await activate(dedicated, targetIndex);
        const targets = routeTargets(dedicated.journey).filter(
          (item) => item.id === routeId,
        );
        if (targets.length === 0) {
          await dedicated.context.close().catch(() => {});
          sessions.pop();
          continue;
        }
        for (const target of targets) {
          const selector = dedicated.page.getByLabel(
            'Lokasi atau layanan pada sisa perjalanan',
          );
          const value = await selector
            .locator('option')
            .evaluateAll(
              (options, id) =>
                options.find((option) => option.value.includes(id))?.value,
              target.id,
            );
          assert.ok(
            value,
            `exhaustion route ${target.id} missing from UI dropdown`,
          );
          await selector.selectOption(value);
          await dedicated.page
            .getByLabel('Waktu kejadian (WIB)')
            .fill(jakarta(new Date(Date.now() - 60_000).toISOString()));
          await dedicated.page
            .getByLabel('Keterangan')
            .fill(`R3 S09 exhaustion SIMULATED ${routeId} ${randomUUID()}`);
          const report = ok(
            await uiMutation(
              dedicated,
              'Kirim laporan',
              'passenger-reports',
              'POST',
            ),
          );
          assert.equal(report.verification_status, 'REPORTED_UNVERIFIED');
          reports.push({
            ...target,
            reportId: report.report_id,
            session: dedicated,
            candidate: targetIndex,
          });
        }
        found = true;
        break;
      }
      if (!found) {
        mark(
          'exhaustion-route-unavailable',
          'NOT_VERIFIED',
          `route ${routeId} not surfaced by OTP candidates within bound; cannot exhaust via UI`,
        );
        continue;
      }
      // Controlled verify each newly reported id
      for (const item of reports.filter(
        (r) => r.id === routeId && !r.verified,
      )) {
        const review = ok(
          await controlled(item.reportId, 'verify', {
            operational_state: 'UNAVAILABLE',
            incident_type: 'SERVICE_SUSPENSION',
            reason: `R3 S09 exhaustion ${item.reportId}`,
          }),
        );
        assert.equal(review.verification_status, 'CONTROLLED_VERIFIED');
        item.verified = true;
      }
    }
  }

  let recoveryResult = await uiMutation(
    primary,
    'Cari rute pengganti',
    'recoveries',
    'POST',
  );
  let exhaustionRounds = 0;
  while (true) {
    if (recoveryResult.status === 200 || recoveryResult.status === 201) {
      recovery = ok(recoveryResult);
      if (recovery.status === 'NO_PATH') {
        assert.equal(recovery.proposed_journey, null);
        assert.equal(recovery.metrics.recovery_success, false);
        outcome = 'NO_VALID_ALTERNATIVE_NO_PATH';
        mark(
          'recovery-rejects-all-blocked-candidates',
          'PASS',
          `application ${outcome}; no alternative persisted after ${exhaustionRounds} exhaustion round(s)`,
        );
        mark(
          'engine-otp-no-path',
          'NOT_VERIFIED',
          'Application NO_PATH observed; provider routingErrors are not exposed here. Run scripts/acceptance/otp-negative-routing.mjs separately; state exhaustion is not genuine OTP graph disconnection.',
        );
        break;
      }
      // Genuine fallback — collect its route dependencies for bounded exhaustion
      const legs = recovery.proposed_journey?.segments ?? [];
      const dependencies = routeTargets({
        segments: legs,
        progress: { completed_segment_count: 0 },
      });
      const detail = `genuine fallback legs=${legs.map((leg) => `${leg.mode}:${leg.route_short_name || 'walk'} (${leg.from.name} → ${leg.to.name})`).join('; ')} route_dependencies=${dependencies.map((item) => item.id).join(',') || 'none'}`;
      if (
        exhaustionRounds >= BOUNDED_RECOVERY_ATTEMPTS ||
        reports.length + dependencies.length > BOUNDED_REPORTS
      ) {
        outcome = 'GENUINE_FALLBACK';
        mark(
          'recovery-rejects-all-blocked-candidates',
          'NOT_VERIFIED',
          `${detail} — bounded limit reached (rounds ${exhaustionRounds}/${BOUNDED_RECOVERY_ATTEMPTS}, reports ${reports.length}/${BOUNDED_REPORTS})`,
        );
        mark(
          'engine-otp-no-path',
          'NOT_VERIFIED',
          `OTP returned ${detail} — fallback not exhausted within bound; engine genuine NO_PATH (routingErrors) distinct from application NO_VALID_ROUTE_AFTER_STATE_VALIDATION/NO_RECOVERY_PATH`,
        );
        break;
      }
      // Exhaust this fallback's routes via legit UI then retry
      if (dependencies.length > 0) {
        await reportRouteIdsViaUi(dependencies.map((item) => item.id));
      } else {
        // Fallback is walk-only, no route to block — cannot exhaust further
        outcome = 'GENUINE_FALLBACK';
        mark(
          'recovery-rejects-all-blocked-candidates',
          'NOT_VERIFIED',
          `${detail} — walk-only fallback has no route dependency to block`,
        );
        mark('engine-otp-no-path', 'NOT_VERIFIED', `OTP returned ${detail}`);
        break;
      }
      exhaustionRounds += 1;
      mark(
        `exhaustion-round-${exhaustionRounds}`,
        'PASS',
        `blocked ${dependencies.map((item) => item.id).join(',')} via UI; retrying recovery`,
      );
      // Legitimate explicit fresh computation: only after known outcome,
      // new idempotency via Cari alternatif terbaru (attempt nonce), no header override.
      await primary.page
        .getByRole('button', { name: 'Cari alternatif terbaru' })
        .waitFor({ timeout: 30_000 });
      recoveryResult = await uiMutation(
        primary,
        'Cari alternatif terbaru',
        'recoveries',
        'POST',
      );
      continue;
    }
    if (recoveryResult.status === 422) {
      assert.equal(recoveryResult.body?.error?.code, 'NO_RECOVERY_PATH');
      assert.equal(
        recoveryResult.body?.error?.details?.recovery_code,
        'NO_RECOVERY_PATH',
      );
      outcome = 'NO_RECOVERY_PATH_422';
      mark(
        'recovery-rejects-all-blocked-candidates',
        'PASS',
        `application ${outcome}; no alternative persisted (distinct from OTP NO_ROUTE/NO_STOPS_IN_RANGE; see engine-otp-no-path)`,
      );
      mark(
        'engine-otp-no-path',
        'NOT_VERIFIED',
        'application 422 NO_RECOVERY_PATH observed; genuine provider routingErrors (e.g. NO_STOPS_IN_RANGE) remain separate — run scripts/acceptance/otp-negative-routing.mjs for pure OTP evidence',
      );
      break;
    }
    throw new Error(
      `unexpected recovery status ${recoveryResult.status}: ${JSON.stringify(recoveryResult.body?.error ?? recoveryResult.body)}`,
    );
  }
  if (outcome === 'GENUINE_FALLBACK') {
    await primary.page
      .getByRole('heading', { name: 'Rute pengganti' })
      .waitFor()
      .catch(() => {});
    const hasRetry = await primary.page
      .getByRole('button', { name: 'Cari rute pengganti' })
      .count();
    assert.ok(hasRetry);
    mark(
      'ui-indonesian-no-path-and-retry',
      'NOT_VERIFIED',
      'genuine fallback shown; NO_PATH explanation unavailable; retry remains allowed — bounded exhaustion incomplete',
    );
  } else
    await step('ui-indonesian-no-path-and-retry', async () => {
      await primary.page
        .getByText(/Tidak ada rute pengganti yang aman/i)
        .first()
        .waitFor({ timeout: 30_000 });
      assert.equal(
        await primary.page
          .getByRole('button', { name: 'Gunakan rute pengganti ini' })
          .count(),
        0,
      );
      assert.ok(
        await primary.page
          .getByRole('button', { name: 'Cari rute pengganti' })
          .count(),
      );
      return 'Indonesian NO_PATH explanation shown; retry allowed';
    });
  await step('active-journey-history-revision-unchanged', async () => {
    const current = ok(await proxy(primary, `journeys/${before.journey_id}`));
    assert.equal(current.status, 'ACTIVE');
    assert.equal(
      current.progress.completed_segment_count,
      before.progress.completed_segment_count,
    );
    assert.equal(current.progress.revision, before.progress.revision);
    assert.deepEqual(current.segments, before.segments);
    assert.equal(
      current.accepted_recovery_id ?? null,
      before.accepted_recovery_id ?? null,
    );
    if (recovery) {
      const persisted = ok(
        await proxy(primary, `recoveries/${recovery.recovery_id}`),
      );
      assert.equal(persisted.accepted, false);
      assert.equal(persisted.accepted_at, null);
    }
    return 'ACTIVE journey, history, revision unchanged; no acceptance persisted';
  });
} catch (error) {
  failure = safe(error.message);
} finally {
  let closedAll = true;
  for (const report of reports.filter((item) => item.verified)) {
    try {
      const closed = ok(
        await controlled(report.reportId, 'close', {
          decision: 'RESOLVED',
          reason: `R3 S09 finally cleanup ${report.reportId}`,
        }),
      );
      assert.equal(closed.lifecycle_status, 'RESOLVED');
    } catch (error) {
      closedAll = false;
      mark('controlled-close-finally', 'FAIL', error.message);
    }
  }
  if (closedAll && reports.some((item) => item.verified))
    mark(
      'controlled-close-finally',
      'PASS',
      `${reports.filter((item) => item.verified).length} incidents RESOLVED`,
    );
  for (const session of sessions) await session.context.close().catch(() => {});
  await browser?.close().catch(() => {});
}
const failed = cases.filter((item) => item.verdict === 'FAIL');
const notVerified = cases.filter((item) => item.verdict === 'NOT_VERIFIED');
const status = failed.length
  ? 'FAIL'
  : failure || notVerified.length
    ? 'NOT_VERIFIED'
    : 'PASS';
console.log(
  JSON.stringify({
    status,
    outcome,
    cases,
    failure,
    evidence:
      'independent real passenger contexts; UI plan/select/activate/report for all OTP candidates; controlled SIMULATED SERVICE_SUSPENSION verification; no direct state injection',
  }),
);
process.exitCode = status === 'PASS' ? 0 : 1;
