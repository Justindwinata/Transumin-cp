import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type {
  OperationalEntityResolution,
  OperationalEntityResolverPort,
} from '../application/operational-entity-resolver.port.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class KyselyOperationalEntityResolver implements OperationalEntityResolverPort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async resolve(reference: string): Promise<OperationalEntityResolution> {
    if (reference.startsWith('CANONICAL:')) {
      const id = reference.slice('CANONICAL:'.length);
      if (!UUID.test(id)) return { status: 'UNRESOLVED', entityId: null };
      const entity = await sql<{ id: string }>`
        select id from twin.mobility_entity where id=${id}::uuid
      `.execute(this.database);
      return entity.rows[0]
        ? { status: 'RESOLVED', entityId: id }
        : { status: 'UNRESOLVED', entityId: null };
    }
    const parts = reference.split('|');
    if (parts.length !== 4) return { status: 'UNRESOLVED', entityId: null };
    const [sourceKey, operatorKey, referenceType, externalReference] = parts;
    const result = await sql<{ id: string }>`
      select distinct canonical_entity_id as id
      from meta.source_entity_reference
      where source_key=${sourceKey} and operator_key=${operatorKey}
        and reference_type=${referenceType} and external_reference=${externalReference}
        and (valid_from is null or valid_from <= now())
        and (valid_to is null or valid_to > now())
      order by canonical_entity_id
    `.execute(this.database);
    if (result.rows.length === 1)
      return { status: 'RESOLVED', entityId: result.rows[0]!.id };
    return {
      status: result.rows.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED',
      entityId: null,
    };
  }
}
