import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type { OperationalState } from '../../operational-data/domain/operational-data.js';
import {
  validateBoundedHazardGeometry,
  type BoundedGeometryPolicy,
} from '../../operational-data/domain/hazard-incident.js';
import type {
  GeoJsonPolygon,
  PetaBencanaFloodObservation,
} from '../../operational-data/infrastructure/petabencana-operational.adapter.js';
import {
  analyzeConnectivity,
  deterministicHash,
  overrideState,
  type NetworkEdge,
  type ScenarioAction,
  type ScenarioActionType,
  type ScenarioOverride,
} from '../domain/disruption-intelligence.js';

export const DISRUPTION_IMPACT_RULE_VERSION = 'PHASE_3_FLOOD_EXPOSURE_V1';
export const SIMULATION_ENGINE_VERSION = 'PHASE_3_SCENARIO_V1';

export const DEFAULT_HAZARD_GEOMETRY_POLICY: BoundedGeometryPolicy = {
  maxCoordinates: 10_000,
  maxAreaDegreesSquared: 2.0,
};

export type DisruptionEventView = Readonly<{
  eventId: string;
  incidentType: string;
  evidenceType: string;
  operationalState: OperationalState;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  provenanceRef: string;
}>;

export type ImpactMetrics = Readonly<{
  impactId: string;
  directExposedCount: number;
  confirmedUnavailableCount: number;
  componentsBefore: number;
  componentsAfter: number;
  connectivityLoss: number;
  isolatedEntityCount: number;
  affectedRouteCount: number;
  affectedSegmentCount: number;
  unresolvedEntityCount: number;
  runtimeMs: number;
  fingerprint: string;
}>;

export type ScenarioActionInput = Readonly<{
  mobilityEntityId: string;
  actionType: ScenarioActionType;
  availability?: OperationalState | null;
  reason: string;
  parameters?: Readonly<Record<string, unknown>>;
}>;

export type ScenarioView = Readonly<{
  scenarioId: string;
  name: string;
  description: string;
  version: number;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  actions: readonly ScenarioActionInput[];
}>;

export type SimulationRunView = Readonly<{
  simulationRunId: string;
  scenarioId: string;
  networkSnapshotId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  failureCode: string | null;
  runtimeMs: number | null;
}>;

type EventRow = Readonly<{
  id: string;
  incidentType: string;
  evidenceType: string;
  operationalState: OperationalState;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  provenanceRef: string;
}>;

type ImpactRow = Readonly<{
  id: string;
  directExposedCount: number;
  confirmedUnavailableCount: number;
  componentsBefore: number;
  componentsAfter: number;
  connectivityLoss: number;
  isolatedEntityCount: number;
  affectedRouteCount: number;
  affectedSegmentCount: number;
  unresolvedEntityCount: number;
  runtimeMs: number;
  fingerprint: string;
}>;

type RunRow = Readonly<{
  id: string;
  scenarioId: string;
  networkSnapshotId: string;
  status: SimulationRunView['status'];
  createdAt: Date;
  completedAt: Date | null;
  failureCode: string | null;
  runtimeMs: number | null;
  requestHash: string;
}>;

function eventView(row: EventRow): DisruptionEventView {
  return {
    eventId: row.id,
    incidentType: row.incidentType,
    evidenceType: row.evidenceType,
    operationalState: row.operationalState,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    reason: row.reason,
    provenanceRef: row.provenanceRef,
  };
}

function impactView(row: ImpactRow): ImpactMetrics {
  return {
    impactId: row.id,
    directExposedCount: row.directExposedCount,
    confirmedUnavailableCount: row.confirmedUnavailableCount,
    componentsBefore: row.componentsBefore,
    componentsAfter: row.componentsAfter,
    connectivityLoss: row.connectivityLoss,
    isolatedEntityCount: row.isolatedEntityCount,
    affectedRouteCount: row.affectedRouteCount,
    affectedSegmentCount: row.affectedSegmentCount,
    unresolvedEntityCount: row.unresolvedEntityCount,
    runtimeMs: row.runtimeMs,
    fingerprint: row.fingerprint,
  };
}

function runView(row: RunRow): SimulationRunView {
  return {
    simulationRunId: row.id,
    scenarioId: row.scenarioId,
    networkSnapshotId: row.networkSnapshotId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    runtimeMs: row.runtimeMs,
  };
}

@Injectable()
export class DisruptionIntelligenceService {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async persistPetaBencanaFlood(
    item: PetaBencanaFloodObservation,
  ): Promise<DisruptionEventView> {
    const geomValidation = validateBoundedHazardGeometry(
      item.geometry,
      DEFAULT_HAZARD_GEOMETRY_POLICY,
    );
    if (!geomValidation.valid)
      throw new Error(`INVALID_HAZARD_GEOMETRY: ${geomValidation.reason}`);

    const observation = item.observation;
    const dedupeKey = deterministicHash({
      sourceId: observation.provenance.sourceId,
      sourceEventId: item.sourceEventId,
      observedAt: observation.observedAt,
      geometry: item.geometry,
    });
    const id = observation.incidentId;
    await sql`
      insert into disruption.event (
        id, incident_type, source_observation_id, source_id, evidence_type,
        operational_state, effective_from, effective_to, received_at, geometry,
        reason, provenance_ref, raw_reference, dedupe_key,
        observed_at, expires_at, source_classification
      ) values (
        ${id}::uuid, 'FLOOD', null, ${observation.provenance.sourceId}::uuid,
        ${observation.evidenceType}, 'UNKNOWN', ${observation.observedAt}::timestamptz,
        ${observation.expiresAt}::timestamptz, ${observation.receivedAt}::timestamptz,
        ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(item.geometry)}), 4326),
        ${observation.reason}, ${observation.provenance.lineageReference},
        ${observation.provenance.rawReference}, ${dedupeKey},
        ${observation.observedAt}::timestamptz, ${observation.expiresAt}::timestamptz,
        ${observation.provenance.sourceClassification}
      ) on conflict (dedupe_key) do nothing
    `.execute(this.database);
    return this.getEventByDedupe(dedupeKey);
  }

  async createControlledEvent(input: {
    incidentType: string;
    sourceId: string;
    evidenceType: 'OBSERVED' | 'SIMULATED';
    operationalState: OperationalState;
    effectiveFrom: string;
    effectiveTo: string | null;
    receivedAt: string;
    geometry: GeoJsonPolygon | null;
    reason: string;
    provenanceRef: string;
    rawReference: string;
    observedAt?: string;
    expiresAt?: string;
    sourceClassification?: string;
  }): Promise<DisruptionEventView> {
    if (
      ['FLOOD', 'WEATHER_DISRUPTION'].includes(input.incidentType) &&
      input.operationalState === 'UNAVAILABLE'
    )
      throw new Error('ENVIRONMENTAL_EXPOSURE_CANNOT_ASSERT_CLOSURE');

    if (input.geometry !== null) {
      const geomValidation = validateBoundedHazardGeometry(
        input.geometry,
        DEFAULT_HAZARD_GEOMETRY_POLICY,
      );
      if (!geomValidation.valid)
        throw new Error(`INVALID_HAZARD_GEOMETRY: ${geomValidation.reason}`);
    }

    const observedAt =
      input.observedAt ??
      (input.incidentType === 'FLOOD' ? input.effectiveFrom : null);
    const expiresAt =
      input.expiresAt ??
      input.effectiveTo ??
      (input.incidentType === 'FLOOD'
        ? new Date(
            Date.parse(input.effectiveFrom) + 6 * 3600 * 1000,
          ).toISOString()
        : null);
    const sourceClassification =
      input.sourceClassification ??
      (input.incidentType === 'FLOOD'
        ? input.evidenceType === 'SIMULATED'
          ? 'NOT_AVAILABLE'
          : 'UNKNOWN'
        : null);

    const dedupeKey = deterministicHash(input);
    const id = randomUUID();
    await sql`
      insert into disruption.event (
        id, incident_type, source_id, evidence_type, operational_state,
        effective_from, effective_to, received_at, geometry, reason,
        provenance_ref, raw_reference, dedupe_key,
        observed_at, expires_at, source_classification
      ) values (
        ${id}::uuid, ${input.incidentType}, ${input.sourceId}::uuid,
        ${input.evidenceType}, ${input.operationalState}, ${input.effectiveFrom}::timestamptz,
        ${input.effectiveTo}::timestamptz, ${input.receivedAt}::timestamptz,
        case when ${input.geometry ? JSON.stringify(input.geometry) : null}::text is null
          then null else ST_SetSRID(ST_GeomFromGeoJSON(${input.geometry ? JSON.stringify(input.geometry) : null}), 4326) end,
        ${input.reason}, ${input.provenanceRef}, ${input.rawReference}, ${dedupeKey},
        ${observedAt}::timestamptz,
        ${expiresAt}::timestamptz,
        ${sourceClassification}
      ) on conflict (dedupe_key) do nothing
    `.execute(this.database);
    return this.getEventByDedupe(dedupeKey);
  }

  async calculateFloodImpact(
    eventId: string,
    snapshotId: string,
  ): Promise<ImpactMetrics> {
    const started = performance.now();
    const existing = await this.findImpact(eventId, snapshotId);
    if (existing) return existing;
    const impactId = randomUUID();
    await this.database.transaction().execute(async (transaction) => {
      await sql`
        insert into disruption.impact_analysis (
          id, disruption_event_id, network_snapshot_id, status, rule_version,
          provenance_ref, fingerprint
        ) values (
          ${impactId}::uuid, ${eventId}::uuid, ${snapshotId}::uuid, 'RUNNING',
          ${DISRUPTION_IMPACT_RULE_VERSION},
          ${`disruption:event:${eventId}`}, 'PENDING'
        )
      `.execute(transaction);
      await sql`
        with exposed as (
          select mobility_entity_id, 'WALKING_EDGE'::text entity_type
          from spatial.walking_edge w, disruption.event e, twin.network_snapshot s
          where e.id=${eventId}::uuid and s.id=${snapshotId}::uuid
            and w.dataset_version_id=s.spatial_dataset_version_id
            and ST_Intersects(w.geom, e.geometry)
          union
          select mobility_entity_id, 'STOP' from transit.stop t, disruption.event e, twin.network_snapshot s
          where e.id=${eventId}::uuid and s.id=${snapshotId}::uuid
            and t.dataset_version_id=s.transit_dataset_version_id
            and ST_Intersects(t.geom, e.geometry)
          union
          select mobility_entity_id, 'STATION' from transit.station t, disruption.event e, twin.network_snapshot s
          where e.id=${eventId}::uuid and s.id=${snapshotId}::uuid
            and t.dataset_version_id=s.transit_dataset_version_id
            and ST_Intersects(t.geom, e.geometry)
          union
          select mobility_entity_id, 'TRANSIT_SEGMENT' from transit.transit_segment t, disruption.event e, twin.network_snapshot s
          where e.id=${eventId}::uuid and s.id=${snapshotId}::uuid
            and t.dataset_version_id=s.transit_dataset_version_id
            and ST_Intersects(t.geom, e.geometry)
          union
          select mobility_entity_id, 'RAIL_TOPOLOGY_EDGE' from spatial.rail_topology_edge r, disruption.event e, twin.network_snapshot s
          where e.id=${eventId}::uuid and s.id=${snapshotId}::uuid
            and r.dataset_version_id=s.spatial_dataset_version_id
            and ST_Intersects(r.geom, e.geometry)
        )
        insert into disruption.entity_impact (
          id, impact_analysis_id, mobility_entity_id, impact_kind,
          spatial_relation, resulting_state, evidence_type, provenance_ref
        )
        select gen_random_uuid(), ${impactId}::uuid, mobility_entity_id,
          'DIRECT_EXPOSURE', 'INTERSECTS', null, 'OBSERVED',
          ${`disruption:event:${eventId}:spatial-exposure`}
        from exposed
        on conflict do nothing
      `.execute(transaction);
      const counts = await sql<{
        total: number;
        segments: number;
        routes: number;
      }>`
        select count(*)::int total,
          count(*) filter (where me.entity_type in ('TRANSIT_SEGMENT','RAIL_TOPOLOGY_EDGE'))::int segments,
          count(distinct ts.route_id)::int routes
        from disruption.entity_impact ei
        join twin.mobility_entity me on me.id=ei.mobility_entity_id
        left join transit.transit_segment ts on ts.mobility_entity_id=ei.mobility_entity_id
        where ei.impact_analysis_id=${impactId}::uuid
      `.execute(transaction);
      const values = counts.rows[0]!;
      const runtime = performance.now() - started;
      const fingerprint = deterministicHash({
        eventId,
        snapshotId,
        ruleVersion: DISRUPTION_IMPACT_RULE_VERSION,
        directExposedCount: values.total,
        affectedSegmentCount: values.segments,
        affectedRouteCount: values.routes,
      });
      await sql`
        update disruption.impact_analysis set
          status='COMPLETED', direct_exposed_count=${values.total},
          affected_segment_count=${values.segments}, affected_route_count=${values.routes},
          components_before=0, components_after=0, connectivity_loss=0,
          runtime_ms=${runtime}, fingerprint=${fingerprint}, completed_at=now()
        where id=${impactId}::uuid
      `.execute(transaction);
    });
    return (await this.getImpact(impactId))!;
  }

  async createScenario(input: {
    name: string;
    description?: string;
    actions: readonly ScenarioActionInput[];
  }): Promise<ScenarioView> {
    if (input.name.trim() === '' || input.actions.length === 0)
      throw new Error('SCENARIO_INVALID');
    const id = randomUUID();
    await this.database.transaction().execute(async (transaction) => {
      await sql`
        insert into simulation.scenario (id, name, description, status)
        values (${id}::uuid, ${input.name}, ${input.description ?? ''}, 'READY')
      `.execute(transaction);
      for (const [sequence, action] of input.actions.entries()) {
        if (
          action.actionType === 'SET_AVAILABILITY' &&
          action.availability === undefined
        )
          throw new Error('SET_AVAILABILITY requires availability');
        await sql`
          insert into simulation.scenario_action (
            id, scenario_id, sequence, mobility_entity_id, action_type,
            availability, reason, parameters_json
          ) values (
            ${randomUUID()}::uuid, ${id}::uuid, ${sequence},
            ${action.mobilityEntityId}::uuid, ${action.actionType},
            ${action.availability ?? null}, ${action.reason},
            ${JSON.stringify(action.parameters ?? {})}::jsonb
          )
        `.execute(transaction);
      }
    });
    return this.getScenario(id);
  }

  async getScenario(id: string): Promise<ScenarioView> {
    const scenario = await sql<{
      id: string;
      name: string;
      description: string;
      version: number;
      status: ScenarioView['status'];
    }>`
      select id, name, description, version, status
      from simulation.scenario where id=${id}::uuid
    `.execute(this.database);
    const row = scenario.rows[0];
    if (!row) throw new Error('Scenario not found');
    const actions = await sql<{
      mobilityEntityId: string;
      actionType: ScenarioActionType;
      availability: OperationalState | null;
      reason: string;
      parameters: Record<string, unknown>;
    }>`
      select mobility_entity_id as "mobilityEntityId", action_type as "actionType",
        availability, reason, parameters_json as parameters
      from simulation.scenario_action where scenario_id=${id}::uuid order by sequence
    `.execute(this.database);
    return {
      scenarioId: row.id,
      name: row.name,
      description: row.description,
      version: row.version,
      status: row.status,
      actions: actions.rows,
    };
  }

  async createAndExecuteRun(input: {
    scenarioId: string;
    snapshotId: string;
    idempotencyKey: string;
    configuration: Readonly<Record<string, unknown>>;
  }): Promise<SimulationRunView> {
    if (input.idempotencyKey.trim() === '')
      throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const requestHash = deterministicHash({
      snapshotId: input.snapshotId,
      configuration: input.configuration,
    });
    const existing = await this.findRunByKey(
      input.scenarioId,
      input.idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new Error('IDEMPOTENCY_CONFLICT');
      return runView(existing);
    }
    const runId = randomUUID();
    await sql`
      insert into simulation.run (
        id, scenario_id, network_snapshot_id, status, idempotency_key,
        request_hash, configuration_json, engine_version, provenance_ref
      ) values (
        ${runId}::uuid, ${input.scenarioId}::uuid, ${input.snapshotId}::uuid,
        'PENDING', ${input.idempotencyKey}, ${requestHash},
        ${JSON.stringify(input.configuration)}::jsonb, ${SIMULATION_ENGINE_VERSION},
        ${`simulation:scenario:${input.scenarioId}:snapshot:${input.snapshotId}`}
      )
    `.execute(this.database);
    const started = performance.now();
    try {
      await sql`update simulation.run set status='RUNNING', started_at=now() where id=${runId}::uuid`.execute(
        this.database,
      );
      const actions = await this.loadActions(input.scenarioId);
      const entityIds = actions.map((action) => action.mobilityEntityId);
      let baseStateRows: Array<{
        entityId: string;
        state: OperationalState;
      }> = [];
      if (entityIds.length > 0) {
        const baseStates = await sql<{
          entityId: string;
          state: OperationalState;
        }>`
        select entity.id as "entityId", coalesce(state.operational_state, 'UNKNOWN') as state
        from unnest(${entityIds}::uuid[]) entity(id)
        left join twin.network_snapshot_state state
          on state.snapshot_id=${input.snapshotId}::uuid and state.mobility_entity_id=entity.id
        `.execute(this.database);
        baseStateRows = [...baseStates.rows];
      }
      const stateByEntity = new Map(
        baseStateRows.map((row) => [row.entityId, row.state]),
      );
      const overrides = actions.map((action) =>
        overrideState(
          stateByEntity.get(action.mobilityEntityId) ?? 'UNKNOWN',
          action,
        ),
      );
      await this.persistOverrides(runId, overrides);
      const baseEdges = await this.loadWalkingEdges(input.snapshotId);
      const overrideMap = new Map(
        overrides.map((item) => [item.mobilityEntityId, item.overrideState]),
      );
      const scenarioEdges = baseEdges.map((edge) => ({
        ...edge,
        state: overrideMap.get(edge.mobilityEntityId) ?? edge.state,
      }));
      const before = analyzeConnectivity(baseEdges);
      const after = analyzeConnectivity(scenarioEdges);
      const runtime = performance.now() - started;
      const result = {
        runId,
        overrides: overrides.map((item) => ({
          entityId: item.mobilityEntityId,
          baseState: item.baseState,
          overrideState: item.overrideState,
          evidenceType: item.evidenceType,
        })),
        before,
        after,
        engineVersion: SIMULATION_ENGINE_VERSION,
      };
      const resultHash = deterministicHash(result);
      await this.database.transaction().execute(async (transaction) => {
        await sql`
          insert into simulation.impact_result (
            id, simulation_run_id, directly_affected_count, overridden_entity_count,
            components_before, components_after, connectivity_loss,
            isolated_entity_count, affected_route_count, affected_segment_count,
            unresolved_entity_count, result_hash, provenance_ref, engine_version, runtime_ms
          ) values (
            ${randomUUID()}::uuid, ${runId}::uuid, ${overrides.length}, ${overrides.length},
            ${before.components}, ${after.components},
            ${Math.max(0, after.components - before.components)}, ${after.isolatedNodes},
            0, 0, 0, ${resultHash}, ${`simulation:run:${runId}`},
            ${SIMULATION_ENGINE_VERSION}, ${runtime}
          )
        `.execute(transaction);
        await sql`
          update simulation.run set status='COMPLETED', completed_at=now(),
            runtime_ms=${runtime} where id=${runId}::uuid
        `.execute(transaction);
      });
    } catch (error) {
      await sql`
        update simulation.run set status='FAILED', completed_at=now(),
          failure_code=${error instanceof Error ? error.message.slice(0, 120) : 'SIMULATION_FAILED'},
          runtime_ms=${performance.now() - started}
        where id=${runId}::uuid
      `.execute(this.database);
      throw error;
    }
    return this.getRun(runId);
  }

  async getRun(id: string): Promise<SimulationRunView> {
    const result = await this.runQuery(sql`where id=${id}::uuid`);
    if (!result) throw new Error('Simulation run not found');
    return runView(result);
  }

  async getSimulationImpact(runId: string): Promise<ImpactMetrics> {
    const result = await sql<ImpactRow>`
      select id, directly_affected_count as "directExposedCount",
        overridden_entity_count as "confirmedUnavailableCount",
        components_before as "componentsBefore", components_after as "componentsAfter",
        connectivity_loss as "connectivityLoss", isolated_entity_count as "isolatedEntityCount",
        affected_route_count as "affectedRouteCount", affected_segment_count as "affectedSegmentCount",
        unresolved_entity_count as "unresolvedEntityCount", runtime_ms as "runtimeMs",
        result_hash as fingerprint
      from simulation.impact_result where simulation_run_id=${runId}::uuid
    `.execute(this.database);
    if (!result.rows[0]) throw new Error('Simulation impact not found');
    return impactView(result.rows[0]);
  }

  async getOverrides(runId: string): Promise<readonly ScenarioOverride[]> {
    const result = await sql<ScenarioOverride>`
      select mobility_entity_id as "mobilityEntityId", base_state as "baseState",
        override_state as "overrideState", evidence_type as "evidenceType",
        action_id as "actionId", reason
      from simulation.state_override where simulation_run_id=${runId}::uuid
      order by mobility_entity_id
    `.execute(this.database);
    return result.rows;
  }

  private async getEventByDedupe(
    dedupeKey: string,
  ): Promise<DisruptionEventView> {
    const result = await sql<EventRow>`
      select id, incident_type as "incidentType", evidence_type as "evidenceType",
        operational_state as "operationalState", effective_from as "effectiveFrom",
        effective_to as "effectiveTo", reason, provenance_ref as "provenanceRef"
      from disruption.event where dedupe_key=${dedupeKey}
    `.execute(this.database);
    if (!result.rows[0]) throw new Error('Disruption event persistence failed');
    return eventView(result.rows[0]);
  }

  private async findImpact(
    eventId: string,
    snapshotId: string,
  ): Promise<ImpactMetrics | null> {
    const result = await sql<ImpactRow>`
      select id, direct_exposed_count as "directExposedCount",
        confirmed_unavailable_count as "confirmedUnavailableCount",
        components_before as "componentsBefore", components_after as "componentsAfter",
        connectivity_loss as "connectivityLoss", isolated_entity_count as "isolatedEntityCount",
        affected_route_count as "affectedRouteCount", affected_segment_count as "affectedSegmentCount",
        unresolved_entity_count as "unresolvedEntityCount", runtime_ms as "runtimeMs", fingerprint
      from disruption.impact_analysis
      where disruption_event_id=${eventId}::uuid and network_snapshot_id=${snapshotId}::uuid
        and rule_version=${DISRUPTION_IMPACT_RULE_VERSION} and status='COMPLETED'
    `.execute(this.database);
    return result.rows[0] ? impactView(result.rows[0]) : null;
  }

  private async getImpact(id: string): Promise<ImpactMetrics | null> {
    const result = await sql<ImpactRow>`
      select id, direct_exposed_count as "directExposedCount",
        confirmed_unavailable_count as "confirmedUnavailableCount",
        components_before as "componentsBefore", components_after as "componentsAfter",
        connectivity_loss as "connectivityLoss", isolated_entity_count as "isolatedEntityCount",
        affected_route_count as "affectedRouteCount", affected_segment_count as "affectedSegmentCount",
        unresolved_entity_count as "unresolvedEntityCount", runtime_ms as "runtimeMs", fingerprint
      from disruption.impact_analysis where id=${id}::uuid
    `.execute(this.database);
    return result.rows[0] ? impactView(result.rows[0]) : null;
  }

  private async loadActions(
    scenarioId: string,
  ): Promise<readonly ScenarioAction[]> {
    const result = await sql<ScenarioAction>`
      select id as "actionId", mobility_entity_id as "mobilityEntityId",
        action_type as "actionType", availability, reason
      from simulation.scenario_action where scenario_id=${scenarioId}::uuid order by sequence
    `.execute(this.database);
    return result.rows;
  }

  private async persistOverrides(
    runId: string,
    overrides: readonly ScenarioOverride[],
  ): Promise<void> {
    for (const item of overrides)
      await sql`
        insert into simulation.state_override (
          id, simulation_run_id, mobility_entity_id, base_state,
          override_state, evidence_type, action_id, reason
        ) values (
          ${randomUUID()}::uuid, ${runId}::uuid, ${item.mobilityEntityId}::uuid,
          ${item.baseState}, ${item.overrideState}, 'SIMULATED',
          ${item.actionId}::uuid, ${item.reason}
        )
      `.execute(this.database);
  }

  private async loadWalkingEdges(
    snapshotId: string,
  ): Promise<readonly NetworkEdge[]> {
    const result = await sql<NetworkEdge>`
      select edge.mobility_entity_id as "mobilityEntityId",
        edge.from_node_id as "fromNodeId", edge.to_node_id as "toNodeId",
        coalesce(state.operational_state, 'UNKNOWN') as state
      from spatial.walking_edge edge
      join twin.network_snapshot snapshot on snapshot.id=${snapshotId}::uuid
        and edge.dataset_version_id=snapshot.spatial_dataset_version_id
      left join twin.network_snapshot_state state
        on state.snapshot_id=snapshot.id and state.mobility_entity_id=edge.mobility_entity_id
      order by edge.id
    `.execute(this.database);
    return result.rows;
  }

  private async findRunByKey(
    scenarioId: string,
    key: string,
  ): Promise<RunRow | null> {
    return this.runQuery(
      sql`where scenario_id=${scenarioId}::uuid and idempotency_key=${key}`,
    );
  }

  private async runQuery(
    where: ReturnType<typeof sql>,
  ): Promise<RunRow | null> {
    const result = await sql<RunRow>`
      select id, scenario_id as "scenarioId", network_snapshot_id as "networkSnapshotId",
        status, created_at as "createdAt", completed_at as "completedAt",
        failure_code as "failureCode", runtime_ms as "runtimeMs", request_hash as "requestHash"
      from simulation.run ${where}
    `.execute(this.database);
    return result.rows[0] ?? null;
  }
}
