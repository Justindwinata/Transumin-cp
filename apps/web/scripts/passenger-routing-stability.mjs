import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { assertCp2Runtime } from './cp2-runtime-guard.mjs';

await assertCp2Runtime();
const web = process.env.PASSENGER_WEB_URL;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PRODUCT_P1R_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const summary = {
  status: 'NOT VERIFIED',
  evidence:
    'SCHEDULED historical 2026-10-02; bounded canonical corridors, not universal coverage',
  cases: [],
  modes: [],
  mixedModeCases: 0,
};
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { origin: new URL(web).origin },
  });
  const config = await context.request.get(`${web}/api/passenger/config`);
  assert.equal(config.status(), 200);
  const snapshot = (await config.json()).data.network_snapshot_id;
  const resolve = async (q, mode) => {
    const response = await context.request.get(
      `${web}/api/passenger/transit/places`,
      { params: { q, snapshot_id: snapshot, limit: 25 } },
    );
    assert.equal(response.status(), 200);
    const rows = (await response.json()).data;
    const matching = rows.filter((p) => !mode || p.product_mode === mode);
    const result =
      matching.find((p) => p.name.toLowerCase() === q.toLowerCase()) ??
      matching.find((p) => p.name.toLowerCase().startsWith(q.toLowerCase()));
    assert.ok(result, `Canonical place missing: ${q} / ${mode}`);
    return result;
  };
  const pairs = [
    ['Gambir', 'Pejaten', 'TRANSJAKARTA'],
    ['Bogor', 'Cilebut', 'KRL'],
    ['Lebak Bulus Bank Syariah Indonesia', 'Fatmawati', 'MRT_JAKARTA'],
    ['Kelapa Gading', 'Velodrome', 'LRT_JAKARTA'],
    ['Harjamukti', 'Ciracas', 'LRT_JABODEBEK'],
    ['Term. Tj. Priok 2', 'Telkom Tj. Priok', 'MIKROTRANS'],
    ['Mall Kelapa Gading', 'Emporium', null],
  ];
  const seen = new Set();
  for (const [from, to, mode] of pairs) {
    const origin = await resolve(from, mode);
    const destination = await resolve(to, mode);
    for (const preference of [
      'BALANCED',
      'FASTEST',
      'FEWEST_TRANSFERS',
      'LEAST_WALKING',
    ]) {
      const response = await context.request.post(
        `${web}/api/passenger/journeys/plan`,
        {
          data: {
            origin: { latitude: origin.latitude, longitude: origin.longitude },
            destination: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
            departure_at: '2026-10-02T08:00:00+07:00',
            network_snapshot_id: snapshot,
            preference,
          },
          timeout: 120000,
        },
      );
      assert.equal(
        response.status(),
        201,
        `${from} → ${to} ${preference}: ${response.status()} ${JSON.stringify(await response.json()).slice(0, 300)}`,
      );
      const journeys = (await response.json()).data;
      assert.ok(journeys.length > 0);
      for (const journey of journeys) {
        assert.ok(
          Number.isFinite(journey.duration_seconds) &&
            journey.duration_seconds >= 0,
        );
        assert.ok(
          Number.isFinite(journey.walking_distance_meters) &&
            journey.walking_distance_meters >= 0,
        );
        assert.equal(
          journey.transfer_count,
          Math.max(
            0,
            journey.segments.filter((s) => s.mode !== 'WALK').length - 1,
          ),
        );
        assert.ok(journey.segments.length > 0);
        for (let i = 0; i < journey.segments.length; i++) {
          const leg = journey.segments[i];
          seen.add(leg.mode);
          assert.equal(leg.sequence, i);
          assert.ok(Date.parse(leg.end_at) >= Date.parse(leg.start_at));
          if (i > 0)
            assert.ok(
              Date.parse(leg.start_at) >=
                Date.parse(journey.segments[i - 1].end_at),
              'broken temporal connection',
            );
        }
        if (
          new Set(
            journey.segments
              .filter((s) => s.mode !== 'WALK')
              .map((s) => s.mode),
          ).size >= 2
        )
          summary.mixedModeCases++;
      }
      const metric = {
        FASTEST: 'duration_seconds',
        FEWEST_TRANSFERS: 'transfer_count',
        LEAST_WALKING: 'walking_distance_meters',
      }[preference];
      if (metric)
        assert.equal(
          journeys[0][metric],
          Math.min(...journeys.map((j) => j[metric])),
        );
      const row = {
        from: origin.name,
        to: destination.name,
        preference,
        status: 'PASS',
        alternatives: journeys.map((j) => ({
          modes: j.segments.map((s) => s.mode),
          duration: j.duration_seconds,
          walking: j.walking_distance_meters,
          transfers: j.transfer_count,
        })),
      };
      summary.cases.push(row);
      console.log(JSON.stringify({ from, to, preference, status: 'PASS' }));
    }
  }
  summary.modes = [...seen].sort();
  for (const mode of [
    'WALK',
    'TRANSJAKARTA',
    'MIKROTRANS',
    'KRL',
    'MRT_JAKARTA',
    'LRT_JAKARTA',
    'LRT_JABODEBEK',
  ])
    assert.ok(seen.has(mode), `No real route evidence for ${mode}`);
  assert.ok(
    summary.mixedModeCases > 0,
    'No mixed transit journey found; do not invent a combination',
  );
  const outside = await context.request.post(
    `${web}/api/passenger/journeys/plan`,
    {
      data: {
        origin: { latitude: 0, longitude: 0 },
        destination: { latitude: -6.2, longitude: 106.8 },
        departure_at: '2026-10-02T08:00:00+07:00',
        network_snapshot_id: snapshot,
        preference: 'BALANCED',
      },
      timeout: 120000,
    },
  );
  assert.ok(
    [400, 422].includes(outside.status()),
    `Out-of-coverage must be a typed domain failure, got ${outside.status()}`,
  );
  summary.outsideCoverageStatus = outside.status();
  summary.status = 'PASS';
  await context.close();
} finally {
  await writeFile(
    join(process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR, 'routing-stability.json'),
    JSON.stringify(summary, null, 2),
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    status: summary.status,
    cases: summary.cases.length,
    modes: summary.modes,
    mixedModeCases: summary.mixedModeCases,
  }),
);
