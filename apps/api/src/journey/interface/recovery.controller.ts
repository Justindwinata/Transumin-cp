import { randomUUID } from 'node:crypto';

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';

import { JourneyRoutingError } from '../domain/journey.js';
import { RecoveryService } from '../application/recovery.service.js';
import type {
  RecoveryAcceptance,
  RecoveryProposal,
} from '../domain/recovery.js';
import { RecoveryError } from '../domain/recovery.js';
import { mapAlternative } from './journey.controller.js';
import { PassengerServiceGuard } from './passenger-service.guard.js';

@Controller('recoveries')
@UseGuards(PassengerServiceGuard)
export class RecoveryController {
  constructor(
    @Inject(RecoveryService)
    private readonly recoveries: RecoveryService,
  ) {}

  @Post()
  async create(
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: {
      original_journey_id?: string;
      impact_id?: string;
      recovery_at?: string;
    },
  ) {
    const requestId = randomUUID();
    try {
      if (!ownerRef)
        throw new ForbiddenException(
          errorBody('FORBIDDEN', 'x-journey-owner is required.', requestId),
        );
      if (!idempotencyKey || idempotencyKey.length < 8)
        throw new ConflictException(
          errorBody(
            'CONFLICT',
            'A valid Idempotency-Key is required.',
            requestId,
          ),
        );
      if (!body.original_journey_id || !body.impact_id || !body.recovery_at)
        throw new UnprocessableEntityException(
          errorBody(
            'VALIDATION_ERROR',
            'original_journey_id, impact_id, and recovery_at are required.',
            requestId,
          ),
        );
      return envelope(
        mapRecovery(
          await this.recoveries.create({
            activeJourneyId: body.original_journey_id,
            impactId: body.impact_id,
            ownerRef,
            idempotencyKey,
            recoveryAt: body.recovery_at,
          }),
        ),
        requestId,
      );
    } catch (error) {
      throw mapError(error, requestId);
    }
  }

  @Get(':recoveryId')
  async get(
    @Param('recoveryId') recoveryId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ) {
    const requestId = randomUUID();
    try {
      if (!ownerRef)
        throw new ForbiddenException(
          errorBody('FORBIDDEN', 'x-journey-owner is required.', requestId),
        );
      const acceptance = await this.recoveries.findAcceptance(
        recoveryId,
        ownerRef,
      );
      return envelope(
        {
          ...mapRecovery(await this.recoveries.get(recoveryId, ownerRef)),
          accepted: acceptance !== null,
          accepted_at: acceptance?.acceptedAt ?? null,
          accepted_journey_fingerprint:
            acceptance?.acceptedJourneyFingerprint ?? null,
        },
        requestId,
      );
    } catch (error) {
      throw mapError(error, requestId);
    }
  }

  @Post(':recoveryId/accept')
  async accept(
    @Param('recoveryId') recoveryId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { progress_revision?: number; accepted_at?: string },
  ) {
    const requestId = randomUUID();
    try {
      if (!ownerRef)
        throw new ForbiddenException(
          errorBody('FORBIDDEN', 'x-journey-owner is required.', requestId),
        );
      if (!idempotencyKey || idempotencyKey.length < 8)
        throw new ConflictException(
          errorBody(
            'CONFLICT',
            'A valid Idempotency-Key is required.',
            requestId,
          ),
        );
      if (
        !Number.isInteger(body.progress_revision) ||
        (body.accepted_at !== undefined &&
          Number.isNaN(Date.parse(body.accepted_at)))
      )
        throw new UnprocessableEntityException(
          errorBody(
            'VALIDATION_ERROR',
            'progress_revision must be the integer journey revision the proposal was computed for.',
            requestId,
          ),
        );
      return envelope(
        mapAcceptance(
          await this.recoveries.accept({
            recoveryId,
            ownerRef,
            idempotencyKey,
            progressRevision: body.progress_revision as number,
            acceptedAt: body.accepted_at ?? new Date().toISOString(),
          }),
        ),
        requestId,
      );
    } catch (error) {
      throw mapError(error, requestId);
    }
  }
}

function mapRecovery(value: RecoveryProposal) {
  return {
    recovery_id: value.recoveryId,
    original_journey_id: value.activeJourneyId,
    impact_id: value.impactId,
    method: value.method,
    status: value.status,
    progress_revision: value.progressRevision,
    completed_segment_count: value.completedLegCount,
    recovery_anchor: {
      name: value.recoveryAnchor.name,
      ...value.recoveryAnchor.point,
    },
    recovery_at: value.recoveryAt,
    network_snapshot_id: value.networkSnapshotId,
    mobility_projection_version: value.mobilityProjectionVersion,
    original_journey_fingerprint: value.originalJourneyFingerprint,
    proposed_fingerprint: value.proposedFingerprint,
    baseline_fingerprint: value.baselineFingerprint,
    triggering_entity_id: value.triggeringEntityId,
    state_transition_id: value.stateTransitionId,
    reason: value.reason,
    preserved_segment_count: value.metrics.preservedLegCount,
    changed_segment_count: value.metrics.changedLegCount,
    additional_duration_seconds: value.metrics.addedTravelTimeSeconds,
    additional_transfers: value.metrics.addedTransfers,
    metrics: {
      recovery_success: value.metrics.recoverySuccess,
      preserved_leg_ratio: value.metrics.preservedLegRatio,
      eligible_remaining_leg_count: value.metrics.eligibleRemainingLegCount,
      plan_change_count: value.metrics.planChangeCount,
      disrupted_entity_avoidance: value.metrics.disruptedEntityAvoidance,
      state_validation_ms: value.metrics.stateValidationMilliseconds,
      preservation_processing_ms:
        value.metrics.preservationProcessingMilliseconds,
      proposed_routing_ms: value.metrics.proposedRoutingMilliseconds,
      baseline_routing_ms: value.metrics.baselineRoutingMilliseconds,
      total_computation_ms: value.metrics.totalComputationMilliseconds,
      state_aware: mapMethodMetrics(value.metrics.stateAware),
      full_replan: mapMethodMetrics(value.metrics.fullReplan),
    },
    completed_segments: value.completedLegs.map((leg) => leg.sequence),
    preserved_segments: value.preservedLegs.map((leg) => leg.sequence),
    invalidated_segments: value.invalidatedLegs.map((leg) => leg.sequence),
    repaired_segments: value.repairedLegs.map((leg) => leg.sequence),
    rejoined_segments: value.rejoinedLegs.map((leg) => leg.sequence),
    rejoin_status: value.rejoinStatus,
    rejoin_reason: value.rejoinReason,
    proposed_journey: value.proposedJourney
      ? mapAlternative(value.proposedJourney)
      : null,
    baseline_journey: value.baselineJourney
      ? mapAlternative(value.baselineJourney)
      : null,
  };
}

function mapMethodMetrics(value: RecoveryProposal['metrics']['stateAware']) {
  return {
    recovery_success: value.recoverySuccess,
    preserved_leg_ratio: value.preservedLegRatio,
    additional_duration_seconds: value.addedTravelTimeSeconds,
    additional_transfers: value.addedTransfers,
    plan_change_count: value.planChangeCount,
    disrupted_entity_avoidance: value.disruptedEntityAvoidance,
    timing: {
      total_ms: value.timing.totalMs,
      routing_ms: value.timing.routingMs,
      validation_ms: value.timing.validationMs,
      ...(value.timing.mergeMs === undefined
        ? {}
        : { merge_ms: value.timing.mergeMs }),
    },
  };
}

function mapAcceptance(value: RecoveryAcceptance) {
  return {
    recovery_id: value.recoveryId,
    original_journey_id: value.activeJourneyId,
    accepted_progress_revision: value.acceptedProgressRevision,
    accepted_impact_id: value.acceptedImpactId,
    accepted_state_transition_id: value.acceptedStateTransitionId,
    accepted_mobility_projection_version:
      value.acceptedMobilityProjectionVersion,
    accepted_journey_fingerprint: value.acceptedJourneyFingerprint,
    current_replacement_journey: mapAlternative(value.acceptedJourney),
    accepted_at: value.acceptedAt,
    original_plan_preserved: true,
    current_pointer_advanced: true,
  };
}

function mapError(error: unknown, requestId: string): Error {
  if (error instanceof JourneyRoutingError) {
    const body = errorBody(error.code, error.message, requestId);
    return error.code === 'ROUTER_UNAVAILABLE'
      ? new ServiceUnavailableException(body)
      : new UnprocessableEntityException(body);
  }
  if (!(error instanceof RecoveryError)) return error as Error;
  if (error.code === 'RECOVERY_NOT_FOUND')
    return new NotFoundException(
      errorBody('NOT_FOUND', error.message, requestId),
    );
  if (error.code === 'RECOVERY_STALE')
    return new ConflictException(
      errorBody('CONFLICT', error.message, requestId, {
        recovery_code: error.code,
      }),
    );
  if (error.code === 'IDEMPOTENCY_CONFLICT')
    return new ConflictException(
      errorBody('CONFLICT', error.message, requestId),
    );
  return new UnprocessableEntityException(
    errorBody(
      error.code === 'INVALID_RECOVERY_ANCHOR'
        ? 'VALIDATION_ERROR'
        : 'NO_RECOVERY_PATH',
      error.message,
      requestId,
      { recovery_code: error.code },
    ),
  );
}

function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
) {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      request_id: requestId,
    },
  };
}

function envelope(data: unknown, requestId: string) {
  return { data, meta: { request_id: requestId, warnings: [] } };
}
