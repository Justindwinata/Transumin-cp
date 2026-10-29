import { randomUUID } from 'node:crypto';

import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
// FR-007/014: operator analyses require server-resolved RESEARCHER_OPERATOR role; caller claims never authorize.
import {
  AuthGuard,
  Roles,
  RolesGuard,
  type AuthRequest,
} from '../../auth/auth.guard.js';
import { OperatorRecoveryError } from '../domain/operator-recovery.js';
import {
  OperatorRecoveryService,
  parseOperatorRequest,
  validUuid,
} from '../application/operator-recovery.service.js';

/** FR-007/014: owner-scoped analyses, authenticated server-side roles only. */
@Controller('operator-recovery/analyses')
@UseGuards(AuthGuard, RolesGuard)
@Roles('RESEARCHER_OPERATOR', 'ADMIN')
export class OperatorRecoveryController {
  constructor(
    @Inject(OperatorRecoveryService)
    private readonly analyses: OperatorRecoveryService,
  ) {}

  @Post()
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ) {
    const requestId = randomUUID();
    const owner = request.principal!.userId;
    try {
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      )
        throw new UnprocessableEntityException(
          errorBody(
            'VALIDATION_ERROR',
            'A valid Idempotency-Key header is required.',
            requestId,
          ),
        );
      const parsed = parseInput(body, requestId);
      return envelope(
        await this.analyses.create(owner, idempotencyKey, parsed),
        requestId,
      );
    } catch (error) {
      throw mapError(error, requestId);
    }
  }

  @Get(':analysisId')
  async get(
    @Param('analysisId') analysisId: string,
    @Req() request: AuthRequest,
  ) {
    const requestId = randomUUID();
    try {
      if (!validUuid(analysisId))
        throw new UnprocessableEntityException(
          errorBody(
            'VALIDATION_ERROR',
            'analysisId must be a UUID.',
            requestId,
          ),
        );
      return envelope(
        await this.analyses.get(
          request.principal!.userId,
          analysisId.toLowerCase(),
        ),
        requestId,
      );
    } catch (error) {
      throw mapError(error, requestId);
    }
  }
}

function parseInput(body: unknown, requestId: string) {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw new UnprocessableEntityException(
      errorBody(
        'VALIDATION_ERROR',
        'Request body must be a JSON object.',
        requestId,
      ),
    );
  try {
    return parseOperatorRequest(body);
  } catch (error) {
    throw new UnprocessableEntityException(
      errorBody('VALIDATION_ERROR', (error as Error).message, requestId),
    );
  }
}

function mapError(error: unknown, requestId: string): Error {
  if (!(error instanceof OperatorRecoveryError)) return error as Error;
  if (error.code === 'NOT_FOUND')
    return new NotFoundException(
      errorBody('NOT_FOUND', error.message, requestId),
    );
  return new ConflictException(errorBody('CONFLICT', error.message, requestId));
}

function errorBody(code: string, message: string, requestId: string) {
  return { error: { code, message, request_id: requestId } };
}

function envelope(data: unknown, requestId: string) {
  return { data, meta: { request_id: requestId, warnings: [] } };
}
