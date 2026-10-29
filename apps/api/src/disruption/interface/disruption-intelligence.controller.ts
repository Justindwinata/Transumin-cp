import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { OperationalState } from '../../operational-data/domain/operational-data.js';
import type { GeoJsonPolygon } from '../../operational-data/infrastructure/petabencana-operational.adapter.js';
import {
  DisruptionIntelligenceService,
  type ScenarioActionInput,
} from '../application/disruption-intelligence.service.js';
import { AuthGuard, Roles, RolesGuard } from '../../auth/auth.guard.js';

function envelope(data: unknown): Record<string, unknown> {
  return {
    data,
    meta: { request_id: randomUUID(), warnings: [], provenance: [] },
  };
}

@Controller()
export class DisruptionIntelligenceController {
  constructor(
    @Inject(DisruptionIntelligenceService)
    private readonly intelligence: DisruptionIntelligenceService,
  ) {}

  @Post('disruption-events')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('RESEARCHER_OPERATOR', 'ADMIN')
  async createEvent(
    @Body()
    body: {
      event_type: string;
      geometry: GeoJsonPolygon;
      effective_from: string;
      effective_to?: string | null;
      evidence_type: 'OBSERVED' | 'SIMULATED';
      provenance: { source_ids?: string[]; references?: string[] };
    } | null,
  ): Promise<Record<string, unknown>> {
    const sourceId = body?.provenance?.source_ids?.[0];
    if (!body || !sourceId)
      throw new BadRequestException('provenance.source_ids is required');
    const event = await this.intelligence.createControlledEvent({
      incidentType: body.event_type,
      sourceId,
      evidenceType: body.evidence_type,
      operationalState: 'UNKNOWN',
      effectiveFrom: body.effective_from,
      effectiveTo: body.effective_to ?? null,
      receivedAt: new Date().toISOString(),
      geometry: body.geometry,
      reason: 'Controlled source-referenced disruption event.',
      provenanceRef: body.provenance.references?.[0] ?? `source:${sourceId}`,
      rawReference: body.provenance.references?.[0] ?? `source:${sourceId}`,
    });
    return envelope({
      event_id: event.eventId,
      event_type: event.incidentType,
      geometry: body.geometry,
      effective_from: event.effectiveFrom,
      effective_to: event.effectiveTo,
      evidence_type: event.evidenceType,
      provenance: body.provenance,
    });
  }

  @Get('disruption-events/:eventId/impact')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('RESEARCHER_OPERATOR', 'ADMIN')
  async disruptionImpact(
    @Param('eventId') eventId: string,
    @Query('snapshot_id') snapshotId: string,
  ): Promise<Record<string, unknown>> {
    const impact = await this.intelligence.calculateFloodImpact(
      eventId,
      snapshotId,
    );
    return envelope(mapImpact(impact, null));
  }

  @Post('scenarios')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('RESEARCHER_OPERATOR', 'ADMIN')
  async createScenario(
    @Body()
    body: {
      name: string;
      description?: string;
      actions: Array<{
        mobility_entity_id: string;
        action_type: ScenarioActionInput['actionType'];
        availability?: OperationalState;
        reason: string;
        parameters?: Record<string, unknown>;
      }>;
    },
  ): Promise<Record<string, unknown>> {
    const scenario = await this.intelligence.createScenario({
      name: body.name,
      description: body.description,
      actions: body.actions.map((item) => ({
        mobilityEntityId: item.mobility_entity_id,
        actionType: item.action_type,
        availability: item.availability,
        reason: item.reason,
        parameters: item.parameters,
      })),
    });
    return envelope(mapScenario(scenario));
  }

  @Get('scenarios/:scenarioId')
  async scenario(
    @Param('scenarioId') id: string,
  ): Promise<Record<string, unknown>> {
    return envelope(mapScenario(await this.intelligence.getScenario(id)));
  }

  @Post('scenarios/:scenarioId/runs')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('RESEARCHER_OPERATOR', 'ADMIN')
  async createRun(
    @Param('scenarioId') scenarioId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      network_snapshot_id: string;
      configuration: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    return envelope(
      mapRun(
        await this.intelligence.createAndExecuteRun({
          scenarioId,
          snapshotId: body.network_snapshot_id,
          idempotencyKey,
          configuration: body.configuration,
        }),
      ),
    );
  }

  @Get('simulation-runs/:runId')
  async run(@Param('runId') id: string): Promise<Record<string, unknown>> {
    return envelope(mapRun(await this.intelligence.getRun(id)));
  }

  @Get('simulation-runs/:runId/impact')
  async runImpact(
    @Param('runId') id: string,
  ): Promise<Record<string, unknown>> {
    return envelope(
      mapImpact(await this.intelligence.getSimulationImpact(id), id),
    );
  }
}

function mapScenario(
  scenario: Awaited<ReturnType<DisruptionIntelligenceService['getScenario']>>,
) {
  return {
    scenario_id: scenario.scenarioId,
    name: scenario.name,
    description: scenario.description,
    version: scenario.version,
    status: scenario.status,
    actions: scenario.actions.map((item) => ({
      mobility_entity_id: item.mobilityEntityId,
      action_type: item.actionType,
      availability: item.availability,
      reason: item.reason,
      parameters: item.parameters,
    })),
  };
}

function mapRun(
  run: Awaited<ReturnType<DisruptionIntelligenceService['getRun']>>,
) {
  return {
    simulation_run_id: run.simulationRunId,
    scenario_id: run.scenarioId,
    network_snapshot_id: run.networkSnapshotId,
    status: run.status,
    created_at: run.createdAt,
    completed_at: run.completedAt,
    failure_code: run.failureCode,
  };
}

function mapImpact(
  impact: Awaited<
    ReturnType<DisruptionIntelligenceService['getSimulationImpact']>
  >,
  runId: string | null,
) {
  return {
    impact_id: impact.impactId,
    simulation_run_id: runId,
    affected_entities: [],
    metrics: {
      directly_exposed: impact.directExposedCount,
      confirmed_unavailable: impact.confirmedUnavailableCount,
      components_before: impact.componentsBefore,
      components_after: impact.componentsAfter,
      connectivity_loss: impact.connectivityLoss,
      isolated_entities: impact.isolatedEntityCount,
      affected_routes: impact.affectedRouteCount,
      affected_segments: impact.affectedSegmentCount,
      unresolved_entities: impact.unresolvedEntityCount,
      runtime_ms: impact.runtimeMs,
    },
    provenance: { references: [impact.fingerprint] },
  };
}
