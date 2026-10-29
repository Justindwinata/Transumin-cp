import type {
  EntityAliasRecord,
  EntityReferenceRecord,
  EntityResolutionResult,
} from '../domain/spatial.types.js';
import { normalizeAlias } from '../domain/spatial-identity.js';

export class EntityReferenceResolver {
  constructor(
    private readonly references: readonly EntityReferenceRecord[],
    private readonly aliases: readonly EntityAliasRecord[],
  ) {}

  resolve(input: {
    sourceKey: string;
    operatorKey: string;
    value: string;
    referenceType?: EntityReferenceRecord['referenceType'];
  }): EntityResolutionResult {
    const exact = this.references.filter(
      (item) =>
        item.sourceKey === input.sourceKey &&
        item.operatorKey === input.operatorKey &&
        item.externalReference === input.value &&
        (input.referenceType === undefined ||
          item.referenceType === input.referenceType),
    );
    const exactIds = [...new Set(exact.map((item) => item.canonicalEntityId))];
    if (exactIds.length === 1)
      return {
        status: 'RESOLVED',
        canonicalEntityId: exactIds[0] as string,
        method: 'EXACT_REFERENCE',
      };
    if (exactIds.length > 1)
      return { status: 'AMBIGUOUS', candidateEntityIds: exactIds.sort() };
    const normalized = normalizeAlias(input.value);
    const aliasIds = [
      ...new Set(
        this.aliases
          .filter(
            (item) =>
              item.sourceKey === input.sourceKey &&
              item.operatorKey === input.operatorKey &&
              item.normalizedAlias === normalized,
          )
          .map((item) => item.canonicalEntityId),
      ),
    ];
    if (aliasIds.length === 1)
      return {
        status: 'RESOLVED',
        canonicalEntityId: aliasIds[0] as string,
        method: 'EXACT_ALIAS',
      };
    if (aliasIds.length > 1)
      return { status: 'AMBIGUOUS', candidateEntityIds: aliasIds.sort() };
    return { status: 'UNRESOLVED' };
  }
}
