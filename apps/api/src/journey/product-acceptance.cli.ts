import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCE = 'transum_in_nexus_product';
const PROTECTED = new Set([
  'transum-in-nexus-postgres-data',
  'transum-in-nexus-phase5b-postgres-data',
]);
const id = randomUUID();
const DB = `tnx_acceptance_${id.replaceAll('-', '')}`;
const marker = `tnx_acceptance:${id}`;
const CONTAINER = 'transum-in-nexus-postgres-1';

type Identity = { name: string; oid: number; owner: string; marker: string };

export function assertSourceUrl(value: string, user: string): URL {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5435');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), SOURCE);
  assert.equal(decodeURIComponent(url.username), user);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url;
}

export function assertOwned(
  expected: Identity,
  actual: Identity | null,
  sessions: number,
) {
  assert.match(expected.name, /^tnx_acceptance_[0-9a-f]{32}$/);
  assert.match(expected.marker, /^tnx_acceptance:[0-9a-f-]{36}$/);
  assert.deepEqual(
    actual,
    expected,
    'Scratch identity changed; preserve database',
  );
  assert.equal(sessions, 0, 'Scratch has sessions; preserve database');
}

function redact(text: string): string {
  return text.replaceAll(
    /(postgres(?:ql)?:\/\/[^\s:/@]+:)[^\s@]+@/gi,
    '$1***@',
  );
}

function run(
  command: string,
  args: string[],
  input?: NodeJS.ReadableStream,
  env = process.env,
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let diagnostic = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output = `${output}${chunk}`.slice(-64_000);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      diagnostic = `${diagnostic}${chunk}`.slice(-2000);
    });
    if (input) input.pipe(child.stdin!);
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolveRun(output)
        : reject(
            new Error(
              `Owned process failed with exit code ${code}: ${redact(diagnostic)}`,
            ),
          ),
    );
  });
}

async function stopOwned(child: ReturnType<typeof spawn> | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const stopped = new Promise<void>((resolveStop) => {
    child.once('exit', () => resolveStop());
    setTimeout(resolveStop, 10_000);
  });
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await stopped;
}

async function main() {
  try {
    loadEnvFile(resolve(ROOT, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cannot load ignored .env', { cause: error });
  }
  const env = process.env;
  assert.equal(
    env.POSTGRES_HOST,
    '127.0.0.1',
    'POSTGRES_HOST must be exact product localhost',
  );
  assert.equal(env.POSTGRES_PORT, '5435', 'POSTGRES_PORT must be 5435');
  assert.equal(env.POSTGRES_DB, SOURCE, 'POSTGRES_DB must name product source');
  assert.ok(
    env.POSTGRES_USER && env.POSTGRES_PASSWORD,
    'Product DB credentials missing',
  );
  const user = env.POSTGRES_USER as string;
  const password = env.POSTGRES_PASSWORD as string;
  assert.ok(
    env.POSTGRES_VOLUME_NAME?.includes('product'),
    'Product Docker volume name required',
  );
  assert.ok(
    env.POSTGRES_VOLUME_NAME && !PROTECTED.has(env.POSTGRES_VOLUME_NAME),
    'Protected volume rejected',
  );
  const sourceUrl = assertSourceUrl(
    env.DATABASE_URL ||
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:5435/${SOURCE}`,
    user,
  );
  sourceUrl.pathname = '/postgres';
  const admin = new Pool({
    connectionString: sourceUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 3000,
  });
  let owned: Identity | null = null;
  let web: ReturnType<typeof spawn> | undefined;
  let passed = false;
  try {
    const inspect = JSON.parse(
      execFileSync('docker', ['inspect', CONTAINER], { encoding: 'utf8' }),
    )[0];
    assert.equal(inspect.Config.Image, 'transum-in-nexus/postgis:17.11-3.6');
    assert.deepEqual(inspect.NetworkSettings.Ports['5432/tcp'], [
      { HostIp: '127.0.0.1', HostPort: '5435' },
    ]);
    const mounts = inspect.Mounts.filter(
      (mount: { Destination: string }) =>
        mount.Destination === '/var/lib/postgresql/data',
    );
    assert.equal(mounts.length, 1);
    assert.equal(mounts[0].Name, env.POSTGRES_VOLUME_NAME);
    assert.ok(!PROTECTED.has(mounts[0].Name));
    const dockerDb = (command: string, args: string[]): string =>
      execFileSync(
        'docker',
        ['exec', '-u', 'postgres', CONTAINER, command, '-U', user, ...args],
        { encoding: 'utf8' },
      ).trim();
    const psql = (statement: string): string =>
      dockerDb('psql', ['-d', 'postgres', '-Atqc', statement]);
    const systemId = psql(
      'select system_identifier::text from pg_control_system()',
    );
    const server = await admin.query(
      'select system_identifier::text from pg_control_system()',
    );
    assert.equal(
      server.rows[0].system_identifier,
      systemId,
      'Database endpoint does not match authorized Docker server',
    );
    assert.match(id, /^[0-9a-f-]{36}$/, 'Scratch id must be a UUID literal');
    assert.equal(
      psql(`select count(*) from pg_database where datname='${DB}'`),
      '0',
      'UUID scratch collision; refusing reuse',
    );
    const sourceSize = await admin
      .query('select pg_database_size($1)::bigint as bytes', [SOURCE])
      .then((r) => Number(r.rows[0]?.bytes ?? 0));
    const hostAvailable =
      Number(
        execFileSync('df', ['-k', '/'], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .at(-1)!
          .trim()
          .split(/\s+/)
          .at(-3),
      ) * 1024;
    const dockerAvailable =
      Number(
        execFileSync(
          'docker',
          [
            'exec',
            CONTAINER,
            'df',
            '-k',
            '--output=avail',
            '/var/lib/postgresql/data',
          ],
          { encoding: 'utf8' },
        )
          .trim()
          .split('\n')
          .at(-1),
      ) * 1024;
    const safetyReserve = 8 * 1024 ** 3;
    assert.ok(
      Number.isFinite(sourceSize) &&
        sourceSize > 0 &&
        hostAvailable > sourceSize * 2 + safetyReserve &&
        dockerAvailable > sourceSize * 2 + safetyReserve,
      'Scratch clone rejected before creation: host and Docker must each retain 8 GiB plus 2x source DB size.',
    );
    psql(`create database "${DB}"`);
    psql(`comment on database "${DB}" is '${marker}'`);
    const ownedIdentity = psql(
      `select datname || '|' || oid || '|' || pg_get_userbyid(datdba) || '|' || coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname='${DB}'`,
    );
    const [scratchName, scratchOid, scratchOwner, scratchMarker] =
      ownedIdentity.split('|');
    assert.equal(scratchMarker, marker, 'Scratch identity marker mismatch');
    assert.ok(scratchName && scratchOwner && scratchMarker && scratchOid);
    owned = {
      name: scratchName,
      oid: Number(scratchOid),
      owner: scratchOwner,
      marker: scratchMarker,
    };

    const dump = spawn(
      'docker',
      [
        'exec',
        '-i',
        '-u',
        'postgres',
        CONTAINER,
        'pg_dump',
        '-U',
        user,
        '--serializable-deferrable',
        '-Fc',
        '-d',
        SOURCE,
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let dumpError = '';
    dump.stderr.on('data', (chunk: Buffer) => {
      dumpError = `${dumpError}${chunk}`.slice(-2000);
    });
    const dumpDone = new Promise<number | null>((resolveCode, reject) => {
      dump.once('error', reject);
      dump.once('close', resolveCode);
    });
    await run(
      'docker',
      [
        'exec',
        '-i',
        '-u',
        'postgres',
        CONTAINER,
        'pg_restore',
        '-U',
        user,
        '--no-owner',
        '-d',
        DB,
      ],
      dump.stdout,
    );
    const dumpCode = await dumpDone;
    assert.equal(dumpCode, 0, 'Read-only source dump failed');
    const scratchUrl = new URL(sourceUrl);
    scratchUrl.pathname = `/${DB}`;
    const base = {
      ...env,
      DATABASE_URL: scratchUrl.toString(),
      PRODUCT_P1R_ACCEPTANCE: '1',
      PRODUCT_P1R_PORT: '3003',
      API_PORT: '3003',
      WEB_PORT: '3002',
      PASSENGER_API_BASE_URL: 'http://127.0.0.1:3003/api/v1',
      PASSENGER_API_URL: 'http://127.0.0.1:3003/api/v1',
      PASSENGER_WEB_URL: 'http://127.0.0.1:3002',
      PRODUCT_ACCEPTANCE_DIST_DIR: '.next-product-acceptance',
      PASSENGER_NETWORK_SNAPSHOT_ID:
        env.PASSENGER_NETWORK_SNAPSHOT_ID ??
        '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f',
    };
    const webEnv = {
      ...base,
      PRODUCT_ACCEPTANCE_DIST_DIR: '.next-product-acceptance',
    };
    await run(
      'pnpm',
      ['--filter', '@transum-in/web', 'exec', 'next', 'build'],
      undefined,
      webEnv,
    );
    web = spawn(
      'pnpm',
      [
        '--filter',
        '@transum-in/web',
        'exec',
        'next',
        'start',
        '--port',
        '3002',
      ],
      { cwd: ROOT, env: webEnv, detached: true, stdio: 'ignore' },
    );
    const wait = async (url: string, child: ReturnType<typeof spawn>) => {
      for (let i = 0; i < 60; i++) {
        assert.equal(
          child.exitCode,
          null,
          `Owned service exited before readiness: ${new URL(url).host}`,
        );
        try {
          if ((await fetch(url)).ok) return;
        } catch {
          /* starting */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`Owned service readiness timeout: ${new URL(url).host}`);
    };
    // The browser harness owns the acceptance API process so it can read
    // readiness/injection lines from its stdout; the runner only owns web.
    await wait('http://127.0.0.1:3002', web);
    const evidence = await run(
      process.execPath,
      ['apps/web/scripts/passenger-browser-acceptance.mjs'],
      undefined,
      base,
    );
    passed = true;
    process.stdout.write(evidence);
    process.stdout.write(
      JSON.stringify({
        status: 'PASS',
        scratchDatabase: DB,
        cleanup: 'verified invocation-owned scratch only',
      }) + '\n',
    );
  } finally {
    for (const child of [web]) await stopOwned(child);
    if (owned && passed) {
      const actual = await admin
        .query<Identity>(
          "select datname as name, oid::int, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid,'pg_database'),'') as marker from pg_database where datname=$1",
          [DB],
        )
        .then((r) => r.rows[0] ?? null)
        .catch(() => null);
      const sessions = await admin
        .query(
          'select count(*)::int as count from pg_stat_activity where datname=$1',
          [DB],
        )
        .then((r) => r.rows[0]?.count ?? -1)
        .catch(() => -1);
      if (
        actual &&
        actual.name === owned.name &&
        actual.oid === owned.oid &&
        actual.owner === owned.owner &&
        actual.marker === marker &&
        sessions === 0
      ) {
        await admin.query(`drop database "${DB}"`).catch(() => undefined);
      }
    }
    await admin.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Acceptance runner failed'}\n`,
    );
    process.exitCode = 1;
  });
}
