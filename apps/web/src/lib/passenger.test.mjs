import assert from 'node:assert/strict';
import test from 'node:test';
import { passengerApi } from './passenger-api.ts';

import {
  recoveryComparisonSource,
  journeyProgressDateTime,
  canReplayPendingReport,
  alertIsCurrent,
  easiestAmongShown,
  evidenceLabel,
  errorMessage,
  passengerReportStatusLabel,
  formatDuration,
  isValidReportDescription,
  journeySearchFailure,
  modeName,
  parsePoint,
  passengerRouteName,
  recoveryPart,
  recoveryPartLabel,
  recoverySummary,
  rankingExplanation,
  rankingFingerprint,
  sameRankingCandidate,
  remainingReportTargets,
  samePassengerLeg,
  segmentPosition,
  toJakartaIso,
  transferLabel,
} from './passenger.ts';

test('recovery comparison requires captured proposal source; refreshed lineage stays honest', () => {
  const original = { journey_id: 'j1', segments: [{ sequence: 2 }] };
  const repaired = {
    ...original,
    accepted_recovery_id: 'r1',
    segments: [{ sequence: 0 }],
  };
  const proposal = {
    original_journey_id: 'j1',
    recovery_id: 'r1',
    progress_revision: 4,
  };
  assert.equal(
    recoveryComparisonSource(repaired, proposal, {
      recoveryId: 'r1',
      journey: original,
    }),
    original,
  );
  assert.equal(recoveryComparisonSource(repaired, proposal, null), null);
  const secondProposal = {
    ...proposal,
    recovery_id: 'r2',
    progress_revision: 5,
  };
  const secondSource = { ...repaired, progress: { revision: 5 } };
  assert.equal(
    recoveryComparisonSource(secondSource, secondProposal, null),
    secondSource,
  );
  const twiceRepaired = {
    ...secondSource,
    accepted_recovery_id: 'r2',
    original_plan: original,
  };
  assert.equal(
    recoveryComparisonSource(twiceRepaired, secondProposal, {
      recoveryId: 'r2',
      journey: secondSource,
    }),
    secondSource,
  );
  assert.equal(
    recoveryComparisonSource(twiceRepaired, secondProposal, null),
    null,
  );
  assert.equal(
    recoveryComparisonSource(twiceRepaired, secondProposal, {
      recoveryId: 'r1',
      journey: original,
    }),
    null,
  );
  // Refreshed report keeps identity but has no in-memory payload proof.
  assert.equal(canReplayPendingReport('k1', 'k1', true), true);
  assert.equal(canReplayPendingReport('k1', null, true), false);
  assert.equal(canReplayPendingReport('k1', 'k2', true), false);
  assert.equal(canReplayPendingReport('k1', 'k1', false), false);
});

test('product modes remain operator-specific', () => {
  assert.equal(modeName('TRANSJAKARTA'), 'TransJakarta');
  assert.equal(modeName('MIKROTRANS'), 'Mikrotrans');
  assert.notEqual(modeName('KRL'), modeName('MRT_JAKARTA'));
  assert.notEqual(modeName('LRT_JAKARTA'), modeName('LRT_JABODEBEK'));
  assert.equal(
    passengerRouteName({
      mode: 'MRT_JAKARTA',
      route_short_name: 'MRT_JAKARTA',
    }),
    '',
  );
  assert.equal(
    passengerRouteName({ mode: 'TRANSJAKARTA', route_short_name: '1' }),
    '1',
  );
  assert.equal(transferLabel(1), '1 kali pindah');
});

test('no route and router unavailability have useful distinct feedback', () => {
  assert.deepEqual(journeySearchFailure({ code: 'NO_ROUTE' }), {
    empty: true,
    message:
      'Rute belum ditemukan. Coba waktu keberangkatan lain atau geser titik awal dan tujuan ke akses transportasi terdekat.',
  });
  assert.deepEqual(
    journeySearchFailure({ code: 'ROUTER_UNAVAILABLE', status: 503 }),
    {
      empty: false,
      message:
        'Mesin pencarian rute belum tersedia. Coba lagi nanti; hasil perkiraan tidak digunakan sebagai pengganti.',
    },
  );
  assert.equal(journeySearchFailure({ status: 503 }).empty, false);
});

test('routing errors explain historical dates and unresolved locations in Indonesian', () => {
  for (const [code, pattern] of [
    ['INVALID_TIME', /cakupan jadwal uji/],
    ['ORIGIN_UNRESOLVED', /Titik awal belum terhubung/],
    ['DESTINATION_UNRESOLVED', /Tujuan belum terhubung/],
    ['DATASET_NOT_READY', /Data transportasi belum siap/],
    ['IDENTITY_UNRESOLVED', /belum dapat dicocokkan/],
  ])
    assert.match(
      errorMessage(
        Object.assign(new Error('technical backend detail'), {
          code,
          status: 400,
        }),
      ),
      pattern,
    );
  assert.match(
    errorMessage(
      Object.assign(new Error('Session is invalid.'), { status: 401 }),
    ),
    /Sesi sudah berakhir/,
  );
  assert.match(
    errorMessage(
      Object.assign(new Error('Session is invalid.'), {
        code: 'INVALID_SESSION',
        status: 403,
      }),
    ),
    /Sesi sudah berakhir/,
  );
  assert.match(
    errorMessage(Object.assign(new Error('forbidden'), { status: 403 })),
    /Akses ditolak/,
  );
  assert.match(
    errorMessage(new TypeError('Failed to fetch')),
    /Koneksi ke server terputus/,
  );
});

test('recovery structure and passenger summary follow backend evidence', () => {
  const recovery = {
    status: 'COMPLETED',
    proposed_journey: { segments: [] },
    completed_segments: [0],
    preserved_segments: [1],
    invalidated_segments: [2],
    rejoined_segments: [3],
    additional_duration_seconds: 300,
    additional_transfers: 0,
  };
  assert.equal(recoveryPart(0, recovery), 'COMPLETED');
  assert.equal(recoveryPart(1, recovery), 'PRESERVED');
  assert.equal(recoveryPart(2, recovery), 'INVALIDATED');
  assert.equal(recoveryPart(3, recovery), 'REJOINED');
  assert.equal(recoveryPartLabel('INVALIDATED'), 'Diubah pada rute pengganti');
  assert.equal(recoveryPartLabel('REJOINED'), 'Kembali ke rute awal');
  assert.equal(
    recoverySummary(recovery),
    'Mempertahankan 2 tahap sisa perjalanan · +5 menit · tanpa tambahan pindah',
  );
  assert.equal(
    recoverySummary({ ...recovery, status: 'NO_PATH', proposed_journey: null }),
    'Belum ada rute pengganti yang memenuhi pemeriksaan sistem. Rencana awal Anda tidak berubah.',
  );
});

test('new route labels compare real leg identity, not generic mode alone', () => {
  const leg = {
    mode: 'TRANSJAKARTA',
    route_id: 'route-a',
    from: { name: 'Harmoni' },
    to: { name: 'Bundaran HI' },
    start_at: '2026-10-02T08:00:00+07:00',
    end_at: '2026-10-02T08:20:00+07:00',
  };
  assert.equal(samePassengerLeg(leg, { ...leg }), true);
  assert.equal(samePassengerLeg(leg, { ...leg, route_id: 'route-b' }), false);
});

test('Jakarta departure and coordinates are validated', () => {
  assert.equal(toJakartaIso('2026-10-02T08:30'), '2026-10-02T08:30:00+07:00');
  assert.deepEqual(parsePoint('-6.2', '106.8'), {
    latitude: -6.2,
    longitude: 106.8,
  });
  assert.throws(() => parsePoint('', '106.8'));
  assert.throws(() => parsePoint('-91', '106.8'));
});

test('progress keeps completed, current, and upcoming separate', () => {
  assert.equal(segmentPosition(0, 1), 'completed');
  assert.equal(segmentPosition(1, 1), 'current');
  assert.equal(segmentPosition(2, 1), 'upcoming');
});

test('expired or resolved alerts are not current; simulation is never live', () => {
  const alert = {
    resolved_at: null,
    freshness_status: 'FRESH',
    expires_at: '2026-10-02T09:00:00Z',
  };
  assert.equal(alertIsCurrent(alert, Date.parse('2026-10-02T08:00:00Z')), true);
  assert.equal(
    alertIsCurrent(alert, Date.parse('2026-10-02T10:00:00Z')),
    false,
  );
  assert.equal(
    alertIsCurrent(
      { ...alert, freshness_status: 'EXPIRED' },
      Date.parse('2026-10-02T08:00:00Z'),
    ),
    false,
  );
  assert.equal(evidenceLabel('SIMULATED'), 'SIMULASI terkontrol');
  assert.notEqual(evidenceLabel('SIMULATED'), evidenceLabel('LIVE'));
  assert.equal(formatDuration(3700), '1 jam 2 menit');
});

test('targeted SSE forwards owner and reconnect cursor, then parses heartbeat and alert', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'id: hb\nevent: heartbeat\ndata: {"type":"heartbeat"}\n\n',
            ),
          );
          controller.enqueue(
            new TextEncoder().encode(
              'id: alert-1\nevent: journey.alert.created\ndata: {"type":"journey.alert.created"}\n\n',
            ),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };
  try {
    const received = [];
    let opened = 0;
    await passengerApi.streamAlerts(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'previous-event',
      new AbortController().signal,
      (event) => received.push(event),
      () => {
        opened += 1;
      },
    );
    assert.equal(opened, 1);
    assert.deepEqual(
      received.map((event) => event.type),
      ['heartbeat', 'journey.alert.created'],
    );
    assert.equal(calls[0].options.headers['last-event-id'], 'previous-event');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('easiest among shown is subset-scoped and tie-aware, not global', () => {
  const base = {
    walking_distance_meters: 0,
    transfer_count: 0,
    journey_id: 'a',
  };
  assert.deepEqual(easiestAmongShown([]), []);
  assert.deepEqual(easiestAmongShown([base]), ['a']);
  assert.deepEqual(
    easiestAmongShown([
      { ...base, journey_id: 'invalid-transfers', transfer_count: -1 },
      {
        ...base,
        journey_id: 'invalid-walking',
        walking_distance_meters: Number.NaN,
      },
    ]),
    [],
  );
  assert.deepEqual(
    easiestAmongShown([base, { ...base, journey_id: 'b', transfer_count: 1 }]),
    ['a'],
  );
  assert.deepEqual(
    easiestAmongShown([
      { ...base, journey_id: 'longer-walk', walking_distance_meters: 50 },
      { ...base, journey_id: 'shorter-walk', walking_distance_meters: 25 },
    ]),
    ['shorter-walk'],
  );
  assert.deepEqual(
    easiestAmongShown(
      [
        { ...base, journey_id: 'x' },
        { ...base, journey_id: 'y' },
      ].map((j) => j),
    ).sort(),
    ['x', 'y'],
  );
});

test('ranking fingerprint keeps honest server comparison and avoids client ranking', () => {
  const journey = {
    journey_id: 'plan-a',
    duration_seconds: 3600,
    walking_distance_meters: 800,
    transfer_count: 1,
  };
  const fingerprint = rankingFingerprint(journey);
  assert.deepEqual(fingerprint, {
    journey_id: 'plan-a',
    duration_seconds: 3600,
    walking_distance_meters: 800,
    transfer_count: 1,
  });
  assert.equal(sameRankingCandidate(fingerprint, { ...fingerprint }), true);
  assert.equal(
    sameRankingCandidate(fingerprint, {
      ...fingerprint,
      duration_seconds: fingerprint.duration_seconds + 1,
    }),
    false,
  );
  assert.equal(
    sameRankingCandidate(fingerprint, {
      ...fingerprint,
      journey_id: 'plan-b',
    }),
    false,
  );
  const note = rankingExplanation('BALANCED', 'FASTEST', fingerprint, 3);
  assert.match(note, /Rute terbaik.*sama/);
  assert.match(
    note,
    /Seimbang mempertimbangkan waktu, jarak berjalan, dan jumlah pindah/,
  );
  assert.match(note, /1 jam 0 menit/);
  assert.match(note, /800 m berjalan/);
  assert.match(note, /1 kali pindah/);
});

test('report targets only cover remaining journey parts with provenance', () => {
  const stopA = {
    mobility_entity_id: '11111111-1111-4111-8111-111111111111',
    entity_type: 'STOP',
    otp_entity_id: 'tj:stop-a',
    provenance_ref: 'gtfs:route-6H:stop-a',
  };
  const routeB = {
    mobility_entity_id: '22222222-2222-4222-8222-222222222222',
    entity_type: 'ROUTE',
    provenance_ref: '',
  };
  const journey = {
    segments: [
      {
        sequence: 0,
        mode: 'TRANSJAKARTA',
        route_short_name: '6H',
        from: { name: 'Gambir' },
        to: { name: 'Sarinah' },
        entity_bindings: [stopA, routeB],
      },
      {
        sequence: 1,
        mode: 'TRANSJAKARTA',
        route_short_name: '6H',
        from: { name: 'Sarinah' },
        to: { name: 'Pejaten' },
        entity_bindings: [
          { ...stopA, provenance_ref: 'gtfs:route-6H:stop-a-alias' },
        ],
      },
    ],
  };
  const remaining = remainingReportTargets(journey, 0);
  assert.equal(remaining.length, 2, 'stop dedupes, route stays distinct');
  assert.ok(
    remaining.every((target) => target.key === `${target.id}:${target.type}`),
    'Translated labels must never change canonical report target identity',
  );
  assert.equal(
    remaining.filter((t) => t.id === stopA.mobility_entity_id).length,
    1,
    'repeated entity+type dedupes',
  );
  assert.equal(remaining[0].provenance, 'gtfs:route-6H:stop-a');
  assert.match(remaining[0].label, /Gambir – Sarinah/);
  assert.match(remaining[0].label, /kode tj:stop-a/);
  const named = structuredClone(journey);
  named.segments[0].from.otp_stop_id = 'tj:stop-a';
  assert.equal(remainingReportTargets(named, 0)[0].label, 'Gambir · Halte');
  const distinct = structuredClone(journey);
  distinct.segments[0].entity_bindings.push({
    ...stopA,
    mobility_entity_id: '33333333-3333-4333-8333-333333333333',
    otp_entity_id: 'tj:stop-b',
  });
  const labels = remainingReportTargets(distinct, 0)
    .filter((t) => t.type === 'STOP')
    .map((t) => t.label);
  assert.equal(
    new Set(labels).size,
    labels.length,
    'Intermediate stop codes disambiguate targets without invented stop names',
  );
  assert.equal(
    remaining.find((t) => t.type === 'ROUTE').provenance,
    'provenance: tidak tersedia',
  );
  const all = remainingReportTargets(journey, 0);
  assert.equal(
    all.every((target) => ['STOP', 'STATION', 'ROUTE'].includes(target.type)),
    true,
  );
  const afterFirstLeg = remainingReportTargets(journey, 1);
  assert.equal(afterFirstLeg.length, 1, 'only later leg remains');
  assert.equal(remainingReportTargets(journey, 5).length, 0);
});

test('report descriptions trim to validated server bounds', () => {
  assert.equal(isValidReportDescription(' '), false);
  assert.equal(isValidReportDescription('Kondisi haltu banjir.'), true);
  assert.equal(isValidReportDescription('x'.repeat(2001)), false);
  assert.equal(isValidReportDescription('row\u0000'), false);
});

import {
  GPS_MAP_ACCURACY_M,
  GPS_NAVIGATION_ACCURACY_M,
  GPS_STATE,
  GPS_STALE_MS,
  distanceMeters,
  gpsAccuracyTier,
  gpsErrorState,
  gpsFreshness,
  gpsNavigationGrade,
  gpsNext,
  gpsNavigationReady,
  gpsMapReady,
} from './device-location.ts';

const fix = (over = {}) => ({
  latitude: -6.2,
  longitude: 106.8,
  accuracy: 10,
  heading: null,
  timestamp: 1_000,
  ...over,
});
const NOW = 5_000;

test('invalid fixes map to GPS_ERROR and keep the current fix verbatim', () => {
  const current = fix();
  for (const bad of [
    fix({ latitude: Number.NaN }),
    fix({ latitude: 90.5 }),
    fix({ longitude: 200 }),
    fix({ timestamp: NOW + 1 }),
    fix({ timestamp: Number.NaN }),
    fix({ accuracy: -1 }),
  ]) {
    const result = gpsNext(current, bad, NOW);
    assert.equal(result.state, GPS_STATE.GPS_ERROR, JSON.stringify(bad));
    assert.equal(result.sample, current);
  }
});

test('duplicate/regressed fixes ignored; sensor coordinates and accuracy stay paired', () => {
  const current = fix({ timestamp: NOW - 1_000 });
  let next = gpsNext(current, { ...current }, NOW);
  assert.deepEqual(next, { sample: current, state: GPS_STATE.GPS_TRACKING });
  next = gpsNext(current, fix({ timestamp: NOW - 2_000 }), NOW - 1_000);
  assert.equal(next.sample, current);
  next = gpsNext(current, fix({ latitude: -6.20005, timestamp: NOW }), NOW);
  assert.equal(next.state, GPS_STATE.GPS_TRACKING);
  assert.deepEqual(next.sample, {
    ...current,
    latitude: -6.20005,
    timestamp: NOW,
  });
  next = gpsNext(
    fix({ accuracy: 40 }),
    fix({ latitude: -6.20005, timestamp: NOW, accuracy: 10 }),
    NOW,
  );
  assert.deepEqual(
    next.sample,
    fix({ latitude: -6.20005, accuracy: 10, timestamp: NOW }),
  );
  next = gpsNext(
    current,
    fix({ timestamp: NOW + GPS_STALE_MS }),
    NOW + GPS_STALE_MS,
  );
  assert.equal(next.state, GPS_STATE.GPS_TRACKING);
  assert.equal(next.sample.timestamp, NOW + GPS_STALE_MS);
});

test('real movement beyond accuracy advances the fix', () => {
  const moved = gpsNext(
    fix({ timestamp: NOW - 1_000 }),
    fix({ latitude: -6.199, timestamp: NOW }),
    NOW,
  );
  assert.equal(moved.state, GPS_STATE.GPS_TRACKING);
  assert.equal(moved.sample?.latitude, -6.199);
  assert.equal(moved.sample?.timestamp, NOW);
});

test('heading kept only when finite, bounded, and accuracy sufficient', () => {
  const ok = gpsNext(null, fix({ heading: 40 }), NOW);
  assert.equal(ok.sample?.heading, 40);
  for (const heading of [Number.NaN, -0.1, 360]) {
    const out = gpsNext(null, fix({ heading }), NOW);
    assert.equal(out.state, GPS_STATE.GPS_TRACKING, `heading ${heading}`);
    assert.equal(out.sample?.heading, null, `heading ${heading} nulled`);
  }
  const low = gpsNext(null, fix({ heading: 40, accuracy: 2000 }), NOW);
  assert.equal(
    low.state,
    GPS_STATE.GPS_ACCURACY_LOW,
    'accuracy>250m is uncertain',
  );
  assert.equal(low.sample?.heading, null, 'heading dropped at low accuracy');
  const staleLow = gpsFreshness(low.sample, NOW + GPS_STALE_MS);
  assert.equal(staleLow, GPS_STATE.GPS_STALE);
});

test('freshness uses the 30s stale span boundary', () => {
  assert.equal(gpsFreshness(null, NOW), GPS_STATE.GPS_STALE);
  const good = fix({ timestamp: NOW });
  assert.equal(
    gpsFreshness(good, NOW + GPS_STALE_MS - 1),
    GPS_STATE.GPS_TRACKING,
  );
  assert.equal(gpsFreshness(good, NOW + GPS_STALE_MS), GPS_STATE.GPS_STALE);
  // Tiered accuracy: 31–250 m is MAP_CONTEXT, >250 or null is uncertain.
  assert.equal(
    gpsFreshness(fix({ accuracy: 50, timestamp: NOW }), NOW),
    GPS_STATE.GPS_MAP_CONTEXT,
  );
  assert.equal(
    gpsFreshness(fix({ accuracy: 30.5, timestamp: NOW }), NOW),
    GPS_STATE.GPS_MAP_CONTEXT,
  );
  assert.equal(
    gpsFreshness(fix({ accuracy: null, timestamp: NOW }), NOW),
    GPS_STATE.GPS_ACCURACY_LOW,
  );
});

test('geolocation error codes map to exact states', () => {
  assert.equal(gpsErrorState(1), GPS_STATE.GPS_PERMISSION_DENIED);
  assert.equal(gpsErrorState(2), GPS_STATE.GPS_UNAVAILABLE);
  assert.equal(gpsErrorState(3), GPS_STATE.GPS_ERROR);
  assert.equal(gpsErrorState(99), GPS_STATE.GPS_ERROR);
});

test('30s staleness remains a named policy boundary', () => {
  assert.equal(GPS_STALE_MS, 30_000);
});

test('R5-A accuracy tiers separate navigation, map context, and uncertain fixes', () => {
  assert.equal(GPS_NAVIGATION_ACCURACY_M, 30);
  assert.equal(GPS_MAP_ACCURACY_M, 250);
  assert.equal(gpsAccuracyTier(null), 'UNCERTAIN');
  assert.equal(gpsAccuracyTier(-1), 'UNCERTAIN');
  assert.equal(gpsAccuracyTier(Number.NaN), 'UNCERTAIN');
  assert.equal(gpsAccuracyTier(0), 'NAVIGATION');
  assert.equal(gpsAccuracyTier(30), 'NAVIGATION');
  assert.equal(gpsAccuracyTier(30.1), 'MAP_CONTEXT');
  assert.equal(gpsAccuracyTier(250), 'MAP_CONTEXT');
  assert.equal(gpsAccuracyTier(250.1), 'UNCERTAIN');
  assert.equal(gpsNavigationGrade(null), false);
  assert.equal(gpsNavigationGrade(29), true);
  assert.equal(gpsNavigationGrade(31), false);
  // Valid imprecise fixes stay retained for map context: 80 m is map context.
  const fix80 = fix({ accuracy: 80 });
  assert.equal(gpsFreshness(fix80, NOW), GPS_STATE.GPS_MAP_CONTEXT);
  const gps80 = gpsNext(null, fix({ accuracy: 80, heading: 40 }), NOW);
  assert.equal(gps80.state, GPS_STATE.GPS_MAP_CONTEXT);
  assert.equal(gps80.sample?.heading, null);
});

test('haversine sanity: Jakarta to Bandung straight-line ~120km', () => {
  const d = distanceMeters(
    fix(),
    fix({ latitude: -6.914744, longitude: 107.609811 }),
  );
  assert.ok(d > 100_000 && d < 150_000, `actual ${d}`);
});

test('FR-009: coarse-to-precise reacquisition keeps the new position, never old coordinates with false precision', () => {
  const coarse = fix({ accuracy: 200, timestamp: NOW - 1000 });
  const precise = fix({ latitude: -6.199, accuracy: 5, timestamp: NOW });
  assert.deepEqual(gpsNext(coarse, precise, NOW).sample, precise);
});

test('FR-001/009: errors, revocation, future and stale timestamps cannot drive current-location planning', () => {
  const sample = fix({ timestamp: NOW });
  for (const state of [
    'GPS_ERROR',
    'GPS_UNAVAILABLE',
    'GPS_PERMISSION_DENIED',
    'GPS_STOPPED',
    'GPS_STALE',
    'GPS_REQUESTING_PERMISSION',
  ]) {
    assert.equal(gpsNavigationReady(sample, state, NOW), false);
    assert.equal(gpsMapReady(sample, state, NOW), false);
  }
  assert.equal(gpsNavigationReady(sample, 'GPS_TRACKING', NOW), true);
  assert.equal(
    gpsNavigationReady(sample, 'GPS_TRACKING', NOW + GPS_STALE_MS),
    false,
  );
  assert.equal(gpsNavigationReady(sample, 'GPS_TRACKING', NOW - 1), false);
  assert.equal(
    gpsMapReady(fix({ accuracy: 80, timestamp: NOW }), 'GPS_MAP_CONTEXT', NOW),
    true,
  );
  assert.equal(
    gpsNavigationReady(
      fix({ accuracy: 80, timestamp: NOW }),
      'GPS_MAP_CONTEXT',
      NOW,
    ),
    false,
  );
});

test('report history distinguishes simulation, admin review and an unverified claim', () => {
  assert.equal(
    passengerReportStatusLabel('REPORTED_UNVERIFIED'),
    'Belum diverifikasi',
  );
  assert.match(passengerReportStatusLabel('CONTROLLED_VERIFIED'), /SIMULASI/);
  const admin = passengerReportStatusLabel('ADMIN_RESTRICTED');
  assert.match(admin, /admin/);
  assert.doesNotMatch(admin, /SIMULASI|operator|aktif/i);
  assert.equal(
    passengerReportStatusLabel('unknown'),
    'Status pemeriksaan belum tersedia',
  );
});

test('restoring a historical journey retains its persisted progress clock instead of today', () => {
  assert.equal(
    journeyProgressDateTime({
      start_at: '2026-10-02T08:00:00+07:00',
      progress: { recorded_at: '2026-10-02T08:13:00+07:00' },
    }),
    '2026-10-02T08:13',
  );
  assert.equal(
    journeyProgressDateTime({ start_at: '2026-10-02T08:00:00+07:00' }),
    '2026-10-02T08:00',
  );
});

test('operator website checks never fabricate arrivals from a reachable webpage', async () => {
  const { checkOperatorScheduleSources } =
    await import('./operator-schedule-sources.ts');
  const calls = [];
  const rows = await checkOperatorScheduleSources(async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 200 });
  });
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (x) => x.options.method === 'HEAD' && x.options.redirect === 'error',
    ),
  );
  assert.ok(
    rows.every(
      (x) =>
        x.website_reachable &&
        x.arrival_status === 'NOT_CONNECTED' &&
        x.arrivals.length === 0,
    ),
  );
});

test('journey progress clock preserves seconds and milliseconds before direct advance', () => {
  for (const stamp of [
    '2026-10-02T01:02:37.000Z',
    '2026-10-02T01:02:00.123Z',
  ]) {
    const value = journeyProgressDateTime({
      start_at: stamp,
      progress: { recorded_at: stamp },
    });
    assert.equal(Date.parse(toJakartaIso(value)), Date.parse(stamp));
  }
});
