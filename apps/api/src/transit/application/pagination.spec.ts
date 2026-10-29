import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { InvalidDataSourceQueryError } from '../domain/data-provenance.js';
import { encodeCursor, parsePageRequest } from './pagination.js';

describe('FR-012 data-source pagination contract', () => {
  it('uses the canonical default and round-trips an opaque cursor', () => {
    const position = { sortValue: 'test-source', id: randomUUID() };
    const cursor = encodeCursor(position, 'DATA_SOURCES');

    assert.deepEqual(parsePageRequest(undefined, undefined, 'DATA_SOURCES'), {
      limit: 25,
      after: null,
    });
    assert.ok(cursor !== null);
    assert.deepEqual(parsePageRequest('100', cursor, 'DATA_SOURCES'), {
      limit: 100,
      after: position,
    });
  });

  it('rejects an excessive limit and malformed cursor', () => {
    assert.throws(
      () => parsePageRequest('101', undefined, 'DATA_SOURCES'),
      InvalidDataSourceQueryError,
    );
    assert.throws(
      () => parsePageRequest(undefined, 'not-a-cursor', 'DATA_SOURCES'),
      InvalidDataSourceQueryError,
    );
  });

  it('rejects a cursor created for a different collection', () => {
    const cursor = encodeCursor(
      { sortValue: 'test-source', id: randomUUID() },
      'DATA_SOURCES',
    );

    assert.ok(cursor !== null);
    assert.throws(
      () => parsePageRequest(undefined, cursor, 'DATASET_VERSIONS'),
      InvalidDataSourceQueryError,
    );
  });
});
