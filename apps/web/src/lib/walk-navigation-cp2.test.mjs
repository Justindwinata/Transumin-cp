import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertCp2Identity } from '../../scripts/cp2-runtime-guard.mjs';
import {
  OTP_RELATIVE_DIRECTIONS,
  directionLabel,
  initialWalkProgress,
  isOffRoute,
  manuallyAdvanceManeuver,
  navigationMode,
  navigationScopeKey,
  nextGuidance,
  preparePath,
  prepareWalkNavigation,
  projectOnPath,
  updateWalkProgress,
} from './navigation.ts';

const base = {
  sequence: 0,
  mode: 'WALK',
  from: { name: 'Start', latitude: -6.2, longitude: 106.81 },
  to: { name: 'Tujuan', latitude: -6.2, longitude: 106.811 },
  geometry: {
    type: 'LineString',
    coordinates: [
      [106.81, -6.2],
      [106.8105, -6.2],
      [106.811, -6.2],
    ],
  },
  walking_steps: [
    {
      latitude: -6.2,
      longitude: 106.81,
      distance_meters: 55,
      relative_direction: 'DEPART',
      absolute_direction: null,
      street_name: 'A',
      bogus_name: false,
      area: false,
      stay_on: false,
    },
    {
      latitude: -6.2,
      longitude: 106.8105,
      distance_meters: 55,
      relative_direction: 'RIGHT',
      absolute_direction: null,
      street_name: 'B',
      bogus_name: false,
      area: false,
      stay_on: false,
    },
  ],
};

const fix = (longitude, timestamp, accuracy = 5) => ({
  latitude: -6.2,
  longitude,
  accuracy,
  timestamp,
});

function prepared() {
  const result = prepareWalkNavigation(base);
  assert.equal(result?.evidence, 'OTP_DERIVED_MANEUVER');
  return result;
}

describe('CP2 runtime guard fail-closed contract', () => {
  const base = {
    name: `tnx_cp2_${'a'.repeat(32)}`,
    marker: `tnx_cp2:${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}`,
    oid: 16384,
    owner: 'scratch_owner',
    invocation: `${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}`,
  };
  const ok = {
    name: base.name,
    oid: base.oid,
    owner: base.owner,
    marker: base.marker,
  };
  it('rejects mismatched realized DB identity and identity not derived from invocation', () => {
    assert.throws(() =>
      assertCp2Identity(base, { ...ok, name: 'transum_in_nexus_product' }),
    );
    assert.throws(() => assertCp2Identity(base, { ...ok, marker: '' }));
    assert.throws(() =>
      assertCp2Identity(base, { ...ok, owner: 'someone_else' }),
    );
    assert.throws(() => assertCp2Identity(base, { ...ok, oid: 0 }));
    assert.throws(() =>
      assertCp2Identity({ ...base, name: 'tnx_cp2_wrong' }, ok),
    );
    assert.throws(() =>
      assertCp2Identity({ ...base, marker: 'tnx-cp2:wrong' }, ok),
    );
    assert.throws(() =>
      assertCp2Identity({ ...base, invocation: 'not-a-uuid' }, ok),
    );
  });
  it('accepts fully-derived invocation-owned identity', () => {
    assert.doesNotThrow(() => assertCp2Identity(base, ok));
  });
});

describe('CP2 walking_steps navigation', () => {
  it('uses cumulative haversine projection and self-crossing hint', () => {
    const path = preparePath([
      { latitude: -6.2, longitude: 106.81 },
      { latitude: -6.2, longitude: 106.8105 },
      { latitude: -6.2, longitude: 106.811 },
    ]);
    assert.ok(path);
    const result = projectOnPath(
      { latitude: -6.2, longitude: 106.81075 },
      path,
      80,
    );
    assert.ok(result);
    assert.ok(result.alongMeters > 70 && result.alongMeters < 90);
    assert.ok(result.crossTrackMeters < 1);
    assert.equal(
      preparePath([
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ]),
      null,
    );
  });

  it('rejects unsupported direction, area, bad mode, and malformed series to schematic', () => {
    assert.equal(prepareWalkNavigation({ ...base, mode: 'BUS' }), null);
    assert.equal(
      prepareWalkNavigation({
        ...base,
        walking_steps: [
          { ...base.walking_steps[0], relative_direction: 'UNKNOWN' },
          base.walking_steps[1],
        ],
      }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    assert.equal(
      prepareWalkNavigation({
        ...base,
        walking_steps: [
          { ...base.walking_steps[0], area: true },
          base.walking_steps[1],
        ],
      }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    assert.equal(
      prepareWalkNavigation({
        ...base,
        walking_steps: [
          { ...base.walking_steps[0], relative_direction: 'RIGHT' },
          base.walking_steps[1],
        ],
      }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    assert.equal(
      prepareWalkNavigation({
        ...base,
        walking_steps: [
          { ...base.walking_steps[0], latitude: NaN },
          base.walking_steps[1],
        ],
      }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
  });

  it('requires two fresh reliable fixes, rejects stale/invalid/duplicate fixes, and resets on pause', () => {
    const nav = prepared();
    let state = initialWalkProgress();
    state = updateWalkProgress(nav, state, fix(106.81, 1000), 2000);
    assert.equal(state.status, 'ACQUIRING');
    const duplicate = updateWalkProgress(nav, state, fix(106.81, 1000), 2000);
    assert.deepEqual(duplicate, state);
    const invalid = updateWalkProgress(nav, state, fix(NaN, 1100), 2000);
    assert.equal(invalid.status, 'UNCERTAIN');
    state = updateWalkProgress(nav, state, fix(106.81, 1100), 2000);
    assert.equal(state.status, 'TRACKING');
    const paused = updateWalkProgress(
      nav,
      state,
      fix(106.81, 1200),
      2000,
      true,
    );
    assert.deepEqual(paused, {
      ...state,
      reliableFixes: 0,
      alongMeters: null,
      lastTimestamp: null,
      status: 'PAUSED',
    });
    const stale = updateWalkProgress(nav, state, fix(106.81, 1100), 40_000);
    assert.equal(stale.status, 'UNCERTAIN');
  });

  it('advances at most one maneuver with turn hysteresis and no stationary jump', () => {
    const nav = prepared();
    let state = updateWalkProgress(
      nav,
      initialWalkProgress(),
      fix(106.81, 1000),
      2000,
    );
    state = updateWalkProgress(nav, state, fix(106.81, 1100), 2000);
    assert.equal(state.maneuverIndex, 0);
    // Need realistic elapsed to bound jump: 55 m segment needs ~24 s at 3 m/s.
    const still = updateWalkProgress(nav, state, fix(106.8106, 26000), 27000);
    assert.equal(still.maneuverIndex, 1);
    const repeated = updateWalkProgress(
      nav,
      still,
      fix(106.8106, 26100),
      27000,
    );
    assert.equal(repeated.maneuverIndex, 1);
  });

  it('bounds jump, tolerates jitter, keeps arrival manual, and includes final walk off-route', () => {
    const nav = prepared();
    let state = updateWalkProgress(
      nav,
      initialWalkProgress(),
      fix(106.81, 1000),
      2000,
    );
    state = updateWalkProgress(nav, state, fix(106.81, 1100), 2000);
    const jump = updateWalkProgress(nav, state, fix(106.811, 1110), 2000);
    assert.equal(jump.status, 'UNCERTAIN');
    const jitter = updateWalkProgress(nav, state, fix(106.81, 1200, 10), 2000);
    assert.equal(jitter.status, 'TRACKING');
    assert.equal(jitter.maneuverIndex, 0);
    assert.equal(
      isOffRoute(
        [{ distance: 130 }, { distance: 130 }, { distance: 130 }],
        nav.path.points,
      ),
      true,
    );
  });

  it('validates every OTP direction by own key and rejects inherited properties', () => {
    assert.deepEqual(OTP_RELATIVE_DIRECTIONS, [
      'DEPART',
      'CONTINUE',
      'LEFT',
      'RIGHT',
      'SLIGHTLY_LEFT',
      'SLIGHTLY_RIGHT',
      'HARD_LEFT',
      'HARD_RIGHT',
      'UTURN_LEFT',
      'UTURN_RIGHT',
      'CIRCLE_CLOCKWISE',
      'CIRCLE_COUNTERCLOCKWISE',
      'ELEVATOR',
      'ENTER_STATION',
      'EXIT_STATION',
      'FOLLOW_SIGNS',
    ]);
    for (const direction of OTP_RELATIVE_DIRECTIONS)
      assert.equal(typeof directionLabel(direction), 'function');
    assert.equal(directionLabel('toString'), null);
    assert.equal(directionLabel('__proto__'), null);
    for (const direction of ['toString', '__proto__']) {
      const bad = [
        { ...base.walking_steps[0], relative_direction: direction },
        base.walking_steps[1],
      ];
      assert.equal(
        prepareWalkNavigation({ ...base, walking_steps: bad }).evidence,
        'SCHEMATIC_GEOMETRY',
      );
    }
  });

  it('keeps accepted walking instruction structures and trusted distance coherent', () => {
    const navigation = prepared();
    const tracking = {
      ...initialWalkProgress(),
      status: 'TRACKING',
      reliableFixes: 2,
      alongMeters: 40,
    };
    const guidance = nextGuidance(
      [base],
      0,
      { boarded: false, alighted: false },
      tracking,
    );
    assert.equal(guidance?.mode, 'WALK_TO_DESTINATION');
    assert.equal(guidance?.remainingMeters, navigation.path.length - 40);
    assert.equal(
      guidance?.nextInstruction,
      navigation.maneuvers[1]?.instruction,
    );
    const transit = { ...base, mode: 'BUS' };
    assert.equal(
      navigationMode([base, transit], 0, { boarded: false, alighted: false }),
      'WALK_TO_BOARDING_STOP',
    );
    assert.equal(
      navigationMode([base], 0, { boarded: false, alighted: false }),
      'WALK_TO_DESTINATION',
    );
    assert.equal(
      nextGuidance([base], 1, { boarded: false, alighted: false })?.mode,
      'ARRIVED',
    );
    assert.equal(
      nextGuidance([transit], 0, { boarded: false, alighted: false })?.mode,
      'WAIT_FOR_TRANSIT',
    );
  });

  it('falls back for missing or malformed walking steps and accepts short valid turns', () => {
    assert.equal(
      prepareWalkNavigation({ ...base, walking_steps: undefined }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    assert.equal(
      prepareWalkNavigation({ ...base, walking_steps: null }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    assert.equal(
      prepareWalkNavigation({
        ...base,
        walking_steps: [
          { ...base.walking_steps[0], distance_meters: Infinity },
          base.walking_steps[1],
        ],
      }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    const short = {
      ...base,
      geometry: {
        type: 'LineString',
        coordinates: [
          [106.81, -6.2],
          [106.8101, -6.2],
          [106.8102, -6.2],
        ],
      },
      walking_steps: [
        { ...base.walking_steps[0], distance_meters: 11.1 },
        {
          ...base.walking_steps[1],
          longitude: 106.8101,
          distance_meters: 11.1,
        },
      ],
    };
    assert.equal(
      prepareWalkNavigation(short)?.evidence,
      'OTP_DERIVED_MANEUVER',
    );
  });

  it('keeps initial far-ahead acquisition manual and lets rejected jumps reacquire without skipping', () => {
    const nav = prepared();
    let state = updateWalkProgress(
      nav,
      initialWalkProgress(),
      fix(106.8109, 1000),
      2000,
    );
    state = updateWalkProgress(nav, state, fix(106.8109, 1100), 2000);
    assert.equal(state.status, 'TRACKING');
    assert.equal(state.maneuverIndex, 0);
    assert.equal(state.needsManualReposition, true);
    assert.equal(
      nextGuidance([base], 0, { boarded: false, alighted: false }, state)
        ?.title,
      'Reposisi diperlukan',
    );
    state = manuallyAdvanceManeuver(nav, state);
    assert.equal(state.maneuverIndex, 1);
    assert.equal(state.needsManualReposition, false);
    let atStart = updateWalkProgress(
      nav,
      initialWalkProgress(),
      fix(106.81, 1000),
      2000,
    );
    atStart = updateWalkProgress(nav, atStart, fix(106.81, 1100), 2000);
    const rejected = updateWalkProgress(nav, atStart, fix(106.811, 1200), 2000);
    assert.equal(rejected.status, 'UNCERTAIN');
    assert.equal(rejected.alongMeters, null);
    const reacquired = updateWalkProgress(
      nav,
      rejected,
      fix(106.8102, 1300),
      2000,
    );
    assert.equal(reacquired.status, 'ACQUIRING');
    assert.equal(reacquired.maneuverIndex, 0);
  });

  it('R6-C rejects whole invalid series without partial turns or GPS advancement', () => {
    // SAMPLE: valid first step must not survive invalid second step.
    for (const walking_steps of [
      undefined,
      [],
      [
        base.walking_steps[0],
        { ...base.walking_steps[1], distance_meters: -1 },
      ],
      [base.walking_steps[0], { ...base.walking_steps[1], longitude: 181 }],
      [
        base.walking_steps[0],
        { ...base.walking_steps[1], relative_direction: 'UNKNOWN' },
      ],
    ]) {
      const segment = { ...base, walking_steps };
      const navigation = prepareWalkNavigation(segment);
      assert.equal(navigation.evidence, 'SCHEMATIC_GEOMETRY');
      assert.deepEqual(navigation.maneuvers, []);
      assert.ok(navigation.reason);
      const progress = updateWalkProgress(
        navigation,
        initialWalkProgress(),
        fix(106.8106, 1000),
        2000,
      );
      assert.equal(progress.status, 'UNCERTAIN');
      assert.equal(progress.maneuverIndex, 0);
      assert.equal(progress.alongMeters, null);
      const guidance = nextGuidance(
        [segment],
        0,
        { boarded: false, alighted: false },
        progress,
      );
      assert.equal(guidance.provenance, 'SCHEMATIC_GEOMETRY');
      assert.equal(guidance.nextInstruction, null);
      assert.equal(guidance.nextDistanceMeters, null);
      assert.equal(guidance.remainingMeters, null);
      assert.doesNotMatch(guidance.title, /Belok| ke A| ke B/i);
    }
  });

  it('R6-C changed recovery leg structure uses active schematic suffix, not old turns', () => {
    // SAMPLE: completed transit plus old transfer WALK; repair removes later transit.
    const completed = { ...base, mode: 'TRANSJAKARTA' };
    const oldWalk = { ...base, sequence: 1 };
    const original = [completed, oldWalk, { ...completed, sequence: 2 }];
    const repaired = {
      ...oldWalk,
      to: { ...base.to, name: 'Tujuan pengganti' },
      walking_steps: [],
    };
    const recovered = [completed, repaired];
    const boarding = { boarded: false, alighted: false };
    assert.equal(nextGuidance(original, 1, boarding).mode, 'WALK_TRANSFER');
    assert.equal(
      nextGuidance(original, 1, boarding).provenance,
      'OTP_DERIVED_MANEUVER',
    );
    assert.notEqual(
      navigationScopeKey('j1', 'r1', oldWalk),
      navigationScopeKey('j1', 'r2', repaired),
    );
    const guidance = nextGuidance(
      recovered,
      1,
      boarding,
      initialWalkProgress(),
    );
    assert.equal(guidance.mode, 'WALK_TO_DESTINATION');
    assert.equal(guidance.destination, 'Tujuan pengganti');
    assert.equal(guidance.provenance, 'SCHEMATIC_GEOMETRY');
    assert.equal(guidance.nextInstruction, null);
    assert.equal(guidance.nextDistanceMeters, null);
    assert.equal(guidance.remainingMeters, null);
    assert.match(guidance.detail, /skematik/);
    assert.equal(nextGuidance(recovered, 2, boarding).mode, 'ARRIVED');
  });

  it('R7 fails closed on malformed coordinates, null steps, non-string street names', () => {
    // SAMPLE: malformed OTP payloads must never throw; navigation degrades, never crashes.
    assert.equal(
      prepareWalkNavigation({
        ...base,
        geometry: {
          ...base.geometry,
          coordinates: [[106.81, -6.2], null, [106.811, -6.2]],
        },
      }),
      null,
    );
    assert.equal(
      prepareWalkNavigation({
        ...base,
        walking_steps: [base.walking_steps[0], null],
      }).evidence,
      'SCHEMATIC_GEOMETRY',
    );
    const nonStringStreet = prepareWalkNavigation({
      ...base,
      walking_steps: [
        base.walking_steps[0],
        { ...base.walking_steps[1], street_name: 123 },
      ],
    });
    assert.equal(nonStringStreet.evidence, 'SCHEMATIC_GEOMETRY');
    assert.deepEqual(nonStringStreet.maneuvers, []);
  });

  it('scope changes on accepted recovery and geometry identity, without GPS storage', () => {
    const original = navigationScopeKey('j1', null, base);
    const recovery = navigationScopeKey('j1', 'r1', base);
    const geometry = navigationScopeKey('j1', null, {
      ...base,
      geometry: {
        ...base.geometry,
        coordinates: [
          [106.81, -6.2],
          [106.812, -6.2],
        ],
      },
    });
    assert.notEqual(original, recovery);
    assert.notEqual(original, geometry);
    assert.ok(original.length < 80);
    const stored = updateWalkProgress(
      prepared(),
      initialWalkProgress(),
      fix(106.811, 1000),
      2000,
    );
    const second = updateWalkProgress(
      prepared(),
      stored,
      fix(106.811, 1100),
      2000,
    );
    assert.equal(second.status, 'TRACKING');
    assert.ok(second.maneuverIndex >= stored.maneuverIndex);
    assert.ok(second.maneuverIndex <= prepared().maneuvers.length - 1);
  });
});
