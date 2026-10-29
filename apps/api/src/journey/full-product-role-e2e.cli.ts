import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { INestApplication } from '@nestjs/common';
import type {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  BrowserType,
} from '../../../web/node_modules/playwright-core/index.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../application.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { seedSampleAccounts } from '../auth/seed-sample-accounts.js';
import { AuthService } from '../auth/auth.service.js';

// FR-014/FR-011: owned scratch only; production-mode same-origin browser boundary.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const id = randomUUID();
const database = `tnx_integration_${id.replaceAll('-', '')}`;
const marker = `tnx_integration:${id}`;
const evidenceRoot =
  process.env.PRODUCT_ACCEPTANCE_EVIDENCE_DIR ??
  join(root, '.release-evidence', 'full-product-role-e2e');
const evidenceDir = join(evidenceRoot, id);
const image = 'transum-in-nexus/postgis:17.11-3.6';
const children: ChildProcess[] = [];
const container = `tnx-role-e2e-${id}`;
let dataDir: string | undefined;
let webPort = 0;
let apiPort = 0;
let tlsPort = 0;
let tls: ReturnType<typeof createHttpsServer> | undefined;
let db: Pool | undefined;
let admin: Pool | undefined;
let app: INestApplication | undefined;

const env = process.env;
const scratchPassword = randomBytes(32).toString('hex');
const q = (v: string) => `"${v.replaceAll('"', '""')}"`;
async function port(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return p;
}
function docker(args: string[], input?: string | Buffer): Buffer {
  return execFileSync('docker', args, {
    input,
    env: { ...env, PGPASSWORD: scratchPassword },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}
async function wait(url: string, child?: ChildProcess) {
  for (let i = 0; i < 120; i++) {
    assert.equal(
      child?.exitCode ?? null,
      null,
      `owned process exited before ${url}`,
    );
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* startup */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`readiness timeout ${url}`);
}
async function stop(child?: ChildProcess) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await new Promise<void>((resolve) => child.once('close', () => resolve()));
}
function proxy(target: number) {
  return createHttpsServer(
    {
      key: readFileSync(join(process.env.TNX_ROLE_TLS_DIR!, 'key.pem')),
      cert: readFileSync(join(process.env.TNX_ROLE_TLS_DIR!, 'cert.pem')),
    },
    (incoming, outgoing) => {
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: target,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    },
  );
}
const marks: Record<string, unknown> = {
  root,
  evidenceDir,
  status: 'NOT_VERIFIED',
  database,
  marker,
  viewport: [],
  checks: [],
  gaps: [
    'Reviewer is not an available canonical role; no reviewer role invented.',
    'Real GPS/official flood evidence not claimed.',
    'Scenario mutation fixture not fabricated; only real scratch read/authorization path exercised.',
  ],
};
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name);
  (marks.checks as unknown[]).push({ name, status: 'PASS', actual });
  console.log(JSON.stringify({ name, status: 'PASS', actual }));
}
async function api(
  context: BrowserContext,
  path: string,
  options?: Parameters<APIRequestContext['fetch']>[1],
): Promise<APIResponse> {
  return context.request.fetch(`${base()}/api/v1/${path}`, options);
}
function base() {
  return `https://127.0.0.1:${tlsPort}`;
}
async function login(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<APIResponse> {
  const r = await api(context, 'auth/login', {
    method: 'POST',
    headers: { origin: base(), 'content-type': 'application/json' },
    data: { email, password },
  });
  check(`login ${email}`, r.status(), 200);
  return r;
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  // Browser alone accepts owned self-signed certificate; upstream remains HTTP loopback.
  const { createRequire } = await import('node:module');
  const chromiumModule = createRequire(join(root, 'apps/web/package.json'))(
    'playwright-core',
  ) as { chromium: BrowserType };
  const chromium: BrowserType = chromiumModule.chromium;
  dataDir = mkdtempSync(join(tmpdir(), `tnx-role-e2e-${id}-`));
  const tlsDir = mkdtempSync(join(tmpdir(), `tnx-role-tls-${id}-`));
  process.env.TNX_ROLE_TLS_DIR = tlsDir;
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
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      join(tlsDir, 'key.pem'),
      '-out',
      join(tlsDir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--label',
    `tnx.role-e2e=${id}`,
    '--mount',
    `type=bind,source=${dataDir},target=/var/lib/postgresql/data`,
    '--memory=768m',
    '--cpus=1',
    '-e',
    `POSTGRES_PASSWORD=${scratchPassword}`,
    '-p',
    '127.0.0.1::5432',
    image,
  ]);
  const inspected = JSON.parse(docker(['inspect', container]).toString())[0];
  assert.equal(inspected.Config.Labels['tnx.role-e2e'], id);
  const boundPort = Number(
    inspected.NetworkSettings.Ports['5432/tcp'][0].HostPort,
  );
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      docker([
        'exec',
        container,
        'psql',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-Atqc',
        'select 1',
      ]);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(ready, 'owned scratch postgres readiness');
  admin = new Pool({
    host: '127.0.0.1',
    port: boundPort,
    database: 'postgres',
    user: 'postgres',
    password: scratchPassword,
    max: 1,
  });
  await admin.query(
    `create database ${q(database)} with template template0 owner postgres`,
  );
  await admin.query(`comment on database ${q(database)} is '${marker}'`);
  const databaseUrl = `postgresql://postgres:${encodeURIComponent(scratchPassword!)}@127.0.0.1:${boundPort}/${database}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.POSTGRES_HOST = '127.0.0.1';
  process.env.POSTGRES_PORT = String(boundPort);
  process.env.POSTGRES_DB = database;
  process.env.NODE_ENV = 'production';
  process.env.PRODUCT_P1R_ACCEPTANCE = '1';
  process.env.AUTH_ALLOW_LOOPBACK_ORIGIN = 'false';
  apiPort = await port();
  webPort = await port();
  tlsPort = await port();
  process.env.AUTH_ORIGIN = base();
  process.env.PUBLIC_ORIGIN = base();
  process.env.OPS_API_BASE_URL = `http://127.0.0.1:${apiPort}/api/v1`;
  process.env.NEXT_PUBLIC_API_BASE_URL = '/api/v1';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  const databaseClient = createDatabase();
  await migrateToLatest(databaseClient);
  const appDb = new Pool({ connectionString: databaseUrl, max: 1 });
  db = appDb;
  await seedSampleAccounts(
    databaseClient,
    new AuthService(
      databaseClient as unknown as ConstructorParameters<typeof AuthService>[0],
    ),
  );
  await databaseClient.destroy();
  await db!.query(
    `create role role_e2e_runtime login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${scratchPassword}';`,
  );
  docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'runtime_role=role_e2e_runtime',
      '-v',
      `database_name=${database}`,
      '-v',
      'ON_ERROR_STOP=1',
    ],
    readFileSync(
      join(root, 'database/operations/passenger-runtime-grants.sql'),
    ),
  );
  process.env.DATABASE_URL = databaseUrl.replace(
    'postgres:',
    'role_e2e_runtime:',
  );
  marks.runtime = 'canonical passenger grants; no owner API';
  const runtimeFlags = (
    await db!.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      'select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=$1',
      ['role_e2e_runtime'],
    )
  ).rows[0]!;
  check(
    'runtime role has no elevated flags',
    [
      runtimeFlags.rolsuper,
      runtimeFlags.rolcreatedb,
      runtimeFlags.rolcreaterole,
      runtimeFlags.rolreplication,
      runtimeFlags.rolbypassrls,
    ],
    [false, false, false, false, false],
  );
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.listen(apiPort, '127.0.0.1');
  const dist = `.next-full-product-role-${id.replaceAll('-', '')}`;
  const build = spawn(
    'pnpm',
    ['--filter', '@transum-in/web', 'exec', 'next', 'build'],
    {
      cwd: root,
      env: {
        ...env,
        ...process.env,
        NODE_ENV: 'production',
        PRODUCT_ACCEPTANCE_DIST_DIR: dist,
      },
      stdio: 'ignore',
    },
  );
  children.push(build);
  await new Promise<void>((resolve, reject) => {
    build.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Next production build ${code}`)),
    );
  });
  const web = spawn(
    'pnpm',
    [
      '--filter',
      '@transum-in/web',
      'exec',
      'next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(webPort),
    ],
    {
      cwd: root,
      env: {
        ...env,
        ...process.env,
        NODE_ENV: 'production',
        PRODUCT_ACCEPTANCE_DIST_DIR: dist,
      },
      detached: true,
      stdio: 'ignore',
    },
  );
  children.push(web);
  await wait(`http://127.0.0.1:${webPort}`, web);
  tls = proxy(webPort);
  await new Promise<void>((resolve) =>
    tls!.listen(tlsPort, '127.0.0.1', resolve),
  ); // TLS listener owned; browser verifies readiness.
  const browser: Browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PRODUCT_P1R_CHROME ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--ignore-certificate-errors'],
  });
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      (marks.viewport as unknown[]).push(viewport);
      const passenger = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: true,
      });
      await passenger.tracing.start({ screenshots: true, snapshots: true });
      const page = await passenger.newPage();
      await page.goto(`${base()}/ops/login`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Email').fill('passenger.sample@local.test');
      await page.getByLabel('Password').fill('SAMPLE-Passenger-123');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL(/\/ops\/network/);
      await page.reload();
      await page.getByText('Access denied', { exact: true }).waitFor();
      check(
        `PASSENGER denied ${viewport.width}`,
        await page.getByText('Access denied').count(),
        1,
      );
      await page.screenshot({
        path: join(evidenceDir, `passenger-denied-${viewport.width}.png`),
        fullPage: true,
      });
      await passenger.tracing.stop({
        path: join(evidenceDir, `${id}-passenger-${viewport.width}.zip`),
      });
      await passenger.close();
    }
    const researcher = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    await researcher.tracing.start({ screenshots: true, snapshots: true });
    const rp = await researcher.newPage();
    await rp.goto(`${base()}/ops/login`);
    await rp.getByLabel('Email').fill('researcher.sample@local.test');
    await rp.getByLabel('Password').fill('SAMPLE-Researcher-123');
    await rp.getByRole('button', { name: 'Sign in' }).click();
    await rp.waitForURL(/\/ops\/network/);
    const scenarios = await api(researcher, 'scenarios');
    check(
      'RESEARCHER_OPERATOR scenarios read allowed',
      scenarios.status(),
      200,
    );
    const deniedProvision = await api(researcher, 'auth/users', {
      method: 'POST',
      headers: { origin: base(), 'content-type': 'application/json' },
      data: {
        email: `denied-${id}@local.test`,
        password: 'SAMPLE-Denied-123',
        roles: ['PASSENGER'],
      },
    });
    check(
      'RESEARCHER_OPERATOR provisioning denied',
      deniedProvision.status(),
      403,
    );
    const forged = await api(researcher, 'auth/users', {
      method: 'POST',
      headers: {
        origin: base(),
        'x-role': 'ADMIN',
        'content-type': 'application/json',
      },
      data: {
        email: `forged-${id}@local.test`,
        password: 'SAMPLE-Forged-123',
        roles: ['PASSENGER'],
      },
    });
    check('forged x-role denied', forged.status(), 403);
    await rp.screenshot({
      path: join(evidenceDir, 'researcher-network.png'),
      fullPage: true,
    });
    const adminCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`${base()}/ops/login`);
    await adminPage.getByLabel('Email').fill('admin.sample@local.test');
    await adminPage.getByLabel('Password').fill('SAMPLE-Admin-123456');
    await adminPage.getByRole('button', { name: 'Sign in' }).click();
    await adminPage.waitForURL(/\/ops\/network/);
    const provision = await api(adminCtx, 'auth/users', {
      method: 'POST',
      headers: { origin: base(), 'content-type': 'application/json' },
      data: {
        email: `provisioned-${id}@local.test`,
        password: 'SAMPLE-Provisioned-123',
        roles: ['PASSENGER'],
      },
    });
    check('ADMIN provisioning allowed', provision.status(), 201);
    const me = await api(adminCtx, 'auth/me');
    check('ADMIN me', me.status(), 200);
    await adminPage.screenshot({
      path: join(evidenceDir, 'admin-network.png'),
      fullPage: true,
    });
    const anon = await browser.newContext({ ignoreHTTPSErrors: true });
    const absent = await api(anon, 'auth/me');
    check('absent auth 401', absent.status(), 401);
    const foreign = await anon.request.fetch(`${base()}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      data: {
        email: 'admin.sample@local.test',
        password: 'SAMPLE-Admin-123456',
      },
    });
    check('foreign origin 403', foreign.status(), 403);
    await anon.close();
    const logout = await api(adminCtx, 'auth/logout', {
      method: 'POST',
      headers: { origin: base() },
    });
    check('logout 200', logout.status(), 200);
    check(
      'logout invalidates me',
      (await api(adminCtx, 'auth/me')).status(),
      401,
    );
    const fresh = await browser.newContext({ ignoreHTTPSErrors: true });
    await login(fresh, 'admin.sample@local.test', 'SAMPLE-Admin-123456');
    check('reload session', (await api(fresh, 'auth/me')).status(), 200);
    await db!.query(
      `update auth.session set created_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' where user_id=(select id from auth.user_account where email='admin.sample@local.test') and revoked_at is null`,
    );
    const fp = await fresh.newPage();
    await fp.goto(`${base()}/ops/network`);
    await fp.reload();
    check('expired session 401', (await api(fresh, 'auth/me')).status(), 401);
    await fresh.close();
    await researcher.tracing.stop({
      path: join(evidenceDir, `${id}-researcher.zip`),
    });
    await researcher.close();
    await adminCtx.close();
  } finally {
    for (const [index, context] of browser.contexts().entries()) {
      for (const [pageIndex, page] of context.pages().entries())
        await page
          .screenshot({
            path: join(evidenceDir, `final-${index}-${pageIndex}.png`),
            fullPage: true,
          })
          .catch(() => {});
      await context.tracing
        .stop({ path: join(evidenceDir, `final-${index}.zip`) })
        .catch(() => {});
    }
    await browser.close();
  }
  marks.status = 'PASS';
}
main()
  .catch((error) => {
    marks.error = error instanceof Error ? error.message : String(error);
    console.error(`NOT VERIFIED: ${marks.error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const fs = await import('node:fs/promises');
    mkdirSync(evidenceDir, { recursive: true });
    await fs.writeFile(
      join(evidenceDir, `run-${id}.json`),
      JSON.stringify(marks, null, 2),
    );
    if (tls) {
      tls.closeAllConnections();
      await new Promise<void>((resolve) => tls!.close(() => resolve()));
    }
    if (app) await app.close().catch(() => {});
    for (const child of children.reverse()) await stop(child).catch(() => {});
    await db?.end().catch(() => {});
    // Owned scratch ownership re-asserted before any deletion; evidence retained either way.
    const identity = await admin
      ?.query<{ marker: string | null }>(
        "select shobj_description(oid,'pg_database') marker from pg_database where datname=$1",
        [database],
      )
      .catch(() => undefined);
    const markerMatch = identity?.rows[0]?.marker === marker;
    if (admin && !markerMatch)
      marks.cleanup_error = 'Scratch ownership changed; cleanup refused';
    await admin?.end().catch(() => {});
    let removed = false;
    if (markerMatch || !admin) {
      try {
        const inspect = JSON.parse(
          docker(['inspect', container]).toString(),
        )[0];
        assert.equal(
          inspect.Config.Labels['tnx.role-e2e'],
          id,
          'Container ownership changed; cleanup refused',
        );
        docker(['rm', '-f', container]);
        if (markerMatch && dataDir)
          rmSync(dataDir, { recursive: true, force: true });
        removed = true;
      } catch (error) {
        marks.cleanup_error =
          error instanceof Error ? error.message : String(error);
        process.exitCode = 1;
      }
    }
    marks.scratch_cleanup = {
      database_removed: removed,
      container_removed: removed,
      owned_marker_matched: markerMatch,
      evidence_preserved: true,
    };
    rmSync(process.env.TNX_ROLE_TLS_DIR!, { recursive: true, force: true });
    await fs.writeFile(
      join(evidenceDir, `run-${id}.json`),
      JSON.stringify(marks, null, 2),
    );
    console.log(
      JSON.stringify({
        status: marks.status,
        evidenceDir,
        cleanup: marks.scratch_cleanup,
      }),
    );
  });
