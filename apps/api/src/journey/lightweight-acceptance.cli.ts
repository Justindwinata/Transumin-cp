import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';

import { runNodeTests } from './node-test-child-runner.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const reporter = fileURLToPath(
  new URL('./acceptance-test-reporter.mjs', import.meta.url),
);
try {
  loadEnvFile(`${root}.env`);
} catch {
  // CI may inject environment variables directly.
}

const source = process.env.POSTGRES_DB ?? 'transum_in_nexus_product';
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
const port = Number(process.env.POSTGRES_PORT ?? 5435);
const id = randomUUID();
const database = `tnx_lightweight_${id.replaceAll('-', '')}`;
const marker = `tnx_lightweight:${id}`;
const container = 'transum-in-nexus-postgres-1';
const reserveBytes = 1024 ** 3;
const timeout = 120_000;

assert(user && password, 'POSTGRES_USER and POSTGRES_PASSWORD are required');
assert(
  host === '127.0.0.1' && port === 5435,
  'Lightweight acceptance requires product Postgres endpoint',
);
assert(
  source === 'transum_in_nexus_product',
  'Lightweight acceptance source must be product DB',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function availableBytes(): number {
  const output = execFileSync(
    'docker',
    [
      'exec',
      container,
      'df',
      '-k',
      '--output=avail',
      '/var/lib/postgresql/data',
    ],
    { encoding: 'utf8' },
  );
  return Number(output.trim().split('\n').at(-1)) * 1024;
}

function run(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return runNodeTests(command, args, {
    cwd: root,
    env: environment,
    timeoutMs: timeout + 30_000,
  }).then(() => undefined);
}

const admin = new Pool({
  host,
  port,
  database: 'postgres',
  user,
  password,
  max: 1,
});
let created = false;
let passed = false;
let databaseOid: number | null = null;
try {
  const before = availableBytes();
  assert(
    before > reserveBytes,
    `Lightweight acceptance rejected: Docker free space ${before}B below 1 GiB reserve`,
  );
  const systemIdentifier = await admin.query<{ system_identifier: string }>(
    'select system_identifier::text from pg_control_system()',
  );
  const dockerIdentifier = execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      user,
      '-d',
      'postgres',
      '-Atc',
      'select system_identifier::text from pg_control_system()',
    ],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(
    systemIdentifier.rows[0]?.system_identifier,
    dockerIdentifier,
    'Endpoint differs from authorized product Docker server',
  );
  const sourceIdentity = await admin.query<{
    current_user: string;
    address: string;
    port: number;
  }>(
    'select current_user, inet_server_addr()::text as address, inet_server_port() as port',
  );
  assert.equal(sourceIdentity.rows[0]?.current_user, user);
  assert.equal(sourceIdentity.rows[0]?.port, 5432);
  assert.equal(
    execFileSync(
      'docker',
      ['inspect', container, '--format', '{{range .Mounts}}{{.Name}}{{end}}'],
      { encoding: 'utf8' },
    ).trim(),
    'transum-in-nexus-product-postgres-data',
  );
  assert.equal(
    (
      await admin.query('select 1 from pg_database where datname = $1', [
        database,
      ])
    ).rowCount,
    0,
  );
  await admin.query(`create database ${quoteIdentifier(database)}`);
  created = true;
  await admin.query(
    `comment on database ${quoteIdentifier(database)} is '${marker}'`,
  );
  databaseOid = await admin
    .query<{ oid: number }>('select oid from pg_database where datname = $1', [
      database,
    ])
    .then((result) => result.rows[0]?.oid ?? null);
  assert.ok(databaseOid !== null);

  const afterCreate = availableBytes();
  assert(
    afterCreate > reserveBytes,
    'Lightweight acceptance consumed 1 GiB Docker reserve',
  );
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  await run(
    'pnpm',
    [
      '--filter',
      '@transum-in/api',
      'exec',
      'node',
      '--import',
      'tsx',
      '--test',
      '--test-concurrency=1',
      '--test-reporter',
      reporter,
      '--test-timeout',
      String(timeout),
      'src/journey/node-test-child-runner.spec.ts',
      'src/journey/journey.integration.spec.ts',
      'src/journey/active-journey-boarding.spec.ts',
      'src/passenger-reporting/passenger-reporting.integration.spec.ts',
    ],
    { ...process.env, DATABASE_URL: url },
  );
  await run(
    'pnpm',
    [
      '--filter',
      '@transum-in/api',
      'exec',
      'node',
      '--import',
      'tsx',
      '--test',
      '--test-concurrency=1',
      '--test-reporter',
      reporter,
      '--test-timeout',
      String(timeout),
      'src/journey/recovery-acceptance.integration.spec.ts',
      'src/journey/active-journey-continuation.integration.spec.ts',
    ],
    { ...process.env, DATABASE_URL: url },
  );
  passed = true;
  console.log(
    JSON.stringify({
      status: 'PASS',
      tier: 'LIGHTWEIGHT_ISOLATED',
      evidence:
        'real domain services and PostgreSQL migrations with controlled synthetic fixture records',
      database,
      source,
      peak_bytes_upper_bound: before - availableBytes(),
      routing: 'NOT_TESTED_BY_THIS_TIER',
      full_snapshot: 'BLOCKED_BY_ENVIRONMENT',
    }),
  );
} finally {
  await admin.end();
  if (created && passed) {
    const cleanup = new Pool({
      host,
      port,
      database: 'postgres',
      user,
      password,
      max: 1,
    });
    try {
      const identity = await cleanup.query<{
        oid: number;
        datname: string;
        owner: string;
        marker: string | null;
      }>(
        `select oid, datname, pg_get_userbyid(datdba) as owner,
          shobj_description(oid, 'pg_database') as marker
        from pg_database where datname = $1`,
        [database],
      );
      assert.deepEqual(identity.rows[0], {
        oid: databaseOid,
        datname: database,
        owner: user,
        marker,
      });
      assert.equal(
        Number(
          (
            await cleanup.query(
              'select count(*) from pg_stat_activity where datname = $1',
              [database],
            )
          ).rows[0]?.count,
        ),
        0,
      );
      await cleanup.query(`drop database ${quoteIdentifier(database)}`);
    } finally {
      await cleanup.end();
    }
  } else if (created) {
    console.error(
      `Preserving failed invocation database ${database}; marker ${marker}`,
    );
  }
}
