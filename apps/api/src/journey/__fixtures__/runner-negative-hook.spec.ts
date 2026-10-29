import { after, describe, it } from 'node:test';
describe('runner negative — after hook', () => {
  it('passes', () => {});
  after(() => {
    throw new Error('hook boom');
  });
});
