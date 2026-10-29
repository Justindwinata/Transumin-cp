import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeOpl, extractPlace } from './build-local-place-index.mjs';
const envelope = { west: 106, east: 108, south: -7, north: -5 };
const node = (tags) => `n123 v1 T${tags} x106.8 y-6.2`;
test('SIMULATED OPL whitelist preserves names, addresses, Unicode and node coordinates', () => {
  assert.equal(decodeOpl('A%20%B%2c%%20%%4e2d%'), 'A B, 中');
  assert.equal(
    extractPlace(node('name=SAMPLE%20%Mall,shop=mall'), envelope)?.kind,
    'POI',
  );
  assert.equal(
    extractPlace(
      node('addr:street=SAMPLE%20%Road,addr:housenumber=5'),
      envelope,
    )?.name,
    'SAMPLE Road 5',
  );
  assert.equal(
    extractPlace(node('addr:full=SAMPLE%20%Address'), envelope)?.kind,
    'ADDRESS',
  );
});
test('SIMULATED transit, street-only, private, invalid and unsupported features excluded', () => {
  for (const tags of [
    'name=SAMPLE,amenity=bus_station,addr:full=SAMPLE',
    'addr:street=SAMPLE',
    'name=SAMPLE,shop=mall,access=private',
    'name=SAMPLE,highway=residential',
    'name=SAMPLE,amenity=unknown',
  ])
    assert.equal(extractPlace(node(tags), envelope), null);
  assert.equal(
    extractPlace('w1 Tname=SAMPLE,shop=mall Nn1,n2', envelope),
    null,
  );
  assert.equal(
    extractPlace(
      node('name=SAMPLE,shop=mall').replace('x106.8', 'x109'),
      envelope,
    ),
    null,
  );
});
