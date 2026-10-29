export const DATABASE = Symbol('DATABASE');

export type FoundationDatabase = Record<string, never>;

export const FOUNDATION_SCHEMAS = [
  'meta',
  'transit',
  'spatial',
  'twin',
  'disruption',
  'simulation',
  'journey',
  'research',
  'auth',
  'ai',
] as const;
