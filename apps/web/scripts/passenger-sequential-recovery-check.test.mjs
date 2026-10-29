import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectSecondRecoveryTarget } from './passenger-sequential-recovery-check.mjs';

const route = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const stop = '33333333-3333-4333-8333-333333333333';

const journey = {
  journey_id: 'journey-accepted',
  accepted_recovery_id: 'aaaaaaa1-1111-4111-8111-111111111111',
  progress: { completed_segment_count: 1 },
  dependencies: [{ mobility_entity_id: route }, { mobility_entity_id: stop }],
  segments: [
    { sequence: 0, mode: 'WALK', entity_bindings: [] },
    { sequence: 1, mode: 'WALK', entity_bindings: [] },
    {
      sequence: 2,
      mode: 'TRANSJAKARTA',
      entity_bindings: [
        { entity_type: 'ROUTE', mobility_entity_id: route },
        { entity_type: 'STOP', mobility_entity_id: stop },
      ],
    },
    { sequence: 3, mode: 'WALK', entity_bindings: [] },
  ],
};

test('selects different remaining transit ROUTE dependency', () => {
  assert.deepEqual(
    selectSecondRecoveryTarget(journey, { mobility_entity_id: other }),
    { key: `${route}:ROUTE`, entityId: route, sequence: 2 },
  );
});

test('rejects the already-reported entity and non-route bindings', () => {
  assert.equal(
    selectSecondRecoveryTarget(journey, { mobility_entity_id: route }),
    null,
  );
});

test('never selects a completed segment', () => {
  const completedRoute = {
    ...journey,
    progress: { completed_segment_count: 3 },
  };
  assert.equal(selectSecondRecoveryTarget(completedRoute, null), null);
});

test('uses accepted itinerary binding when original dependency projection is stale', () => {
  const staleProjection = {
    ...journey,
    dependencies: [{ mobility_entity_id: other }],
  };
  assert.deepEqual(selectSecondRecoveryTarget(staleProjection, null), {
    key: `${route}:ROUTE`,
    entityId: route,
    sequence: 2,
  });
});
