import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';

import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../application/mobility-state.port.js';
import type {
  EffectiveMobilityState,
  NetworkSnapshot,
} from '../domain/mobility-twin.js';

@Controller('network')
export class MobilityStateController {
  constructor(
    @Inject(MOBILITY_STATE_PORT)
    private readonly state: MobilityStatePort,
  ) {}

  @Get('state')
  async getNetworkState(
    @Query('snapshot_id') snapshotId: string,
    @Query('entity_id') entityId?: string,
    @Query('simulation_run_id') simulationRunId?: string,
  ): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    assertUuid(snapshotId, 'snapshot_id', requestId);
    if (entityId !== undefined) assertUuid(entityId, 'entity_id', requestId);
    if (simulationRunId !== undefined)
      throw new BadRequestException({
        error: {
          code: 'SCENARIO_OVERLAY_NOT_IMPLEMENTED',
          message:
            'Phase 2B exposes immutable base state only; scenario overlays are not available.',
          request_id: requestId,
        },
      });
    try {
      await this.state.getSnapshot(snapshotId);
      const entities = await this.state.getSnapshotStates(
        snapshotId,
        entityId === undefined ? undefined : [entityId],
      );
      return envelope(
        {
          network_snapshot_id: snapshotId,
          entities: entities.map(mapState),
        },
        requestId,
      );
    } catch (error) {
      throw notFoundOrInternal(error, requestId);
    }
  }

  @Get('entities/:entityId')
  async getEntity(
    @Param('entityId') entityId: string,
  ): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    assertUuid(entityId, 'entityId', requestId);
    try {
      const entity = await this.state.getEntity(entityId);
      return envelope(
        {
          mobility_entity_id: entity.mobilityEntityId,
          entity_type: entity.entityType,
          availability: entity.state.operationalState,
          evidence_type: entity.state.evidenceType,
          freshness_status: entity.state.freshnessStatus,
          observed_at: entity.state.observedAt,
          expires_at: entity.state.expiresAt,
          provenance_ref: entity.state.provenanceRef,
        },
        requestId,
      );
    } catch (error) {
      throw notFoundOrInternal(error, requestId);
    }
  }

  @Get('snapshots/:snapshotId')
  async getSnapshot(
    @Param('snapshotId') snapshotId: string,
  ): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    assertUuid(snapshotId, 'snapshotId', requestId);
    try {
      const snapshot = await this.state.getSnapshot(snapshotId);
      return envelope(mapSnapshot(snapshot), requestId);
    } catch (error) {
      throw notFoundOrInternal(error, requestId);
    }
  }
}

function mapState(state: EffectiveMobilityState): Record<string, unknown> {
  return {
    mobility_entity_id: state.mobilityEntityId,
    availability: state.operationalState,
    evidence_type: state.evidenceType,
    freshness_status: state.freshnessStatus,
    observed_at: state.observedAt,
    expires_at: state.expiresAt,
    provenance_ref: state.provenanceRef,
  };
}

function mapSnapshot(snapshot: NetworkSnapshot): Record<string, unknown> {
  return {
    network_snapshot_id: snapshot.snapshotId,
    captured_at: snapshot.createdAt,
    state_cutoff_at: snapshot.stateCutoffAt,
    fingerprint: snapshot.contentHash,
    dataset_version_ids: [
      snapshot.transitDatasetVersionId,
      snapshot.spatialDatasetVersionId,
    ],
    processing_version: snapshot.processingVersion,
    status: snapshot.status,
    materialized_state_count: snapshot.materializedStateCount,
  };
}

function envelope(
  data: Record<string, unknown>,
  requestId: string,
): Record<string, unknown> {
  return {
    data,
    meta: { request_id: requestId, warnings: [], provenance: [] },
  };
}

function assertUuid(
  value: string | undefined,
  field: string,
  requestId: string,
) {
  if (
    value === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException({
      error: {
        code: 'INVALID_PARAMETER',
        message: `${field} must be a UUID.`,
        request_id: requestId,
      },
    });
}

function notFoundOrInternal(error: unknown, requestId: string): Error {
  if (error instanceof Error && /not found/i.test(error.message))
    return new NotFoundException({
      error: {
        code: 'NOT_FOUND',
        message: error.message,
        request_id: requestId,
      },
    });
  return new InternalServerErrorException({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The network state request could not be completed.',
      request_id: requestId,
    },
  });
}
