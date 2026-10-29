import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertOwned, assertSourceUrl } from './product-acceptance.cli.js';

const identity = {
  name: 'tnx_acceptance_12345678123442349234123456789abc',
  oid: 42,
  owner: 'transum_in',
  marker: 'tnx_acceptance:12345678-1234-4234-9234-123456789abc',
};

describe('product acceptance database guards', () => {
  it('accepts only exact product source endpoint', () => {
    assert.equal(
      assertSourceUrl(
        'postgresql://transum_in:test-password@127.0.0.1:5435/transum_in_nexus_product',
        'transum_in',
      ).pathname,
      '/transum_in_nexus_product',
    );
    for (const value of [
      'postgresql://transum_in:test-password@localhost:5435/transum_in_nexus_product',
      'postgresql://transum_in:test-password@127.0.0.1:5433/transum_in_nexus_product',
      'postgresql://transum_in:test-password@127.0.0.1:5435/transum_in_nexus_protected',
      'postgresql://other:test-password@127.0.0.1:5435/transum_in_nexus_product',
      'postgresql://transum_in:test-password@127.0.0.1:5435/transum_in_nexus?sslmode=disable',
    ])
      assert.throws(() => assertSourceUrl(value, 'transum_in'));
  });

  it('permits cleanup only for exact invocation identity with zero sessions', () => {
    assert.doesNotThrow(() => assertOwned(identity, identity, 0));
    assert.throws(() => assertOwned(identity, { ...identity, oid: 43 }, 0));
    assert.throws(() => assertOwned(identity, identity, 1));
    assert.throws(() => assertOwned(identity, null, 0));
  });
});
