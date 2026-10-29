import assert from 'node:assert/strict';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

const reviewer = 'cp3-sequential-reviewer';

/** Select a different remaining current-transit ROUTE bound in the itinerary. */
export function selectSecondRecoveryTarget(journey, firstReport) {
  const completed = journey.progress?.completed_segment_count ?? 0;
  for (const segment of journey.segments ?? []) {
    if (segment.sequence < completed || segment.mode === 'WALK') continue;
    for (const binding of segment.entity_bindings ?? []) {
      if (
        binding.entity_type === 'ROUTE' &&
        binding.mobility_entity_id &&
        binding.mobility_entity_id !== firstReport?.mobility_entity_id
      )
        return {
          key: `${binding.mobility_entity_id}:ROUTE`,
          entityId: binding.mobility_entity_id,
          sequence: segment.sequence,
        };
    }
  }
  return null;
}

function readJourney(page, id) {
  return page.evaluate(
    async (journeyId) =>
      (await fetch(`/api/passenger/journeys/${journeyId}`)).json(),
    id,
  );
}

async function readMap(page) {
  return page.evaluate(() => {
    const map =
      document.querySelector('.map-frame') ??
      document.querySelector('.maplibre-frame');
    return {
      count: Number(map?.getAttribute('data-route-source-count') ?? -1),
      fingerprint: map?.getAttribute('data-route-source-fingerprint') ?? null,
    };
  });
}

async function readTimeline(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.leg-list li')].map((leg) => ({
      sequence: leg.getAttribute('data-segment-sequence'),
      fingerprint: leg.getAttribute('data-leg-fingerprint'),
      position: leg.className,
    })),
  );
}

/** Optional CP3 continuation using current itinerary, controlled review and OTP recovery. */
export async function runSequentialRecoveryCheck({
  page,
  journeyId,
  firstReportId,
  direct,
  expectedMapFingerprint,
  nav,
  summary,
}) {
  if (process.env.R7_SEQUENTIAL_RECOVERY !== '1')
    return { status: 'SKIPPED', reason: 'R7_SEQUENTIAL_RECOVERY is not 1' };
  const mark = (stage, operation) => {
    summary.sequential_recovery_stage = { stage, operation };
    console.error(
      JSON.stringify({ check: 'sequential-recovery', stage, operation }),
    );
  };
  mark(1, 'runtime-identity');
  await assertCp2Runtime();
  assert.ok(
    process.env.CONTROLLED_REVIEW_TOKEN &&
      process.env.CONTROLLED_REVIEW_TOKEN.length >= 32,
    'controlled reviewer token missing',
  );

  const beforeEnvelope = await readJourney(page, journeyId);
  const before = beforeEnvelope.data;
  const predecessorRecoveryId = before.accepted_recovery_id;
  assert.ok(
    predecessorRecoveryId,
    'R1 pointer missing before sequential recovery',
  );
  const firstReport = await page.evaluate(async (id) => {
    const response = await fetch(`/api/passenger/passenger-reports/${id}`);
    return response.ok ? (await response.json()).data : null;
  }, firstReportId);
  assert.ok(firstReport, 'R1 report unavailable to owner');
  mark(2, 'current-itinerary-and-R1-report-loaded');

  const target = selectSecondRecoveryTarget(before, firstReport);
  if (!target) {
    const result = {
      status: 'NOT_VERIFIED',
      reason:
        'No different remaining current transit ROUTE binding eligible for controlled review.',
    };
    Object.assign(summary, { sequential_recovery: result });
    return result;
  }
  mark(3, `different-route-target-selected segment=${target.sequence}`);

  await page.getByRole('button', { name: 'Gangguan', exact: true }).click();
  const select = page.locator('#report-target');
  await select.waitFor();
  const optionExists = await select
    .locator(`option[value="${target.key}"]`)
    .count();
  if (!optionExists) {
    const result = {
      status: 'NOT_VERIFIED',
      reason:
        'Current transit ROUTE dependency is not exposed as a passenger report target.',
    };
    Object.assign(summary, { sequential_recovery: result });
    return result;
  }
  mark(4, 'report-target-option-exposed');

  await select.selectOption(target.key);
  await page.locator('#report-category').selectOption('CLEANLINESS');
  await page
    .locator('#report-description')
    .fill('Controlled sequential recovery observation for continuity proof.');
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/passenger/passenger-reports') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Kirim laporan' }).click();
  const submittedResponse = await submitted;
  mark(5, `POST-passenger-report-status=${submittedResponse.status()}`);
  assert.equal(submittedResponse.status(), 201);
  const secondReport = (await submittedResponse.json()).data;
  assert.notEqual(secondReport.report_id, firstReportId);
  assert.equal(secondReport.mobility_entity_id, target.entityId);
  assert.equal(secondReport.verification_status, 'REPORTED_UNVERIFIED');
  mark(5, 'second-report-created-unverified');

  const alertsBefore = await page
    .getByRole('article', { name: 'Peringatan perjalanan' })
    .count();
  const verified = await direct(
    `controlled/passenger-reports/${secondReport.report_id}/verify`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CONTROLLED_REVIEW_TOKEN}`,
        'x-controlled-reviewer': reviewer,
      },
      body: JSON.stringify({
        operational_state: 'UNAVAILABLE',
        incident_type: 'SERVICE_SUSPENSION',
        reason: 'Controlled SIMULATED sequential continuity review.',
      }),
    },
  );
  assert.equal(verified.verification_status, 'CONTROLLED_VERIFIED');
  mark(6, 'second-report-controlled-review-committed');

  const alerts = page.getByRole('article', { name: 'Peringatan perjalanan' });
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll('article[aria-label="Peringatan perjalanan"]')
        .length === expected,
    alertsBefore + 1,
    { timeout: 30000 },
  );
  const alert = alerts.last();
  await alert.waitFor({ timeout: 30000 });
  mark(7, 'second-target-alert-rendered');

  const proposedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/recoveries') &&
      response.request().method() === 'POST',
    { timeout: 120000 },
  );
  await alert.getByRole('button', { name: 'Cari rute pengganti' }).click();
  const proposalResponse = await proposedResponse;
  const proposal = (await proposalResponse.json()).data;
  if (
    !proposal?.recovery_id ||
    proposal.status !== 'COMPLETED' ||
    !proposal.proposed_journey
  ) {
    const result = {
      status: 'NOT_VERIFIED',
      reason: 'OTP produced no genuine second recovery alternative.',
      second_report_id: secondReport.report_id,
    };
    Object.assign(summary, { sequential_recovery: result });
    return result;
  }
  mark(8, 'second-otp-proposal-completed');

  await page
    .getByRole('heading', { name: 'Rute pengganti' })
    .waitFor({ timeout: 120000 });
  const acceptedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/recoveries/${proposal.recovery_id}/accept`) &&
      response.request().method() === 'POST',
    { timeout: 120000 },
  );
  await page
    .getByRole('button', { name: 'Gunakan rute pengganti ini' })
    .click();
  const acceptance = await acceptedResponse;
  assert.ok([200, 201].includes(acceptance.status()));
  await page
    .getByText('Recovery diterima. Rute aktif mengikuti rute pengganti.')
    .waitFor({ timeout: 120000 });
  mark(9, 'second-recovery-accepted');

  const after = (await readJourney(page, journeyId)).data;
  assert.equal(after.accepted_recovery_id, proposal.recovery_id);
  assert.notEqual(after.accepted_recovery_id, predecessorRecoveryId);
  assert.deepEqual(after.original_plan, before.original_plan);
  const completed = before.progress.completed_segment_count;
  assert.equal(after.progress.completed_segment_count, completed);
  assert.deepEqual(
    after.segments.slice(0, completed),
    before.segments.slice(0, completed),
    'R2 changed completed R1 prefix',
  );
  mark(10, 'authoritative-journey-lineage-and-prefix-verified');

  const expectedMap = expectedMapFingerprint(after);
  await page.waitForFunction(
    (fingerprint) =>
      (
        document.querySelector('.map-frame') ??
        document.querySelector('.maplibre-frame')
      )?.getAttribute('data-route-source-fingerprint') === fingerprint,
    expectedMap.join('|'),
    { timeout: 15000 },
  );
  const map = await readMap(page);
  assert.equal(map.count, expectedMap.length);
  assert.deepEqual(map.fingerprint?.split('|'), expectedMap);
  const expectedTimeline = after.segments.map((segment) => ({
    sequence: String(segment.sequence),
    fingerprint: nav.walkGeometryIdentity(segment),
    position:
      segment.sequence < completed
        ? 'completed'
        : segment.sequence === completed
          ? 'current'
          : 'upcoming',
  }));
  assert.deepEqual(await readTimeline(page), expectedTimeline);
  mark(11, 'map-and-timeline-match-authoritative-itinerary');

  await page.reload();
  await page
    .getByRole('heading', { name: 'Perjalanan aktif Anda' })
    .waitFor({ timeout: 30000 });
  const refreshed = (await readJourney(page, journeyId)).data;
  assert.equal(refreshed.accepted_recovery_id, proposal.recovery_id);
  assert.deepEqual(refreshed.segments, after.segments);
  assert.deepEqual(refreshed.original_plan, before.original_plan);
  // Reload restores API state before MapLibre finishes rebuilding its sources.
  await page.waitForFunction(
    (fingerprint) =>
      (
        document.querySelector('.map-frame') ??
        document.querySelector('.maplibre-frame')
      )?.getAttribute('data-route-source-fingerprint') === fingerprint,
    expectedMap.join('|'),
    { timeout: 15000 },
  );
  assert.deepEqual(await readTimeline(page), expectedTimeline);
  assert.deepEqual((await readMap(page)).fingerprint?.split('|'), expectedMap);
  mark(12, 'refresh-preserves-accepted-itinerary-map-and-timeline');

  // Current public recovery DTO omits baseRecoveryId/predecessorRecoveryId.
  // Exact durable field remains NOT_VERIFIED until contract exposes it or parent harness queries DB.
  const result = {
    status: 'NOT_VERIFIED',
    reason:
      'R2 passed, but exact predecessorRecoveryId is not exposed by current API DTO.',
    second_report_id: secondReport.report_id,
    predecessor_recovery_id_expected: predecessorRecoveryId,
    accepted_recovery_id: proposal.recovery_id,
    generation_cas_verified: true,
    original_plan_immutable: true,
    completed_prefix_immutable: true,
    refreshed_itinerary_map_timeline: true,
  };
  Object.assign(summary, { sequential_recovery: result });
  return result;
}
