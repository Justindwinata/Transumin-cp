import * as adminFieldReviewMigration from '../infrastructure/database/migrations/202610200001_admin_field_review.js';
import { AuthService } from '../auth/auth.service.js';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createServer as createPortProbe } from 'node:net';
import { createServer, request as httpsRequest } from 'node:https';
import { createServer as createHttpServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTAINER = 'transum-in-nexus-postgres-1';
const SOURCE = 'transum_in_nexus_product';
const SNAPSHOT = '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f';
const ROUTING_VERSION = 'bf7e3650-6af7-5bee-b25a-26f763f7fe4c';
const SPATIAL_VERSION = 'e6aa5be0-0cf4-5e33-8581-696af9a2045f';
const RAIL_VERSION = '19dde3d7-a359-5457-bea5-a6db1704543d';

type Identity = { name: string; oid: number; owner: string; marker: string };
type SuiteKey = keyof typeof SUITE_SCRIPTS;
/** Stage G: owned web/API processes restart while browser stays open; DB untouched. */
const productionRestart = process.argv.includes('--restart-production');
const exactGrants = process.argv.includes('--exact-runtime-grants');
const serveLocal = process.argv.includes('--serve-local');
const managedVolume = process.argv.includes('--managed-volume') || serveLocal;
if (serveLocal)
  assert.ok(
    exactGrants && process.argv.includes('--production-web'),
    'Local serving requires production web and exact runtime grants',
  );
const productionWeb =
  productionRestart || process.argv.includes('--production-web');
const RESTART_TLS_PORT = '3306';
/** Mutable stand-alone browser suites and the shared isolated browser framework. */
const SUITE_SCRIPTS = {
  CP2: 'apps/web/scripts/passenger-cp2-walk-navigation-acceptance.mjs',
  ADMIN_REPORTS: 'apps/web/scripts/passenger-admin-reports.mjs',
  CP3: 'apps/web/scripts/passenger-cp3-recovery-navigation-acceptance.mjs',
  V20: 'apps/web/scripts/passenger-r1-full-workflow.mjs',
  MOBILE: 'apps/web/scripts/passenger-mobile-v20-acceptance.mjs',
  FINAL: 'apps/web/scripts/passenger-final-supplement-acceptance.mjs',
  COMBINED: 'apps/web/scripts/passenger-combined-acceptance.mjs',
  PLACE_NEGATIVE:
    'apps/web/scripts/passenger-place-search-negative-acceptance.mjs',
  NEG: 'apps/web/scripts/passenger-endpoint-negative-acceptance.mjs',
  M5: 'apps/web/scripts/passenger-report-m5-acceptance.mjs',
  M6: 'apps/web/scripts/passenger-recovery-m6-acceptance.mjs',
  M7: 'apps/web/scripts/passenger-integrated-m7-acceptance.mjs',
  REPORTING_RATE_LIMIT:
    'apps/web/scripts/passenger-report-rate-limit-acceptance.mjs',
  TIMEOUT: 'apps/web/scripts/passenger-report-timeout-acceptance.mjs',
  GPS: 'apps/web/scripts/passenger-gps-browser-acceptance.mjs',
  GPS_STABILITY: 'apps/web/scripts/passenger-gps-stability.mjs',
  SESSION_STABILITY: 'apps/web/scripts/passenger-session-stability.mjs',
  ROUTING_STABILITY: 'apps/web/scripts/passenger-routing-stability.mjs',
  ROUTING_CORE: 'apps/web/scripts/passenger-routing-core.mjs',
  HANDOFF: 'apps/web/scripts/passenger-r4-f06-handoff-acceptance.mjs',
  SMOKE: 'apps/web/scripts/passenger-smoke.mjs',
  MODES: 'apps/web/scripts/passenger-modes-browser-acceptance.mjs',
  OTP: 'apps/web/scripts/passenger-otp-degraded-acceptance.mjs',
  S09: 'apps/web/scripts/passenger-s09-no-path-r1-acceptance.mjs',
  ADDR: 'apps/web/scripts/passenger-address-poi-acceptance.mjs',
  COPILOT: 'apps/web/scripts/passenger-copilot-acceptance.mjs',
} as const;
const recoverySuite = process.argv.includes('--recovery');
const suiteFlags = process.argv
  .filter((argument) => argument.startsWith('--suite='))
  .flatMap((argument) => argument.slice('--suite='.length).split(','))
  .map((key) => key.trim().toUpperCase())
  .map((key) => (key === 'S14' ? 'V20' : key) as SuiteKey);
for (const key of suiteFlags)
  assert.ok(
    key in SUITE_SCRIPTS,
    `Unknown suite ${key}; assignable: ${Object.keys(SUITE_SCRIPTS).join(',')}`,
  );
const selectedSuites: readonly SuiteKey[] = suiteFlags.length
  ? suiteFlags
  : [recoverySuite ? 'CP3' : 'CP2'];
const id = randomUUID();
const database = `tnx_cp2_${id.replaceAll('-', '')}`;
const marker = `tnx_cp2:${id}`;
const runtimeRole = `tnx_passenger_${id.replaceAll('-', '').slice(0, 48)}`;
const runtimePassword = randomBytes(32).toString('hex');

function q(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
function redact(value: string) {
  return value.replace(
    /(postgres(?:ql)?:\/\/[^\s:/@]+:)[^\s@]+@/gi,
    '$1[REDACTED]@',
  );
}
function urlFor(base: URL, name: string) {
  const value = new URL(base);
  value.pathname = `/${name}`;
  return value.toString();
}
async function identity(pool: Pool): Promise<Identity | null> {
  return (
    (
      await pool.query<Identity>(
        `select datname as name, oid::int, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid,'pg_database'),'') as marker from pg_database where datname=$1`,
        [database],
      )
    ).rows[0] ?? null
  );
}
async function copyTable(
  source: Pool,
  target: Pool,
  table: string,
  where: string,
  params: unknown[] = [],
) {
  const [schema, name] = table.split('.');
  const columns = (
    await source.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema=$1 and table_name=$2 and is_generated='NEVER' order by ordinal_position`,
      [schema, name],
    )
  ).rows.map((r: { column_name: string }) => r.column_name);
  const rows = (
    await source.query(
      `select ${columns.map(q).join(',')} from ${table} where ${where}`,
      params,
    )
  ).rows as Record<string, unknown>[];
  for (const row of rows) {
    const values = columns.map((column: string) => row[column]);
    await target.query(
      `insert into ${table} (${columns.map(q).join(',')}) values (${values.map((_: unknown, i: number) => `$${i + 1}`).join(',')}) on conflict do nothing`,
      values,
    );
  }
  return rows.length;
}
async function wait(url: string, child: ChildProcess) {
  for (let i = 0; i < 120; i += 1) {
    assert.equal(
      child.exitCode,
      null,
      `Owned service exited: ${new URL(url).host}`,
    );
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Owned service readiness timeout: ${new URL(url).host}`);
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const closed = await Promise.race([
    new Promise<boolean>((resolve) => child.once('close', () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  if (!closed) {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    await Promise.race([
      new Promise<void>((resolve) => child.once('close', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}
function forwardHttps(
  options: { key: Buffer; cert: Buffer },
  targetPort: number,
) {
  return createServer(options, (incoming, outgoing) => {
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.writeHead(502).end());
    incoming.pipe(upstream);
  });
}
async function otpRelay(target: string) {
  const upstream = new URL(target);
  assert.ok(['http:', 'https:'].includes(upstream.protocol));
  const controlPath = `/__control/${randomUUID()}`;
  let mode: 'healthy' | 'unavailable' | 'hang' = 'healthy';
  const relay = createHttpServer((incoming, outgoing) => {
    if (incoming.url === controlPath && incoming.method === 'POST') {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => (body += chunk));
      incoming.on('end', () => {
        const requested = JSON.parse(body).mode;
        assert.ok(['healthy', 'unavailable', 'hang'].includes(requested));
        mode = requested;
        outgoing.writeHead(204).end();
      });
      return;
    }
    if (mode === 'unavailable') {
      outgoing
        .writeHead(503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'OTP relay unavailable' }));
      return;
    }
    if (mode === 'hang') return;
    const transport = upstream.protocol === 'https:' ? httpsRequest : request;
    const proxy = transport(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    proxy.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(proxy);
  });
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const address = relay.address();
  assert.ok(address && typeof address === 'object');
  return {
    relay,
    endpoint: `http://127.0.0.1:${address.port}${upstream.pathname}`,
    controlPath,
    control: async (next: 'healthy' | 'unavailable' | 'hang') => {
      await fetch(`http://127.0.0.1:${address.port}${controlPath}`, {
        method: 'POST',
        body: JSON.stringify({ mode: next }),
        headers: { 'content-type': 'application/json' },
      });
    },
    cleanup: () => new Promise<void>((resolve) => relay.close(() => resolve())),
  };
}

async function productionTlsProxy(port: number, targetPort: number) {
  // Optional private local bundle preserves the certificate already reviewed
  // by the user across owned UAT rebuilds; it never changes browser trust.
  const supplied = process.env.LOCAL_UAT_TLS_DIR?.trim() || undefined;
  const persistent = Boolean(supplied) || serveLocal;
  const dir =
    supplied ??
    (serveLocal
      ? `${ROOT}.release-evidence/local-tls`
      : mkdtempSync(`${tmpdir()}/cp2-stage-g-tls-`));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = `${dir}/key.pem`;
  const cert = `${dir}/cert.pem`;
  assert.equal(
    existsSync(key),
    existsSync(cert),
    'Incomplete local TLS bundle; restore the matching private key and certificate',
  );
  if (supplied || existsSync(cert)) {
    assert.ok(
      dir.startsWith('/'),
      'Local TLS bundle requires an absolute path',
    );
    for (const path of [dir, key, cert]) {
      const stat = statSync(path);
      assert.equal(
        stat.uid,
        process.getuid?.(),
        'Local TLS bundle owner mismatch',
      );
      assert.equal(
        stat.mode & 0o077,
        0,
        'Local TLS bundle must remain private',
      );
    }
  } else {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdio: 'ignore' },
    );
    chmodSync(key, 0o600);
    chmodSync(cert, 0o600);
  }
  const proxy = forwardHttps(
    { key: readFileSync(key), cert: readFileSync(cert) },
    targetPort,
  );
  await new Promise<void>((resolve) =>
    proxy.listen(port, '127.0.0.1', resolve),
  );
  return {
    proxy,
    cleanup: () => {
      proxy.close();
      if (!persistent) rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  try {
    loadEnvFile(`${ROOT}.env`);
  } catch {
    /* env may be injected */
  }
  // Never accept another invocation's readiness response on a stale listener.
  for (const port of [
    3302,
    3303,
    3304,
    3305,
    3307,
    ...(productionRestart ? [3306] : []),
  ]) {
    await new Promise<void>((resolve, reject) => {
      const probe = createPortProbe();
      probe.once('error', () =>
        reject(
          new Error(
            `Local port ${port} is already in use; stop its owning runtime before starting another.`,
          ),
        ),
      );
      probe.listen(port, '127.0.0.1', () =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
    });
  }
  const env = process.env;
  assert.equal(env.POSTGRES_HOST, '127.0.0.1');
  assert.equal(env.POSTGRES_PORT, '5435');
  assert.equal(env.POSTGRES_DB, SOURCE);
  assert.ok(env.POSTGRES_USER && env.POSTGRES_PASSWORD);
  let base = new URL(
    `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:5435/${SOURCE}`,
  );
  const sourceBase = new URL(base);
  const ownedContainer = `tnx-passenger-${id}`;
  let ownedContainerId: string | undefined;
  const containerPassword = randomBytes(32).toString('hex');
  const docker = (args: string[], input?: string | Buffer) =>
    execFileSync('docker', args, {
      input,
      env: {
        ...env,
        POSTGRES_PASSWORD: containerPassword,
        PGPASSWORD: containerPassword,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: 256 * 1024 ** 2,
    });
  const psql = (name: string, sql: string, variables: string[] = []) =>
    docker(
      [
        'exec',
        '-i',
        '-e',
        'PGPASSWORD',
        ownedContainer,
        'psql',
        '-h',
        '127.0.0.1',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        name,
        ...variables,
      ],
      sql,
    );
  const ownedDataDirectory =
    exactGrants && !managedVolume
      ? mkdtempSync(
          `${process.env.TNX_DOCKER_BIND_ROOT ?? tmpdir()}/tnx-passenger-${id}-`,
        )
      : undefined;
  const ownedVolume = `tnx-passenger-${id}`;
  if (exactGrants) {
    if (managedVolume) {
      // A new named volume avoids macOS shared-directory UID translation.
      // No existing/product volume is mounted, adopted or removed.
      assert.equal(
        docker([
          'volume',
          'ls',
          '--filter',
          `name=^${ownedVolume}$`,
          '--format',
          '{{.Name}}',
        ])
          .toString()
          .trim(),
        '',
      );
      docker([
        'volume',
        'create',
        '--label',
        `tnx.passenger=${id}`,
        ownedVolume,
      ]);
    }
    docker([
      'run',
      '--mount',
      managedVolume
        ? `type=volume,source=${ownedVolume},target=/var/lib/postgresql/data`
        : `type=bind,source=${ownedDataDirectory},target=/var/lib/postgresql/data`,
      '-d',
      '--name',
      ownedContainer,
      '--label',
      `tnx.passenger=${id}`,
      '--memory=768m',
      '--cpus=1',
      '-e',
      'POSTGRES_PASSWORD',
      '-p',
      '127.0.0.1::5432',
      'transum-in-nexus/postgis:17.11-3.6',
    ]);
    const inspected = JSON.parse(
      docker(['inspect', ownedContainer]).toString(),
    )[0];
    assert.equal(inspected.Config.Labels['tnx.passenger'], id);
    ownedContainerId = inspected.Id;
    // Image entrypoint initializes owned bind mount, then drops to postgres.
    assert.equal(inspected.Config.User, '');
    const mount = inspected.Mounts.find(
      (entry: { Destination: string }) =>
        entry.Destination === '/var/lib/postgresql/data',
    );
    assert.equal(mount.Type, managedVolume ? 'volume' : 'bind');
    if (managedVolume) {
      assert.equal(mount.Name, ownedVolume);
      const volume = JSON.parse(
        docker(['volume', 'inspect', ownedVolume]).toString(),
      )[0];
      assert.equal(volume.Labels['tnx.passenger'], id);
    } else assert.equal(mount.Source, ownedDataDirectory);
    assert.equal(mount.RW, true);
    console.log(
      JSON.stringify({
        owned_storage: {
          source: managedVolume ? ownedVolume : ownedDataDirectory,
          destination: mount.Destination,
          type: mount.Type,
          free_bytes: ownedDataDirectory
            ? statfsSync(ownedDataDirectory).bavail *
              statfsSync(ownedDataDirectory).bsize
            : null,
          reserve_bytes: 1024 ** 3,
        },
      }),
    );
    const binding = inspected.NetworkSettings.Ports['5432/tcp'][0];
    assert.equal(binding.HostIp, '127.0.0.1');
    base = new URL(
      `postgresql://postgres:${containerPassword}@127.0.0.1:${binding.HostPort}/${SOURCE}`,
    );
    console.log(
      JSON.stringify({
        container: ownedContainer,
        id: ownedContainerId,
        marker,
        port: binding.HostPort,
      }),
    );
    let lastErr: string;
    for (let attempt = 0; ; attempt++) {
      try {
        psql('postgres', 'select 1');
        break;
      } catch (error) {
        lastErr = String((error as Error).message ?? error).slice(0, 800);
        if (attempt >= 120) {
          try {
            const logs = docker(['logs', ownedContainer])
              .toString()
              .slice(-4000);
            console.error(
              JSON.stringify({
                owned_ready_failed: lastErr,
                docker_logs_tail: logs,
              }),
            );
          } catch {
            // Container may already be gone; readiness failure remains authoritative.
          }
          assert.fail(`Owned database readiness deadline: ${lastErr}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  const admin = new Pool({
    connectionString: urlFor(base, 'postgres'),
    max: 1,
  });
  const source = new Pool({
    connectionString: sourceBase.toString(),
    max: 1,
    options: '-c default_transaction_read_only=on',
  });
  let target: Pool | undefined;
  let scratch: Identity | null = null;
  let api: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  let reviewerApi: ChildProcess | undefined;
  let adminReviewApi: ChildProcess | undefined;
  let tls: Awaited<ReturnType<typeof productionTlsProxy>> | undefined;
  let otp: Awaited<ReturnType<typeof otpRelay>> | undefined;
  let passed = false;
  try {
    const dockerFree = ownedDataDirectory
      ? statfsSync(ownedDataDirectory).bavail *
        statfsSync(ownedDataDirectory).bsize
      : Number(
          execFileSync(
            'docker',
            [
              'exec',
              exactGrants ? ownedContainer : CONTAINER,
              'df',
              '-k',
              '--output=avail',
              '/var/lib/postgresql/data',
            ],
            {
              encoding: 'utf8',
            },
          )
            .trim()
            .split('\n')
            .at(-1),
        ) * 1024;
    const hostFree =
      Number(
        execFileSync('df', ['-k', ROOT], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .at(-1)
          ?.trim()
          .split(/\s+/)
          .at(-3),
      ) * 1024;
    assert.ok(
      Number.isSafeInteger(dockerFree) && dockerFree > 1024 ** 3,
      'Insufficient Docker headroom; scratch creation refused',
    );
    assert.ok(
      Number.isSafeInteger(hostFree) && hostFree > 1024 ** 3,
      'Insufficient host headroom; scratch creation refused',
    );
    const inspect = JSON.parse(
      execFileSync('docker', ['inspect', CONTAINER], { encoding: 'utf8' }),
    )[0];
    assert.equal(inspect.Config.Image, 'transum-in-nexus/postgis:17.11-3.6');
    assert.equal(
      inspect.Mounts.find(
        (m: { Destination: string }) =>
          m.Destination === '/var/lib/postgresql/data',
      )?.Name,
      env.POSTGRES_VOLUME_NAME,
    );
    const sourceAdmin = exactGrants
      ? new Pool({
          connectionString: urlFor(sourceBase, 'postgres'),
          max: 1,
          options: '-c default_transaction_read_only=on',
        })
      : admin;
    const server = (
      await sourceAdmin.query(
        'select system_identifier::text from pg_control_system()',
      )
    ).rows[0].system_identifier;
    const dockerServer = execFileSync(
      'docker',
      [
        'exec',
        '-u',
        'postgres',
        CONTAINER,
        'psql',
        '-U',
        env.POSTGRES_USER,
        '-d',
        'postgres',
        '-Atqc',
        'select system_identifier::text from pg_control_system()',
      ],
      { encoding: 'utf8' },
    ).trim();
    if (sourceAdmin !== admin) await sourceAdmin.end();
    assert.equal(
      server,
      dockerServer,
      'Endpoint is not authorized product Docker server',
    );
    assert.equal(
      (
        await admin.query('select 1 from pg_database where datname=$1', [
          database,
        ])
      ).rowCount,
      0,
    );
    await admin.query(`create database ${q(database)}`);
    scratch = await identity(admin);
    assert.ok(scratch);
    await admin.query(`comment on database ${q(database)} is '${marker}'`);
    scratch = await identity(admin);
    assert.deepEqual(scratch, { ...scratch, marker });
    const migrationPool = new Pool({
      connectionString: urlFor(base, database),
      max: 1,
    });
    const db = new Kysely<FoundationDatabase>({
      dialect: new PostgresDialect({ pool: migrationPool }),
    });
    await migrateToLatest(db);
    if (selectedSuites.includes('ADMIN_REPORTS')) {
      // Fresh upgrade, safe empty-authority downgrade, and current-schema reapply;
      // only this invocation-owned scratch is writable here.
      await adminFieldReviewMigration.down(db);
      await adminFieldReviewMigration.up(db);
      console.log(
        JSON.stringify({
          admin_review_migration: 'PASS',
          scope:
            'fresh scratch + downgrade/reapply before field records; product untouched',
        }),
      );
    }
    await db.destroy();
    target = new Pool({ connectionString: urlFor(base, database), max: 4 });
    const versions = [ROUTING_VERSION, SPATIAL_VERSION, RAIL_VERSION];
    assert.equal(
      (await source.query('show default_transaction_read_only')).rows[0]
        .default_transaction_read_only,
      'on',
    );
    await source.query('begin transaction read only');
    assert.equal(
      (await source.query('show transaction_read_only')).rows[0]
        .transaction_read_only,
      'on',
    );
    try {
      const versionRows = await source.query(
        `select * from meta.dataset_version where id = any($1::uuid[])`,
        [versions],
      );
      const sourceIds = [
        ...new Set(versionRows.rows.map((row) => row.source_id)),
      ];
      await copyTable(
        source,
        target,
        'meta.dataset_source',
        `id = any($1::uuid[])`,
        [sourceIds],
      );
      await copyTable(
        source,
        target,
        'meta.dataset_version',
        `id = any($1::uuid[])`,
        [versions],
      );
      const entityIds = (
        await source.query(
          `select distinct canonical_entity_id from meta.source_entity_reference where source_dataset_version_id = any($1::uuid[])`,
          [versions],
        )
      ).rows.map((r) => r.canonical_entity_id);
      await copyTable(
        source,
        target,
        'twin.mobility_entity',
        'id = any($1::uuid[])',
        [entityIds],
      );
      await copyTable(
        source,
        target,
        'meta.source_entity_reference',
        'source_dataset_version_id = any($1::uuid[])',
        [versions],
      );
      await copyTable(source, target, 'twin.network_snapshot', 'id=$1::uuid', [
        SNAPSHOT,
      ]);
      // Place search and plan identity resolution read the snapshot's transit
      // and rail corpora; the isolated runtime needs the same bounded corpus or
      // suites silently fall back to the shared product surface.
      for (const table of [
        'transit.operator',
        'transit.service_calendar',
        'transit.transit_shape',
        'transit.route',
        'transit.station',
        'transit.stop',
        'transit.trip',
        'transit.stop_time',
        'spatial.rail_topology_station',
      ])
        await copyTable(
          source,
          target,
          table,
          'dataset_version_id = any($1::uuid[])',
          [versions],
        );
      await source.query('commit');
    } catch (error) {
      await source.query('rollback');
      throw error;
    }
    assert.equal(
      (
        await target.query(
          'select count(*) from twin.network_snapshot where id=$1',
          [SNAPSHOT],
        )
      ).rows[0].count,
      '1',
    );
    assert.ok(
      Number(
        (
          await target.query(
            'select count(*) from meta.source_entity_reference',
          )
        ).rows[0].count,
      ) > 0,
    );
    const otpTarget = env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1';
    otp = await otpRelay(otpTarget);
    let runtimeUrl = urlFor(base, database);
    let adminReviewUrl: string | undefined;
    if (exactGrants) {
      psql(
        database,
        `create role ${q(runtimeRole)} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${runtimePassword}';`,
      );
      const template = readFileSync(
        `${ROOT}/database/operations/passenger-runtime-grants.sql`,
        'utf8',
      );
      psql(database, template, [
        '-v',
        `runtime_role=${runtimeRole}`,
        '-v',
        `database_name=${database}`,
      ]);
      const runtimeBase = new URL(base);
      runtimeBase.username = runtimeRole;
      runtimeBase.password = runtimePassword;
      runtimeUrl = urlFor(runtimeBase, database);
      const runtime = new Pool({ connectionString: runtimeUrl, max: 1 });
      try {
        const flags = (
          await runtime.query(
            'select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user',
          )
        ).rows[0];
        assert.ok(Object.values(flags).every((value) => value === false));
        for (const sql of [
          'insert into transit.station select * from transit.station where false',
          'update twin.mobility_state set id=id where false',
          'delete from journey.active_journey where false',
          'update recovery.recovery_plan set comparison_json=comparison_json where false',
          'update recovery.recovery_acceptance set acceptance_json=acceptance_json where false',
          'insert into report.passenger_report_review select * from report.passenger_report_review where false',
        ])
          await assert.rejects(
            runtime.query(sql),
            (error: unknown) => (error as { code?: string }).code === '42501',
          );
        console.log(
          JSON.stringify({
            exact_runtime_grants: true,
            template_sha256: createHash('sha256')
              .update(template)
              .digest('hex'),
            role_flags: flags,
            denied_ingestion_state_delete: true,
          }),
        );
      } finally {
        await runtime.end();
      }
    }
    if (
      exactGrants &&
      (serveLocal || selectedSuites.includes('ADMIN_REPORTS'))
    ) {
      const role = `tnx_admin_review_${id.replaceAll('-', '')}`;
      const password = randomBytes(32).toString('hex');
      psql(
        database,
        `create role ${q(role)} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}';`,
      );
      for (const file of [
        'passenger-runtime-grants.sql',
        'admin-review-runtime-grants.sql',
      ]) {
        const template = readFileSync(
          `${ROOT}/database/operations/${file}`,
          'utf8',
        );
        psql(database, template, [
          '-v',
          `runtime_role=${role}`,
          '-v',
          `database_name=${database}`,
        ]);
      }
      const adminBase = new URL(base);
      adminBase.username = role;
      adminBase.password = password;
      adminReviewUrl = urlFor(adminBase, database);
      console.log(
        JSON.stringify({
          admin_review_role: role,
          separate_from_passenger_role: role !== runtimeRole,
          mode: 'ADMIN_FIELD_REVIEW',
        }),
      );
    }
    if (serveLocal || selectedSuites.includes('ADMIN_REPORTS')) {
      assert.ok(
        scratch && scratch.marker === marker && scratch.name === database,
      );
      const fixtureDb = new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: urlFor(base, database), max: 1 }),
        }),
      });
      try {
        const fixtureAuth = new AuthService(fixtureDb);
        for (const account of [
          {
            email: 'admin.sample@local.test',
            password: 'SAMPLE-Admin-123456',
            roles: ['ADMIN'] as const,
          },
          {
            email: 'passenger.sample@local.test',
            password: 'SAMPLE-Passenger-123',
            roles: ['PASSENGER'] as const,
          },
          {
            email: 'researcher.sample@local.test',
            password: 'SAMPLE-Researcher-123',
            roles: ['RESEARCHER_OPERATOR'] as const,
          },
        ])
          await fixtureAuth.provision(account.email, account.password, [
            ...account.roles,
          ]);
      } finally {
        await fixtureDb.destroy();
      }
      console.log(
        JSON.stringify({
          admin_review_sample_accounts: true,
          scope: 'Owned scratch only; SAMPLE identities',
        }),
      );
    }
    const childEnv = {
      ...env,
      DATABASE_URL: runtimeUrl,
      ADMIN_FIELD_REVIEW_ENABLED: 'false',
      OPS_API_BASE_URL: 'http://127.0.0.1:3303/api/v1',
      ADMIN_REVIEW_API_BASE_URL: adminReviewUrl
        ? 'http://127.0.0.1:3305/api/v1'
        : '',
      AUTH_ORIGIN: productionWeb
        ? 'https://127.0.0.1:3302'
        : 'http://127.0.0.1:3302',
      CP2_EXPECTED_DB_PORT: base.port,
      PRODUCT_ACCEPTANCE_EVIDENCE_DIR:
        env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR ??
        `${ROOT}/.release-evidence/exact-runtime-${id}`,
      CONTROLLED_REVIEW_API_URL: exactGrants
        ? 'http://127.0.0.1:3304/api/v1'
        : 'http://127.0.0.1:3303/api/v1',
      POSTGRES_DB: database,
      PRODUCT_P1R_ACCEPTANCE: '1',
      PRODUCT_P1R_PORT: '3303',
      API_PORT: '3303',
      PASSENGER_API_BASE_URL: 'http://127.0.0.1:3303/api/v1',
      PASSENGER_SESSION_SECRET: randomBytes(32).toString('hex'),
      PASSENGER_SERVICE_TOKEN: randomBytes(32).toString('hex'),
      CONTROLLED_REVIEW_ENABLED: exactGrants ? 'false' : 'true',
      CONTROLLED_REVIEW_TOKEN:
        typeof env.CONTROLLED_REVIEW_TOKEN === 'string' &&
        env.CONTROLLED_REVIEW_TOKEN.length >= 32
          ? env.CONTROLLED_REVIEW_TOKEN
          : 'test-controlled-reviewer-0123456789abcdef',
      NEXT_TELEMETRY_DISABLED: '1',
      PASSENGER_API_URL: 'http://127.0.0.1:3303/api/v1',
      PASSENGER_NETWORK_SNAPSHOT_ID: SNAPSHOT,
      PASSENGER_WEB_URL: 'http://127.0.0.1:3302',
      M5_API_URL: 'http://127.0.0.1:3303/api/v1',
      M5_WEB_URL: 'http://127.0.0.1:3302',
      M6_API_URL: 'http://127.0.0.1:3303/api/v1',
      M6_WEB_URL: 'http://127.0.0.1:3302',
      M7_API_URL: 'http://127.0.0.1:3303/api/v1',
      M7_WEB_URL: 'http://127.0.0.1:3302',
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3303/api/v1',
      WEB_PORT: '3302',
      OTP_URL: otp.endpoint,
      OTP_RELAY_CONTROL: `http://127.0.0.1:${new URL(otp.endpoint).port}${otp.controlPath}`,
      PRODUCT_ACCEPTANCE_DIST_DIR: productionWeb
        ? '.next-cp2-stage-g-production'
        : '.next-cp2-acceptance-dev',
      CP2_EXPECTED_INVOCATION: id,
      CP2_EXPECTED_DB: database,
      CP2_EXPECTED_MARKER: marker,
      CP2_EXPECTED_OID: String(scratch.oid),
      CP2_EXPECTED_OWNER: scratch.owner,
    };
    const startApi = async () => {
      api = spawn(
        process.execPath,
        ['--import', 'tsx', 'src/journey/product-p1r-browser.cli.ts'],
        {
          cwd: `${ROOT}/apps/api`,
          env: childEnv,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const ownedApi = api;
      const readyLine = await new Promise<string>((resolve, reject) => {
        const chunks: Array<string> = [];
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                'Owned API identity timeout; child output withheld (may contain sensitive data)',
              ),
            ),
          60000,
        );
        ownedApi.stdout!.setEncoding('utf8');
        ownedApi.stdout!.on('data', (chunk: string) => {
          chunks.push(chunk);
          const line = chunks
            .join('')
            .split('\n')
            .find((candidate) => candidate.includes('P1R_ACCEPTANCE_READY'));
          if (line) {
            clearTimeout(timeout);
            resolve(line);
          }
        });
        ownedApi.stderr!.setEncoding('utf8');
        ownedApi.stderr!.on('data', (chunk: string) => chunks.push(chunk));
        ownedApi.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        ownedApi.once('exit', (code) => {
          clearTimeout(timeout);
          const diagnostic = chunks.join('');
          const safeCode =
            diagnostic
              .split('\n')
              .filter((line) =>
                /(?:Error:|error:|EADDRINUSE|EACCES|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|permission denied for [a-z_ ]+|DATABASE_[A-Z_]+)/i.test(
                  line,
                ),
              )
              .slice(-8)
              .map((line) =>
                line
                  .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL]')
                  .replace(/(authorization: ?bearer\s+)\S+/gi, '$1[REDACTED]')
                  .slice(0, 400),
              )
              .join('\n') || 'details withheld';
          reject(
            new Error(
              `Owned API exited before readiness: ${code}; ${safeCode}`,
            ),
          );
        });
      });
      console.log(redact(readyLine.trim()));
      await wait('http://127.0.0.1:3303/health/ready', api);
      if (exactGrants) {
        const sessions = (
          await target!.query(
            `select usename, count(*)::int connections from pg_stat_activity where datname=$1 and usename=$2 group by usename`,
            [database, runtimeRole],
          )
        ).rows;
        assert.ok(
          sessions.length === 1 && sessions[0].connections > 0,
          'Passenger API runtime-role database session missing',
        );
        console.log(
          JSON.stringify({
            passenger_api_sessions: sessions,
            controlled_review_enabled: false,
            api_host: 'acceptance-configured Nest AppModule; no role switching',
            reviewer_port: 3304,
          }),
        );
      }
    };
    await startApi();
    const startAdminReviewApi = async () => {
      if (!adminReviewUrl) return;
      adminReviewApi = spawn(
        process.execPath,
        ['--import', 'tsx', 'src/journey/product-p1r-browser.cli.ts'],
        {
          cwd: `${ROOT}/apps/api`,
          detached: true,
          stdio: ['pipe', 'ignore', 'ignore'],
          env: {
            ...childEnv,
            DATABASE_URL: adminReviewUrl,
            PRODUCT_P1R_PORT: '3305',
            API_PORT: '3305',
            CONTROLLED_REVIEW_ENABLED: 'false',
            ADMIN_FIELD_REVIEW_ENABLED: 'true',
          },
        },
      );
      await wait('http://127.0.0.1:3305/health/ready', adminReviewApi);
    };
    await startAdminReviewApi();
    if (exactGrants) {
      reviewerApi = spawn(
        process.execPath,
        ['--import', 'tsx', 'src/journey/product-p1r-browser.cli.ts'],
        {
          cwd: `${ROOT}/apps/api`,
          detached: true,
          stdio: ['pipe', 'ignore', 'ignore'],
          env: {
            ...childEnv,
            DATABASE_URL: urlFor(base, database),
            PRODUCT_P1R_PORT: '3304',
            API_PORT: '3304',
            CONTROLLED_REVIEW_ENABLED: 'true',
          },
        },
      );
      await wait('http://127.0.0.1:3304/health/ready', reviewerApi);
    }
    if (productionWeb && !productionRestart) {
      for (const key of [
        'PASSENGER_WEB_URL',
        'M5_WEB_URL',
        'M6_WEB_URL',
        'M7_WEB_URL',
      ] as const)
        childEnv[key] = 'https://127.0.0.1:3302';
      tls = await productionTlsProxy(3302, 3307);
    }
    const webEnv = {
      ...childEnv,
      NODE_ENV: productionWeb ? 'production' : 'development',
    };
    const startWeb = async () => {
      // Spawn the actual CLI in our process group. A pnpm exec wrapper can
      // exit before its detached Next descendant and leave a stale service.
      web = spawn(
        process.execPath,
        [
          createRequire(`${ROOT}/apps/web/package.json`).resolve(
            'next/dist/bin/next',
          ),
          productionWeb ? 'start' : 'dev',
          '--hostname',
          '127.0.0.1',
          '--port',
          productionWeb && !productionRestart ? '3307' : '3302',
        ],
        {
          cwd: `${ROOT}/apps/web`,
          env: webEnv,
          detached: true,
          stdio: 'ignore',
        },
      );
      await wait(
        productionWeb && !productionRestart
          ? 'http://127.0.0.1:3307'
          : 'http://127.0.0.1:3302',
        web,
      );
    };
    if (productionWeb) {
      if (productionRestart)
        assert.equal(
          suiteFlags.length,
          0,
          'Restart proof runs alone; omit --suite',
        );
      await new Promise<void>((resolve, reject) => {
        const build = spawn(
          'pnpm',
          ['--filter', '@transum-in/web', 'exec', 'next', 'build'],
          {
            cwd: ROOT,
            env: webEnv,
            stdio: 'ignore',
          },
        );
        build.once('error', reject);
        build.once('close', (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  'Owned production Next build failed; output withheld',
                ),
              ),
        );
      });
      if (productionRestart)
        tls = await productionTlsProxy(Number(RESTART_TLS_PORT), 3302);
    }
    await startWeb();
    const browserEnv = {
      ...childEnv,
      ...(productionWeb && !productionRestart
        ? { NODE_TLS_REJECT_UNAUTHORIZED: '0' }
        : {}),
      CONTROLLED_REVIEW_ENABLED: 'true',
      CP2_API_PID: String(api!.pid),
    };
    if (productionRestart) {
      const suite = spawn(
        process.execPath,
        ['apps/web/scripts/passenger-production-restart-acceptance.mjs'],
        {
          cwd: ROOT,
          env: {
            ...browserEnv,
            STAGE_G_WEB_URL: `https://127.0.0.1:${RESTART_TLS_PORT}`,
            NODE_ENV: 'production',
          },
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      );
      let restarted = false;
      let restartError: unknown;
      let restartTask: Promise<void> = Promise.resolve();
      let apiStopped = false;
      const ownedRestartGuard = async (action: () => Promise<void>) => {
        await restartTask;
        restartTask = action().catch((error) => {
          restartError = error;
          suite.kill('SIGTERM');
          throw error;
        });
        await restartTask;
      };
      suite.on('message', (message) => {
        const type = (message as { type?: string }).type;
        if (!type) return;
        void (async () => {
          if (type === 'RESTART_WEB') {
            await ownedRestartGuard(async () => {
              assert.deepEqual(
                await identity(admin),
                scratch,
                'Scratch identity changed before web restart',
              );
              await stop(web);
              assert.ok(
                web!.exitCode !== null || web!.signalCode !== null,
                'Owned web did not stop',
              );
              await startWeb();
              suite.send({ type: 'WEB_RESTARTED' });
            });
          } else if (type === 'STOP_API') {
            await ownedRestartGuard(async () => {
              assert.deepEqual(
                await identity(admin),
                scratch,
                'Scratch identity changed before API stop',
              );
              await stop(api);
              assert.ok(
                api!.exitCode !== null || api!.signalCode !== null,
                'Owned API did not stop',
              );
              apiStopped = true;
              suite.send({ type: 'API_STOPPED' });
            });
          } else if (type === 'START_API') {
            await ownedRestartGuard(async () => {
              assert.ok(
                apiStopped,
                'API start requested without owned API stop',
              );
              const oldPid = api!.pid;
              await startApi();
              assert.notEqual(api!.pid, oldPid, 'API PID did not change');
              assert.deepEqual(
                await identity(admin),
                scratch,
                'Scratch identity changed after API restart',
              );
              apiStopped = false;
              restarted = true;
              suite.send({ type: 'API_RESTARTED', apiPid: String(api!.pid) });
            });
          } else if (type === 'RESTART') {
            await ownedRestartGuard(async () => {
              assert.deepEqual(
                await identity(admin),
                scratch,
                'Scratch identity changed before restart',
              );
              const oldPid = api!.pid;
              await stop(web);
              await stop(api);
              assert.ok(
                api!.exitCode !== null || api!.signalCode !== null,
                'Owned API did not stop',
              );
              assert.ok(
                web!.exitCode !== null || web!.signalCode !== null,
                'Owned web did not stop',
              );
              await startApi();
              await startWeb();
              assert.notEqual(api!.pid, oldPid, 'API PID did not change');
              assert.deepEqual(
                await identity(admin),
                scratch,
                'Scratch identity changed after restart',
              );
              restarted = true;
              suite.send({ type: 'RESTARTED', apiPid: String(api!.pid) });
            });
          }
        })().catch(() => undefined);
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        suite.once('error', reject);
        suite.once('close', resolve);
      });
      await restartTask;
      if (restartError) throw restartError;
      assert.ok(restarted, 'Browser did not request restart');
      assert.equal(code, 0, 'Stage G browser proof failed');
    }
    const hasCp2 = !productionRestart && selectedSuites.includes('CP2');
    const hasCp3 = !productionRestart && selectedSuites.includes('CP3');
    for (const key of productionRestart ? [] : selectedSuites) {
      const script = SUITE_SCRIPTS[key];
      console.log(JSON.stringify({ suite: key, script }));
      const suite = spawn(process.execPath, [script], {
        cwd: ROOT,
        env: browserEnv,
        stdio: 'inherit',
      });
      const suiteCode = await new Promise<number | null>((resolve, reject) => {
        suite.once('error', reject);
        suite.once('close', resolve);
      });
      assert.equal(suiteCode, 0, `${key} browser proof failed`);
    }
    if (selectedSuites.includes('ADMIN_REPORTS')) {
      assert.ok(target && scratch && scratch.marker === marker);
      await assert.rejects(
        target.query(`insert into report.passenger_report_review
        (report_id,incident_id,reviewer_ref,evidence_json,review_authority,actor_user_id,supporting_reference)
        select report_id,incident_id,reviewer_ref,evidence_json,'ADMIN_FIELD_REVIEW',null,supporting_reference
        from report.passenger_report_review where review_authority='ADMIN_FIELD_REVIEW' limit 1`),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      const verifyDb = new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: urlFor(base, database), max: 1 }),
        }),
      });
      try {
        await assert.rejects(
          adminFieldReviewMigration.down(verifyDb),
          /ADMIN_FIELD_REVIEW_DOWNGRADE_REQUIRES_FORWARD_RECOVERY/,
        );
      } finally {
        await verifyDb.destroy();
      }
      console.log(
        JSON.stringify({
          admin_review_constraints: 'PASS',
          unsafe_downgrade_refused: true,
          scope: 'populated owned scratch',
        }),
      );
    }
    if (hasCp3 && process.env.R7_SEQUENTIAL_RECOVERY === '1') {
      const lineage = await target.query<{
        proposal_base_matches: boolean;
        predecessor_exists: boolean;
        pointer_matches: boolean;
      }>(`
        select
          p.comparison_json->>'baseRecoveryId' =
            a.acceptance_json->>'predecessorRecoveryId' as proposal_base_matches,
          exists(select 1 from recovery.recovery_acceptance predecessor
            where predecessor.recovery_id =
              (a.acceptance_json->>'predecessorRecoveryId')::uuid
              and predecessor.active_journey_id=a.active_journey_id) as predecessor_exists,
          j.accepted_recovery_id=a.recovery_id as pointer_matches
        from recovery.recovery_acceptance a
        join recovery.recovery_plan p on p.id=a.recovery_id
        join journey.active_journey j on j.journey_id=a.active_journey_id
        where a.acceptance_json->>'predecessorRecoveryId' is not null
      `);
      assert.equal(lineage.rows.length, 1, 'R2 durable acceptance required');
      assert.deepEqual(lineage.rows[0], {
        proposal_base_matches: true,
        predecessor_exists: true,
        pointer_matches: true,
      });
      console.log(
        'ASSERT sequential.durable_lineage base=R1 predecessor=R1 pointer=R2 exact=true',
      );
    }
    if (hasCp2) {
      const r4 = spawn(
        process.execPath,
        ['apps/web/scripts/passenger-r4-f04-acceptance.mjs'],
        {
          cwd: ROOT,
          env: browserEnv,
          stdio: 'inherit',
        },
      );
      const r4Code = await new Promise<number | null>((resolve, reject) => {
        r4.once('error', reject);
        r4.once('close', resolve);
      });
      assert.equal(r4Code, 0, 'R4 browser proof failed');
    }
    if (exactGrants) {
      await stop(web);
      await stop(api);
      await stop(reviewerApi);
      await stop(adminReviewApi);
      const restoredName = `${database}_restore`;
      assert.deepEqual(
        await identity(admin),
        scratch,
        'Scratch changed before backup',
      );
      const dump = docker([
        'exec',
        '-e',
        'PGPASSWORD',
        ownedContainer,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        database,
        '-Fc',
      ]);
      await admin.query(`create database ${q(restoredName)}`);
      await admin.query(
        `comment on database ${q(restoredName)} is '${marker}:restore'`,
      );
      const restoreIdentity = (
        await admin.query(
          `select oid::int, pg_get_userbyid(datdba) owner, shobj_description(oid,'pg_database') marker from pg_database where datname=$1`,
          [restoredName],
        )
      ).rows[0];
      docker(
        [
          'exec',
          '-i',
          '-e',
          'PGPASSWORD',
          ownedContainer,
          'pg_restore',
          '-U',
          'postgres',
          '--exit-on-error',
          '-d',
          restoredName,
        ],
        dump,
      );
      const restored = new Pool({
        connectionString: urlFor(base, restoredName),
        max: 1,
      });
      const hashes = async (pool: Pool) => {
        const tables = (
          await pool.query(
            `select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog','information_schema','public') order by 1,2`,
          )
        ).rows;
        const results = [];
        for (const { schemaname, tablename } of tables) {
          const table = `${q(schemaname)}.${q(tablename)}`;
          results.push({
            table,
            ...(
              await pool.query(
                `select count(*)::int rows, md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) hash from (select md5(to_jsonb(t)::text) row_hash from ${table} t) hashed`,
              )
            ).rows[0],
          });
        }
        return results;
      };
      try {
        const originalHashes = await hashes(target);
        assert.deepEqual(await hashes(restored), originalHashes);
        const requiresRecoveryAcceptance = selectedSuites.some((suite) =>
          ['COMBINED', 'V20', 'CP3', 'M6', 'M7'].includes(suite),
        );
        const requiresPassengerReport = selectedSuites.some((suite) =>
          ['COMBINED', 'V20', 'CP3', 'M5', 'M6', 'M7', 'S09'].includes(suite),
        );
        const requiresCopilotRead = selectedSuites.some((suite) =>
          ['COMBINED', 'COPILOT'].includes(suite),
        );
        const copilotTables = [
          'copilot.session',
          'copilot.message',
          'copilot.tool_audit',
        ];
        const populatedTables = [
          '"journey"."active_journey"',
          ...(requiresRecoveryAcceptance
            ? ['"recovery"."recovery_acceptance"']
            : []),
          ...(requiresPassengerReport ? ['"report"."passenger_report"'] : []),
          ...(requiresCopilotRead
            ? copilotTables.map((table) => `"${table.replace('.', '"."')}"`)
            : []),
        ];
        for (const table of populatedTables)
          assert.ok(
            originalHashes.some((row) => row.table === table && row.rows > 0),
            `Populated backup required: ${table}`,
          );
        const catalog = async (pool: Pool) =>
          (
            await pool.query(
              `select 'constraint' kind,n.nspname schema,c.relname name,con.conname item,pg_get_constraintdef(con.oid) definition,con.convalidated valid from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' union all select 'index',n.nspname,c.relname,ic.relname,pg_get_indexdef(i.indexrelid),i.indisvalid from pg_index i join pg_class c on c.oid=i.indrelid join pg_class ic on ic.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' order by 1,2,3,4`,
            )
          ).rows;
        const originalCatalog = await catalog(target);
        const restoredCatalog = await catalog(restored);
        const invalidCatalog = (rows: typeof originalCatalog) =>
          rows.filter((row) => row.valid === false);
        // Migration 202610080001 deliberately leaves legacy hazard evidence NOT VALID.
        for (const [scope, rows] of [
          ['original', originalCatalog],
          ['restored', restoredCatalog],
        ] as const)
          assert.deepEqual(
            invalidCatalog(rows).map(({ kind, schema, name, item }) => ({
              kind,
              schema,
              name,
              item,
            })),
            [
              {
                kind: 'constraint',
                schema: 'disruption',
                name: 'event',
                item: 'disruption_event_hazard_evidence_check',
              },
            ],
            `Unexpected invalid constraint/index in ${scope} catalog`,
          );
        const definitionDifferences = originalCatalog.flatMap((row, index) =>
          row.definition === restoredCatalog[index]?.definition
            ? []
            : [{ original: row, restored: restoredCatalog[index] }],
        );
        const constraintStructure = async (pool: Pool) =>
          (
            await pool.query(
              `select n.nspname schema,c.relname table_name,con.conname,con.contype,array(select a.attname from unnest(con.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.num order by k.ord) conkey,array(select a.attname from unnest(con.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.num order by k.ord) confkey,con.confupdtype,con.confdeltype,con.confmatchtype,con.condeferrable,con.condeferred,con.convalidated,rn.nspname referenced_schema,rc.relname referenced_table from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace left join pg_class rc on rc.oid=con.confrelid left join pg_namespace rn on rn.oid=rc.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' order by 1,2,3`,
            )
          ).rows;
        assert.deepEqual(
          await constraintStructure(restored),
          await constraintStructure(target),
        );
        assert.deepEqual(
          restoredCatalog.filter((row) => row.kind === 'index'),
          originalCatalog.filter((row) => row.kind === 'index'),
        );
        assert.deepEqual(
          restoredCatalog.map(({ kind, schema, name, item, valid }) => ({
            kind,
            schema,
            name,
            item,
            valid,
          })),
          originalCatalog.map(({ kind, schema, name, item, valid }) => ({
            kind,
            schema,
            name,
            item,
            valid,
          })),
          'Restored constraint/index validation state differs',
        );
        if (definitionDifferences.length)
          console.log(
            JSON.stringify({
              constraint_definition_comparison: 'NOT_IDENTICAL',
              differences: definitionDifferences,
              scope:
                'Definitions retained verbatim; no equivalence claim for changed expressions. Constraint structure and index definitions compared separately.',
            }),
          );
        const readUrl = new URL(runtimeUrl);
        readUrl.pathname = `/${restoredName}`;
        const runtimeRead = new Pool({
          connectionString: readUrl.toString(),
          max: 1,
        });
        try {
          const requiresRecoveryRead = selectedSuites.some((suite) =>
            ['COMBINED', 'V20', 'CP3', 'M6', 'M7'].includes(suite),
          );
          const requiresReportRead = selectedSuites.some((suite) =>
            ['COMBINED', 'V20', 'CP3', 'M5', 'M6', 'M7', 'S09'].includes(suite),
          );
          const readableTables = [
            'journey.active_journey',
            ...(requiresRecoveryRead ? ['recovery.recovery_acceptance'] : []),
            ...(requiresReportRead ? ['report.passenger_report'] : []),
            ...(requiresCopilotRead ? copilotTables : []),
            'transit.route',
          ];
          for (const table of readableTables)
            assert.ok(
              Number(
                (await runtimeRead.query(`select count(*) from ${table}`))
                  .rows[0].count,
              ) > 0,
            );
        } finally {
          await runtimeRead.end();
        }
        console.log(
          JSON.stringify({
            backup_restore: 'PASS',
            scope: 'populated owned scratch only; no product dump',
            dump_sha256: createHash('sha256').update(dump).digest('hex'),
            rows: originalHashes,
            constraint_structure_equal: true,
            constraint_definitions_identical:
              definitionDifferences.length === 0,
            constraint_definition_difference_count:
              definitionDifferences.length,
            index_definitions_equal: true,
            restored_validation_matches_original: true,
            original_invalid_constraints_indexes:
              invalidCatalog(originalCatalog),
            restored_invalid_constraints_indexes:
              invalidCatalog(restoredCatalog),
            restored_constraints_indexes_valid: restoredCatalog.every(
              (row) => row.valid === true,
            ),
            restored_runtime_reads: true,
          }),
        );
      } finally {
        await restored.end();
      }
      assert.deepEqual(
        (
          await admin.query(
            `select oid::int, pg_get_userbyid(datdba) owner, shobj_description(oid,'pg_database') marker from pg_database where datname=$1`,
            [restoredName],
          )
        ).rows[0],
        restoreIdentity,
      );
      assert.equal(restoreIdentity.marker, `${marker}:restore`);
      assert.equal(
        Number(
          (
            await admin.query(
              'select count(*) from pg_stat_activity where datname=$1',
              [restoredName],
            )
          ).rows[0].count,
        ),
        0,
      );
      await admin.query(`drop database ${q(restoredName)}`);
    }
    passed = true;
    console.log(
      JSON.stringify({
        status: 'PASS',
        tier: `ISOLATED_SCRATCH_${selectedSuites.join('_')}`,
        suites: selectedSuites,
        database,
        marker,
        oid: scratch.oid,
        owner: scratch.owner,
        source_read_only: true,
        exact_runtime_grants: exactGrants,
        web_mode: productionWeb ? 'production' : 'development',
        api_port: 3303,
        web_port: 3302,
      }),
    );
    if (serveLocal) {
      // Exact-grants backup proof stops the servers; serving must restore them.
      await startApi();
      await startAdminReviewApi();
      await startWeb();
      await new Promise<void>((resolve, reject) => {
        const probe = httpsRequest(
          'https://127.0.0.1:3302',
          { rejectUnauthorized: false, timeout: 10000 },
          (response) => {
            response.resume();
            if (response.statusCode === 200) resolve();
            else reject(new Error(`Local web returned ${response.statusCode}`));
          },
        );
        probe.once('error', reject);
        probe.once('timeout', () =>
          probe.destroy(new Error('Local web timeout')),
        );
        probe.end();
      });
      console.log(
        JSON.stringify({
          status: 'LOCAL_PASSENGER_READY',
          web: 'https://127.0.0.1:3302',
          api: 'http://127.0.0.1:3303',
          scope:
            'Owned isolated local database; SCHEDULED historical service, no field GPS validation',
          stop: 'Ctrl+C performs ownership-checked scratch cleanup',
        }),
      );
      await new Promise<void>((resolve) => {
        const finish = () => {
          process.off('SIGINT', finish);
          process.off('SIGTERM', finish);
          resolve();
        };
        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
      });
    }
  } catch (error) {
    console.error(
      redact(
        `NOT VERIFIED: ${error instanceof Error ? error.message : String(error)}; scratch retained: ${database}`,
      ),
    );
    process.exitCode = 1;
  } finally {
    await otp?.cleanup().catch(() => {});
    tls?.cleanup();
    await stop(web);
    await stop(api);
    await stop(reviewerApi);
    await stop(adminReviewApi);
    await target?.end().catch(() => undefined);
    await source.end();
    const cleanup = new Pool({
      connectionString: urlFor(base, 'postgres'),
      max: 1,
    });
    let dropReported = false;
    const canDrop = async (): Promise<boolean> => {
      if (!scratch || !passed) return false;
      const actual = await cleanup
        .query<Identity>(
          `select datname as name, oid::int, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid,'pg_database'),'') as marker from pg_database where datname=$1`,
          [database],
        )
        .then((r) => r.rows[0] ?? null)
        .catch(() => null);
      if (
        !actual ||
        JSON.stringify(actual) !== JSON.stringify(scratch) ||
        actual.marker !== marker
      )
        return false;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const sessions = Number(
          await cleanup
            .query('select count(*) from pg_stat_activity where datname=$1', [
              database,
            ])
            .catch(() => ({ rows: [{ count: 1 }] }))
            .then(
              (r) =>
                (r as { rows: Array<{ count: unknown }> }).rows[0]?.count ?? 1,
            ),
        );
        if (Number.isFinite(sessions) && sessions === 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    };
    if (await canDrop()) {
      await cleanup.query(`drop database ${q(database)}`);
      const confirmed = await cleanup
        .query('select 1 from pg_database where datname=$1', [database])
        .then((r) => r.rowCount);
      assert.equal(confirmed, 0, 'DROP reported success but database persists');
      dropReported = true;
      console.log(JSON.stringify({ cleanup: 'DROP_SUCCESS', database }));
    } else {
      console.error(
        redact(`CP2 cleanup refused; scratch retained: ${database}`),
      );
    }
    await cleanup.end();
    await admin.end();
    if (exactGrants && passed && dropReported && ownedContainerId) {
      const actual = JSON.parse(
        docker(['inspect', ownedContainer]).toString(),
      )[0];
      assert.equal(actual.Id, ownedContainerId);
      assert.equal(actual.Config.Labels['tnx.passenger'], id);
      docker(['rm', '-v', '-f', ownedContainer]);
      if (managedVolume) {
        const volume = JSON.parse(
          docker(['volume', 'inspect', ownedVolume]).toString(),
        )[0];
        assert.equal(volume.Name, ownedVolume);
        assert.equal(volume.Labels['tnx.passenger'], id);
        docker(['volume', 'rm', ownedVolume]);
      }
      if (ownedDataDirectory) rmSync(ownedDataDirectory, { recursive: true });
      console.log(
        JSON.stringify({
          cleanup: 'OWNED_CONTAINER_REMOVED',
          container: ownedContainer,
          id: ownedContainerId,
        }),
      );
    }
    assert.ok(
      passed ? dropReported : true,
      'Successful run kept no scratch drop evidence',
    );
  }
}
await main();
