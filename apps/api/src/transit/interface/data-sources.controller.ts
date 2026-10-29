import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';

import {
  ListDataSourcesUseCase,
  ListDatasetVersionsUseCase,
} from '../application/data-source.use-cases.js';
import {
  DataSourceNotFoundError,
  InvalidDataSourceQueryError,
  type DataSourceSummary,
  type DatasetVersionSummary,
} from '../domain/data-provenance.js';

type CollectionEnvelope = Readonly<{
  data: readonly Record<string, unknown>[];
  meta: Readonly<{
    request_id: string;
    warnings: readonly string[];
    next_cursor: string | null;
  }>;
}>;

@Controller('data-sources')
export class DataSourcesController {
  constructor(
    @Inject(ListDataSourcesUseCase)
    private readonly listDataSources: ListDataSourcesUseCase,
    @Inject(ListDatasetVersionsUseCase)
    private readonly listDatasetVersions: ListDatasetVersionsUseCase,
  ) {}

  @Get()
  async listSources(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<CollectionEnvelope> {
    const requestId = randomUUID();

    try {
      const result = await this.listDataSources.execute(limit, cursor);
      return collectionEnvelope(
        result.items.map(mapDataSource),
        result.meta.nextCursor,
        requestId,
      );
    } catch (error) {
      throw mapApplicationError(error, requestId);
    }
  }

  @Get(':sourceId/versions')
  async listVersions(
    @Param('sourceId') sourceId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<CollectionEnvelope> {
    const requestId = randomUUID();

    try {
      const result = await this.listDatasetVersions.execute(
        sourceId,
        limit,
        cursor,
      );
      return collectionEnvelope(
        result.items.map(mapDatasetVersion),
        result.meta.nextCursor,
        requestId,
      );
    } catch (error) {
      throw mapApplicationError(error, requestId);
    }
  }
}

function collectionEnvelope(
  data: readonly Record<string, unknown>[],
  nextCursor: string | null,
  requestId: string,
): CollectionEnvelope {
  return {
    data,
    meta: {
      request_id: requestId,
      warnings: [],
      next_cursor: nextCursor,
    },
  };
}

function mapDataSource(source: DataSourceSummary): Record<string, unknown> {
  return {
    source_id: source.sourceId,
    source_key: source.sourceKey,
    name: source.name,
    provider: source.provider,
    source_type: source.sourceType,
    canonical_url: source.canonicalUrl,
    license_name: source.licenseName,
    license_url: source.licenseUrl,
    access_method: source.accessMethod,
    access_notes: source.accessNotes,
    coverage_notes: source.coverageNotes,
    redistribution_rule: source.redistributionRule,
    verification_status: source.verificationStatus,
    active: source.active,
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString(),
  };
}

function mapDatasetVersion(
  version: DatasetVersionSummary,
): Record<string, unknown> {
  return {
    dataset_version_id: version.datasetVersionId,
    source_id: version.sourceId,
    version_label: version.versionLabel,
    checksum_sha256: version.checksumSha256,
    retrieved_at: version.retrievedAt.toISOString(),
    effective_from: version.effectiveFrom?.toISOString() ?? null,
    effective_to: version.effectiveTo?.toISOString() ?? null,
    raw_path_ref: version.rawPathRef,
    manifest_path: version.manifestPath,
    validation_status: version.validationStatus,
  };
}

function mapApplicationError(error: unknown, requestId: string): Error {
  if (error instanceof InvalidDataSourceQueryError) {
    return new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        request_id: requestId,
      },
    });
  }

  if (error instanceof DataSourceNotFoundError) {
    return new NotFoundException({
      error: {
        code: 'NOT_FOUND',
        message: error.message,
        details: { source_id: error.sourceId },
        request_id: requestId,
      },
    });
  }

  return new InternalServerErrorException({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The data-source request could not be completed.',
      request_id: requestId,
    },
  });
}
