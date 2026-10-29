import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type {
  DataSourceRepository,
  PageRequest,
  RepositoryPage,
} from '../application/data-source.repository.js';
import type {
  DataSourceSummary,
  DatasetVersionSummary,
} from '../domain/data-provenance.js';

type DataSourceRow = Readonly<{
  sourceId: string;
  sourceKey: string;
  name: string;
  provider: string;
  sourceType: string;
  canonicalUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  accessMethod: string | null;
  accessNotes: string | null;
  coverageNotes: string | null;
  redistributionRule: string | null;
  verificationStatus: DataSourceSummary['verificationStatus'];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}>;

type DatasetVersionRow = Readonly<{
  datasetVersionId: string;
  sourceId: string;
  versionLabel: string;
  checksumSha256: string;
  retrievedAt: Date;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  rawPathRef: string;
  manifestPath: string;
  validationStatus: DatasetVersionSummary['validationStatus'];
}>;

@Injectable()
export class KyselyDataSourceRepository implements DataSourceRepository {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async listSources(
    page: PageRequest,
  ): Promise<RepositoryPage<DataSourceSummary>> {
    const after = page.after;
    const cursorPredicate =
      after === null
        ? sql``
        : sql`where (source_key, id) > (${after.sortValue}, ${after.id}::uuid)`;
    const result = await sql<DataSourceRow>`
      select
        id as "sourceId",
        source_key as "sourceKey",
        name,
        provider,
        source_type as "sourceType",
        canonical_url as "canonicalUrl",
        license_name as "licenseName",
        license_url as "licenseUrl",
        access_method as "accessMethod",
        access_notes as "accessNotes",
        coverage_notes as "coverageNotes",
        redistribution_rule as "redistributionRule",
        verification_status as "verificationStatus",
        active,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from meta.dataset_source
      ${cursorPredicate}
      order by source_key, id
      limit ${page.limit + 1}
    `.execute(this.database);

    const items = result.rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items,
      next:
        result.rows.length > page.limit && last !== undefined
          ? { sortValue: last.sourceKey, id: last.sourceId }
          : null,
    };
  }

  async sourceExists(sourceId: string): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      select exists(
        select 1 from meta.dataset_source where id = ${sourceId}::uuid
      ) as exists
    `.execute(this.database);

    return result.rows[0]?.exists === true;
  }

  async listVersions(
    sourceId: string,
    page: PageRequest,
  ): Promise<RepositoryPage<DatasetVersionSummary>> {
    const after = page.after;
    const cursorPredicate =
      after === null
        ? sql``
        : sql`and (retrieved_at, id) < (${after.sortValue}::timestamptz, ${after.id}::uuid)`;
    const result = await sql<DatasetVersionRow>`
      select
        id as "datasetVersionId",
        source_id as "sourceId",
        version_label as "versionLabel",
        checksum_sha256 as "checksumSha256",
        retrieved_at as "retrievedAt",
        effective_from as "effectiveFrom",
        effective_to as "effectiveTo",
        raw_path_ref as "rawPathRef",
        manifest_path as "manifestPath",
        validation_status as "validationStatus"
      from meta.dataset_version
      where source_id = ${sourceId}::uuid
      ${cursorPredicate}
      order by retrieved_at desc, id desc
      limit ${page.limit + 1}
    `.execute(this.database);

    const items = result.rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items,
      next:
        result.rows.length > page.limit && last !== undefined
          ? {
              sortValue: last.retrievedAt.toISOString(),
              id: last.datasetVersionId,
            }
          : null,
    };
  }
}
