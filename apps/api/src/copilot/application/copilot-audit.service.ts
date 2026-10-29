import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type { CopilotAnswer } from './copilot.service.js';

export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** FR-010. Transaction includes session/message/tool audit; failed persistence never returns success. */
@Injectable()
export class CopilotAuditService {
  constructor(
    @Inject(DATABASE) private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async record(
    input: {
      ownerRef: string;
      sessionId?: unknown;
      message: string;
      refs: readonly string[];
    },
    execute: () => Promise<CopilotAnswer>,
  ): Promise<CopilotAnswer & { sessionId: string }> {
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/.test(input.ownerRef) ||
      (input.sessionId !== undefined &&
        (typeof input.sessionId !== 'string' || !UUID.test(input.sessionId)))
    )
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Valid owner and optional session_id UUID required.',
          request_id: randomUUID(),
        },
      });
    return this.database.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`copilot:${input.ownerRef}`}))`.execute(
        tx,
      );
      if (input.sessionId !== undefined) {
        const session =
          await sql`select id from copilot.session where id=${input.sessionId}::uuid and owner_ref=${input.ownerRef} and expires_at > clock_timestamp()`.execute(
            tx,
          );
        if (!session.rows.length) throw this.notFound();
      }
      // Modest durable rolling quota: 20 requests/minute/owner, serialized across API processes.
      const quota = await sql<{
        count: number;
      }>`select count(*)::int as count from copilot.message where owner_ref=${input.ownerRef} and created_at > clock_timestamp() - interval '1 minute'`.execute(
        tx,
      );
      if (quota.rows[0]!.count >= 20)
        throw new HttpException(
          {
            error: {
              code: 'RATE_LIMITED',
              message:
                'Copilot limit: 20 messages per minute. Retry after 60 seconds.',
              request_id: randomUUID(),
            },
          },
          429,
        );
      const sessionId = (input.sessionId as string | undefined) ?? randomUUID();
      if (input.sessionId === undefined)
        await sql`insert into copilot.session (id, owner_ref) values (${sessionId}::uuid, ${input.ownerRef})`.execute(
          tx,
        );
      const result = await execute();
      const requestDigest = digest({
        message: input.message,
        context_references: input.refs,
      });
      await sql`insert into copilot.message (id, session_id, owner_ref, request_digest, context_references, answer_text, evidence_type, fallback_status, response_json) values (${result.messageId}::uuid, ${sessionId}::uuid, ${input.ownerRef}, ${requestDigest}, ${JSON.stringify(input.refs)}::jsonb, ${result.answer}, ${result.evidenceType}, ${result.fallbackStatus}, ${JSON.stringify(result)}::jsonb)`.execute(
        tx,
      );
      for (const audit of result.toolAudit)
        await sql`insert into copilot.tool_audit (id, message_id, session_id, owner_ref, tool_name, request_digest, result_ref, response_digest, status, latency_ms) values (${randomUUID()}::uuid, ${result.messageId}::uuid, ${sessionId}::uuid, ${input.ownerRef}, ${audit.tool}, ${digest({ tool: audit.tool, refs: input.refs })}, ${audit.resultRef}, ${digest({ answer: result.answer, evidence: result.evidenceReferences })}, ${audit.status}, ${audit.latencyMs})`.execute(
          tx,
        );
      await sql`update copilot.session set last_message_at=clock_timestamp() where id=${sessionId}::uuid and owner_ref=${input.ownerRef}`.execute(
        tx,
      );
      return { ...result, sessionId };
    });
  }

  async get(
    id: string,
    ownerRef: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (
      !UUID.test(id) ||
      !ownerRef ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(ownerRef)
    )
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Valid session UUID and owner required.',
          request_id: randomUUID(),
        },
      });
    const session = await sql<{
      created_at: Date;
      expires_at: Date;
    }>`select created_at, expires_at from copilot.session where id=${id}::uuid and owner_ref=${ownerRef} and expires_at > clock_timestamp()`.execute(
      this.database,
    );
    if (!session.rows[0]) throw this.notFound();
    const messages = await sql<{
      id: string;
      created_at: Date;
      request_digest: string;
      response: CopilotAnswer;
    }>`select id, created_at, request_digest, response_json as response from copilot.message where session_id=${id}::uuid and owner_ref=${ownerRef} order by created_at desc, id desc limit 100`.execute(
      this.database,
    );
    return {
      session_id: id,
      created_at: session.rows[0].created_at.toISOString(),
      expires_at: session.rows[0].expires_at.toISOString(),
      messages: messages.rows.reverse().map((row) => ({
        message_id: row.id,
        created_at: row.created_at.toISOString(),
        request_digest: row.request_digest,
        answer: row.response.answer,
        evidence_type: row.response.evidenceType,
        evidence_references: row.response.evidenceReferences,
        tool_result_references: row.response.toolResultReferences,
        fallback_status: row.response.fallbackStatus,
        tool_audit: row.response.toolAudit,
      })),
      history_limit: 100,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      error: {
        code: 'NOT_FOUND',
        message: 'Copilot session not found.',
        request_id: randomUUID(),
      },
    });
  }
}
