import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OFF_ROUTE_HISTORY,
  initialWalkProgress,
  isOffRoute,
  modeNavLabel,
  navigationMode,
  nextGuidance,
  pathPoints,
  prepareWalkNavigation,
  updateWalkProgress,
} from './navigation.ts';

function segWalk(overrides = {}) {
  return {
    sequence: 0,
    mode: 'WALK',
    from: { name: 'Dari' },
    to: { name: 'Ke' },
    route_short_name: null,
    geometry: {
      type: 'LineString',
      coordinates: [
        [106.81, -6.2],
        [106.82, -6.21],
        [106.83, -6.2],
      ],
    },
    ...overrides,
  };
}
function segBus(seq = 1, mode = 'TRANSJAKARTA', name = '6H') {
  return {
    sequence: seq,
    mode,
    from: { name: `Stasiun ${seq}` },
    to: { name: `Stasiun ${seq + 1}` },
    route_short_name: name,
    geometry: {
      type: 'LineString',
      coordinates: [
        [106.81, -6.2],
        [106.83, -6.2],
      ],
    },
  };
}

describe('F-04 navigation', () => {
  it('navigationMode covers every required state', () => {
    assert.equal(
      navigationMode([], 0, { boarded: false, alighted: false }),
      'ARRIVED',
    );
    assert.equal(
      navigationMode([], 1, { boarded: false, alighted: false }),
      'ARRIVED',
    );
    const seg = segWalk();
    const transit = segBus(0);
    assert.equal(
      navigationMode([seg, transit], 0, { boarded: false, alighted: false }),
      'WALK_TO_BOARDING_STOP',
    );
    assert.equal(
      navigationMode([transit, segWalk({ sequence: 1 })], 0, {
        boarded: false,
        alighted: false,
      }),
      'WAIT_FOR_TRANSIT',
    );
    assert.equal(
      navigationMode([transit], 0, { boarded: true, alighted: false }),
      'ON_TRANSIT_CONFIRMED',
    );
    assert.equal(
      navigationMode([transit, seg], 0, { boarded: true, alighted: true }),
      'ALIGHTING_PENDING',
    );
    assert.equal(
      navigationMode([seg, transit, segWalk({ sequence: 2 })], 1, {
        boarded: false,
        alighted: false,
      }),
      'WAIT_FOR_TRANSIT',
    );
    assert.equal(
      navigationMode([segWalk({ sequence: 0 }), segWalk({ sequence: 1 })], 1, {
        boarded: false,
        alighted: false,
      }),
      'WALK_TO_DESTINATION',
    );
    assert.equal(modeNavLabel('WALK_TO_BOARDING_STOP'), 'Jalan menuju halte');
    assert.equal(modeNavLabel('WAIT_FOR_TRANSIT'), 'Menunggu transportasi');
    assert.equal(
      modeNavLabel('NAVIGATION_UNAVAILABLE'),
      'Navigasi tidak tersedia',
    );
  });

  it('distinguishes boarding target from alighting target, including the last leg', () => {
    const leg = segBus(0, 'LRT_JABODEBEK', 'LRT_JABODEBEK');
    const waiting = nextGuidance([leg], 0, { boarded: false, alighted: false });
    assert.equal(waiting.destination, leg.from.name);
    assert.equal(waiting.title, 'Menunggu LRT Jabodebek');
    const riding = nextGuidance([leg], 0, { boarded: true, alighted: false });
    assert.equal(riding.destination, leg.to.name);
    const alighted = nextGuidance([leg], 0, { boarded: true, alighted: true });
    assert.equal(alighted.mode, 'ALIGHTING_PENDING');
    assert.equal(
      navigationMode([leg], 0, { boarded: true, alighted: true }),
      alighted.mode,
    );
    assert.equal(alighted.title, 'Turun sudah dikonfirmasi');
    assert.match(alighted.detail, /sudah menandai turun/);
  });

  it('walking guidance never fabricates a turn street name', () => {
    const segments = [segWalk()];
    const guidance = nextGuidance(
      segments,
      0,
      { boarded: false, alighted: false },
      null,
    );
    assert.ok(guidance);
    assert.ok(
      !/(belok kanan|belok kiri|turn left|turn right|keep left|keep right)/i.test(
        guidance.detail,
      ),
    );
    assert.equal(guidance.provenance, 'SCHEMATIC_GEOMETRY');
    assert.ok(/skematik/i.test(guidance.detail));
  });

  it('walking distances decrease with fresh SIMULATED fixes in TRACKING state', () => {
    const segment = segWalk({
      geometry: {
        type: 'LineString',
        coordinates: [
          [106.81, -6.2],
          [106.811, -6.2],
          [106.812, -6.2],
        ],
      },
      walking_steps: [
        {
          latitude: -6.2,
          longitude: 106.81,
          distance_meters: 110.5,
          relative_direction: 'DEPART',
          absolute_direction: null,
          street_name: null,
          bogus_name: false,
          area: false,
          stay_on: false,
        },
        {
          latitude: -6.2,
          longitude: 106.811,
          distance_meters: 110.5,
          relative_direction: 'RIGHT',
          absolute_direction: null,
          street_name: null,
          bogus_name: false,
          area: false,
          stay_on: false,
        },
      ],
    });
    const navigation = prepareWalkNavigation(segment);
    assert.equal(navigation?.evidence, 'OTP_DERIVED_MANEUVER');
    const boarding = { boarded: false, alighted: false };
    let progress = initialWalkProgress();
    let previous = null;
    for (const [index, longitude] of [
      106.81, 106.8101, 106.8102, 106.8103,
    ].entries()) {
      const timestamp = 1000 + index * 10_000;
      const before = progress;
      progress = updateWalkProgress(
        navigation,
        progress,
        {
          latitude: -6.2,
          longitude,
          accuracy: 5,
          timestamp,
        },
        timestamp,
      );
      if (index === 0) {
        assert.equal(progress.status, 'ACQUIRING');
        continue;
      }
      assert.equal(progress.status, 'TRACKING');
      assert.ok(progress.alongMeters > before.alongMeters);
      assert.equal(progress.maneuverIndex, 0);
      const guidance = nextGuidance([segment], 0, boarding, progress);
      assert.equal(guidance.progressStatus, 'TRACKING');
      assert.equal(guidance.mode, 'WALK_TO_DESTINATION');
      assert.equal(
        guidance.remainingMeters,
        navigation.path.length - progress.alongMeters,
      );
      assert.equal(
        guidance.nextDistanceMeters,
        navigation.maneuvers[1].alongMeters - progress.alongMeters,
      );
      if (previous) {
        assert.ok(guidance.remainingMeters < previous.remainingMeters);
        assert.ok(guidance.nextDistanceMeters < previous.nextDistanceMeters);
      }
      previous = guidance;
    }
    assert.deepEqual(boarding, { boarded: false, alighted: false });
  });

  it('one noisy sample never reports off-route; sustained does', () => {
    const path = pathPoints(segWalk());
    assert.ok(path);
    const noisy = [{ distance: null }];
    assert.equal(isOffRoute(noisy, path), false);
    assert.equal(isOffRoute([{ distance: 200 }], path), false);
    assert.equal(
      isOffRoute(
        [{ distance: 130 }, { distance: 130 }, { distance: 130 }],
        path,
      ),
      true,
    );
  });

  it('OFF_ROUTE_HISTORY bounds growth', () => {
    assert.ok(OFF_ROUTE_HISTORY >= 3);
  });
});
