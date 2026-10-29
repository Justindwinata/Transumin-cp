#!/usr/bin/env node
// Run from repo root: node scripts/acceptance/check-restore-constraints.mjs
// Only owned Docker scratch; never reads DATABASE_URL or connects to product DB.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
);
const { Client } = require('pg');
const root = new URL('../../', import.meta.url);
const evidencePath =
  '.release-evidence/exact-runtime-full-attempt14-production.log';
const outputPath = '.release-evidence/final-check-constraints.log';
const evidence = readFileSync(new URL(evidencePath, root), 'utf8');
const differences = JSON.parse(
  evidence
    .split('\n')
    .find((line) => line.includes('constraint_definition_comparison')),
).differences;
assert.equal(differences.length, 3);
const migrations = new URL(
  '../../apps/api/src/infrastructure/database/migrations/',
  import.meta.url,
);
const specs = [
  {
    name: 'recovery_anchor_check',
    file: '202610050001_state_aware_journey_recovery.ts',
    fields: ['recovery_anchor_lat', 'recovery_anchor_lon'],
  },
  {
    name: 'passenger_report_description_check',
    file: '202610120003_passenger_reporting.ts',
    fields: ['description'],
  },
  {
    name: 'passenger_report_verification_reason_check',
    file: '202610120003_passenger_reporting.ts',
    fields: ['reviewer_ref', 'reason'],
  },
];
const output = [];
const log = (value) => {
  const line = JSON.stringify(value);
  output.push(line);
  console.log(line);
};
const name = `tnx-check-constraints-${randomUUID()}`;
const label = randomUUID();
let containerID;
let passed = false;
const clients = [];
function docker(args, input) {
  const result = spawnSync('docker', args, {
    input,
    encoding: input instanceof Buffer ? undefined : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `docker ${args[0]} failed: ${String(result.stderr)}`,
  );
  return result.stdout;
}
// Keep every parenthesis: SQL accepts CHECK's complete parenthesized expression.
const expression = (definition) => {
  assert.match(definition, /^CHECK \(/);
  return definition.slice('CHECK '.length);
};
const truthCases = (values, n) =>
  n === 1
    ? values.map((value) => [value])
    : values.flatMap((a) => truthCases(values, n - 1).map((b) => [a, ...b]));
function textValues(limit) {
  return [
    null,
    '',
    'a',
    ' ',
    '  ',
    'é🙂',
    '\t',
    '\n',
    '\r',
    '\x01',
    '\x7f',
    'normal text',
    'a'.repeat(limit - 1),
    'a'.repeat(limit),
    'a'.repeat(limit + 1),
    'a'.repeat(limit - 1) + '\n',
  ];
}
async function connect(port, database) {
  const client = new Client({
    host: '127.0.0.1',
    port,
    database,
    user: 'postgres',
    password: 'scratch-only',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
try {
  log({
    scope: 'Three CHECKs only; SYNTHETIC cases; no product DB connections',
    evidence: evidencePath,
    evidence_sha256: createHash('sha256').update(evidence).digest('hex'),
  });
  containerID = docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `tnx.check-constraints=${label}`,
    '--memory=256m',
    '--cpus=1',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=128m',
    '-e',
    'POSTGRES_PASSWORD=scratch-only',
    '-p',
    '127.0.0.1::5432',
    'transum-in-nexus/postgis:17.11-3.6',
  ]).trim();
  const inspect = JSON.parse(docker(['inspect', containerID]))[0];
  const port = Number(inspect.NetworkSettings.Ports['5432/tcp'][0].HostPort);
  log({
    scratch: name,
    id: containerID,
    port,
    memory_bytes: inspect.HostConfig.Memory,
    tmpfs: inspect.HostConfig.Tmpfs,
  });
  let ready = false;
  for (let n = 0; n < 90; n++) {
    const result = spawnSync(
      'docker',
      ['exec', containerID, 'pg_isready', '-U', 'postgres'],
      { encoding: 'utf8' },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Scratch PostgreSQL not ready');
  const source = await connect(port, 'postgres');
  log({
    postgres: (await source.query('select version() version')).rows[0].version,
  });
  await source.query('create database restored');
  await source.query('create schema recovery; create schema report');
  for (const spec of specs) {
    const diff = differences.find((d) => d.original.item === spec.name);
    assert.ok(diff);
    assert.equal(diff.original.valid, true);
    assert.equal(diff.restored.valid, true);
    assert.notEqual(diff.original.definition, diff.restored.definition);
    const migration = readFileSync(new URL(spec.file, migrations), 'utf8');
    // Narrow extraction from known migration SQL templates; fail closed on missing fields/CHECK.
    const table = migration
      .split(`create table ${diff.original.schema}.${diff.original.name} (`)[1]
      ?.split('`.execute')[0];
    assert.ok(table, `Missing migration table ${spec.name}`);
    const fields = spec.fields.map((field) => {
      const match = table.match(
        new RegExp(
          `^\\s*${field} (double precision|text|varchar\\(\\d+\\)) (not null)`,
          'm',
        ),
      );
      assert.ok(match, `Missing typed migration field ${field}`);
      return { field, type: match[1], notNull: true };
    });
    const start = table.indexOf(`constraint ${spec.name} check (`);
    assert.ok(start >= 0);
    const checkStart = table.indexOf('(', start);
    let depth = 0,
      end = checkStart;
    for (; end < table.length; end++) {
      if (table[end] === '(') depth++;
      if (table[end] === ')' && --depth === 0) break;
    }
    assert.equal(depth, 0);
    spec.migrationExpression = table.slice(checkStart, end + 1);
    spec.diff = diff;
    spec.fields = fields;
    spec.relation = `${diff.original.schema}.${diff.original.name}`;
    // Original field order/types/nullability; omit unrelated product columns/FKs.
    const columns = fields
      .map((f) => `${f.field} ${f.type} not null`)
      .join(', ');
    await source.query(
      `create table ${spec.relation} (${columns}, constraint ${spec.name} check ${spec.migrationExpression})`,
    );
    const original = (
      await source.query(
        'select pg_get_constraintdef(oid) definition from pg_constraint where conname=$1',
        [spec.name],
      )
    ).rows[0].definition;
    assert.equal(
      original,
      diff.original.definition,
      'Migration must reproduce actual original evidence verbatim',
    );
    const valid =
      spec.name === 'recovery_anchor_check'
        ? [0, 0]
        : spec.fields.map(() => 'SYNTHETIC valid');
    await source.query(
      `insert into ${spec.relation} values (${fields.map((_, i) => `$${i + 1}`).join(',')})`,
      valid,
    );
    log({
      constraint: spec.name,
      migration: spec.file,
      migration_sha256: createHash('sha256').update(migration).digest('hex'),
      fields,
      migration_expression: spec.migrationExpression,
      original,
    });
  }
  const dumpRaw = spawnSync(
    'docker',
    ['exec', containerID, 'pg_dump', '-U', 'postgres', '-d', 'postgres'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(dumpRaw.status, 0, `pg_dump failed: ${String(dumpRaw.stderr)}`);
  const dump = dumpRaw.stdout; // Buffer
  const psql = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      containerID,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'restored',
      '-q',
    ],
    { input: dump, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(psql.status, 0, `psql restore failed: ${String(psql.stderr)}`);
  log({
    actual_pg_dump_restore: true,
    dump_kind: 'pg_dump plain SQL piped to psql',
    dump_sha256: createHash('sha256').update(dump).digest('hex'),
    dump_bytes: dump.length,
  });
  const restored = await connect(port, 'restored');
  let total = 0;
  for (const spec of specs) {
    const catalog = async (client) =>
      (
        await client.query(
          'select pg_get_constraintdef(oid) definition,conbin::text tree,convalidated from pg_constraint where conname=$1',
          [spec.name],
        )
      ).rows[0];
    const original = await catalog(source),
      actualRestored = await catalog(restored);
    assert.equal(
      actualRestored.definition,
      spec.diff.restored.definition,
      'Actual pg_restore must reproduce restored evidence verbatim',
    );
    assert.equal(actualRestored.convalidated, true);
    assert.deepEqual(
      (await source.query(`select * from ${spec.relation}`)).rows,
      (await restored.query(`select * from ${spec.relation}`)).rows,
    );
    // Separate nullable probes isolate CHECK truth from original fields' NOT NULL constraints.
    for (const [suffix, definition] of [
      ['original', spec.diff.original.definition],
      ['restored', spec.diff.restored.definition],
    ]) {
      await source.query(
        `create temp table probe_${suffix} (${spec.fields.map((f) => `${f.field} ${f.type}`).join(',')}, constraint probe_check ${definition})`,
      );
    }
    const parsedTrees = (
      await source.query(
        "select conrelid::regclass::text relation,conbin::text tree from pg_constraint where conname='probe_check' order by relation",
      )
    ).rows;
    assert.equal(parsedTrees.length, 2);
    // Do not erase tree differences (locations or AND nesting) to manufacture equality.
    log({
      constraint: spec.name,
      original: spec.diff.original.definition,
      restored: actualRestored.definition,
      raw_conbin_equal: original.tree === actualRestored.tree,
      original_conbin: original.tree,
      restored_conbin: actualRestored.tree,
      probe_conbin_equal: parsedTrees[0].tree === parsedTrees[1].tree,
    });
    const points = [
      -Infinity,
      -180.000001,
      -180,
      -179.999999,
      -90.000001,
      -90,
      -89.999999,
      0,
      89.999999,
      90,
      90.000001,
      179.999999,
      180,
      180.000001,
      Infinity,
      NaN,
      null,
    ];
    const cases =
      spec.name === 'recovery_anchor_check'
        ? truthCases(points, 2)
        : spec.name === 'passenger_report_description_check'
          ? textValues(2000).map((x) => [x])
          : textValues(1000).flatMap((reason) =>
              [
                null,
                '',
                ' ',
                '  ',
                '\t',
                '\n',
                'reviewer',
                ' reviewer ',
                'x'.repeat(128),
              ].map((reviewer) => [reviewer, reason]),
            );
    const binds = spec.fields.map((f, i) => `$${i + 1}::${f.type}`).join(',');
    const evaluate = `select ${expression(spec.diff.original.definition)} original, ${expression(spec.diff.restored.definition)} restored, ${spec.migrationExpression} migration from (values (${binds})) t(${spec.fields.map((f) => f.field).join(',')})`;
    const counts = { true: 0, false: 0, null: 0 };
    for (const values of cases) {
      const row = (await source.query(evaluate, values)).rows[0];
      assert.equal(row.original, row.restored);
      assert.equal(row.original, row.migration);
      counts[String(row.original)]++;
      for (const suffix of ['original', 'restored']) {
        try {
          await source.query(
            `insert into probe_${suffix} values (${binds})`,
            values,
          );
          assert.notEqual(row.original, false, 'CHECK must reject FALSE');
        } catch (error) {
          assert.equal(error.code, '23514', 'Only CHECK violation accepted');
          assert.equal(row.original, false, 'CHECK must accept TRUE/NULL');
        }
      }
    }
    assert.ok(counts.true > 0 && counts.false > 0 && counts.null > 0);
    total += cases.length;
    await source.query('drop table probe_original, probe_restored');
    log({
      constraint: spec.name,
      cases: cases.length,
      truth_counts: counts,
      three_valued_truth_equal: true,
      check_insert_acceptance_equal: true,
      populated_dump_restore_equal: true,
      fixture_generation:
        spec.name === 'recovery_anchor_check'
          ? '17 latitude x 17 longitude: boundaries ±epsilon, null, NaN, ±Infinity'
          : 'length 0/1/max-1/max/max+1, Unicode, spaces, controls, null; reason cross reviewer null/empty/spaces/tab/newline/valid/padded/128 chars',
    });
  }
  log({
    status: 'PASS',
    scope: 'BOUNDED_EQUALITY',
    constraints: 3,
    cases: total,
    universal_proof: false,
    explanation:
      'Migration BETWEEN creates nested AND BoolExpr bounds. pg_dump emits pg_get_constraintdef SQL; restore reparses emitted AND sequence, flattening left-associated AND group. Actual dump/restore reproduces all three evidence strings. Raw conbin differs; no canonical-tree equality or universal-proof claim. Every sampled TRUE/FALSE/NULL and real CHECK insert outcome agrees.',
  });
  passed = true;
} catch (error) {
  log({
    status: 'NOT VERIFIED',
    error: error.message,
    retained_container: containerID ?? null,
  });
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.end().catch(() => {});
  if (passed && containerID) {
    const current = JSON.parse(docker(['inspect', containerID]))[0];
    assert.equal(current.Id, containerID);
    assert.equal(current.Config.Labels['tnx.check-constraints'], label);
    docker(['rm', '-f', containerID]);
    log({ cleanup: 'OWNED_CONTAINER_REMOVED', id: containerID });
  }
  writeFileSync(new URL(outputPath, root), output.join('\n') + '\n');
}
