import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  makeMonotonicTimes,
  validateControlledRoutingRepresentation,
} from './domain/controlled-routing.js';
import {
  medianHeadwaySeconds,
  parseLrtJabodebekTimetableHtml,
} from './sources/lrt-jabodebek.js';
import { parseKrlPositionedRows } from './sources/krl-gapeka.js';
import {
  namespaceId,
  originalId,
  productModeForRouterEntity,
  serviceCalendarApplies,
  validateServiceDatePolicies,
} from './domain/otp-input.js';

describe('Phase 4A-R controlled routing data', () => {
  it('preserves after-midnight ordering without inventing missing calls', () => {
    assert.deepEqual(makeMonotonicTimes(['23:55', null, '00:10']), [
      86_100,
      null,
      87_000,
    ]);
  });

  it('rejects duplicate exact service IDs and temporally invalid trips', () => {
    const result = validateControlledRoutingRepresentation({
      mode: 'KRL',
      sourceId: 'fixture',
      sourceChecksum: 'a'.repeat(64),
      sourceRetrievedAt: '2026-10-01T00:00:00Z',
      precision: 'EXACT_SCHEDULE',
      exactTrips: [
        {
          serviceId: '1001',
          relation: 'A-B',
          serviceCalendar: 'DAILY',
          stopTimes: [
            { stopId: 'A', timeSeconds: 100, passThrough: false },
            { stopId: 'B', timeSeconds: 90, passThrough: false },
          ],
        },
        {
          serviceId: '1001',
          relation: 'B-A',
          serviceCalendar: 'DAILY',
          stopTimes: [
            { stopId: 'B', timeSeconds: 200, passThrough: false },
            { stopId: 'A', timeSeconds: 300, passThrough: false },
          ],
        },
      ],
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes('Duplicate service ID')),
    );
    assert.ok(
      result.errors.some((error) => error.includes('not temporally ordered')),
    );
  });

  it('maps KRL PDF cells by source column without shifting omitted stops', () => {
    const parsed = parseKrlPositionedRows(
      [
        { text: 'AAA', x: 100, y: 500 },
        { text: 'BBB', x: 120, y: 500 },
        { text: 'CCC', x: 140, y: 500 },
      ],
      [
        [
          { text: '1001F', x: 40, y: 490 },
          { text: 'Aaa-Ccc', x: 60, y: 490 },
          { text: '23:55', x: 100, y: 490 },
          { text: '00:10', x: 140, y: 490 },
        ],
      ],
    );
    assert.equal(parsed.rejectedRows.length, 0);
    assert.deepEqual(parsed.trips[0]?.stopTimes, [
      { stopId: 'AAA', timeSeconds: 86_100, passThrough: false },
      { stopId: 'CCC', timeSeconds: 87_000, passThrough: false },
    ]);
    assert.equal(parsed.trips[0]?.serviceCalendar, 'WEEKDAY');
  });

  it('accounts for clock-like KRL annotations outside the station grid', () => {
    const parsed = parseKrlPositionedRows(
      [
        { text: 'AAA', x: 100, y: 500 },
        { text: 'BBB', x: 120, y: 500 },
      ],
      [
        [
          { text: '1001', x: 40, y: 490 },
          { text: 'Aaa-Bbb', x: 60, y: 490 },
          { text: '05:00', x: 100, y: 490 },
          { text: '05:10', x: 120, y: 490 },
          { text: '05:17', x: 180, y: 490 },
        ],
      ],
    );
    assert.equal(parsed.rejectedRows.length, 0);
    assert.equal(parsed.trips[0]?.stopTimes.length, 2);
    assert.deepEqual(parsed.ignoredOutsideStationGridCells, [
      'page=1;service=1001;value=05:17;reason=OUTSIDE_STATION_GRID',
    ]);
  });

  it('parses station-scoped LRT Jabodebek departures without pairing trains', () => {
    const html = `
      <button id="pills-alpha-tab" aria-selected="true">Alpha</button>
      <div class="tab-pane fade show active" id="pills-alpha">
        <h3>Jam Keberangkatan Hari Biasa</h3>
        <table><small>05:00</small><small>05:10</small></table>
        <h3>Jam Keberangkatan Hari Libur</h3>
        <table><small>06:00</small><small>06:15</small></table>
      </div>`;
    const parsed = parseLrtJabodebekTimetableHtml(html);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.displayedTimeCount, 4);
    assert.equal(
      medianHeadwaySeconds(parsed.departureSets[0]?.departures ?? []),
      600,
    );
  });

  it('keeps frequency-derived timing explicit and reports pass-through stations', () => {
    const result = validateControlledRoutingRepresentation({
      mode: 'LRT_JAKARTA',
      sourceId: 'fixture',
      sourceChecksum: 'b'.repeat(64),
      sourceRetrievedAt: '2026-10-01T00:00:00Z',
      precision: 'FREQUENCY_DERIVED',
      frequencyPatterns: [
        {
          id: 'limited-service',
          direction: 'A-C',
          stops: [
            { id: 'A', name: 'A' },
            { id: 'B', name: 'B', boardingAllowed: false },
            { id: 'C', name: 'C' },
          ],
          endToEndSeconds: 1_680,
          windows: [
            {
              serviceCalendar: 'DAILY',
              startSeconds: 19_800,
              endSeconds: 72_000,
              headwaySeconds: 900,
            },
          ],
          travelTimeBasis: 'OFFICIAL_END_TO_END_WITH_UNIFORM_INTERPOLATION',
        },
      ],
    });
    assert.equal(result.valid, true);
    assert.equal(result.frequencyPatternCount, 1);
    assert.equal(result.warnings.length, 1);
  });

  it('uses deterministic collision-safe namespaces and preserves original IDs', () => {
    const tj = namespaceId('tj', 'stop', 'shared:01');
    const mikro = namespaceId('mikro', 'stop', 'shared:01');
    assert.notEqual(tj, mikro);
    assert.equal(originalId(tj), 'shared:01');
    assert.equal(namespaceId('tj', 'stop', 'shared:01'), tj);
  });

  it('resolves generic OTP categories through feed identity', () => {
    assert.equal(
      productModeForRouterEntity({ feedKey: 'tj', otpMode: 'BUS' }),
      'TRANSJAKARTA',
    );
    assert.equal(
      productModeForRouterEntity({ feedKey: 'mikro', otpMode: 'BUS' }),
      'MIKROTRANS',
    );
    assert.equal(
      productModeForRouterEntity({ feedKey: 'krl', otpMode: 'RAIL' }),
      'KRL',
    );
    assert.equal(
      productModeForRouterEntity({ feedKey: 'mrt', otpMode: 'SUBWAY' }),
      'MRT_JAKARTA',
    );
  });

  it('requires an explicit Asia/Jakarta temporal policy for every feed', () => {
    const policies = ['tj', 'mikro', 'krl', 'mrt', 'lrtj', 'lrtjb'].map(
      (feedKey) => ({
        feedKey,
        timezone: 'Asia/Jakarta',
        representativeDate: '2026-10-02',
        applicability: 'controlled fixture',
      }),
    );
    assert.deepEqual(validateServiceDatePolicies(policies as never), []);
    assert.ok(
      validateServiceDatePolicies(policies.slice(1) as never).some((error) =>
        error.includes('Missing feed policy: tj'),
      ),
    );
    assert.ok(
      validateServiceDatePolicies([
        ...policies.slice(0, -1),
        { ...policies.at(-1), representativeDate: '2025-02-03' },
      ] as never).some((error) =>
        error.includes('one common representative date'),
      ),
    );
  });

  it('activates rail calendar classes using the representative local weekday', () => {
    assert.equal(serviceCalendarApplies('WEEKDAY', 5), true);
    assert.equal(serviceCalendarApplies('WEEKEND', 5), false);
    assert.equal(serviceCalendarApplies('WEEKEND', 6), true);
    assert.equal(serviceCalendarApplies('DAILY', 5), true);
  });
});
