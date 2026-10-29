import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import {
  PassengerReportRateLimitException,
  PassengerReportService,
} from './passenger-report.service.js';
import { ControlledReviewGuard } from './controlled-review.guard.js';
import { PassengerServiceGuard } from '../journey/interface/passenger-service.guard.js';

@Controller()
export class PassengerReportController {
  constructor(
    @Inject(PassengerReportService)
    private readonly reports: PassengerReportService,
  ) {}

  @Post('passenger-reports')
  @UseGuards(PassengerServiceGuard)
  async submit(
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body()
    body: {
      active_journey_id?: unknown;
      category?: unknown;
      observed_at?: unknown;
      mobility_entity_id?: unknown;
      entity_type?: unknown;
      description?: unknown;
    },
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    if (typeof ownerRef !== 'string' || typeof key !== 'string')
      throw new BadRequestException('Owner and Idempotency-Key are required.');
    const text = (
      value: unknown,
      field: string,
      optional = false,
    ): string | null => {
      if (optional && (value === undefined || value === null)) return null;
      if (typeof value !== 'string')
        throw new BadRequestException(`${field} must be a string.`);
      return value;
    };
    try {
      return envelope(
        await this.reports.submit({
          ownerRef,
          key,
          journeyId: text(body.active_journey_id, 'active_journey_id', true),
          category: text(body.category, 'category')!,
          observedAt: text(body.observed_at, 'observed_at')!,
          entityId: text(body.mobility_entity_id, 'mobility_entity_id')!,
          entityType: text(body.entity_type, 'entity_type')!,
          description: text(body.description, 'description')!,
        }),
      );
    } catch (error) {
      if (error instanceof PassengerReportRateLimitException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          {
            error: {
              code: 'RATE_LIMITED',
              message: error.message,
              request_id: randomUUID(),
              details: { retry_after_seconds: error.retryAfterSeconds },
            },
          },
          429,
        );
      }
      throw error;
    }
  }

  @Get('passenger-reports')
  @UseGuards(PassengerServiceGuard)
  async list(
    @Query('active_journey_id') journeyId: string | undefined,
    @Query('idempotency_key') key: string | undefined,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ) {
    if (typeof ownerRef !== 'string')
      throw new BadRequestException('Owner is required.');
    if ((typeof key === 'string') === (typeof journeyId === 'string'))
      throw new BadRequestException(
        'Supply exactly one of active_journey_id or idempotency_key.',
      );
    if (typeof key === 'string')
      return envelope(await this.reports.lookupByIdempotencyKey(ownerRef, key));
    if (typeof journeyId !== 'string')
      throw new BadRequestException('active_journey_id is required.');
    return envelope(await this.reports.list(ownerRef, journeyId));
  }

  @Get('passenger-reports/:id')
  @UseGuards(PassengerServiceGuard)
  async get(
    @Param('id') id: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ) {
    if (typeof ownerRef !== 'string')
      throw new BadRequestException('Owner is required.');
    return envelope(await this.reports.get(id, ownerRef));
  }

  @Post('controlled/passenger-reports/:id/verify')
  @UseGuards(ControlledReviewGuard)
  async verify(
    @Param('id') id: string,
    @Headers('x-controlled-reviewer') reviewer: string | undefined,
    @Body()
    body: {
      operational_state?: unknown;
      reason?: unknown;
      incident_type?: unknown;
    },
  ) {
    if (
      typeof reviewer !== 'string' ||
      typeof body.operational_state !== 'string' ||
      typeof body.reason !== 'string' ||
      typeof body.incident_type !== 'string'
    )
      throw new BadRequestException(
        'Reviewer, operational_state, incident_type and reason are required.',
      );
    return envelope(
      await this.reports.verify({
        reportId: id,
        reviewer,
        state: body.operational_state,
        reason: body.reason,
        incidentType: body.incident_type,
      }),
    );
  }

  @Post('controlled/passenger-reports/:id/close')
  @UseGuards(ControlledReviewGuard)
  async close(
    @Param('id') id: string,
    @Headers('x-controlled-reviewer') reviewer: string | undefined,
    @Body() body: { decision?: unknown; reason?: unknown },
  ) {
    if (
      typeof reviewer !== 'string' ||
      typeof body.decision !== 'string' ||
      typeof body.reason !== 'string'
    )
      throw new BadRequestException(
        'Reviewer, decision and reason are required.',
      );
    return envelope(
      await this.reports.close({
        reportId: id,
        reviewer,
        decision: body.decision,
        reason: body.reason,
      }),
    );
  }
}

function envelope(data: unknown) {
  return { data, meta: { request_id: randomUUID(), warnings: [] } };
}
