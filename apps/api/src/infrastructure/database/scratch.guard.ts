import assert from 'node:assert/strict';

import { sql, type Kysely } from 'kysely';

import type { FoundationDatabase } from './database.constants.js';

/**
 * Mutation-bearing integration specs must run on an invocation-owned scratch
 * database; never on the persistent product database. The prefixes match the
 * runners that create these databases:
 *
 * - tnx_lightweight_*  (src/journey/lightweight-acceptance.cli.ts)
 * - tnx_integration_*  (invocation-owned scratch databases created by the
 *   integration runner via DATABASE_URL)
 *
 * Spec fixtures must satisfy the original unique constraints (e.g.
 * twin.network_snapshot.content_hash); scratch isolation, never constraint
 * removal, resolves fixture collisions between suites.
 */
export const SCRATCH_DATABASE_PATTERN =
  /^tnx_(lightweight|integration)_[0-9a-f]{32}$/;

export async function assertInvocationScratchDatabase(
  database: Kysely<FoundationDatabase>,
): Promise<void> {
  const identity = await sql<{ name: string; marker: string | null }>`
    select datname as name, shobj_description(oid, 'pg_database') as marker
    from pg_database where datname = current_database()
  `.execute(database);
  assert.match(
    identity.rows[0]?.name ?? '',
    SCRATCH_DATABASE_PATTERN,
    'Mutation-bearing integration specs require an invocation-owned scratch database; run pnpm test:integration (integration runner), not the persistent product database.',
  );
  const name = identity.rows[0]!.name;
  const [, kind, id] = /^tnx_(lightweight|integration)_([0-9a-f]{32})$/.exec(
    name,
  )!;
  const uuid = `${id!.slice(0, 8)}-${id!.slice(8, 12)}-${id!.slice(12, 16)}-${id!.slice(16, 20)}-${id!.slice(20)}`;
  assert.equal(
    identity.rows[0]?.marker,
    `tnx_${kind}:${uuid}`,
    'Scratch database lacks the matching invocation ownership marker.',
  );
}
