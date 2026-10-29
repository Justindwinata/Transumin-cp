import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { runNodeTests } from '../../journey/node-test-child-runner.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const api = fileURLToPath(new URL('../../../', import.meta.url));
const reporter = fileURLToPath(
  new URL('../../journey/acceptance-test-reporter.mjs', import.meta.url),
);
try {
  loadEnvFile(`${root}.env`);
} catch {
  // CI may inject environment variables directly.
}

const specs = [
  'src/infrastructure/database/database.integration.spec.ts',
  'src/transit/transit.foundation.integration.spec.ts',
  'src/transit/gtfs/gtfs-ingestion.integration.spec.ts',
  'src/spatial/spatial.integration.spec.ts',
  'src/mobility-twin/mobility-twin.integration.spec.ts',
  'src/disruption/disruption.integration.spec.ts',
  'src/research/research.integration.spec.ts',
  'src/disruption/hazard-incident.integration.spec.ts',
  'src/journey/journey.integration.spec.ts',
  'src/journey/journey-x1b.integration.spec.ts',
  'src/copilot/copilot.integration.spec.ts',
  'src/auth/auth.integration.spec.ts',
  'src/operator-recovery/operator-recovery.integration.spec.ts',
] as const;
// Exact registered path only; targeted runs retain every scratch ownership/cleanup guard.
const requestedSpec = process.argv[2];
assert(
  process.argv.length <= 3,
  'Usage: integration-suite.cli.ts [registered-spec-path]',
);
assert(
  !requestedSpec || specs.some((spec) => spec === requestedSpec),
  'Unknown integration spec',
);
const selectedSpecs = specs.filter(
  (spec) => !requestedSpec || spec === requestedSpec,
);
const source = process.env.POSTGRES_DB ?? 'transum_in_nexus_product';
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
const port = Number(process.env.POSTGRES_PORT ?? 5435);
const container = 'transum-in-nexus-postgres-1';
const reserveBytes = 1024 ** 3;
const timeout = 120_000;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function docker(args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function waitForScratchSessionsToClose(
  admin: Pool,
  database: string,
): Promise<void> {
  // Child close and awaited pool teardown precede this check. PostgreSQL may
  // still be retiring client backends; never terminate them or force DROP.
  const deadline = Date.now() + 10_000;
  let observed = false;
  while (Date.now() < deadline) {
    const sessions = await admin.query<{
      pid: number;
      application_name: string;
      state: string | null;
      backend_type: string;
      wait_event_type: string | null;
    }>(
      `select pid, application_name, state, backend_type, wait_event_type
       from pg_stat_activity where datname = $1`,
      [database],
    );
    if (sessions.rowCount === 0) {
      if (observed)
        console.log(JSON.stringify({ database, sessions: 'CLOSED' }));
      return;
    }
    if (!observed) {
      console.log(JSON.stringify({ database, sessions: sessions.rows }));
    }
    observed = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  const sessions = await admin.query<{
    pid: number;
    application_name: string;
    state: string | null;
    backend_type: string;
    wait_event_type: string | null;
  }>(
    `select pid, application_name, state, backend_type, wait_event_type
     from pg_stat_activity where datname = $1`,
    [database],
  );
  assert.equal(
    sessions.rowCount,
    0,
    `Owned scratch sessions did not close: ${JSON.stringify(sessions.rows)}`,
  );
}

async function main(): Promise<void> {
  assert(user && password, 'POSTGRES_USER and POSTGRES_PASSWORD are required');
  assert(
    host === '127.0.0.1' && port === 5435,
    'Integration suite requires product Postgres endpoint',
  );
  assert.equal(source, 'transum_in_nexus_product');
  const admin = new Pool({
    host,
    port,
    database: 'postgres',
    user,
    password,
    max: 1,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 30_000,
  });
  let serverIdentifier: string | undefined;
  let passed = 0;
  let completed = 0;

  async function guard(): Promise<void> {
    const identity = await admin.query<{
      system_identifier: string;
      owner: string;
      port: number;
    }>(`select system_identifier::text, current_user as owner,
      inet_server_port() as port from pg_control_system()`);
    const identifier = identity.rows[0]?.system_identifier;
    assert.ok(identifier);
    assert.equal(identity.rows[0]?.owner, user);
    assert.equal(identity.rows[0]?.port, 5432);
    assert.equal(
      identifier,
      docker([
        'exec',
        container,
        'psql',
        '-U',
        user!,
        '-d',
        'postgres',
        '-Atc',
        'select system_identifier::text from pg_control_system()',
      ]),
      'Endpoint differs from authorized product Docker server',
    );
    if (serverIdentifier !== undefined)
      assert.equal(identifier, serverIdentifier);
    serverIdentifier = identifier;
    const mounts = JSON.parse(
      docker(['inspect', container, '--format', '{{json .Mounts}}']),
    ) as { Type: string; Name?: string; Destination: string }[];
    const mount = mounts.find(
      (entry) => entry.Destination === '/var/lib/postgresql/data',
    );
    assert.equal(mount?.Type, 'volume');
    assert.equal(mount?.Name, 'transum-in-nexus-product-postgres-data');
    const free =
      Number(
        docker([
          'exec',
          container,
          'df',
          '-k',
          '--output=avail',
          '/var/lib/postgresql/data',
        ])
          .split('\n')
          .at(-1),
      ) * 1024;
    assert(
      Number.isSafeInteger(free) && free > reserveBytes,
      'Integration suite rejected: Docker free space below 1 GiB reserve',
    );
  }

  try {
    await guard();
    // Catalog-only source identity: migration status would create meta schema.
    const sourceIdentity = await admin.query<{ owner: string }>(
      'select pg_get_userbyid(datdba) as owner from pg_database where datname = $1',
      [source],
    );
    assert.equal(sourceIdentity.rows[0]?.owner, user);

    for (const spec of selectedSpecs) {
      const id = randomUUID();
      const database = `tnx_integration_${id.replaceAll('-', '')}`;
      const marker = `tnx_integration:${id}`;
      let created = false;
      let cleaned = false;
      let oid: number | undefined;
      try {
        await guard();
        assert.equal(
          (
            await admin.query('select 1 from pg_database where datname = $1', [
              database,
            ])
          ).rowCount,
          0,
        );
        // template0 supplies only PostgreSQL's empty baseline, never product data.
        await admin.query(
          `create database ${quoteIdentifier(database)} with template template0 owner ${quoteIdentifier(user)}`,
        );
        created = true;
        await admin.query(
          `comment on database ${quoteIdentifier(database)} is '${marker}'`,
        );
        oid = (
          await admin.query<{ oid: number }>(
            'select oid from pg_database where datname = $1',
            [database],
          )
        ).rows[0]?.oid;
        assert.ok(oid !== undefined);
        await guard();
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          DATABASE_URL: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
          POSTGRES_DB: database,
        };
        delete env.NODE_TEST_CONTEXT;
        console.log(JSON.stringify({ spec, database, status: 'RUNNING' }));
        // Migration CLI has no test summary; its nonzero exit aborts this run.
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            'src/infrastructure/database/database.cli.ts',
            'migrate',
          ],
          { cwd: api, env, timeout, stdio: ['ignore', 'inherit', 'inherit'] },
        );
        await guard();
        const result = await runNodeTests(
          process.execPath,
          [
            '--import',
            'tsx',
            '--test',
            '--test-concurrency=1',
            '--test-reporter',
            reporter,
            '--test-timeout',
            String(timeout),
            spec,
          ],
          { cwd: api, env, timeoutMs: timeout + 30_000 },
        );
        assert.ok(
          result.passed > 0,
          'Integration spec produced no passing tests',
        );
        await guard();
        const identity = await admin.query<{
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
          oid,
          datname: database,
          owner: user,
          marker,
        });
        await waitForScratchSessionsToClose(admin, database);
        await admin.query(`drop database ${quoteIdentifier(database)}`);
        cleaned = true;
        passed += result.passed;
        completed += 1;
      } finally {
        if (created && !cleaned) {
          console.error(
            `Preserving failed invocation database ${database}; marker ${marker}`,
          );
        }
      }
    }
    console.log(
      JSON.stringify({ status: 'PASS', specs: completed, passed, failed: 0 }),
    );
  } finally {
    await admin.end();
    if (completed !== selectedSpecs.length) {
      console.error(
        JSON.stringify({
          status: 'FAIL',
          completed,
          total: selectedSpecs.length,
          passed,
        }),
      );
    }
  }
}

void main().catch((error: unknown) => {
  // Child diagnostics already streamed; never serialize connection credentials.
  const message =
    error instanceof Error ? error.message : 'Unknown integration failure';
  console.error(`Integration suite failed: ${message}`);
  console.error(
    'Scratch databases retained when created and cleanup was not verified.',
  );
  process.exitCode = 1;
});
