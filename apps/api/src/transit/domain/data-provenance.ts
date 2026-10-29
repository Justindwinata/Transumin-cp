export type SourceVerificationStatus = 'NOT_VERIFIED' | 'VERIFIED' | 'REJECTED';

export type DatasetValidationStatus =
  'PENDING' | 'VALID' | 'WARNING' | 'INVALID';

export type DataSourceSummary = Readonly<{
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
  verificationStatus: SourceVerificationStatus;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}>;

export type DatasetVersionSummary = Readonly<{
  datasetVersionId: string;
  sourceId: string;
  versionLabel: string;
  checksumSha256: string;
  retrievedAt: Date;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  rawPathRef: string;
  manifestPath: string;
  validationStatus: DatasetValidationStatus;
}>;

export class InvalidDataSourceQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDataSourceQueryError';
  }
}

export class DataSourceNotFoundError extends Error {
  constructor(readonly sourceId: string) {
    super(`Data source ${sourceId} was not found.`);
    this.name = 'DataSourceNotFoundError';
  }
}
