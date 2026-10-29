import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTERNAL_PROVIDERS,
  handoffDestinationText,
  handoffPickupText,
} from './external-handoff.ts';

const now = 100_000;
const position = {
  latitude: -6.2,
  longitude: 106.8,
  accuracy: 5,
  heading: null,
  timestamp: now,
};
test('FR-006/009: provider pickup requires a fresh accepted device fix, never inferred journey position', () => {
  assert.match(handoffPickupText(position, 'GPS_TRACKING', now), /-6.2, 106.8/);
  assert.equal(handoffPickupText(position, 'GPS_PERMISSION_DENIED', now), null);
  assert.equal(handoffPickupText(position, 'GPS_TRACKING', now + 30_000), null);
  assert.equal(
    handoffPickupText({ ...position, accuracy: 80 }, 'GPS_MAP_CONTEXT', now),
    null,
  );
  assert.equal(handoffPickupText(null, 'GPS_OFF', now), null);
});
test('FR-006: destination copy never invents missing or invalid coordinates', () => {
  assert.equal(
    handoffDestinationText({ name: 'Destination' }),
    'Tujuan Transum-In: Destination',
  );
  assert.equal(
    handoffDestinationText({ name: 'Destination', latitude: 0, longitude: 0 }),
    'Tujuan Transum-In: Destination (0, 0)',
  );
  assert.equal(
    handoffDestinationText({
      name: 'Destination',
      latitude: NaN,
      longitude: 200,
    }),
    'Tujuan Transum-In: Destination',
  );
  for (const provider of EXTERNAL_PROVIDERS) {
    const url = new URL(provider.href);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.search, ''); // no automatic location disclosure or guessed booking scheme
    assert.equal(url.hash, '');
  }
});
