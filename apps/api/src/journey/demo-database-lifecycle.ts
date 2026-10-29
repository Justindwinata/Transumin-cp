import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import {
  PRESENTER_ACTIONS,
  PRESENTER_PORT,
  WEB_URL,
  assertPortFree,
  ensureWeb,
  otpReadiness,
  runPresenterTerminal,
  startPresenterChild,
  stopWeb,
  webConfigSnapshot,
} from './presenter-session.js';

export const SEED = 'tnx_demo_seed_20261011';
const SOURCE = 'transum_in_nexus';
const EXT = 'transum_in_nexus_ext_x1';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTAINER = 'transum-in-nexus-postgres-1';
export const HEADROOM = 8 * 1024 ** 3 + 128 * 1024 ** 2;
const WRITE_BUDGET = 256 * 1024 ** 2;
const SEED_EVIDENCE_DIR =
  'data/processed/demo-lifecycle/seed-6927076c-42b7-4ccd-83e8-47f90cdb2bff/evidence.json';
const DEMO_MANIFEST_PATH = 'data/manifests/DEMO-20261011-EVIDENCE.json';
export type Identity = {
  name: string;
  oid: number;
  owner: string;
  marker: string;
};

export function localUrl(environment: NodeJS.ProcessEnv): URL {
  let url: URL;
  try {
    url = new URL(
      environment.DATABASE_URL?.trim() ||
        'postgresql://127.0.0.1:5433/transum_in_nexus',
    );
  } catch {
    throw new Error('Invalid database URL');
  }
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'PostgreSQL protocol required',
  );
  assert.equal(
    environment.POSTGRES_HOST ?? url.hostname,
    '127.0.0.1',
    'Local host required',
  );
  assert.equal(
    environment.POSTGRES_PORT ?? url.port,
    '5433',
    'Local port required',
  );
  assert.equal(url.hostname, '127.0.0.1', 'Local host required');
  assert.equal(url.port, '5433', 'Local port required');
  assert.equal(url.search, '', 'Connection query overrides forbidden');
  assert.equal(url.hash, '', 'Connection fragment forbidden');
  if (!url.username) url.username = environment.POSTGRES_USER || 'transum_in';
  if (!url.password) url.password = environment.POSTGRES_PASSWORD || '';
  url.pathname = `/${SOURCE}`;
  return url;
}
export function scratchIdentityName(id: string): string {
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  return `tnx_demo_ci_${id.replaceAll('-', '')}`;
}
export function assertDropIdentity(
  expected: Identity,
  actual: Identity | null,
  invocationMarker: string,
  sessions: number,
): void {
  assert.match(expected.name, /^tnx_demo_ci_[0-9a-f]{32}$/);
  assert.equal(
    expected.marker,
    invocationMarker,
    'Not created by this invocation',
  );
  assert.deepEqual(
    actual,
    expected,
    'Database identity changed; preserve scratch',
  );
  assert.equal(sessions, 0, 'Database has sessions; preserve scratch');
}
function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type SeedCapture = Readonly<{
  identity: Identity;
  counts: unknown;
  migrations: unknown;
  triggers: unknown;
  versions: unknown;
  pins: unknown;
  snapshots: unknown;
  bytes: string;
}>;

/** Local original evidence is ignored; tracked manifest pins identity and shape. */
export async function assertSeedProvenance(
  seed: unknown,
  evidencePath = resolve(ROOT, SEED_EVIDENCE_DIR),
  manifestPath = resolve(ROOT, DEMO_MANIFEST_PATH),
): Promise<void> {
  const record = seed as SeedCapture;
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as {
    status: string;
    command: string;
    post: SeedCapture;
  };
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    evidence: {
      p13: {
        seed: {
          oid: number;
          owner: string;
          marker: string;
          sizeBytes: number;
          networkSnapshotId: string;
          snapshotContentHash: string;
          route6HCanonical: string;
          kuninganCanonical: string;
          demoRunTablesEmpty: boolean;
        };
      };
    };
  };
  assert.equal(evidence.command, 'seed');
  assert.equal(evidence.status, 'PASS');
  const pin = manifest.evidence.p13.seed;
  assert.deepEqual(record.identity, {
    name: SEED,
    oid: pin.oid,
    owner: pin.owner,
    marker: pin.marker,
  });
  for (const field of [
    'counts',
    'migrations',
    'triggers',
    'versions',
    'pins',
    'snapshots',
  ] as const)
    assert.deepEqual(
      record[field],
      evidence.post[field],
      `Seed ${field} changed`,
    );
  assert.equal(
    (record.counts as Record<string, number>)['journey.journey_plan'],
    pin.demoRunTablesEmpty ? 0 : -1,
  );
  assert.deepEqual(record.pins, [
    {
      external_reference: '6H',
      reference_type: 'ROUTE_CODE',
      canonical_entity_id: pin.route6HCanonical,
    },
    {
      external_reference: 'G00283',
      reference_type: 'OFFICIAL_ID',
      canonical_entity_id: pin.kuninganCanonical,
    },
  ]);
  assert.deepEqual(record.snapshots, [
    {
      id: pin.networkSnapshotId,
      content_hash: pin.snapshotContentHash,
      status: 'FINALIZED',
      processing_version: 'EXT_X1_CONTROLLED_TEST_BRIDGE_V1',
      manifest_ref: 'data/manifests/EXT-X1-HAZARD-INCIDENT-EVIDENCE.json',
    },
  ]);
}

export async function lifecycle(
  command: 'seed' | 'run' | 'present',
): Promise<void> {
  try {
    loadEnvFile(resolve(ROOT, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cannot load ignored .env', { cause: error });
  }
  const base = localUrl(process.env);
  const urlFor = (name: string) => {
    const url = new URL(base);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const poolFor = (name: string) =>
    new Pool({
      connectionString: urlFor(name),
      max: 1,
      connectionTimeoutMillis: 3000,
    });
  const id = randomUUID();
  const name = command === 'seed' ? SEED : scratchIdentityName(id);
  const marker = `tnx_demo:D8:${id}`;
  const sensitive = [
    urlFor(name),
    urlFor(SOURCE),
    base.password,
    decodeURIComponent(base.password),
  ];
  const dir = resolve(
    ROOT,
    'data/processed/demo-lifecycle',
    `${command}-${id}`,
  );
  await mkdir(dir, { recursive: true });
  const evidenceFile = resolve(dir, 'evidence.json');
  const report: Record<string, unknown> = {
    command,
    invocation: id,
    marker,
    name,
    startedAt: new Date().toISOString(),
    status: 'PENDING',
    evidenceFile,
    phases: [],
  };
  const save = () =>
    writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  const admin = poolFor('postgres');
  let created: Identity | null = null;
  let interrupted = false;
  let child: ReturnType<typeof spawn> | undefined;
  const interrupt = () => {
    interrupted = true;
    report.status = 'INTERRUPTED';
    child?.kill('SIGTERM');
    void save();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  async function identity(database: string): Promise<Identity | null> {
    const result = await admin.query<{
      name: string;
      oid: number;
      owner: string;
      marker: string;
    }>(
      `select datname as name, oid::int as oid, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid, 'pg_database'), '') as marker from pg_database where datname=$1`,
      [database],
    );
    return result.rows[0] ?? null;
  }
  async function capture(database: string): Promise<unknown> {
    const record = await identity(database);
    if (!record) return { absent: true };
    const pool = poolFor(database);
    try {
      await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const tables = await pool.query<{ schema: string; name: string }>(
        `select schemaname as schema, tablename as name from pg_tables where schemaname not in ('pg_catalog','information_schema','public') order by 1,2`,
      );
      const counts: Record<string, number> = {};
      for (const table of tables.rows) {
        const value = await pool.query<{ count: string }>(
          `select count(*)::text as count from ${identifier(table.schema)}.${identifier(table.name)}`,
        );
        counts[`${table.schema}.${table.name}`] = Number(value.rows[0]!.count);
      }
      const migrations = await pool.query(
        'select name from meta.kysely_migration order by name',
      );
      const triggers = await pool.query(
        `select n.nspname as schema,c.relname as table,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal order by 1,2,3`,
      );
      let versions: unknown[] = [];
      let pins: unknown[] = [];
      let snapshots: unknown[] = [];
      if (
        tables.rows.some(
          (table) =>
            table.schema === 'meta' && table.name === 'dataset_version',
        )
      ) {
        versions = (
          await pool.query(
            'select id,checksum_sha256,manifest_path,raw_path_ref,metadata_json from meta.dataset_version order by id',
          )
        ).rows;
        pins = (
          await pool.query(
            `select external_reference,reference_type,canonical_entity_id from meta.source_entity_reference where (external_reference='6H' and reference_type='ROUTE_CODE') or (external_reference='G00283' and reference_type='OFFICIAL_ID') order by 1,2,3`,
          )
        ).rows;
        snapshots = (
          await pool.query(
            'select id,content_hash,status,processing_version,manifest_ref from twin.network_snapshot order by id',
          )
        ).rows;
      }
      const size = await pool.query(
        'select pg_database_size(current_database())::text as bytes',
      );
      await pool.query('COMMIT');
      return {
        identity: record,
        counts,
        migrations: migrations.rows,
        triggers: triggers.rows,
        versions,
        pins,
        snapshots,
        bytes: size.rows[0]!.bytes,
      };
    } finally {
      await pool.end();
    }
  }
  async function phase(
    label: string,
  ): Promise<{ seed: unknown; ext_x1: unknown }> {
    const seed = await capture(SEED);
    const ext_x1 = await capture(EXT);
    (report.phases as unknown[]).push({
      label,
      at: new Date().toISOString(),
      seed,
      ext_x1,
    });
    await save();
    return { seed, ext_x1 };
  }
  async function sessions(database: string): Promise<number> {
    const result = await admin.query<{ count: number }>(
      'select count(*)::int as count from pg_stat_activity where datname=$1',
      [database],
    );
    return result.rows[0]!.count;
  }
  async function execute(
    args: string[],
    env: NodeJS.ProcessEnv,
    pnpmArgs: string[],
  ): Promise<string> {
    let output = '';
    const isRunner = args.includes('apps/web/scripts/demo-scenario.mjs');
    const logFile = resolve(dir, isRunner ? 'runner.log' : 'bridge.log');
    const command = pnpmArgs.length ? 'pnpm' : process.execPath;
    const argv = pnpmArgs.length ? [...pnpmArgs, ...args] : args;
    child = spawn(command, argv, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    // Wait for stdio streams to close, not merely process exit, or buffered
    // output can be lost between 'exit' and the file write above.
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      child!.once('error', reject);
      child!.once('close', resolveExit);
    });
    // Logs can contain provider diagnostics; never echo credentials to terminal.
    sensitive.forEach((value) => {
      if (value) output = output.replaceAll(value, '[REDACTED]');
    });
    await writeFile(logFile, output, { mode: 0o600 });
    assert.equal(exit, 0, `Child failed; diagnostics saved: ${logFile}`);
    assert.ok(!interrupted, 'Invocation interrupted; scratch retained');
    return output;
  }
  try {
    await save();
    // Verify exact approved Docker endpoint, not merely a PostgreSQL version string.
    const inspect = JSON.parse(
      execFileSync('docker', ['inspect', CONTAINER], { encoding: 'utf8' }),
    )[0];
    assert.equal(inspect.Config.Image, 'transum-in-nexus/postgis:17.11-3.6');
    assert.deepEqual(inspect.NetworkSettings.Ports['5432/tcp'], [
      { HostIp: '127.0.0.1', HostPort: '5433' },
    ]);
    const mounts = inspect.Mounts.filter(
      (mount: { Destination: string }) =>
        mount.Destination === '/var/lib/postgresql/data',
    );
    assert.equal(mounts.length, 1);
    assert.equal(mounts[0].Name, 'transum-in-nexus-postgres-data');
    const server = await admin.query(
      `select version(),current_user,inet_server_addr()::text as address,inet_server_port() as port,system_identifier::text from pg_control_system()`,
    );
    assert.equal(server.rows[0].port, 5432); // Docker internal port; approved host binding checked above.
    const containerSystemId = execFileSync(
      'docker',
      [
        'exec',
        CONTAINER,
        'psql',
        '-U',
        base.username,
        '-d',
        'postgres',
        '-Atc',
        'select system_identifier from pg_control_system()',
      ],
      { encoding: 'utf8' },
    ).trim();
    assert.equal(server.rows[0].system_identifier, containerSystemId);
    report.server = {
      ...server.rows[0],
      containerId: inspect.Id,
      image: inspect.Image,
      volume: mounts[0].Name,
    };
    const df = execFileSync(
      'docker',
      [
        'exec',
        CONTAINER,
        'df',
        '-B1',
        '--output=avail',
        '/var/lib/postgresql/data',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .at(-1)!;
    const freeBytes = Number(df.trim());
    assert.ok(
      Number.isSafeInteger(freeBytes) && freeBytes >= HEADROOM,
      'Insufficient server disk headroom',
    );
    report.disk = { freeBytes, requiredBytes: HEADROOM };
    // Seed reuse is narrow: only a D8-owned seed may serve as the scratch template.
    const seedRecord = await identity(SEED);
    if (seedRecord)
      assert.ok(
        seedRecord.marker.startsWith('tnx_demo:'),
        'Existing seed is not owned by this harness; refusing reuse',
      );
    if (command === 'run' || command === 'present') {
      assert.ok(seedRecord, 'Seed missing; run seed CLI first');
      assert.equal(
        await identity(name),
        null,
        'Scratch already exists; no prior cleanup permitted',
      );
      assert.equal(await sessions(SEED), 0, 'Seed has sessions; cannot clone');
    }
    const before = await phase('before');
    if (command === 'present') await assertSeedProvenance(before.seed);
    if (command === 'present') {
      const seedBytes = Number(
        (before.seed as { bytes?: string }).bytes ?? NaN,
      );
      assert.ok(
        Number.isSafeInteger(seedBytes) && seedBytes >= 0,
        'Seed size unavailable; refusing clone',
      );
      const required = HEADROOM + seedBytes + WRITE_BUDGET;
      assert.ok(
        Number.isSafeInteger(required) && freeBytes >= required,
        'Insufficient server disk headroom for presenter scratch',
      );
      const host = await statfs(ROOT);
      const hostFreeBytes = host.bavail * host.bsize;
      assert.ok(
        Number.isSafeInteger(hostFreeBytes) && hostFreeBytes >= required,
        'Insufficient host disk headroom for presenter scratch',
      );
      report.hostDisk = { freeBytes: hostFreeBytes, requiredBytes: required };
      report.disk = { freeBytes, requiredBytes: required, seedBytes };
      await assertPortFree(PRESENTER_PORT);
      report.webConfig = await webConfigSnapshot(ROOT);
      report.otp = await otpReadiness(ROOT);
    }
    const createScratch = command !== 'seed' || !seedRecord;
    if (createScratch) {
      assert.ok(!interrupted, 'Interrupted before create');
      const template = command === 'seed' ? 'template0' : SEED;
      await admin.query(
        `create database ${identifier(name)} with template ${identifier(template)}`,
      );
      // Save OID/owner even if COMMENT fails; failed attempts never auto-drop.
      const record = await identity(name);
      assert.ok(record);
      created = { ...record, marker };
      report.created = created;
      await save();
      await admin.query(
        `comment on database ${identifier(name)} is ${literal(marker)}`,
      );
      assert.deepEqual(await identity(name), created);
    }
    if (command === 'seed') {
      const pool = poolFor(name);
      const db = new Kysely<FoundationDatabase>({
        dialect: new PostgresDialect({ pool }),
      });
      try {
        const applied = await migrateToLatest(db);
        assert.equal(
          applied.length,
          seedRecord ? 0 : 12,
          'Expected migrations through 12 only',
        );
      } finally {
        await db.destroy();
      }
      if (!seedRecord || seedRecord.marker === 'tnx_demo:seed_20261011') {
        const output = await execute(
          ['src/journey/ext-x1-canonical-bridge.cli.ts'],
          {
            ...process.env,
            CANONICAL_BRIDGE_TEST_ONLY: '1',
            CANONICAL_BRIDGE_DEMO_SEED_ONLY: '1',
            CANONICAL_BRIDGE_SOURCE_DATABASE_URL: urlFor(SOURCE),
            CANONICAL_BRIDGE_DESTINATION_DATABASE_URL: urlFor(SEED),
          },
          ['--filter', '@transum-in/api', 'exec', 'tsx'],
        );
        // pnpm exec prefixes diagnostic text; isolate the canonical JSON by
        // splitting on the completion status marker rather than a line boundary.
        const completionStart = output.lastIndexOf('{"status":"COMPLETED"');
        assert.ok(
          completionStart >= 0,
          `Bridge produced no COMPLETED payload; diagnostics saved`,
        );
        report.bridge = JSON.parse(output.slice(completionStart).trim());
        assert.equal((report.bridge as { status: string }).status, 'COMPLETED');
        assert.equal(
          (report.bridge as { destinationDatabase: string })
            .destinationDatabase,
          SEED,
        );
      }
      report.post = await capture(name);
      const afterSeed = await phase('after');
      assert.deepEqual(
        (afterSeed.ext_x1 as { counts: unknown }).counts,
        (before.ext_x1 as { counts: unknown }).counts,
        'Protected ext_x1 counts changed',
      );
      report.status = 'PASS';
      report.finishedAt = new Date().toISOString();
      await save();
      process.stdout.write(
        `${JSON.stringify({ status: report.status, database: name, retained: true, reused: seedRecord !== null, evidenceFile })}\n`,
      );
      return;
    }
    assert.ok(created, 'Scratch identity missing');
    report.scratchPre = await capture(name);
    assert.deepEqual(
      (report.scratchPre as { counts: unknown }).counts,
      (before.seed as { counts: unknown }).counts,
      'Scratch differs from seed',
    );
    if (command === 'present') {
      const web = await ensureWeb(ROOT);
      const presenter = await startPresenterChild({
        command: process.execPath,
        args: ['--import', 'tsx', 'src/journey/product-p1r-browser.cli.ts'],
        cwd: resolve(ROOT, 'apps/api'),
        env: {
          ...process.env,
          DATABASE_URL: urlFor(name),
          PRODUCT_P1R_ACCEPTANCE: '1',
          PRODUCT_P1R_PORT: '3001',
        },
        readyPattern: 'P1R_ACCEPTANCE_READY',
      });
      report.presenter = {
        apiPid: presenter.pid,
        commands: [...PRESENTER_ACTIONS],
        webStarted: web.started,
        webUrl: WEB_URL,
        startedAt: new Date(presenter.startedAt).toISOString(),
      };
      report.status = 'PRESENTING';
      report.presenterStartedAt = new Date(presenter.startedAt).toISOString();
      await save();
      const presenterStatus = async (): Promise<Record<string, unknown>> => {
        const pool = poolFor(name);
        try {
          const value = async (query: string): Promise<number> =>
            (await pool.query<{ count: number }>(query)).rows[0]!.count;
          return {
            database: name,
            scratchOwnedByThisSession:
              JSON.stringify(await identity(name)) === JSON.stringify(created),
            plans: await value(
              'select count(*)::int as count from journey.journey_plan',
            ),
            activeJourneys: await value(
              'select count(*)::int as count from journey.active_journey',
            ),
            observations: await value(
              'select count(*)::int as count from twin.operational_observation',
            ),
            currentAlerts: await value(
              'select count(*)::int as count from journey.targeted_alert where resolved_at is null',
            ),
            evidenceFile,
            labels:
              'SCHEDULED routing / SIMULATED CONTROLLED incidents / HISTORICAL replay; never LIVE',
          };
        } finally {
          await pool.end();
        }
      };
      let outcome: 'STOPPED' | 'UNEXPECTED_END';
      try {
        outcome = await runPresenterTerminal(presenter, presenterStatus);
      } finally {
        await presenter.stop();
        await stopWeb(web);
      }
      assert.equal(
        outcome,
        'STOPPED',
        'Presenter input closed without stop; scratch retained',
      );
      assert.ok(
        !interrupted,
        'Presenter session interrupted; scratch retained',
      );
      // Wait for session-owned API connections to close. Never terminate them.
      for (let attempt = 0; attempt < 20; attempt++) {
        if ((await sessions(name)) === 0) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      }
      report.scratchPost = await capture(name);
    } else {
      await execute(
        ['apps/web/scripts/demo-scenario.mjs'],
        {
          ...process.env,
          DATABASE_URL: urlFor(name),
          PRODUCT_P1R_ACCEPTANCE: '1',
          DEMO_ISOLATED_TEST: '1',
          PRODUCT_P1R_PORT: '3001',
          DEMO_SCREENSHOT_DIR: dir,
        },
        [],
      );
      assert.ok(!interrupted, 'Interrupted; scratch retained');
      report.scratchPost = await capture(name);
      assert.notDeepEqual(
        (report.scratchPost as { counts: unknown }).counts,
        (report.scratchPre as { counts: unknown }).counts,
        'Runner produced no database changes',
      );
    }
    const between = await phase('between');
    assert.deepEqual(
      (between.ext_x1 as { counts: unknown }).counts,
      (before.ext_x1 as { counts: unknown }).counts,
      'Protected ext_x1 counts changed',
    );
    assert.deepEqual(
      (between.seed as { counts: unknown }).counts,
      (before.seed as { counts: unknown }).counts,
      'Seed counts changed',
    );
    report.status = 'EVIDENCE_EXPORTED';
    await save();
    assert.deepEqual(
      JSON.parse(await readFile(evidenceFile, 'utf8')).created,
      created,
      'External evidence not saved',
    );
    assertDropIdentity(
      created,
      await identity(name),
      marker,
      await sessions(name),
    );
    // Block new sessions without terminating any; DROP still refuses races/sessions.
    await admin.query(
      `alter database ${identifier(name)} with allow_connections false`,
    );
    assertDropIdentity(
      created,
      await identity(name),
      marker,
      await sessions(name),
    );
    await admin.query(`drop database ${identifier(name)}`);
    assert.equal(
      await identity(name),
      null,
      'Scratch still present after drop',
    );
    report.dropped = true;
    const afterDrop = await phase('after');
    assert.deepEqual(
      (afterDrop.ext_x1 as { counts: unknown }).counts,
      (before.ext_x1 as { counts: unknown }).counts,
      'Protected ext_x1 counts changed',
    );
    report.status = 'PASS';
    report.finishedAt = new Date().toISOString();
    await save();
    process.stdout.write(
      `${JSON.stringify({ status: report.status, database: name, retained: false, evidenceFile })}\n`,
    );
  } catch (error) {
    report.status = interrupted ? 'INTERRUPTED' : 'FAILED';
    report.error =
      error instanceof Error ? error.message : 'Unknown lifecycle error';
    report.retained = created;
    if (created && command !== 'seed' && report.dropped !== true) {
      child?.kill('SIGTERM');
      await admin
        .query(
          `alter database ${identifier(created.name)} with allow_connections true`,
        )
        .catch(() => undefined);
    }
    try {
      report.failureSnapshot = await capture(name);
    } catch {
      report.failureCapture = 'NOT VERIFIED';
    }
    await save();
    throw new Error(
      `Lifecycle failed; database preserved if created. Evidence: ${evidenceFile}`,
      { cause: error },
    );
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await admin.end();
  }
}
