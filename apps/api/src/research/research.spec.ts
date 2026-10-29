// FR-011/FR-013 unit checks over exported bounded parsers (no DB).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBbox, parseCursor, parseLimit } from './research.read-model.js';

describe('FR-011/FR-013 research read-model bounds', () => {
  it('rejects invalid limit/cursor/bbox', () => {
    assert.throws(() => parseLimit('101'), /limit/);
    assert.throws(() => parseLimit('abc'), /limit/);
    assert.throws(() => parseCursor('!!!', 'scenarios'), /cursor/);
    assert.throws(() => parseBbox('1,2,3'), /bbox/);
    assert.equal(parseLimit(), 25);
    assert.equal(parseCursor(undefined, 'scenarios'), null);
    assert.equal(parseBbox(undefined), null);
  });
});
