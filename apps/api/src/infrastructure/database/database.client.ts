import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { FoundationDatabase } from './database.constants.js';
import { getDatabaseConfig } from './database.config.js';

export function createDatabase(): Kysely<FoundationDatabase> {
  const pool = new Pool(getDatabaseConfig());
  // Idle connections can fail during DB outages; pg discards them automatically.
  // Query failures still propagate to callers and readiness reports degradation.
  pool.on('error', () => {
    console.error('Database idle connection lost; reconnect on next request.');
  });
  return new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
}
