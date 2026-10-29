import assert from 'node:assert/strict';
import test from 'node:test';

const {
  deviceAccuracyRing,
  deviceHeadingWedge,
  isValidDevicePosition,
  mapGeometryPoints,
} = await import('./map-geometry.ts');

test('map geometry rejects malformed legs without joining gaps', () => {
  assert.deepEqual(mapGeometryPoints([[106.8, -6.2]]), []);
  assert.deepEqual(mapGeometryPoints([[106.8, -6.2], [181, -6.1]]), []);
  assert.deepEqual(mapGeometryPoints([[106.8, -6.2], [106.9, -6.1]]), [
    [106.8, -6.2],
    [106.9, -6.1],
  ]);
});

test('device helpers validate positions and build closed rings', () => {
  const position = { latitude: -6.2, longitude: 106.8, accuracy: 25, heading: 90 };
  assert.equal(isValidDevicePosition(position), true);
  assert.equal(isValidDevicePosition({ ...position, accuracy: -1 }), false);
  const accuracy = deviceAccuracyRing(position, 25);
  assert.equal(accuracy?.length, 49);
  assert.deepEqual(accuracy?.[0], accuracy?.[accuracy?.length - 1]);
  assert.ok(Math.abs(accuracy?.length ?? 0) > 48);
  const heading = deviceHeadingWedge(position, 90, 20);
  assert.deepEqual(heading?.[0], heading?.[heading?.length - 1]);
  assert.equal(deviceHeadingWedge(position, null, 20), null);
});
