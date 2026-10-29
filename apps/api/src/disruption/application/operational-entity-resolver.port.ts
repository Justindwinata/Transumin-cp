export const OPERATIONAL_ENTITY_RESOLVER = Symbol(
  'OPERATIONAL_ENTITY_RESOLVER',
);

export type OperationalEntityResolution = Readonly<{
  status: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED';
  entityId: string | null;
}>;

export interface OperationalEntityResolverPort {
  resolve(reference: string): Promise<OperationalEntityResolution>;
}
