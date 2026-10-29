import type {
  DataSourceSummary,
  DatasetVersionSummary,
} from '../domain/data-provenance.js';

export const DATA_SOURCE_REPOSITORY = Symbol('DATA_SOURCE_REPOSITORY');

export type PagePosition = Readonly<{
  sortValue: string;
  id: string;
}>;

export type PageRequest = Readonly<{
  limit: number;
  after: PagePosition | null;
}>;

export type RepositoryPage<T> = Readonly<{
  items: readonly T[];
  next: PagePosition | null;
}>;

export interface DataSourceRepository {
  listSources(page: PageRequest): Promise<RepositoryPage<DataSourceSummary>>;
  sourceExists(sourceId: string): Promise<boolean>;
  listVersions(
    sourceId: string,
    page: PageRequest,
  ): Promise<RepositoryPage<DatasetVersionSummary>>;
}
