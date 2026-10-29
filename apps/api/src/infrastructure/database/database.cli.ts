import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

import {
  assertMigrateDatabaseIdentity,
  databaseCliPoolConfig,
  resolveCliEnvironment,
} from './database.cli.environment.js';
import type { FoundationDatabase } from './database.constants.js';
import { getMigrationStatus, migrateToLatest } from './database.migrator.js';

type Command = 'migrate' | 'status';

function parseCommand(value: string | undefined): Command {
  if (value === 'migrate' || value === 'status') return value;
  throw new Error('Expected database command: migrate or status');
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  try {
    loadEnvFile(`${root}.env`);
  } catch {
    // CI may inject complete environment variables directly.
  }
  const command = parseCommand(process.argv[2]);
  const resolved = resolveCliEnvironment(process.env);
  const database = new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool(databaseCliPoolConfig(resolved)),
    }),
  });

  try {
    const identity = (
      await sql<{ database: string; user: string }>`
        select current_database() as database, current_user as user
      `.execute(database)
    ).rows[0]!;
    assertMigrateDatabaseIdentity(resolved, identity);
    process.stdout.write(
      `Database identity verified (${resolved.host}:${resolved.port}/${identity.database}; role redacted).\n`,
    );

    if (command === 'migrate') {
      const results = await migrateToLatest(database);
      const applied = results.filter(
        (result) => result.status === 'Success',
      ).length;
      process.stdout.write(
        `Database migrations complete (${applied} applied).\n`,
      );
      return;
    }

    const migrations = await getMigrationStatus(database);
    for (const migration of migrations) {
      const status = migration.executedAt === undefined ? 'pending' : 'applied';
      process.stdout.write(`${migration.name}: ${status}\n`);
    }
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown database error';
  process.stderr.write(`Database command failed: ${message}\n`);
  process.exitCode = 1;
});
