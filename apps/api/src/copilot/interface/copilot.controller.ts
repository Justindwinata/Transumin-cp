import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CopilotAuditService } from '../application/copilot-audit.service.js';
import { CopilotService } from '../application/copilot.service.js';
import { PassengerServiceGuard } from '../../journey/interface/passenger-service.guard.js';

export type CopilotMessageBody = {
  message?: unknown;
  context_references?: unknown;
  session_id?: unknown;
};

// FR-010/014: passenger service callers cannot select authenticated research owners.
function passengerOwner(owner: string | undefined): string | undefined {
  if (owner?.toLowerCase().startsWith('user:'))
    throw new BadRequestException(
      'Authenticated copilot owners require research endpoints.',
    );
  return owner;
}

@Controller('copilot')
@UseGuards(PassengerServiceGuard)
export class CopilotController {
  constructor(
    @Inject(CopilotService) private readonly copilot: CopilotService,
    @Inject(CopilotAuditService) private readonly audit: CopilotAuditService,
  ) {}

  @Post('messages')
  @HttpCode(200)
  create(
    @Body() body: CopilotMessageBody,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ): Promise<Record<string, unknown>> {
    return recordMessage(
      this.copilot,
      this.audit,
      body,
      passengerOwner(ownerRef),
    );
  }

  @Get('sessions/:id')
  async getSession(
    @Param('id') id: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ): Promise<Record<string, unknown>> {
    return {
      data: await this.audit.get(id, passengerOwner(ownerRef)),
      meta: { request_id: randomUUID(), warnings: [], provenance: null },
    };
  }
}

// Shared persistence/response contract; authority passed only by guarded controllers.
export async function recordMessage(
  copilot: CopilotService,
  audit: CopilotAuditService,
  body: CopilotMessageBody,
  ownerRef: string | undefined,
  researchAuthorized = false,
): Promise<Record<string, unknown>> {
  const requestId = randomUUID();
  if (
    body === null ||
    typeof body !== 'object' ||
    typeof body.message !== 'string' ||
    !body.message.trim() ||
    body.message.length > 4000 ||
    !Array.isArray(body.context_references) ||
    body.context_references.length !== 1 ||
    body.context_references.some((ref: unknown) => typeof ref !== 'string')
  )
    throw new BadRequestException({
      error: {
        code: 'VALIDATION_ERROR',
        message:
          'message must be 1-4000 chars and exactly one typed context reference is required.',
        request_id: requestId,
      },
    });
  const message = body.message;
  const refs = body.context_references as string[];
  const result = await audit.record(
    { ownerRef: ownerRef ?? '', sessionId: body.session_id, message, refs },
    () =>
      copilot.ask({
        message,
        contextReferences: refs,
        ownerRef,
        researchAuthorized,
      }),
  );
  return {
    data: {
      message_id: result.messageId,
      session_id: result.sessionId,
      answer: result.answer,
      evidence_references: [...result.evidenceReferences],
      tool_result_references: [...result.toolResultReferences],
      evidence_type: result.evidenceType,
      fallback_status: result.fallbackStatus,
    },
    meta: {
      request_id: requestId,
      warnings: [...result.meta.warnings],
      provenance: {
        evidence_type: result.evidenceType,
        reference_ids: [...result.evidenceReferences],
        observed_at: result.meta.observedAt,
        limitations: [...result.meta.warnings],
      },
      tool_audit: result.toolAudit,
    },
  };
}
