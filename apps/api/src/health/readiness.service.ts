import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../infrastructure/database/database.constants.js';

export type ReadinessResponse = Readonly<{
  status: 'ready';
  service: 'transum-in-nexus-api';
  dependencies: Readonly<{
    database: Readonly<{
      status: 'up';
      postgis: 'available';
      version: string;
    }>;
  }>;
}>;

type ReadinessRow = Readonly<{
  postgisVersion: string | null;
  geometryText: string;
}>;

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async check(): Promise<ReadinessResponse> {
    try {
      const result = await sql<ReadinessRow>`
        select
          (select extversion from pg_extension where extname = 'postgis') as "postgisVersion",
          ST_AsText(ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326)) as "geometryText"
      `.execute(this.database);
      const row = result.rows[0];

      if (row?.postgisVersion === null || row?.geometryText === undefined) {
        throw new Error('PostGIS is not available');
      }

      return {
        status: 'ready',
        service: 'transum-in-nexus-api',
        dependencies: {
          database: {
            status: 'up',
            postgis: 'available',
            version: row.postgisVersion,
          },
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        service: 'transum-in-nexus-api',
        dependencies: {
          database: {
            status: 'down',
          },
        },
      });
    }
  }
}
