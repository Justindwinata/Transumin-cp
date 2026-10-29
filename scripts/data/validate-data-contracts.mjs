import { access, readFile } from 'node:fs/promises';
import { verifyManifestArtifacts } from './verify-manifest-artifacts.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const checks = [
  {
    schema: 'data/registry/source-record.schema.json',
    document: 'data/registry/transjakarta-gtfs.json',
  },
  {
    schema: 'data/manifests/dataset-manifest.schema.json',
    document: 'data/manifests/transjakarta-gtfs-63b4fb14d9af.json',
  },
  ...[
    'krl-commuter-jabodetabek.json',
    'mrt-jakarta.json',
    'lrt-jakarta.json',
    'lrt-jabodebek.json',
  ].map((document) => ({
    schema: 'data/registry/source-record.schema.json',
    document: `data/registry/${document}`,
  })),
  {
    schema: 'data/manifests/phase1-operator-coverage.schema.json',
    document: 'data/manifests/PHASE-1-OPERATOR-COVERAGE.json',
  },
  {
    schema: 'data/manifests/phase1-canonical-transit-snapshot.schema.json',
    document: 'data/manifests/PHASE-1-CANONICAL-TRANSIT-SNAPSHOT.json',
  },
  {
    schema:
      'data/manifests/operational-data-source-capability-matrix.schema.json',
    document: 'data/manifests/OPERATIONAL-DATA-SOURCE-CAPABILITY-MATRIX.json',
  },
  {
    schema: 'data/manifests/phase2a-spatial-snapshot.schema.json',
    document: 'data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json',
  },
  {
    schema: 'data/manifests/phase2-base-network-snapshot.schema.json',
    document: 'data/manifests/PHASE-2-BASE-NETWORK-SNAPSHOT.json',
  },
];

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), 'utf8'),
  );
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = new Map();

for (const check of checks) {
  const document = await readJson(check.document);
  let validate = validators.get(check.schema);
  if (!validate) {
    validate = ajv.compile(await readJson(check.schema));
    validators.set(check.schema, validate);
  }
  if (!validate(document)) {
    throw new Error(
      `${check.document} violates ${check.schema}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
    );
  }
}

const registry = await readJson('data/registry/transjakarta-gtfs.json');
const manifest = await readJson(registry.current_manifest);
for (const reference of [
  registry.license_record,
  manifest.license_record,
  manifest.validation_report_ref,
  manifest.external_validation_summary_ref,
]) {
  if (typeof reference === 'string') {
    await access(path.join(repositoryRoot, reference));
  }
}

const sourceRecords = await Promise.all(
  checks
    .filter((check) => check.schema.endsWith('source-record.schema.json'))
    .map((check) => readJson(check.document)),
);
const uniqueSourceIds = new Set(
  sourceRecords.map((record) => record.source_id),
);
const uniqueSourceKeys = new Set(
  sourceRecords.map((record) => record.source_key),
);
if (
  uniqueSourceIds.size !== sourceRecords.length ||
  uniqueSourceKeys.size !== sourceRecords.length
) {
  throw new Error(
    'Source IDs and keys must be collision-safe across providers',
  );
}

const phase1Snapshot = await readJson(
  'data/manifests/PHASE-1-CANONICAL-TRANSIT-SNAPSHOT.json',
);
const coverage = await readJson(phase1Snapshot.coverage_manifest);
await access(path.join(repositoryRoot, phase1Snapshot.coverage_manifest));
for (const source of phase1Snapshot.sources) {
  const sourceManifest = await readJson(source.manifest);
  if (
    sourceManifest.dataset_version_id !== source.dataset_version_id ||
    sourceManifest.checksum_sha256 !== source.checksum_sha256
  ) {
    throw new Error(
      `Phase 1 source ${source.source_key} does not match its immutable manifest`,
    );
  }
}
const expectedReproducibilityKey = `${phase1Snapshot.pipeline_version}:${phase1Snapshot.representative_service_date}:${phase1Snapshot.sources.map((source) => source.checksum_sha256).join(':')}`;
if (phase1Snapshot.reproducibility_key !== expectedReproducibilityKey) {
  throw new Error('Phase 1 reproducibility key does not match its inputs');
}
if (new Set(coverage.operators.map((item) => item.operator)).size !== 6) {
  throw new Error('Phase 1 coverage must contain six unique operator rows');
}

const operationalMatrix = await readJson(
  'data/manifests/OPERATIONAL-DATA-SOURCE-CAPABILITY-MATRIX.json',
);
const requiredModes = new Set([
  'TRANSJAKARTA',
  'MIKROTRANS',
  'KRL',
  'MRT_JAKARTA',
  'LRT_JAKARTA',
  'LRT_JABODEBEK',
  'WALKING',
]);
const actualModes = new Set(
  operationalMatrix.mode_coverage.map((item) => item.mode),
);
if (
  actualModes.size !== requiredModes.size ||
  [...requiredModes].some((mode) => !actualModes.has(mode))
) {
  throw new Error(
    'Operational coverage must contain every target mode exactly once',
  );
}

const spatialSnapshot = await readJson(
  'data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json',
);
const artifactVerification = await verifyManifestArtifacts(
  [
    spatialSnapshot.source_archive,
    spatialSnapshot.raw,
    spatialSnapshot.processing,
  ],
  {
    root: repositoryRoot,
    metadataOnly: process.argv.includes('--metadata-only'),
  },
);
if (
  spatialSnapshot.transit_snapshot_dependency.snapshot_id !==
  phase1Snapshot.snapshot_id
) {
  throw new Error(
    'Phase 2A spatial snapshot must depend on the frozen Phase 1 snapshot',
  );
}
const phase2Snapshot = await readJson(
  'data/manifests/PHASE-2-BASE-NETWORK-SNAPSHOT.json',
);
if (
  phase2Snapshot.transit_snapshot.snapshot_id !== phase1Snapshot.snapshot_id ||
  phase2Snapshot.spatial_snapshot.snapshot_id !== spatialSnapshot.snapshot_id
) {
  throw new Error('Phase 2 snapshot dependencies do not match frozen inputs');
}
if (
  phase2Snapshot.configuration.scenario_overrides_included !== false ||
  phase2Snapshot.configuration.missing_evidence_state !== 'UNKNOWN'
) {
  throw new Error(
    'Phase 2 base snapshot must exclude scenarios and preserve UNKNOWN',
  );
}
if (
  phase2Snapshot.status !== 'FINALIZED' ||
  typeof phase2Snapshot.network_snapshot_id !== 'string' ||
  typeof phase2Snapshot.content_hash !== 'string'
) {
  throw new Error(
    'Phase 2 base snapshot must be finalized and content-addressed',
  );
}
const operationalSourceIds = new Set(
  operationalMatrix.sources.map((source) => source.source_id),
);
const operationalSourceKeys = new Set(
  operationalMatrix.sources.map((source) => source.source_key),
);
if (
  operationalSourceIds.size !== operationalMatrix.sources.length ||
  operationalSourceKeys.size !== operationalMatrix.sources.length
) {
  throw new Error('Operational source IDs and keys must be unique');
}
const jli = operationalMatrix.sources.find(
  (source) =>
    source.source_key === 'jaklingko-indonesia-application-and-partnership',
);
if (jli?.classification !== 'PARTNERSHIP_REQUIRED') {
  throw new Error(
    'JLI must remain partnership-required until a public machine contract is verified',
  );
}
const petaBencana = operationalMatrix.sources.find(
  (source) => source.source_key === 'petabencana-public-flood-api',
);
if (
  petaBencana?.source_id !== 'a129327c-e4cd-400b-a55d-c8577f95c404' ||
  petaBencana.implementation_status !== 'ADAPTER_IMPLEMENTED'
) {
  throw new Error(
    'PetaBencana registry identity must match its implemented adapter',
  );
}
if (
  operationalMatrix.mode_coverage.some((item) =>
    item.current_implementation_status
      .split(';')
      .map((status) => status.trim())
      .includes('LIVE_CONNECTED'),
  )
) {
  throw new Error(
    'No target transport mode has verified live machine connectivity yet',
  );
}

process.stdout.write(`Data contracts valid (${checks.length} records).\n`);
process.stdout.write(`Local artifact availability: ${artifactVerification}.\n`);
