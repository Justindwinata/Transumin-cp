import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
describe('runner negative — failing assertion', () => {
  it('fails', () => {
    assert.equal(1, 2);
  });
});
