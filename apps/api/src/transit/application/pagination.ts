import { InvalidDataSourceQueryError } from '../domain/data-provenance.js';
import type { PagePosition, PageRequest } from './data-source.repository.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CursorPayload = Readonly<{
  version: 1;
  scope: CursorScope;
  sortValue: string;
  id: string;
}>;

export type CursorScope = 'DATA_SOURCES' | 'DATASET_VERSIONS';

export function parsePageRequest(
  limitValue: string | undefined,
  cursorValue: string | undefined,
  scope: CursorScope,
): PageRequest {
  const limit = parseLimit(limitValue);
  const after =
    cursorValue === undefined ? null : decodeCursor(cursorValue, scope);

  return { limit, after };
}

export function encodeCursor(
  position: PagePosition | null,
  scope: CursorScope,
): string | null {
  if (position === null) {
    return null;
  }

  const payload: CursorPayload = {
    version: 1,
    scope,
    sortValue: position.sortValue,
    id: position.id,
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!/^\d+$/.test(value)) {
    throw new InvalidDataSourceQueryError(
      'limit must be an integer between 1 and 100.',
    );
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new InvalidDataSourceQueryError(
      'limit must be an integer between 1 and 100.',
    );
  }

  return limit;
}

function decodeCursor(value: string, scope: CursorScope): PagePosition {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload>;

    if (
      parsed.version !== 1 ||
      parsed.scope !== scope ||
      typeof parsed.sortValue !== 'string' ||
      parsed.sortValue.length === 0 ||
      typeof parsed.id !== 'string' ||
      !isUuid(parsed.id)
    ) {
      throw new Error('Malformed cursor payload');
    }

    if (
      scope === 'DATASET_VERSIONS' &&
      !Number.isFinite(Date.parse(parsed.sortValue))
    ) {
      throw new Error('Malformed dataset-version cursor sort value');
    }

    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    throw new InvalidDataSourceQueryError('cursor is invalid or malformed.');
  }
}
