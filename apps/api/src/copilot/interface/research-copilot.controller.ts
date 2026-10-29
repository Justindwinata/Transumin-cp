import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  Roles,
  RolesGuard,
  type AuthRequest,
} from '../../auth/auth.guard.js';
import { CopilotAuditService } from '../application/copilot-audit.service.js';
import { CopilotService } from '../application/copilot.service.js';
import {
  recordMessage,
  type CopilotMessageBody,
} from './copilot.controller.js';

// FR-010/014: body/header owner claims ignored. AuthGuard resolves current principal.
@Controller('copilot/research')
@UseGuards(AuthGuard, RolesGuard)
@Roles('RESEARCHER_OPERATOR', 'ADMIN')
export class ResearchCopilotController {
  constructor(
    @Inject(CopilotService) private readonly copilot: CopilotService,
    @Inject(CopilotAuditService) private readonly audit: CopilotAuditService,
  ) {}

  @Post('messages')
  @HttpCode(200)
  create(
    @Body() body: CopilotMessageBody,
    @Req() request: AuthRequest,
  ): Promise<Record<string, unknown>> {
    return recordMessage(
      this.copilot,
      this.audit,
      body,
      `user:${request.principal!.userId}`,
      true,
    );
  }

  @Get('sessions/:id')
  async getSession(
    @Param('id') id: string,
    @Req() request: AuthRequest,
  ): Promise<Record<string, unknown>> {
    return {
      data: await this.audit.get(id, `user:${request.principal!.userId}`),
      meta: { request_id: randomUUID(), warnings: [], provenance: null },
    };
  }
}
