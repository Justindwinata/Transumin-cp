import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertCp2Identity } from './cp2-runtime-guard.mjs';

const invocation = '7155827b-ef2c-46e9-8ffa-afeef92b333d';
const expected = {
  invocation,
  name: `tnx_cp2_${invocation.replaceAll('-', '')}`,
  marker: `tnx_cp2:${invocation}`,
  oid: 680342,
  owner: 'scratch_owner_example',
};

test('accepts the invocation-derived scratch identity', () => {
  assert.doesNotThrow(() =>
    assertCp2Identity(expected, {
      name: expected.name,
      oid: expected.oid,
      owner: expected.owner,
      marker: expected.marker,
    }),
  );
});

test('refuses the shared product database identity before mutation', () => {
  assert.throws(
    () =>
      assertCp2Identity(expected, {
        name: 'transum_in_nexus_product',
        oid: 16384,
        owner: expected.owner,
        marker: '',
      }),
    /identity mismatch|does not derive/,
  );
});

test('refuses a scratch-like name whose marker/OID do not match', () => {
  assert.throws(
    () =>
      assertCp2Identity(expected, {
        name: expected.name,
        oid: expected.oid + 1,
        owner: expected.owner,
        marker: expected.marker,
      }),
    /identity mismatch/,
  );
  assert.throws(
    () =>
      assertCp2Identity(
        { ...expected, marker: `${expected.marker}-stale` },
        {
          name: expected.name,
          oid: expected.oid,
          owner: expected.owner,
          marker: `${expected.marker}-stale`,
        },
      ),
    /marker does not derive/,
  );
});
