import { sql, type Kysely } from 'kysely';

import { FOUNDATION_SCHEMAS } from '../database.constants.js';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists postgis`.execute(database);

  for (const schema of FOUNDATION_SCHEMAS) {
    await sql.raw(`create schema if not exists "${schema}"`).execute(database);
  }
}

export async function down(database: Kysely<unknown>): Promise<void> {
  const reversibleSchemas = FOUNDATION_SCHEMAS.filter(
    (schema) => schema !== 'meta',
  );

  for (const schema of [...reversibleSchemas].reverse()) {
    await sql
      .raw(`drop schema if exists "${schema}" restrict`)
      .execute(database);
  }

  await sql`drop extension if exists postgis restrict`.execute(database);
}
