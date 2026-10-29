import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

const webUrl = process.env.STAGE_G_WEB_URL;
assert.ok(
  webUrl?.startsWith('https://'),
  'Stage G requires HTTPS production origin',
);
assert.equal(process.env.NODE_ENV, 'production');
await assertCp2Runtime();

const workflowUrl = new URL(
  './passenger-r1-full-workflow.mjs',
  import.meta.url,
);
const workflow = await readFile(workflowUrl, 'utf8');

function replaceOnce(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `V20 anchor changed: ${anchor}`);
  return source.replace(anchor, () => replacement);
}

let source = replaceOnce(
  workflow,
  "from 'playwright-core'",
  `from ${JSON.stringify(import.meta.resolve('playwright-core'))}`,
);
source = replaceOnce(
  source,
  "from './cp2-runtime-guard.mjs'",
  `from ${JSON.stringify(new URL('./cp2-runtime-guard.mjs', import.meta.url).href)}`,
);
source = source.replaceAll('import.meta.url', JSON.stringify(workflowUrl.href));
source = replaceOnce(
  source,
  "const web = process.env.M7_WEB_URL ?? 'http://127.0.0.1:3000';",
  `const web = ${JSON.stringify(webUrl)};`,
);
// Native readiness probe targets owned HTTP listener; actual UI uses HTTPS.
source = replaceOnce(
  source,
  'await fetch(web, { signal: AbortSignal.timeout(20_000) })',
  "await fetch('http://127.0.0.1:3302', { signal: AbortSignal.timeout(20_000) })",
);
source = replaceOnce(
  source,
  'cookieA?.httpOnly && cookieB?.httpOnly && cookieA.value !== cookieB.value',
  'cookieA?.httpOnly && cookieA.secure && cookieB?.httpOnly && cookieB.secure && cookieA.value !== cookieB.value',
);

// Production proxy is HTTPS; keep both independent browser contexts on same TLS policy.
const contextAnchor =
  'browser.newContext({ viewport: { width: 390, height: 844 } })';
assert.equal(
  source.split(contextAnchor).length,
  3,
  'V20 context anchors changed',
);
source = source.replaceAll(
  contextAnchor,
  `browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true })`,
);
source = replaceOnce(
  source,
  "cookie.name === 'transumin_proto_session' && cookie.httpOnly",
  "cookie.name === 'transumin_proto_session' && cookie.httpOnly && cookie.secure",
);

// Capture activation request at browser boundary, not through an API-only shortcut.
source = replaceOnce(
  source,
  'let reviewed = false;',
  'let reviewed = false;\nlet stageActivationRequest;',
);
source = replaceOnce(
  source,
  "  await page.getByRole('button', { name: button, exact: true }).click();\n  return ok(await jsonResponse(await wait));",
  "  await page.getByRole('button', { name: button, exact: true }).click();\n  const response = await wait;\n  if (suffix.endsWith('/activate')) {\n    const requestBody = response.request().postDataJSON();\n    const idempotencyKey = await response.request().headerValue('idempotency-key');\n    assert.ok(requestBody?.selected_journey, 'activation request missing selected journey');\n    assert.ok(idempotencyKey, 'activation request missing idempotency key');\n    assert.equal(requestBody.selected_journey.journey_id, active?.journey_id ?? requestBody.selected_journey.journey_id);\n    stageActivationRequest = { body: requestBody, idempotencyKey };\n    evidence.activation_request = { journey_id: requestBody.selected_journey.journey_id, captured_in_browser: true, idempotency_key_present: true };\n  }\n  return ok(await jsonResponse(response));",
);

const restartFunction = `
async function productionRestartProof() {
  const mapFingerprint = async () => (await page.locator('.maplibre-frame').getAttribute('data-route-source-fingerprint'))
    ?.split('|').map((item) => item.split(':').at(-1));
  const mapFingerprintBefore = await mapFingerprint();
  assert.ok(mapFingerprintBefore?.length, 'map fingerprint missing before restart');
  const message = (type) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(type + ' acknowledgement timed out')), 120_000);
    const handler = (value) => {
      if (value?.type !== type) return;
      clearTimeout(timeout);
      process.off('message', handler);
      resolve(value);
    };
    process.on('message', handler);
  });
  const webRestarted = message('WEB_RESTARTED');
  process.send?.({ type: 'RESTART_WEB' });
  await webRestarted;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Perjalanan aktif Anda' }).waitFor({ timeout: 30_000 });
  await page.getByLabel('Waktu tahapan perjalanan (WIB, skenario uji)').waitFor({ timeout: 30_000 });
  const stopped = message('API_STOPPED');
  process.send?.({ type: 'STOP_API' });
  await stopped;
  const apiWhileStopped = await page.evaluate(async (journeyId) => {
    try {
      const response = await fetch('/api/passenger/journeys/' + journeyId, { cache: 'no-store' });
      return response.status;
    } catch {
      return 0;
    }
  }, active.journey_id);
  assert.equal(apiWhileStopped, 503, 'UI proxy must report degraded API state while API is stopped');
  assert.ok(await page.getByRole('heading', { name: 'Perjalanan aktif Anda' }).count(), 'UI disappeared while API stopped');
  const restarted = message('API_RESTARTED');
  process.send?.({ type: 'START_API' });
  const r2 = await restarted;
  process.env.CP2_API_PID = r2.apiPid;
  await assertCp2Runtime();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Perjalanan aktif Anda' }).waitFor({ timeout: 30_000 });
  await page.getByText('Kelapa Gading', { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('.maplibre-frame')?.getAttribute('data-route-source-fingerprint'), null, { timeout: 30_000 });
  assert.ok(await page.getByText('Kelapa Gading', { exact: false }).count());
  const preserved = active;
  const snapshotBefore = createHash('sha256').update(JSON.stringify(preserved)).digest('hex');
  const reloaded = ok(await proxy(\`journeys/\${preserved.journey_id}\`));
  assert.deepEqual(reloaded.progress, preserved.progress, 'authoritative progress changed across restart');
  assert.deepEqual(reloaded.segments, preserved.segments, 'authoritative segments changed across restart');
  assert.equal(reloaded.routing_context.graph_sha256, preserved.routing_context.graph_sha256, 'routing graph changed across restart');
  assert.equal(reloaded.network_snapshot_id, preserved.network_snapshot_id, 'snapshot identity changed across restart');
  assert.equal(typeof preserved.plan_fingerprint === 'string' ? preserved.plan_fingerprint.length : 0, 64, 'plan fingerprint missing');
  const snapshotAfter = createHash('sha256').update(JSON.stringify(reloaded)).digest('hex');
  assert.equal(snapshotAfter, snapshotBefore, 'map fingerprint source journey mutated across restart');
  assert.ok(await page.locator('.maplibre-frame').count(), 'map surface gone after restart');
  const mapAfter = await page.locator('.maplibre-frame').evaluate((node) => ({
    route_sources: Number(node.getAttribute('data-route-source-count')),
    route_points: Number(node.getAttribute('data-route-point-count')),
    markers: Number(node.getAttribute('data-marker-count')),
  }));
  assert.equal(mapAfter.route_sources, preserved.segments.length, 'map route sources differ after restart');
  const mapFingerprintAfter = await mapFingerprint();
  assert.deepEqual(mapFingerprintAfter, mapFingerprintBefore, 'map fingerprint changed across restart');
  const replayBody = stageActivationRequest?.body ?? { selected_journey: preserved };
  const replayPlanId = replayBody.selected_journey?.journey_id ?? preserved.journey_id;
  const replay = ok(await proxy(\`journeys/\${replayPlanId}/activate\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': stageActivationRequest?.idempotencyKey ?? '',
    },
    data: replayBody,
  }));
  assert.equal(replay.journey_id, preserved.journey_id, 'activation replay produced different journey');
  evidence.production_restart = {
    active_heading: true,
    restarted: true,
    apiWhileStopped,
    map_parity: mapAfter,
    map_fingerprint_parity: true,
    journey_fingerprint: snapshotBefore,
    activation_replay_same_journey: true,
  };
  return { web: true, api: true, apiWhileStopped, snapshotBefore, replayed: replay.journey_id };
}
`;
source = replaceOnce(
  source,
  '// R3-B: 20 executable UI steps. Order enforced, no branch-skip. 1..20 indexed.',
  `${restartFunction}\n// R3-B: 20 executable UI steps. Order enforced, no branch-skip. 1..20 indexed.`,
);
source = replaceOnce(
  source,
  "  await step('ui-report-reporting-unverified-target-anchor', 11, async () => {",
  "  await productionRestartProof();\n\n  await step('ui-report-reporting-unverified-target-anchor', 11, async () => {",
);
source = replaceOnce(
  source,
  '  acceptance_map_timeline_parity: evidence.acceptance_map_timeline_parity,',
  '  acceptance_map_timeline_parity: evidence.acceptance_map_timeline_parity,\n  activation_request: evidence.activation_request,\n  production_restart: evidence.production_restart,',
);
process.exitCode = 0;
await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
assert.equal(process.exitCode, 0, 'Stage G V20 workflow failed');
