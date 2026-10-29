import { promises as fileSystem } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql, type Kysely } from 'kysely';
import {
  FileMigrationProvider,
  Migrator,
  type MigrationInfo,
  type MigrationResult,
} from 'kysely/migration';

import type { FoundationDatabase } from './database.constants.js';

const migrationFolder = fileURLToPath(new URL('./migrations', import.meta.url));

async function createMigrator(
  database: Kysely<FoundationDatabase>,
): Promise<Migrator> {
  await sql`create schema if not exists meta`.execute(database);

  return new Migrator({
    db: database,
    migrationTableSchema: 'meta',
    provider: new FileMigrationProvider({
      fs: fileSystem,
      path,
      migrationFolder,
    }),
  });
}

export async function migrateToLatest(
  database: Kysely<FoundationDatabase>,
): Promise<readonly MigrationResult[]> {
  const migrator = await createMigrator(database);
  const { error, results = [] } = await migrator.migrateToLatest();

  if (error !== undefined) {
    throw error;
  }

  return results;
}

export async function getMigrationStatus(
  database: Kysely<FoundationDatabase>,
): Promise<readonly MigrationInfo[]> {
  const migrator = await createMigrator(database);
  return migrator.getMigrations();
}
