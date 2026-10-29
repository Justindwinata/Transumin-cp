import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertMigrateDatabaseIdentity,
  resolveCliEnvironment,
} from './database.cli.environment.js';

describe('database cli environment', () => {
  it('accepts configured product identity; missing config never picks silent port', () => {
    const resolved = resolveCliEnvironment({
      POSTGRES_DB: 'transum_in_nexus_product',
      POSTGRES_USER: 'fixture_role',
      POSTGRES_PASSWORD: 'ignored-fixture',
      POSTGRES_PORT: '5435',
      POSTGRES_HOST: '127.0.0.1',
    });
    assert.equal(resolved.port, 5435);
    assert.equal(resolved.database, 'transum_in_nexus_product');
    assert.equal(resolved.databaseUrl, null);
    assert.throws(() => resolveCliEnvironment({}), /POSTGRES_PORT/);
  });

  it('rejects DATABASE_URL/component conflicts; accepts coherent values and non-loopback hosts', () => {
    assert.throws(
      () =>
        resolveCliEnvironment({
          DATABASE_URL: 'postgresql://127.0.0.1:5435/other-database',
          POSTGRES_DB: 'transum_in_nexus_product',
        }),
      /disagree/,
    );
    assert.throws(
      () =>
        resolveCliEnvironment({
          POSTGRES_DB: 'transum_in_nexus_product',
          POSTGRES_PORT: '5435',
          POSTGRES_HOST: 'db.internal.example',
        }),
      /loopback/,
    );
    const coherent = resolveCliEnvironment({
      DATABASE_URL: 'postgresql://127.0.0.1:5435/transum_in_nexus_product',
      POSTGRES_DB: 'transum_in_nexus_product',
      POSTGRES_PORT: '5435',
    });
    assert.equal(coherent.database, 'transum_in_nexus_product');
    assert.equal(coherent.port, 5435);
  });

  it('refuses migrate when live identity differs; product identity match stays allowed', () => {
    assert.throws(
      () =>
        assertMigrateDatabaseIdentity(
          { database: 'transum_in_nexus_product', user: 'fixture_role' },
          { database: 'other_database', user: 'fixture_role' },
        ),
      /does not match/,
    );
    assert.throws(
      () =>
        assertMigrateDatabaseIdentity(
          { database: 'transum_in_nexus_product', user: 'fixture_role' },
          { database: 'transum_in_nexus_product', user: 'another_role' },
        ),
      /does not match/,
    );
    assert.doesNotThrow(() =>
      assertMigrateDatabaseIdentity(
        { database: 'transum_in_nexus_product', user: 'fixture_role' },
        { database: 'transum_in_nexus_product', user: 'fixture_role' },
      ),
    );
  });
});
