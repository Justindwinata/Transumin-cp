import { Inject, Injectable } from '@nestjs/common';

import {
  DataSourceNotFoundError,
  InvalidDataSourceQueryError,
  type DataSourceSummary,
  type DatasetVersionSummary,
} from '../domain/data-provenance.js';
import {
  DATA_SOURCE_REPOSITORY,
  type DataSourceRepository,
} from './data-source.repository.js';
import { encodeCursor, isUuid, parsePageRequest } from './pagination.js';

export type PageMeta = Readonly<{
  nextCursor: string | null;
}>;

export type ApplicationPage<T> = Readonly<{
  items: readonly T[];
  meta: PageMeta;
}>;

@Injectable()
export class ListDataSourcesUseCase {
  constructor(
    @Inject(DATA_SOURCE_REPOSITORY)
    private readonly repository: DataSourceRepository,
  ) {}

  async execute(
    limit: string | undefined,
    cursor: string | undefined,
  ): Promise<ApplicationPage<DataSourceSummary>> {
    const result = await this.repository.listSources(
      parsePageRequest(limit, cursor, 'DATA_SOURCES'),
    );

    return {
      items: result.items,
      meta: { nextCursor: encodeCursor(result.next, 'DATA_SOURCES') },
    };
  }
}

@Injectable()
export class ListDatasetVersionsUseCase {
  constructor(
    @Inject(DATA_SOURCE_REPOSITORY)
    private readonly repository: DataSourceRepository,
  ) {}

  async execute(
    sourceId: string,
    limit: string | undefined,
    cursor: string | undefined,
  ): Promise<ApplicationPage<DatasetVersionSummary>> {
    if (!isUuid(sourceId)) {
      throw new InvalidDataSourceQueryError('sourceId must be a UUID.');
    }

    const page = parsePageRequest(limit, cursor, 'DATASET_VERSIONS');

    if (!(await this.repository.sourceExists(sourceId))) {
      throw new DataSourceNotFoundError(sourceId);
    }

    const result = await this.repository.listVersions(sourceId, page);

    return {
      items: result.items,
      meta: { nextCursor: encodeCursor(result.next, 'DATASET_VERSIONS') },
    };
  }
}
