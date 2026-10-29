import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';

import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';
import type { NetworkSnapshot } from '../mobility-twin/domain/mobility-twin.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';

const TRANSIT_VERSION = 'bf7e3650-6af7-5bee-b25a-26f763f7fe4c';
const RAIL_VERSION = '19dde3d7-a359-5457-bea5-a6db1704543d';
const SPATIAL_VERSION = 'e6aa5be0-0cf4-5e33-8581-696af9a2045f';
const CONTROLLED_PROCESSING_VERSION = 'EXT_X1_CONTROLLED_TEST_BRIDGE_V1';
const CONTROLLED_CUTOFF_AT = new Date('2026-10-02T00:00:00.000Z');
const CONTROLLED_CONFIGURATION = {
  evidence_class: 'TEST_CONTROLLED',
  identity_bridge_only: true,
  spatial_entities_copied: false,
  operational_observations_at_bootstrap: 0,
  production_runtime: false,
} as const;
const CONTROLLED_MANIFEST_REF =
  'data/manifests/EXT-X1-HAZARD-INCIDENT-EVIDENCE.json';
const EXPECTED_ROUTE_ID = 'c95bde93-682f-5742-ab1f-3b0f653ecbae';
const EXPECTED_STOP_ID = '72c80913-9833-53ac-8ab4-4cb103517ac4';
const MAX_BYTES = 20 * 1024 * 1024;
const BATCH_SIZE = 500;
const TARGET_DATABASE = 'transum_in_nexus_ext_x1';
const DEMO_SEED_DATABASE = 'tnx_demo_seed_20261011';
const IDENTITY_VERSIONS = [TRANSIT_VERSION, RAIL_VERSION];

function isAdmittedBridgeDestination(databaseName: string): boolean {
  return (
    databaseName === TARGET_DATABASE || databaseName === DEMO_SEED_DATABASE
  );
}

type Row = Record<string, unknown>;
type TableRows = Readonly<Record<string, readonly Row[]>>;
type BridgeData = Readonly<{
  tables: TableRows;
  bytes: number;
}>;

const tableColumns = {
  'meta.dataset_source': [
    'id',
    'source_key',
    'name',
    'provider',
    'source_type',
    'canonical_url',
    'license_name',
    'access_method',
    'access_notes',
    'coverage_notes',
    'redistribution_rule',
    'verification_status',
  ],
  'meta.dataset_version': [
    'id',
    'source_id',
    'version_label',
    'checksum_sha256',
    'retrieved_at',
    'effective_from',
    'effective_to',
    'raw_path_ref',
    'manifest_path',
    'validation_status',
    'metadata_json',
  ],
  'twin.mobility_entity': [
    'id',
    'entity_type',
    'creation_dataset_version_id',
    'created_at',
    'retired_at',
  ],
  'meta.source_entity_reference': [
    'id',
    'source_key',
    'operator_key',
    'source_dataset_version_id',
    'external_reference',
    'reference_type',
    'canonical_entity_id',
    'valid_from',
    'valid_to',
    'provenance_ref',
  ],
} as const;

type TableName = keyof typeof tableColumns;

function connectionUrl(name: string): URL {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new Error(`${name} must use the postgres or postgresql protocol`);
  return url;
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowJson(table: TableName, alias: string): ReturnType<typeof sql> {
  return sql`jsonb_build_object(${sql.join(
    tableColumns[table].flatMap((column) => [
      sql.lit(column),
      sql.ref(`${alias}.${column}`),
    ]),
  )})`;
}

async function readRows(
  transaction: Transaction<FoundationDatabase>,
  table: TableName,
  predicate: ReturnType<typeof sql>,
): Promise<Row[]> {
  const result = await sql<{ row: Row }>`
    select ${rowJson(table, 'source_row')} as row
    from ${sql.raw(table)} as source_row
    where ${predicate}
    order by source_row.id
  `.execute(transaction);
  return result.rows.map(({ row }) => row);
}

async function loadSource(
  source: Kysely<FoundationDatabase>,
): Promise<BridgeData> {
  return source.transaction().execute(async (transaction) => {
    await sql`set transaction read only`.execute(transaction);
    const versions = await readRows(
      transaction,
      'meta.dataset_version',
      sql`id = any(${[TRANSIT_VERSION, RAIL_VERSION, SPATIAL_VERSION]}::uuid[])`,
    );
    assert.deepEqual(
      versions.map((row) => row.id).sort(),
      [TRANSIT_VERSION, RAIL_VERSION, SPATIAL_VERSION].sort(),
      'Source must contain exactly the three pinned dataset versions',
    );

    const sourceIds = [
      ...new Set(versions.map((row) => row.source_id as string)),
    ];
    assert.equal(
      sourceIds.length,
      3,
      'Pinned versions must have three sources',
    );
    const sources = await readRows(
      transaction,
      'meta.dataset_source',
      sql`id = any(${sourceIds}::uuid[])`,
    );
    assert.equal(
      sources.length,
      3,
      'Source must contain exactly three pinned sources',
    );

    const references = await readRows(
      transaction,
      'meta.source_entity_reference',
      sql`source_dataset_version_id = any(${IDENTITY_VERSIONS}::uuid[])`,
    );
    assert.ok(
      references.length > 0,
      'Pinned source entity references are missing',
    );
    const entityIds = [
      ...new Set(references.map((row) => row.canonical_entity_id as string)),
    ];
    const entities = await readRows(
      transaction,
      'twin.mobility_entity',
      sql`id = any(${entityIds}::uuid[])`,
    );
    assert.equal(
      entities.length,
      entityIds.length,
      'Referenced identity entity is missing',
    );

    const tables: TableRows = {
      'meta.dataset_source': sources,
      'meta.dataset_version': versions,
      'twin.mobility_entity': entities,
      'meta.source_entity_reference': references,
    };
    const bytes = Buffer.byteLength(stableJson(tables), 'utf8');
    if (bytes > MAX_BYTES)
      throw new Error(`Selected canonical bridge rows exceed 20 MiB: ${bytes}`);
    return { tables, bytes };
  });
}

async function verifyTableExact(
  database: Kysely<FoundationDatabase>,
  table: TableName,
  expectedRows: readonly Row[],
  transaction?: Transaction<FoundationDatabase>,
  allowMissing = false,
): Promise<void> {
  const queryable = transaction ?? database;
  const rows = await sql<{ row: Row }>`
    select ${rowJson(table, 'target_row')} as row
    from ${sql.raw(table)} as target_row
    order by target_row.id
  `.execute(queryable);
  if (!allowMissing)
    assert.equal(
      rows.rows.length,
      expectedRows.length,
      `${table}: unexpected row count`,
    );
  const expectedById = new Map(expectedRows.map((row) => [row.id, row]));
  for (const { row } of rows.rows) {
    const expected = expectedById.get(row.id);
    assert.ok(expected, `${table}: unexpected ID ${String(row.id)}`);
    assert.equal(
      stableJson(row),
      stableJson(expected),
      `${table}: row ${String(row.id)} differs from source`,
    );
    expectedById.delete(row.id);
  }
  if (!allowMissing)
    assert.equal(
      expectedById.size,
      0,
      `${table}: source rows missing from destination`,
    );
}

async function insertRows(
  transaction: Transaction<FoundationDatabase>,
  table: TableName,
  rows: readonly Row[],
): Promise<number> {
  const columns = tableColumns[table];
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const tuples = batch.map(
      (row) =>
        sql`(${sql.join(columns.map((column) => sql.val(row[column] ?? null)))})`,
    );
    const result = await sql`
      insert into ${sql.raw(table)} (${sql.join(columns.map((column) => sql.ref(column)))})
      values ${sql.join(tuples)}
      on conflict (id) do nothing
    `.execute(transaction);
    inserted += Number(result.numAffectedRows ?? 0);
  }
  return inserted;
}

async function copyAndVerify(
  destination: Kysely<FoundationDatabase>,
  data: BridgeData,
): Promise<number> {
  return destination.transaction().execute(async (transaction) => {
    for (const table of Object.keys(tableColumns) as TableName[]) {
      await verifyTableExact(
        destination,
        table,
        data.tables[table] ?? [],
        transaction,
        true,
      );
    }

    let inserted = 0;
    for (const table of Object.keys(tableColumns) as TableName[]) {
      inserted += await insertRows(
        transaction,
        table,
        data.tables[table] ?? [],
      );
    }
    for (const table of Object.keys(tableColumns) as TableName[]) {
      await verifyTableExact(
        destination,
        table,
        data.tables[table] ?? [],
        transaction,
      );
    }
    return inserted;
  });
}

function assertPinnedIdentities(references: readonly Row[]): void {
  const route = references.find(
    (row) =>
      row.external_reference === '6H' && row.reference_type === 'ROUTE_CODE',
  );
  const stop = references.find(
    (row) =>
      row.external_reference === 'G00283' &&
      row.reference_type === 'OFFICIAL_ID',
  );
  assert.equal(
    route?.canonical_entity_id,
    EXPECTED_ROUTE_ID,
    'route 6H identity mismatch',
  );
  assert.equal(
    stop?.canonical_entity_id,
    EXPECTED_STOP_ID,
    'G00283 identity mismatch',
  );
}

async function createSnapshot(
  destination: Kysely<FoundationDatabase>,
): Promise<NetworkSnapshot> {
  const repository = new KyselyMobilityStateRepository(
    destination,
    new OperationalContractValidator(),
  );
  const snapshot = await repository.createSnapshot({
    transitDatasetVersionId: TRANSIT_VERSION,
    spatialDatasetVersionId: SPATIAL_VERSION,
    processingVersion: CONTROLLED_PROCESSING_VERSION,
    stateCutoffAt: CONTROLLED_CUTOFF_AT,
    configuration: CONTROLLED_CONFIGURATION,
    manifestRef: CONTROLLED_MANIFEST_REF,
  });
  assert.equal(snapshot.processingVersion, CONTROLLED_PROCESSING_VERSION);
  assert.equal(snapshot.stateCutoffAt, CONTROLLED_CUTOFF_AT.toISOString());
  assert.deepEqual(snapshot.configuration, CONTROLLED_CONFIGURATION);
  assert.equal(snapshot.manifestRef, CONTROLLED_MANIFEST_REF);
  assert.equal(snapshot.status, 'FINALIZED');
  assert.equal(snapshot.materializedStateCount, 0);
  return snapshot;
}

async function assertControlledSnapshot(
  destination: Kysely<FoundationDatabase>,
  snapshot: NetworkSnapshot,
): Promise<void> {
  const row = await sql<{ id: string }>`
    select id from twin.network_snapshot
    where id=${snapshot.snapshotId}::uuid
      and processing_version=${CONTROLLED_PROCESSING_VERSION}
      and state_cutoff_at=${CONTROLLED_CUTOFF_AT.toISOString()}::timestamptz
      and configuration_json=${JSON.stringify(CONTROLLED_CONFIGURATION)}::jsonb
      and manifest_ref=${CONTROLLED_MANIFEST_REF}
      and content_hash=${snapshot.contentHash}
      and status='FINALIZED'
  `.execute(destination);
  assert.equal(
    row.rows.length,
    1,
    'Controlled test snapshot metadata mismatch',
  );
  const stateCount = await sql<{ count: number }>`
    select count(*)::int as count from twin.network_snapshot_state
    where snapshot_id=${snapshot.snapshotId}::uuid
  `.execute(destination);
  assert.equal(stateCount.rows[0]?.count, 0);
  assert.equal(snapshot.snapshotId, '07d3393e-e7f4-5708-b467-807406c25a10');
  assert.equal(
    snapshot.contentHash,
    '5609b00c9f700ce5fe77fe11bc9a3368711d0b6deb520131ef0b46f5de9cd111',
  );
  assert.equal(snapshot.transitDatasetVersionId, TRANSIT_VERSION);
  assert.equal(snapshot.spatialDatasetVersionId, SPATIAL_VERSION);
  assert.ok(snapshot.finalizedAt);
}

async function assertReferentialIntegrity(
  destination: Kysely<FoundationDatabase>,
): Promise<{
  refsMissingEntity: number;
  entitiesMissingCreationVersion: number;
}> {
  const result = await sql<{
    refsMissingEntity: number;
    entitiesMissingCreationVersion: number;
  }>`
    select
      (select count(*)::int from meta.source_entity_reference reference
       left join twin.mobility_entity entity on entity.id=reference.canonical_entity_id
       where entity.id is null) as "refsMissingEntity",
      (select count(*)::int from twin.mobility_entity entity
       left join meta.dataset_version version on version.id=entity.creation_dataset_version_id
       where version.id is null) as "entitiesMissingCreationVersion"
  `.execute(destination);
  const counts = result.rows[0];
  assert.ok(counts);
  assert.equal(counts.refsMissingEntity, 0);
  assert.equal(counts.entitiesMissingCreationVersion, 0);
  return counts;
}

async function main(): Promise<void> {
  if (process.env.CANONICAL_BRIDGE_TEST_ONLY !== '1')
    throw new Error(
      'Set CANONICAL_BRIDGE_TEST_ONLY=1 to run this test-only CLI',
    );
  const sourceUrl = connectionUrl('CANONICAL_BRIDGE_SOURCE_DATABASE_URL');
  const destinationUrl = connectionUrl(
    'CANONICAL_BRIDGE_DESTINATION_DATABASE_URL',
  );
  assert.equal(
    databaseName(sourceUrl),
    'transum_in_nexus',
    'Source DB guard failed',
  );
  const destinationDatabase = databaseName(destinationUrl);
  if (process.env.CANONICAL_BRIDGE_DEMO_SEED_ONLY === '1')
    assert.equal(
      destinationDatabase,
      DEMO_SEED_DATABASE,
      'Seed-only destination guard failed',
    );
  assert.equal(sourceUrl.hostname, '127.0.0.1', 'Source host guard failed');
  assert.equal(
    destinationUrl.hostname,
    '127.0.0.1',
    'Destination host guard failed',
  );
  assert.equal(sourceUrl.port, '5433', 'Source port guard failed');
  assert.equal(destinationUrl.port, '5433', 'Destination port guard failed');
  assert.ok(
    isAdmittedBridgeDestination(destinationDatabase),
    'Destination DB guard failed',
  );
  assert.notEqual(
    `${sourceUrl.hostname}:${sourceUrl.port}/${databaseName(sourceUrl)}`,
    `${destinationUrl.hostname}:${destinationUrl.port}/${databaseName(destinationUrl)}`,
    'Source and destination must be separate databases',
  );

  const sourcePool = new Pool({
    connectionString: sourceUrl.toString(),
    max: 1,
  });
  const destinationPool = new Pool({
    connectionString: destinationUrl.toString(),
    max: 1,
  });
  const source = new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({ pool: sourcePool }),
  });
  const destination = new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({ pool: destinationPool }),
  });

  try {
    const data = await loadSource(source);
    assertPinnedIdentities(data.tables['meta.source_entity_reference'] ?? []);
    const payloadSha256 = createHash('sha256')
      .update(stableJson(data.tables))
      .digest('hex');
    const firstPassInserted = await copyAndVerify(destination, data);
    const snapshot = await createSnapshot(destination);
    await assertControlledSnapshot(destination, snapshot);
    const integrity = await assertReferentialIntegrity(destination);
    const secondPassInserted = await copyAndVerify(destination, data);
    const repeatedSnapshot = await createSnapshot(destination);
    assert.deepEqual(
      repeatedSnapshot,
      snapshot,
      'Snapshot creation is not idempotent',
    );
    await assertControlledSnapshot(destination, repeatedSnapshot);
    assert.equal(
      secondPassInserted,
      0,
      'Second exact copy pass must insert no rows',
    );

    process.stdout.write(
      `${JSON.stringify({
        status: 'COMPLETED',
        sourceReadOnly: true,
        destinationDatabase,
        sourceRowsBytes: data.bytes,
        canonicalPayloadSha256: payloadSha256,
        sourceRows: Object.fromEntries(
          Object.entries(data.tables).map(([table, rows]) => [
            table,
            rows.length,
          ]),
        ),
        firstPassInserted,
        secondPassInserted,
        repeatPasses: 2,
        route6H: EXPECTED_ROUTE_ID,
        G00283: EXPECTED_STOP_ID,
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.contentHash,
        snapshotStatus: snapshot.status,
        processingVersion: snapshot.processingVersion,
        stateCutoffAt: snapshot.stateCutoffAt,
        manifestRef: snapshot.manifestRef,
        materializedStateCount: snapshot.materializedStateCount,
        referentialIntegrity: integrity,
      })}\n`,
    );
  } finally {
    await Promise.all([source.destroy(), destination.destroy()]);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
}
