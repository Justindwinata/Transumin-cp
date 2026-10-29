import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type { SourceHealthPort } from '../application/source-health.port.js';
import type { SourceHealth } from '../domain/operational-events.js';

type HealthRow = Readonly<{
  sourceId: string;
  status: SourceHealth['status'];
  lastCheckedAt: Date;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  errorSummary: string | null;
}>;

function map(row: HealthRow): SourceHealth {
  return {
    sourceId: row.sourceId,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    consecutiveFailures: row.consecutiveFailures,
    errorSummary: row.errorSummary,
  };
}

@Injectable()
export class KyselySourceHealthRepository implements SourceHealthPort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async recordSuccess(
    sourceId: string,
    checkedAt: Date,
  ): Promise<SourceHealth> {
    const result = await sql<HealthRow>`
      insert into disruption.source_health (
        source_id, status, last_checked_at, last_success_at,
        consecutive_failures, error_summary
      ) values (${sourceId}::uuid, 'HEALTHY', ${checkedAt}, ${checkedAt}, 0, null)
      on conflict (source_id) do update set
        status='HEALTHY', last_checked_at=excluded.last_checked_at,
        last_success_at=excluded.last_success_at, consecutive_failures=0,
        error_summary=null
      returning source_id as "sourceId", status, last_checked_at as "lastCheckedAt",
        last_success_at as "lastSuccessAt", consecutive_failures as "consecutiveFailures",
        error_summary as "errorSummary"
    `.execute(this.database);
    return map(result.rows[0]!);
  }

  async recordFailure(
    sourceId: string,
    checkedAt: Date,
    errorSummary: string,
  ): Promise<SourceHealth> {
    const result = await sql<HealthRow>`
      insert into disruption.source_health (
        source_id, status, last_checked_at, last_success_at,
        consecutive_failures, error_summary
      ) values (${sourceId}::uuid, 'DEGRADED', ${checkedAt}, null, 1, ${errorSummary})
      on conflict (source_id) do update set
        status=case when disruption.source_health.consecutive_failures + 1 >= 3
          then 'UNHEALTHY' else 'DEGRADED' end,
        last_checked_at=excluded.last_checked_at,
        consecutive_failures=disruption.source_health.consecutive_failures + 1,
        error_summary=excluded.error_summary
      returning source_id as "sourceId", status, last_checked_at as "lastCheckedAt",
        last_success_at as "lastSuccessAt", consecutive_failures as "consecutiveFailures",
        error_summary as "errorSummary"
    `.execute(this.database);
    return map(result.rows[0]!);
  }

  async get(sourceId: string): Promise<SourceHealth | null> {
    const result = await sql<HealthRow>`
      select source_id as "sourceId", status, last_checked_at as "lastCheckedAt",
        last_success_at as "lastSuccessAt", consecutive_failures as "consecutiveFailures",
        error_summary as "errorSummary"
      from disruption.source_health where source_id=${sourceId}::uuid
    `.execute(this.database);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
}
