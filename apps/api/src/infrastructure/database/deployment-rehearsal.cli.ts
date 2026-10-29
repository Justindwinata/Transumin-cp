import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { migrateToLatest } from './database.migrator.js';
import type { FoundationDatabase } from './database.constants.js';

// No .env loading: this runner cannot address the product database or its roles.
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const id = randomUUID();
const container = `tnx-deploy-${id}`;
const password = randomBytes(32).toString('hex');
const runtimePassword = randomBytes(32).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'tnx-deploy-'));
const children: ChildProcess[] = [];
const pools: Pool[] = [];
let passed = false;
let owned = false;
const docker = (args: string[], input?: string | Buffer) =>
  execFileSync('docker', args, {
    input,
    env: { ...process.env, POSTGRES_PASSWORD: password, PGPASSWORD: password },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 64 * 1024 ** 2,
  });
const psql = (database: string, statement: string) =>
  docker(
    [
      'exec',
      '-i',
      '-e',
      'PGPASSWORD',
      container,
      'psql',
      '-h',
      '127.0.0.1',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database,
    ],
    statement,
  );
const checkpoint = (step: string, details = {}) =>
  console.log(JSON.stringify({ step, ...details }));
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function wait(url: string, child: ChildProcess) {
  for (let i = 0; i < 90; i++) {
    assert.equal(child.exitCode, null, 'owned process exited before readiness');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return;
    } catch {
      /* bounded startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Readiness deadline exceeded: ${new URL(url).pathname}`);
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5000).unref(),
    ),
  ]);
  if (child.exitCode === null && child.signalCode === null)
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}
async function main() {
  const image = 'transum-in-nexus/postgis:17.11-3.6';
  docker(['image', 'inspect', image]); // Never builds/pulls or mounts protected volumes.
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--label',
    `tnx.rehearsal=${id}`,
    '--memory=768m',
    '--cpus=1',
    '-e',
    'POSTGRES_PASSWORD',
    '-p',
    '127.0.0.1::5432',
    image,
  ]);
  owned = true;
  const inspected = JSON.parse(docker(['inspect', container]).toString())[0];
  assert.equal(inspected.Config.Labels['tnx.rehearsal'], id);
  assert.equal(inspected.Config.Image, image);
  const port = Number(inspected.NetworkSettings.Ports['5432/tcp'][0].HostPort);
  assert.equal(
    inspected.NetworkSettings.Ports['5432/tcp'][0].HostIp,
    '127.0.0.1',
  );
  for (let i = 0; ; i++) {
    try {
      psql('postgres', 'select 1;');
      break;
    } catch {
      assert.ok(i < 60, 'PostgreSQL readiness deadline');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  psql(
    'postgres',
    `create database rehearsal; create database restored; comment on database rehearsal is '${id}'; comment on database restored is '${id}';`,
  );
  const pool = new Pool({
    host: '127.0.0.1',
    port,
    database: 'rehearsal',
    user: 'postgres',
    password,
    max: 1,
  });
  pools.push(pool);
  const db = new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
  const migrations = await migrateToLatest(db);
  const migrationNames = [
    '202609280001_foundation',
    '202609280002_data_provenance_and_transit',
    '202609290001_gtfs_source_fidelity',
    '202609290002_phase1_transit_hardening',
    '202609300001_spatial_pedestrian_foundation',
    '202610010001_hybrid_mobility_twin',
    '202610010002_live_operational_gateway',
    '202610010003_disruption_and_simulation_intelligence',
    '202610030001_active_journey_targeted_alerts',
    '202610050001_state_aware_journey_recovery',
    '202610060001_active_journey_instance_identity',
    '202610080001_ext_x1_incident_lifecycle',
    '202610120001_active_journey_boarding',
    '202610120002_product_activation_identity',
    '202610120003_passenger_reporting',
    '202610130001_recovery_acceptance_lineage',
    '202610130002_active_journey_current_itinerary',
    '202610180001_copilot_audit',
    '202610190001_auth_foundation',
    '202610190002_operator_recovery',
  ];
  const migrator = new Migrator({
    db,
    migrationTableSchema: 'meta',
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    }),
  });
  assert.deepEqual(
    (await migrator.getMigrations()).map(({ name }) => name),
    migrationNames,
  );
  assert.deepEqual(
    migrations,
    migrationNames.map((migrationName) => ({
      migrationName,
      direction: 'Up',
      status: 'Success',
    })),
  );
  assert.equal((await migrateToLatest(db)).length, 0);
  const rollback = await migrator.migrateDown();
  assert.equal(rollback.error, undefined);
  assert.equal(rollback.results?.[0]?.status, 'Success');
  assert.equal(
    rollback.results?.[0]?.migrationName,
    '202610190002_operator_recovery',
  );
  assert.equal(
    (
      await pool.query(
        "select to_regclass('recovery.operator_recovery_plan') as table_name",
      )
    ).rows[0].table_name,
    null,
  );
  const rollbackAuth = await migrator.migrateDown();
  assert.equal(rollbackAuth.error, undefined);
  assert.equal(rollbackAuth.results?.[0]?.status, 'Success');
  assert.equal(
    rollbackAuth.results?.[0]?.migrationName,
    '202610190001_auth_foundation',
  );
  assert.equal(
    (await pool.query("select to_regclass('auth.user_account') as table_name"))
      .rows[0].table_name,
    null,
  );
  assert.equal(
    (
      await pool.query(
        "select to_regclass('journey.active_journey_dependency') as table_name",
      )
    ).rows[0].table_name,
    'journey.active_journey_dependency',
  );
  assert.equal(
    (await pool.query("select to_regnamespace('auth') as name")).rows[0].name,
    'auth',
  );
  for (const table of ['role_assignment', 'session', 'login_attempt']) {
    assert.equal(
      (await pool.query('select to_regclass($1) as name', [`auth.${table}`]))
        .rows[0].name,
      null,
    );
  }
  const reapply = await migrateToLatest(db);
  assert.deepEqual(reapply, [
    {
      migrationName: '202610190001_auth_foundation',
      direction: 'Up',
      status: 'Success',
    },
    {
      migrationName: '202610190002_operator_recovery',
      direction: 'Up',
      status: 'Success',
    },
  ]);
  assert.equal(
    (
      await pool.query(
        "select to_regclass('journey.active_journey_dependency') as table_name",
      )
    ).rows[0].table_name,
    'journey.active_journey_dependency',
  );
  assert.equal(
    (await pool.query("select to_regclass('auth.user_account') as table_name"))
      .rows[0].table_name,
    'auth.user_account',
  );
  const copilotTables = (
    await pool.query(
      "select table_schema || '.' || table_name as name from information_schema.tables where table_schema = 'copilot' order by table_name",
    )
  ).rows.map(({ name }) => name);
  assert.deepEqual(copilotTables, [
    'copilot.message',
    'copilot.session',
    'copilot.tool_audit',
  ]);
  const schemas = (
    await pool.query(
      "select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('public','information_schema') order by 1",
    )
  ).rows
    .map((r) => `"${r.nspname}"`)
    .join(',');
  // Proposed permission template: immutable data read-only; product mutations only.
  psql(
    'rehearsal',
    `create role tnx_runtime login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${runtimePassword}';
    revoke create on schema public from public;
    revoke all on database rehearsal from public;
    grant connect on database rehearsal to tnx_runtime;
    grant usage on schema ${schemas}, public to tnx_runtime;
    grant select on all tables in schema ${schemas} to tnx_runtime;
    grant insert,update,delete on all tables in schema journey,report,recovery to tnx_runtime;
    grant select,insert,update on all tables in schema copilot,auth to tnx_runtime;
    grant usage,select on all sequences in schema journey,report,recovery to tnx_runtime;
    create table journey.deployment_probe (id integer primary key, value text not null);
    grant select,insert,update,delete on journey.deployment_probe to tnx_runtime;
    alter table disruption.event validate constraint disruption_event_hazard_evidence_check;`,
  );
  const runtime = new Pool({
    host: '127.0.0.1',
    port,
    database: 'rehearsal',
    user: 'tnx_runtime',
    password: runtimePassword,
    max: 1,
  });
  pools.push(runtime);
  const flags = (
    await runtime.query(
      'select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user',
    )
  ).rows[0];
  assert.ok(Object.values(flags).every((value) => value === false));
  await assert.rejects(
    runtime.query('create table journey.forbidden(id int)'),
    /permission denied/,
  );
  await assert.rejects(
    runtime.query('update meta.kysely_migration set name=name'),
    /permission denied/,
  );
  await runtime.query('begin');
  await runtime.query(
    "insert into journey.deployment_probe values(1,'rollback')",
  );
  await runtime.query('rollback');
  assert.equal(
    (
      await runtime.query(
        'select count(*)::int n from journey.deployment_probe',
      )
    ).rows[0].n,
    0,
  );
  await runtime.query(
    "insert into journey.deployment_probe values(1,'committed')",
  );
  await assert.rejects(
    runtime.query("insert into journey.deployment_probe values(1,'duplicate')"),
    /duplicate key/,
  );
  assert.equal(
    (
      await runtime.query(
        'select st_srid(st_setsrid(st_makepoint(106.8,-6.2),4326)) srid',
      )
    ).rows[0].srid,
    4326,
  );
  const integrity = (
    await pool.query(
      'select (select count(*)::int from pg_index where not indisvalid) invalid_indexes, (select count(*)::int from pg_constraint where not convalidated) unvalidated_constraints',
    )
  ).rows[0];
  assert.deepEqual(integrity, {
    invalid_indexes: 0,
    unvalidated_constraints: 0,
  });
  checkpoint('migrations_permissions_transactions', {
    status: 'PASS',
    migrations: migrations.length,
    migration_names: migrationNames,
    copilot_tables: copilotTables,
    auth_and_operator_migrations_rollback_reapply: 'PASS',
    runtime_flags: flags,
    integrity,
    port,
    database: 'rehearsal',
    marker: id,
    oid: (
      await pool.query(
        "select oid from pg_database where datname=current_database() and shobj_description(oid,'pg_database')=$1",
        [id],
      )
    ).rows[0].oid,
  });
  const snapshot = async (p: Pool) => {
    const tables = (
      await p.query(
        "select schemaname,tablename from pg_tables where schemaname not like 'pg_%' and schemaname not in ('information_schema','public') order by 1,2",
      )
    ).rows;
    const result = [];
    for (const { schemaname, tablename } of tables) {
      const rows = (
        await p.query(
          `select row_to_json(t)::text v from "${schemaname}"."${tablename}" t order by row_to_json(t)::text`,
        )
      ).rows;
      result.push({
        table: `${schemaname}.${tablename}`,
        rows: rows.length,
        sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      });
    }
    return result;
  };
  // Explicit SAMPLE identities/topology/audits; never copied from product DB.
  psql(
    'rehearsal',
    `do $$
    declare source uuid := gen_random_uuid(); version uuid := gen_random_uuid();
      operator uuid := gen_random_uuid(); entity uuid := gen_random_uuid();
      route uuid := gen_random_uuid(); snapshot uuid := gen_random_uuid();
      account uuid := gen_random_uuid();
    begin
      insert into auth.user_account(id,email,password_hash)
        values(account,'sample-rehearsal@example.invalid','scrypt$' || repeat('0',32) || '$' || repeat('0',128));
      insert into auth.role_assignment(id,user_id,role_code) values(gen_random_uuid(),account,'RESEARCHER_OPERATOR');
      insert into auth.session(id,user_id,token_hash,expires_at) values(gen_random_uuid(),account,repeat('0',64),now()+interval '1 hour');
      insert into auth.login_attempt(id,ip_digest,email_digest,success) values(gen_random_uuid(),repeat('0',64),repeat('0',64),true);
      insert into meta.dataset_source(id,source_key,name,provider,source_type,license_name,verification_status)
        values(source,'SAMPLE-rehearsal','SAMPLE rehearsal topology','SAMPLE','TEST_FIXTURE','TEST-ONLY','NOT_VERIFIED');
      insert into meta.dataset_version(id,source_id,version_label,checksum_sha256,retrieved_at,raw_path_ref,manifest_path,validation_status)
        values(version,source,'SAMPLE',repeat('0',64),now(),'SAMPLE:rehearsal','SAMPLE:rehearsal','VALID');
      insert into transit.operator(id,dataset_version_id,external_id,code,name,mode_group)
        values(operator,version,'SAMPLE','SAMPLE','SAMPLE','BUS');
      insert into twin.mobility_entity(id,entity_type,creation_dataset_version_id) values(entity,'ROUTE',version);
      insert into transit.route(id,mobility_entity_id,dataset_version_id,operator_id,external_id,short_name,mode)
        values(route,entity,version,operator,'SAMPLE','SAMPLE','TRANSJAKARTA');
      insert into twin.network_snapshot(id,transit_dataset_version_id,spatial_dataset_version_id,processing_version,state_cutoff_at,manifest_ref,content_hash,status,finalized_at)
        values(snapshot,version,version,'SAMPLE',now(),'SAMPLE:rehearsal',repeat('0',64),'FINALIZED',now());
      insert into recovery.operator_recovery_plan(id,owner_ref,idempotency_key,fingerprint,route_id,network_snapshot_id,validation_status,analysis_json)
        values(gen_random_uuid(),'SAMPLE-rehearsal','SAMPLE-rehearsal',repeat('0',64),route,snapshot,'INSUFFICIENT_EVIDENCE','{"evidence_type":"SIMULATED"}');
    end $$;`,
  );
  // Explicit SAMPLE audit rows prove nonempty Copilot data survives restore.
  const sessionId = randomUUID();
  const messageId = randomUUID();
  await pool.query('insert into copilot.session(id,owner_ref) values($1,$2)', [
    sessionId,
    'SAMPLE-deployment-rehearsal',
  ]);
  await pool.query(
    `insert into copilot.message(id,session_id,owner_ref,request_digest,answer_text,evidence_type,fallback_status,response_json)
     values($1,$2,$3,$4,'SAMPLE rehearsal','SIMULATED','DETERMINISTIC_FALLBACK','{}')`,
    [messageId, sessionId, 'SAMPLE-deployment-rehearsal', '0'.repeat(64)],
  );
  await pool.query(
    `insert into copilot.tool_audit(id,message_id,session_id,owner_ref,tool_name,request_digest,result_ref,status,latency_ms)
     values($1,$2,$3,$4,'SAMPLE','${'0'.repeat(64)}','SAMPLE','UNAVAILABLE',0)`,
    [randomUUID(), messageId, sessionId, 'SAMPLE-deployment-rehearsal'],
  );
  const schemaSnapshot = async (p: Pool) =>
    (
      await p.query(`
      select 'column' kind, table_name || '.' || column_name name,
        json_build_array(ordinal_position, data_type, udt_name, is_nullable, column_default)::text definition
      from information_schema.columns where table_schema='copilot'
      union all
      select 'constraint', conrelid::regclass::text || '.' || conname,
        pg_get_constraintdef(oid) from pg_constraint
      where connamespace='copilot'::regnamespace
      union all
      select 'index', indexname, indexdef from pg_indexes where schemaname='copilot'
      order by 1,2`)
    ).rows;
  const beforeSchema = await schemaSnapshot(pool);
  const before = await snapshot(pool);
  assert.deepEqual(
    before
      .filter(({ table }) => copilotTables.includes(table))
      .map(({ table, rows }) => ({ table, rows })),
    copilotTables.map((table) => ({ table, rows: 1 })),
  );
  const dump = docker([
    'exec',
    container,
    'pg_dump',
    '-U',
    'postgres',
    '-Fc',
    '-d',
    'rehearsal',
  ]);
  writeFileSync(join(dir, 'backup.dump'), dump, { mode: 0o600 });
  docker(
    [
      'exec',
      '-i',
      container,
      'pg_restore',
      '--exit-on-error',
      '-U',
      'postgres',
      '-d',
      'restored',
    ],
    dump,
  );
  const restored = new Pool({
    host: '127.0.0.1',
    port,
    database: 'restored',
    user: 'postgres',
    password,
    max: 1,
  });
  pools.push(restored);
  assert.deepEqual(await snapshot(restored), before);
  assert.deepEqual(await schemaSnapshot(restored), beforeSchema);
  const restoredCopilot = (
    await restored.query(
      "select table_schema || '.' || table_name as name from information_schema.tables where table_schema = 'copilot' order by table_name",
    )
  ).rows.map(({ name }) => name);
  assert.deepEqual(restoredCopilot, copilotTables);
  checkpoint('backup_restore', {
    status: 'PASS',
    tables: before.length,
    copilot_tables: restoredCopilot,
    copilot_schema_and_sample_rows: 'PASS',
    rows: before.reduce((n, t) => n + t.rows, 0),
    bytes: dump.length,
    sha256: createHash('sha256').update(dump).digest('hex'),
    scope:
      'fresh migrations plus SAMPLE transaction fixture; not product-data recovery',
  });
  const apiPort = await freePort();
  const webPort = await freePort();
  const tlsPort = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    APP_ENV: 'production',
    API_PORT: String(apiPort),
    API_HOST: '127.0.0.1',
    DATABASE_URL: '',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: String(port),
    POSTGRES_DB: 'rehearsal',
    POSTGRES_USER: 'tnx_runtime',
    POSTGRES_PASSWORD: runtimePassword,
    CONTROLLED_REVIEW_ENABLED: 'false',
    CONTROLLED_REVIEW_TOKEN: '',
    PASSENGER_SERVICE_TOKEN: randomBytes(32).toString('hex'),
    PASSENGER_SESSION_SECRET: randomBytes(32).toString('hex'),
    PASSENGER_API_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1`,
  };
  const startApi = () => {
    const p = spawn(
      process.execPath,
      [process.env.REHEARSAL_API_ENTRYPOINT ?? 'apps/api/dist/main.js'],
      {
        cwd: root,
        env,
        stdio: 'ignore',
      },
    );
    children.push(p);
    return p;
  };
  let api = startApi();
  await wait(`http://127.0.0.1:${apiPort}/health/ready`, api);
  // Fault only owned disposable DB: existing runtime connections must also close.
  runtime.on('error', () => {});
  psql(
    'rehearsal',
    `revoke connect on database rehearsal from tnx_runtime;
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname='rehearsal' and usename='tnx_runtime' and pid <> pg_backend_pid();`,
  );
  try {
    let unavailable = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch(`http://127.0.0.1:${apiPort}/health/ready`, {
        signal: AbortSignal.timeout(3000),
      });
      unavailable = response.status;
      if (unavailable === 503) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(unavailable, 503);
  } finally {
    psql('rehearsal', 'grant connect on database rehearsal to tnx_runtime;');
  }
  await wait(`http://127.0.0.1:${apiPort}/health/ready`, api);
  assert.equal(
    (
      await runtime.query(
        'select value from journey.deployment_probe where id=1',
      )
    ).rows[0].value,
    'committed',
  );
  checkpoint('database_outage_recovery', {
    status: 'PASS',
    fault: 'owned database CONNECT revoked and runtime sessions terminated',
    readiness_unavailable: 503,
    committed_data_preserved: true,
  });
  const web = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(webPort),
    ],
    { cwd: join(root, 'apps/web'), env, stdio: 'ignore' },
  );
  children.push(web);
  await wait(`http://127.0.0.1:${webPort}/`, web);
  // Real API/Web/DB plus existing OTP; no SAMPLE servers or secret URL output.
  const monitoring = spawn(
    process.execPath,
    ['infra/deployment/health-check.mjs'],
    {
      cwd: root,
      env: {
        ...env,
        API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        WEB_BASE_URL: `http://127.0.0.1:${webPort}`,
        OTP_URL: process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const monitoringCode = await new Promise<number | null>((resolve, reject) => {
    monitoring.once('error', reject);
    monitoring.once('close', resolve);
  });
  assert.equal(monitoringCode, 0, 'Real deployment monitoring probes failed');
  checkpoint('monitoring_probes', {
    status: 'PASS',
    scope:
      'real production API/Web/PostGIS and existing OTP; no alert scheduler/delivery claim',
  });
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore', timeout: 15000 },
  );
  const tls = httpsServer(
    {
      key: readFileSync(join(dir, 'key.pem')),
      cert: readFileSync(join(dir, 'cert.pem')),
    },
    (incoming, outgoing) => {
      const upstream = request(
        {
          host: '127.0.0.1',
          port: webPort,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
          timeout: 10000,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    },
  );
  await new Promise<void>((resolve) =>
    tls.listen(tlsPort, '127.0.0.1', resolve),
  );
  try {
    const { request: tlsRequest } = await import('node:https');
    const code = await new Promise<number>((resolve, reject) => {
      const req = tlsRequest(
        {
          host: '127.0.0.1',
          port: tlsPort,
          path: '/',
          rejectUnauthorized: false,
          timeout: 10000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('TLS deadline')));
      req.end();
    });
    assert.equal(code, 200);
    await stop(api);
    api = startApi();
    await wait(`http://127.0.0.1:${apiPort}/health/ready`, api);
    assert.equal(
      (
        await runtime.query(
          'select value from journey.deployment_probe where id=1',
        )
      ).rows[0].value,
      'committed',
    );
    checkpoint('production_start_https_restart', {
      status: 'PASS',
      apiPort,
      webPort,
      tlsPort,
      runtime: 'tnx_runtime',
      controlled_review: false,
      limitation:
        'local self-signed HTTPS and startup/readiness only; no historical routing data seeded',
    });
  } finally {
    tls.closeAllConnections();
    await new Promise<void>((resolve) => tls.close(() => resolve()));
  }
  passed = true;
}
try {
  await main();
} catch (error) {
  // No raw provider/DB errors: those can contain credentials or sensitive SQL.
  checkpoint('rehearsal', {
    status: 'FAIL',
    error_type: error instanceof Error ? error.name : 'unknown',
    message:
      error instanceof assert.AssertionError
        ? error.message
        : 'Execution failed; inspect owned resources locally without publishing secrets',
    container,
  });
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) await stop(child);
  for (const pool of pools) await pool.end();
  if (passed && owned) {
    const inspected = JSON.parse(docker(['inspect', container]).toString())[0];
    assert.equal(inspected.Config.Labels['tnx.rehearsal'], id);
    docker(['rm', '-f', '-v', container]);
    rmSync(dir, { recursive: true });
    checkpoint('cleanup', { status: 'PASS', container, marker: id });
  } else checkpoint('retained_on_failure', { container, directory: dir });
}
