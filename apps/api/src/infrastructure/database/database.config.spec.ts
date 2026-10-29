import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getDatabaseConfig } from './database.config.js';

describe('getDatabaseConfig', () => {
  it('uses localhost-only development defaults without requiring a running database', () => {
    const config = getDatabaseConfig({});

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 5433);
    assert.equal(config.database, 'transum_in_nexus');
    assert.equal(config.user, 'transum_in');
    assert.equal(config.password, '');
  });

  it('accepts a PostgreSQL URL without exposing it through errors', () => {
    const connectionString = 'postgresql://localhost:5433/database';
    const config = getDatabaseConfig({ DATABASE_URL: connectionString });

    assert.equal(config.connectionString, connectionString);
  });

  it('rejects invalid ports and non-PostgreSQL URLs', () => {
    assert.throws(
      () => getDatabaseConfig({ POSTGRES_PORT: '70000' }),
      /POSTGRES_PORT/,
    );
    assert.throws(
      () => getDatabaseConfig({ DATABASE_URL: 'https://example.com/database' }),
      /DATABASE_URL/,
    );
  });
});
