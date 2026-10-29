import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { Pool } = createRequire(
  new URL('../../api/package.json', import.meta.url),
)('pg');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fail-closed identity contract. Deliberately pure so the negative path is
 * unit-checkable: a single mismatch aborts before any request or mutation.
 */
export function assertCp2Identity(expected, actual) {
  assert.match(
    String(expected.invocation),
    UUID,
    'CP2 invocation must be a UUID',
  );
  assert.equal(
    expected.name,
    `tnx_cp2_${expected.invocation.replaceAll('-', '')}`,
    'CP2 scratch name does not derive from invocation',
  );
  assert.equal(
    expected.marker,
    `tnx_cp2:${expected.invocation}`,
    'CP2 marker does not derive from invocation',
  );
  assert.ok(
    Number.isInteger(expected.oid) && expected.oid > 0,
    'CP2 expected OID missing',
  );
  assert.ok(expected.owner, 'CP2 expected owner missing');
  assert.deepEqual(
    actual,
    {
      name: expected.name,
      oid: expected.oid,
      owner: expected.owner,
      marker: expected.marker,
    },
    'CP2 runtime identity mismatch; preserving scratch, no state changes',
  );
}

/**
 * Reads all identity inputs from the isolated runtime environment: the pixel
 * runner (proxy), the owned API process, and the owned scratch database. The
 * owned API is proven by PID-bound port ownership (lsof) rather than a
 * production endpoint, so no product surface is weakened.
 */
export async function assertCp2Runtime() {
  const expected = {
    name: process.env.CP2_EXPECTED_DB,
    marker: process.env.CP2_EXPECTED_MARKER,
    oid: Number(process.env.CP2_EXPECTED_OID),
    owner: process.env.CP2_EXPECTED_OWNER,
    invocation: process.env.CP2_EXPECTED_INVOCATION,
  };
  assert.ok(
    expected.name && expected.marker && expected.owner && expected.invocation,
    'Run pnpm data:cp2:isolated-browser; runtime identity missing',
  );
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, process.env.CP2_EXPECTED_DB_PORT ?? '5435');
  assert.equal(url.pathname, `/${expected.name}`);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.match(
    String(process.env.CP2_API_PID),
    /^\d+$/,
    'CP2 requires owned API process ownership (CP2_API_PID)',
  );
  const listeners = execFileSync(
    'lsof',
    ['-nP', '-a', '-p', process.env.CP2_API_PID, '-iTCP:3303', '-sTCP:LISTEN'],
    { encoding: 'utf8' },
  );
  assert.match(
    listeners,
    /:3303 \(LISTEN\)/,
    'Owned API PID does not hold port 3303',
  );
  const apiEnvironment = execFileSync(
    'ps',
    ['eww', '-p', process.env.CP2_API_PID, '-o', 'command='],
    { encoding: 'utf8' },
  );
  assert.ok(
    apiEnvironment.includes(`DATABASE_URL=${url.toString()} `),
    'Owned API process DATABASE_URL differs from scratch',
  );
  assert.equal(
    process.env.PASSENGER_API_BASE_URL,
    'http://127.0.0.1:3303/api/v1',
  );
  assert.ok(
    ['http://127.0.0.1:3302', 'https://127.0.0.1:3302'].includes(
      process.env.PASSENGER_WEB_URL,
    ),
  );
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  try {
    const actual = (
      await pool.query(
        "select datname as name, oid::int, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid,'pg_database'),'') as marker from pg_database where datname=current_database()",
      )
    ).rows[0];
    assertCp2Identity(expected, actual);
  } finally {
    await pool.end();
  }
}
