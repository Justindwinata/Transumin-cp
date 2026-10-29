import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readGtfsArchive } from './gtfs-archive.js';
import { getCanonicalCounts, ingestGtfsFeed } from './gtfs-ingestor.js';
import { normalizeGtfsFeed } from './gtfs-normalizer.js';
import type {
  GtfsValidationReport,
  TransJakartaManifest,
  TransJakartaRegistry,
} from './gtfs.types.js';
import { validateGtfsArchive } from './gtfs-validator.js';

const repositoryRoot = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);
const registryPath = path.join(
  repositoryRoot,
  'data/registry/transjakarta-gtfs.json',
);

type Command = 'fetch' | 'validate' | 'ingest' | 'verify';

interface RegistryRecord {
  readonly source_id: string;
  readonly source_key: string;
  readonly name: string;
  readonly provider: string;
  readonly canonical_url: string;
  readonly access_method: 'HTTPS_DOWNLOAD';
  readonly official_download_url: string;
  readonly license_name: 'CC BY 4.0';
  readonly license_url: string;
  readonly license_evidence_url: string;
  readonly attribution_requirement: string;
  readonly redistribution_rule: string;
  readonly verification_status: 'VERIFIED';
  readonly verified_at: string;
  readonly evidence: readonly string[];
  readonly corroboration: readonly string[];
  readonly current_manifest: string;
}

interface ManifestRecord {
  readonly dataset_source_id: string;
  readonly dataset_version_id: string;
  readonly source_key: string;
  readonly version_label: string;
  readonly retrieved_at: string;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly checksum_sha256: string;
  readonly raw_path_ref: string;
  readonly validation_status: 'VALID' | 'WARNING';
  readonly validation_report_ref: string;
  readonly publication_page: string;
  readonly requested_download_url: string;
  readonly resolved_download_url: string;
  readonly http_status: 200;
  readonly content_type: 'application/zip';
  readonly archive_filename: string;
  readonly archive_bytes: number;
  readonly validator: 'TRANSUM_IN_GTFS_VALIDATOR_V1';
  readonly external_validator_status: 'PASS' | 'NOT_VERIFIED';
  readonly external_validator_note: string;
}

function parseCommand(value: string | undefined): Command {
  if (
    value === 'fetch' ||
    value === 'validate' ||
    value === 'ingest' ||
    value === 'verify'
  ) {
    return value;
  }
  throw new Error('Expected command: fetch, validate, ingest, or verify');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function loadRegistry(): Promise<TransJakartaRegistry> {
  const record = await readJson<RegistryRecord>(registryPath);
  if (record.verification_status !== 'VERIFIED') {
    throw new Error('TransJakarta source registry record is not VERIFIED');
  }
  return {
    schemaVersion: 1,
    sourceId: record.source_id,
    sourceKey: record.source_key,
    datasetName: record.name,
    publisher: record.provider,
    publicationPage: record.canonical_url,
    officialDownloadUrl: record.official_download_url,
    accessMethod: record.access_method,
    license: {
      name: record.license_name,
      url: record.license_url,
      evidenceUrl: record.license_evidence_url,
      attributionRequirement: record.attribution_requirement,
      redistributionImplication: record.redistribution_rule,
    },
    verification: {
      status: record.verification_status,
      verifiedAt: record.verified_at,
      evidence: record.evidence,
      corroboration: record.corroboration,
    },
    currentManifest: record.current_manifest,
  };
}

async function loadManifest(
  registry: TransJakartaRegistry,
): Promise<TransJakartaManifest> {
  const record = await readJson<ManifestRecord>(
    path.join(repositoryRoot, registry.currentManifest),
  );
  return {
    schemaVersion: 1,
    datasetSourceId: record.dataset_source_id,
    datasetVersionId: record.dataset_version_id,
    sourceKey: record.source_key,
    versionLabel: record.version_label,
    source: {
      publisher: registry.publisher,
      publicationPage: record.publication_page,
      requestedDownloadUrl: record.requested_download_url,
      resolvedDownloadUrl: record.resolved_download_url,
      accessMethod: registry.accessMethod,
      httpStatus: record.http_status,
      contentType: record.content_type,
      licenseName: registry.license.name,
      licenseUrl: registry.license.url,
      licenseEvidenceUrl: registry.license.evidenceUrl,
    },
    snapshot: {
      retrievedAt: record.retrieved_at,
      archiveFilename: record.archive_filename,
      rawPathRef: record.raw_path_ref,
      bytes: record.archive_bytes,
      sha256: record.checksum_sha256,
    },
    serviceCoverage: {
      effectiveFrom: record.effective_from?.slice(0, 10) ?? null,
      effectiveTo: record.effective_to?.slice(0, 10) ?? null,
    },
    validation: {
      status: record.validation_status,
      validator: record.validator,
      qualityReportPath: record.validation_report_ref,
      externalValidatorStatus: record.external_validator_status,
      externalValidatorNote: record.external_validator_note,
    },
  };
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function loadAndValidateSnapshot(
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
): Promise<GtfsValidationReport> {
  if (registry.sourceId !== manifest.datasetSourceId) {
    throw new Error('Registry source ID does not match the snapshot manifest');
  }
  const archivePath = path.join(repositoryRoot, manifest.snapshot.rawPathRef);
  const archiveStat = await stat(archivePath);
  if (archiveStat.size !== manifest.snapshot.bytes) {
    throw new Error(
      'Raw snapshot byte size does not match the tracked manifest',
    );
  }
  const checksum = await sha256(archivePath);
  if (checksum !== manifest.snapshot.sha256) {
    throw new Error('Raw snapshot SHA-256 does not match the tracked manifest');
  }
  const archive = await readGtfsArchive(archivePath);
  const parsed = validateGtfsArchive(archive);
  if (parsed.report.status === 'INVALID') {
    throw new Error(
      `GTFS validation failed with ${parsed.report.issues.filter((issue) => issue.severity === 'ERROR').length} error categories`,
    );
  }
  if (parsed.report.status !== manifest.validation.status) {
    throw new Error(
      'Validation status differs from the tracked snapshot manifest',
    );
  }
  return parsed.report;
}

async function parsedSnapshot(
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
) {
  const archivePath = path.join(repositoryRoot, manifest.snapshot.rawPathRef);
  const checksum = await sha256(archivePath);
  if (checksum !== manifest.snapshot.sha256) {
    throw new Error('Raw snapshot SHA-256 does not match the tracked manifest');
  }
  const parsed = validateGtfsArchive(await readGtfsArchive(archivePath));
  if (parsed.report.status === 'INVALID') {
    throw new Error('Refusing to ingest an invalid GTFS snapshot');
  }
  if (
    parsed.report.archiveBytes !== manifest.snapshot.bytes ||
    parsed.report.status !== manifest.validation.status ||
    registry.sourceId !== manifest.datasetSourceId
  ) {
    throw new Error('Validated snapshot differs from its tracked manifest');
  }
  return parsed;
}

async function fetchSnapshot(registry: TransJakartaRegistry): Promise<void> {
  const response = await fetch(registry.officialDownloadUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
    headers: { 'user-agent': 'TRANSUM-IN-NEXUS/Phase-1B' },
  });
  if (!response.ok) {
    throw new Error(
      `Official GTFS download failed with HTTP ${response.status}`,
    );
  }
  const resolved = new URL(response.url);
  if (
    resolved.protocol !== 'https:' ||
    resolved.hostname !== 'gtfs.transjakarta.co.id'
  ) {
    throw new Error(
      `Official download resolved to an unexpected origin: ${response.url}`,
    );
  }
  const contentType = response.headers.get('content-type')?.split(';')[0];
  if (contentType !== 'application/zip') {
    throw new Error(
      `Official download returned unexpected content type: ${contentType ?? 'missing'}`,
    );
  }
  const retrievedAt = new Date().toISOString();
  const date = retrievedAt.slice(0, 10);
  const incomingDirectory = path.join(
    repositoryRoot,
    'data/raw/transjakarta/incoming',
  );
  await mkdir(incomingDirectory, { recursive: true });
  const temporaryPath = path.join(
    incomingDirectory,
    `transjakarta-gtfs-${process.pid}-${Date.now()}.zip.part`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(temporaryPath, bytes, { flag: 'wx' });
  try {
    await readGtfsArchive(temporaryPath);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const targetDirectory = path.join(
      repositoryRoot,
      'data/raw/transjakarta',
      date,
      checksum,
    );
    const targetPath = path.join(targetDirectory, 'transjakarta-gtfs.zip');
    await mkdir(targetDirectory, { recursive: true });
    try {
      await stat(targetPath);
      if ((await sha256(targetPath)) !== checksum) {
        throw new Error(
          'Immutable snapshot path already exists with different bytes',
        );
      }
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await rename(temporaryPath, targetPath);
      } else {
        throw error;
      }
    }
    const currentManifest = await loadManifest(registry).catch(() => null);
    const tracked =
      currentManifest?.snapshot.sha256 === checksum &&
      currentManifest.snapshot.rawPathRef ===
        path.relative(repositoryRoot, targetPath);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: tracked ? 'ALREADY_TRACKED' : 'FETCHED',
          retrievalAttemptAt: retrievedAt,
          snapshotRetrievedAt: tracked
            ? (currentManifest?.snapshot.retrievedAt ?? retrievedAt)
            : retrievedAt,
          httpStatus: response.status,
          contentType,
          resolvedDownloadUrl: response.url,
          bytes: bytes.length,
          sha256: checksum,
          rawPathRef: path.relative(repositoryRoot, targetPath),
          tracked,
          next: tracked
            ? 'Run pnpm data:transjakarta:validate before ingestion.'
            : 'Review provenance, then create/update a tracked immutable manifest before validation.',
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function validateSnapshot(
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
): Promise<void> {
  const report = await loadAndValidateSnapshot(registry, manifest);
  const reportPath = path.join(
    repositoryRoot,
    manifest.validation.qualityReportPath,
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify(
      {
        status: report.status,
        qualityReportPath: manifest.validation.qualityReportPath,
        metrics: report.metrics,
        issueCategories: report.issues.length,
      },
      null,
      2,
    )}\n`,
  );
}

async function ingestSnapshot(
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
): Promise<void> {
  const parsed = await parsedSnapshot(registry, manifest);
  const feed = normalizeGtfsFeed(parsed, manifest);
  const result = await ingestGtfsFeed(registry, manifest, feed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function verifySnapshot(
  registry: TransJakartaRegistry,
  manifest: TransJakartaManifest,
): Promise<void> {
  const parsed = await parsedSnapshot(registry, manifest);
  const feed = normalizeGtfsFeed(parsed, manifest);
  const trackedReport = await readJson<GtfsValidationReport>(
    path.join(repositoryRoot, manifest.validation.qualityReportPath),
  );
  if (JSON.stringify(trackedReport) !== JSON.stringify(parsed.report)) {
    throw new Error(
      'Tracked quality report does not match deterministic validation output',
    );
  }
  const idempotency = await ingestGtfsFeed(registry, manifest, feed);
  if (idempotency.status !== 'ALREADY_IMPORTED') {
    throw new Error('Verification expected an already-imported snapshot');
  }
  const counts = await getCanonicalCounts(manifest.datasetVersionId);
  const expected = parsed.report.metrics;
  const comparisons: Readonly<Record<string, readonly [number, number]>> = {
    operators: [counts.operators, expected.agencies],
    routes: [counts.routes, expected.routes],
    stations: [counts.stations, expected.stations],
    stops: [counts.stops, expected.stops],
    serviceCalendars: [counts.serviceCalendars, expected.serviceCalendars],
    serviceExceptions: [counts.serviceExceptions, expected.serviceExceptions],
    tripFrequencies: [counts.tripFrequencies, expected.frequencies],
    shapes: [counts.shapes, expected.shapes],
    trips: [counts.trips, expected.trips],
    stopTimes: [counts.stopTimes, expected.stopTimes],
    transfers: [counts.transfers, expected.transfers],
    transitSegments: [counts.transitSegments, expected.logicalTransitSegments],
    tripSegmentTraversals: [
      counts.tripSegmentTraversals,
      expected.tripSegmentTraversals,
    ],
    mobilityEntities: [counts.mobilityEntities, expected.mobilityEntities],
    invalidGeometries: [counts.invalidGeometries, 0],
  };
  const mismatches = Object.entries(comparisons).filter(
    ([, [actual, wanted]]) => actual !== wanted,
  );
  if (mismatches.length > 0) {
    throw new Error(
      `Post-ingest count mismatch: ${mismatches
        .map(([name, values]) => `${name}=${values[0]} expected ${values[1]}`)
        .join(', ')}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'VERIFIED',
        checksum: manifest.snapshot.sha256,
        validation: parsed.report.status,
        idempotency: idempotency.status,
        counts,
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const registry = await loadRegistry();
  if (command === 'fetch') {
    await fetchSnapshot(registry);
    return;
  }
  const manifest = await loadManifest(registry);
  if (command === 'validate') {
    await validateSnapshot(registry, manifest);
    return;
  }
  if (command === 'ingest') {
    await ingestSnapshot(registry, manifest);
    return;
  }
  await verifySnapshot(registry, manifest);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown GTFS command failure';
  process.stderr.write(`TransJakarta GTFS command failed: ${message}\n`);
  process.exitCode = 1;
});
