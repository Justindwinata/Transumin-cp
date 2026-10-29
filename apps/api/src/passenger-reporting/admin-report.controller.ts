import {
  BadRequestException,
  ServiceUnavailableException,
  Body,
  Controller,
  Get,
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
} from '../auth/auth.guard.js';
import { PassengerReportService } from './passenger-report.service.js';

@Controller('admin/passenger-reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminReportController {
  constructor(
    @Inject(PassengerReportService)
    private readonly reports: PassengerReportService,
  ) {}

  private assertReviewRuntime() {
    if (process.env.ADMIN_FIELD_REVIEW_ENABLED !== 'true')
      throw new ServiceUnavailableException('ADMIN_REVIEW_NOT_CONFIGURED');
  }

  @Get()
  async list() {
    this.assertReviewRuntime();
    return { data: await this.reports.reviewQueue(), meta: { limit: 100 } };
  }

  @Post(':id/restrict')
  async restrict(
    @Param('id') id: string,
    @Req() request: AuthRequest,
    @Body()
    body: {
      operational_state?: unknown;
      reason?: unknown;
      incident_type?: unknown;
      evidence_reference?: unknown;
      observed_at?: unknown;
      valid_for_minutes?: unknown;
    },
  ) {
    this.assertReviewRuntime();
    if (
      !body ||
      typeof body.operational_state !== 'string' ||
      typeof body.reason !== 'string' ||
      typeof body.incident_type !== 'string' ||
      typeof body.evidence_reference !== 'string' ||
      typeof body.observed_at !== 'string' ||
      typeof body.valid_for_minutes !== 'number' ||
      !request.principal
    )
      throw new BadRequestException(
        'Documented field evidence and restriction fields are required.',
      );
    return {
      data: await this.reports.restrictAdmin(
        {
          reportId: id,
          reviewer: `admin:${request.principal.userId}`,
          state: body.operational_state,
          reason: body.reason,
          incidentType: body.incident_type,
        },
        {
          actorUserId: request.principal.userId,
          evidenceReference: body.evidence_reference,
          observedAt: body.observed_at,
          validForMinutes: body.valid_for_minutes,
        },
      ),
      meta: {},
    };
  }

  @Post(':id/close')
  async close(
    @Param('id') id: string,
    @Req() request: AuthRequest,
    @Body() body: { decision?: unknown; reason?: unknown },
  ) {
    this.assertReviewRuntime();
    if (
      !body ||
      typeof body.decision !== 'string' ||
      typeof body.reason !== 'string' ||
      !request.principal
    )
      throw new BadRequestException('Decision and public reason are required.');
    return {
      data: await this.reports.closeAdmin({
        reportId: id,
        reviewer: `admin:${request.principal.userId}`,
        decision: body.decision,
        reason: body.reason,
      }),
      meta: {},
    };
  }
}
