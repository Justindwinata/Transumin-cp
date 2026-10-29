import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { OperationalContractValidator } from '../../operational-data/application/operational-contract-validator.js';
import type { OperationalObservation } from '../../operational-data/domain/operational-data.js';
import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import type {
  EffectiveMobilityState,
  MobilityStateHistoryRecord,
  NetworkSnapshot,
  PersistedOperationalObservation,
  SnapshotCreationInput,
  TwinFreshnessStatus,
} from '../domain/mobility-twin.js';
import { EffectiveStateProjector } from '../application/state-projector.js';
import type {
  MobilityStatePort,
  MobilityEntityView,
  PersistObservationResult,
} from '../application/mobility-state.port.js';

type ObservationRow = Readonly<{
  id: string;
  incidentId: string;
  mobilityEntityId: string | null;
  sourceId: string;
  sourceClassification: OperationalObservation['provenance']['sourceClassification'];
  affectedEntityRefs: unknown;
  affectedModes: unknown;
  incidentType: OperationalObservation['incidentType'];
  operationalState: OperationalObservation['operationalState'];
  evidenceType: OperationalObservation['evidenceType'];
  sourceAuthority: OperationalObservation['sourceAuthority'];
  sourceChannel: OperationalObservation['sourceChannel'];
  impactBasis: OperationalObservation['impactBasis'];
  observedAt: Date;
  receivedAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  reason: string;
  confidenceStatus: OperationalObservation['confidenceStatus'];
  confidence: number | null;
  rawReference: string;
  lineageReference: string;
  retrievedAt: Date;
  sourceAttributes: unknown;
}>;

type StateRow = Readonly<{
  mobilityEntityId: string;
  operationalState: EffectiveMobilityState['operationalState'];
  evidenceType: EffectiveMobilityState['evidenceType'];
  freshnessStatus: TwinFreshnessStatus;
  observationId: string | null;
  sourceId: string | null;
  observedAt: Date | null;
  expiresAt: Date | null;
  confidenceStatus: EffectiveMobilityState['confidenceStatus'];
  confidence: number | null;
  provenanceRef: string | null;
  stateAsOf: Date;
  projectionVersion: string;
}>;

type HistoryRow = Readonly<{
  id: string;
  mobilityEntityId: string;
  previousState: EffectiveMobilityState['operationalState'] | null;
  newState: EffectiveMobilityState['operationalState'];
  effectiveAt: Date;
  triggeringObservationId: string | null;
  evidenceType: EffectiveMobilityState['evidenceType'];
  freshnessStatus: TwinFreshnessStatus;
  sourceId: string | null;
  provenanceRef: string | null;
  reason: string;
  projectionVersion: string;
}>;

type SnapshotRow = Readonly<{
  snapshotId: string;
  transitDatasetVersionId: string;
  spatialDatasetVersionId: string;
  processingVersion: string;
  stateCutoffAt: Date;
  configuration: Record<string, unknown>;
  manifestRef: string;
  contentHash: string;
  status: 'DRAFT' | 'FINALIZED';
  createdAt: Date;
  finalizedAt: Date | null;
  materializedStateCount: number;
}>;

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  return value;
}

function jsonValue<T>(value: unknown, fallback: T): T {
  return value === null || value === undefined ? fallback : (value as T);
}

function mapObservation(row: ObservationRow): PersistedOperationalObservation {
  return {
    observationId: row.id,
    incidentId: row.incidentId,
    mobilityEntityId: row.mobilityEntityId,
    incidentType: row.incidentType,
    affectedEntityRefs: jsonValue(row.affectedEntityRefs, []),
    affectedModes: jsonValue(row.affectedModes, []),
    operationalState: row.operationalState,
    evidenceType: row.evidenceType,
    sourceAuthority: row.sourceAuthority,
    sourceChannel: row.sourceChannel,
    impactBasis: row.impactBasis,
    observedAt: row.observedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    reason: row.reason,
    confidenceStatus: row.confidenceStatus,
    confidence: row.confidence,
    provenance: {
      sourceId: row.sourceId,
      sourceClassification: row.sourceClassification,
      rawReference: row.rawReference,
      lineageReference: row.lineageReference,
      retrievedAt: row.retrievedAt.toISOString(),
    },
    sourceAttributes: jsonValue(row.sourceAttributes, {}),
  };
}

function mapState(row: StateRow): EffectiveMobilityState {
  return {
    mobilityEntityId: row.mobilityEntityId,
    operationalState: row.operationalState,
    evidenceType: row.evidenceType,
    freshnessStatus: row.freshnessStatus,
    observationId: row.observationId,
    sourceId: row.sourceId,
    observedAt: row.observedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    confidenceStatus: row.confidenceStatus,
    confidence: row.confidence,
    provenanceRef: row.provenanceRef,
    stateAsOf: row.stateAsOf.toISOString(),
    projectionVersion: row.projectionVersion,
    reason:
      row.operationalState === 'UNKNOWN'
        ? 'No fresh evidence establishes current state.'
        : 'Effective state projected from the selected observation.',
  };
}

function mapHistory(row: HistoryRow): MobilityStateHistoryRecord {
  return {
    id: row.id,
    mobilityEntityId: row.mobilityEntityId,
    previousState: row.previousState,
    newState: row.newState,
    effectiveAt: row.effectiveAt.toISOString(),
    triggeringObservationId: row.triggeringObservationId,
    evidenceType: row.evidenceType,
    freshnessStatus: row.freshnessStatus,
    sourceId: row.sourceId,
    provenanceRef: row.provenanceRef,
    reason: row.reason,
    projectionVersion: row.projectionVersion,
  };
}

function mapSnapshot(row: SnapshotRow): NetworkSnapshot {
  return {
    snapshotId: row.snapshotId,
    transitDatasetVersionId: row.transitDatasetVersionId,
    spatialDatasetVersionId: row.spatialDatasetVersionId,
    processingVersion: row.processingVersion,
    stateCutoffAt: row.stateCutoffAt.toISOString(),
    configuration: row.configuration,
    manifestRef: row.manifestRef,
    contentHash: row.contentHash,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    materializedStateCount: row.materializedStateCount,
  };
}

@Injectable()
export class KyselyMobilityStateRepository implements MobilityStatePort {
  private readonly projector = new EffectiveStateProjector();

  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
    @Inject(OperationalContractValidator)
    private readonly validator: OperationalContractValidator,
  ) {}

  async persistObservation(
    observation: OperationalObservation,
    mobilityEntityId: string | null = null,
  ): Promise<PersistObservationResult> {
    this.validator.assertValid(observation);
    const dedupeKey = hash({
      observation,
      mobilityEntityId,
    });
    return this.database
      .transaction()
      .execute((transaction) =>
        this.persistObservationInTransaction(
          transaction,
          observation,
          mobilityEntityId,
          dedupeKey,
        ),
      );
  }

  async persistObservationInTransaction(
    transaction: Kysely<FoundationDatabase>,
    observation: OperationalObservation,
    mobilityEntityId: string | null,
    dedupeKey = hash({ observation, mobilityEntityId }),
  ): Promise<PersistObservationResult> {
    this.validator.assertValid(observation);
    const inserted = await sql<{ id: string }>`
        insert into twin.operational_observation (
          id, incident_id, mobility_entity_id, source_id, source_classification,
          affected_entity_refs, affected_modes, incident_type, operational_state,
          evidence_type, source_authority, source_channel, impact_basis,
          observed_at, received_at, updated_at, expires_at, reason,
          confidence_status, confidence, raw_reference, lineage_reference,
          retrieved_at, source_attributes, dedupe_key
        ) values (
          ${observation.observationId}::uuid, ${observation.incidentId}::uuid,
          ${mobilityEntityId}::uuid, ${observation.provenance.sourceId}::uuid,
          ${observation.provenance.sourceClassification},
          ${JSON.stringify(observation.affectedEntityRefs)}::jsonb,
          ${JSON.stringify(observation.affectedModes)}::jsonb,
          ${observation.incidentType}, ${observation.operationalState},
          ${observation.evidenceType}, ${observation.sourceAuthority},
          ${observation.sourceChannel}, ${observation.impactBasis},
          ${observation.observedAt}::timestamptz, ${observation.receivedAt}::timestamptz,
          ${observation.updatedAt}::timestamptz, ${observation.expiresAt}::timestamptz,
          ${observation.reason}, ${observation.confidenceStatus}, ${observation.confidence},
          ${observation.provenance.rawReference}, ${observation.provenance.lineageReference},
          ${observation.provenance.retrievedAt}::timestamptz,
          ${JSON.stringify(observation.sourceAttributes)}::jsonb, ${dedupeKey}
        ) on conflict do nothing returning id
      `.execute(transaction);
    if (inserted.rows[0] !== undefined)
      return { observationId: inserted.rows[0].id, status: 'INSERTED' };
    const existing = await sql<{ id: string }>`
        select id from twin.operational_observation
        where id=${observation.observationId}::uuid or dedupe_key=${dedupeKey}
        order by case when id=${observation.observationId}::uuid then 0 else 1 end
        limit 1
      `.execute(transaction);
    const existingId = existing.rows[0]?.id;
    if (existingId === undefined)
      throw new Error('Observation idempotency lookup failed');
    return { observationId: existingId, status: 'ALREADY_PERSISTED' };
  }

  async getCurrentState(entityId: string): Promise<EffectiveMobilityState> {
    return this.replayState(entityId, new Date());
  }

  async projectState(
    entityId: string,
    asOf: Date,
  ): Promise<EffectiveMobilityState> {
    return this.database.transaction().execute(async (transaction) => {
      return this.projectStateInTransaction(transaction, entityId, asOf);
    });
  }

  async projectStates(
    entityIds: readonly string[],
    asOf: Date,
  ): Promise<readonly EffectiveMobilityState[]> {
    const results: EffectiveMobilityState[] = [];
    for (const entityId of entityIds)
      results.push(await this.projectState(entityId, asOf));
    return results;
  }

  async getStates(
    entityIds: readonly string[],
  ): Promise<readonly EffectiveMobilityState[]> {
    return this.replayStates(entityIds, new Date());
  }

  async getEntity(entityId: string): Promise<MobilityEntityView> {
    const result = await sql<{ entityId: string; entityType: string }>`
      select id as "entityId", entity_type as "entityType"
      from twin.mobility_entity where id=${entityId}::uuid
    `.execute(this.database);
    const row = result.rows[0];
    if (row === undefined)
      throw new Error(`Mobility entity not found: ${entityId}`);
    return {
      mobilityEntityId: row.entityId,
      entityType: row.entityType,
      state: await this.getCurrentState(entityId),
    };
  }

  async getSnapshotStates(
    snapshotId: string,
    entityIds?: readonly string[],
  ): Promise<readonly EffectiveMobilityState[]> {
    const filter =
      entityIds === undefined || entityIds.length === 0
        ? sql``
        : sql`and mobility_entity_id = any(${entityIds}::uuid[])`;
    const result = await sql<StateRow>`
      select mobility_entity_id as "mobilityEntityId", operational_state as "operationalState",
        evidence_type as "evidenceType", freshness_status as "freshnessStatus",
        observation_id as "observationId", source_id as "sourceId", observed_at as "observedAt",
        expires_at as "expiresAt", confidence_status as "confidenceStatus", confidence,
        provenance_ref as "provenanceRef", state_as_of as "stateAsOf", 'PHASE_2B_V1' as "projectionVersion"
      from twin.network_snapshot_state
      where snapshot_id=${snapshotId}::uuid ${filter}
      order by mobility_entity_id
    `.execute(this.database);
    return result.rows.map(mapState);
  }

  async getStateHistory(
    entityId: string,
    from?: Date,
    to?: Date,
  ): Promise<readonly MobilityStateHistoryRecord[]> {
    const result = await sql<HistoryRow>`
      select id, mobility_entity_id as "mobilityEntityId", previous_state as "previousState",
        new_state as "newState", effective_at as "effectiveAt",
        triggering_observation_id as "triggeringObservationId", evidence_type as "evidenceType",
        freshness_status as "freshnessStatus", source_id as "sourceId", provenance_ref as "provenanceRef",
        reason, projection_version as "projectionVersion"
      from twin.mobility_state_history
      where mobility_entity_id=${entityId}::uuid
        and (${from?.toISOString() ?? null}::timestamptz is null or effective_at >= ${from?.toISOString() ?? null}::timestamptz)
        and (${to?.toISOString() ?? null}::timestamptz is null or effective_at <= ${to?.toISOString() ?? null}::timestamptz)
      order by effective_at asc, id asc
    `.execute(this.database);
    return result.rows.map(mapHistory);
  }

  async replayState(
    entityId: string,
    asOf: Date,
  ): Promise<EffectiveMobilityState> {
    const observations = await this.loadObservations(entityId, asOf);
    return this.projector.project(entityId, observations, asOf);
  }

  async replayStates(
    entityIds: readonly string[],
    asOf: Date,
  ): Promise<readonly EffectiveMobilityState[]> {
    if (entityIds.length === 0) return [];
    const observations = await this.loadObservations(entityIds, asOf);
    const grouped = new Map<string, PersistedOperationalObservation[]>();
    for (const observation of observations) {
      if (observation.mobilityEntityId === null) continue;
      const list = grouped.get(observation.mobilityEntityId) ?? [];
      list.push(observation);
      grouped.set(observation.mobilityEntityId, list);
    }
    return entityIds.map((entityId) =>
      this.projector.project(entityId, grouped.get(entityId) ?? [], asOf),
    );
  }

  async createSnapshot(input: SnapshotCreationInput): Promise<NetworkSnapshot> {
    const observed = await sql<ObservationRow>`
      select id, incident_id as "incidentId", mobility_entity_id as "mobilityEntityId",
        source_id as "sourceId", source_classification as "sourceClassification",
        affected_entity_refs as "affectedEntityRefs", affected_modes as "affectedModes",
        incident_type as "incidentType", operational_state as "operationalState",
        evidence_type as "evidenceType", source_authority as "sourceAuthority",
        source_channel as "sourceChannel", impact_basis as "impactBasis",
        observed_at as "observedAt", received_at as "receivedAt", updated_at as "updatedAt",
        expires_at as "expiresAt", reason, confidence_status as "confidenceStatus", confidence,
        raw_reference as "rawReference", lineage_reference as "lineageReference",
        retrieved_at as "retrievedAt", source_attributes as "sourceAttributes"
      from twin.operational_observation observation
      where mobility_entity_id is not null
        and observed_at <= ${input.stateCutoffAt.toISOString()}::timestamptz
        and received_at <= ${input.stateCutoffAt.toISOString()}::timestamptz
        and not exists (
          select 1 from disruption.operational_incident incident
          where incident.id=observation.incident_id
            and not (
              coalesce((
                select journal.lifecycle_status
                from disruption.operational_incident_journal journal
                where journal.incident_id=incident.id
                  and journal.changed_at <= ${input.stateCutoffAt.toISOString()}::timestamptz
                order by journal.changed_at desc, journal.revision desc
                limit 1
              ), 'INGESTED_UNVERIFIED') = 'VERIFIED_ACTIVE'
              and incident.effective_from <= ${input.stateCutoffAt.toISOString()}::timestamptz
              and incident.expires_at > ${input.stateCutoffAt.toISOString()}::timestamptz
              and (incident.effective_to is null or incident.effective_to > ${input.stateCutoffAt.toISOString()}::timestamptz)
            )
        )
      order by mobility_entity_id, observed_at asc, received_at asc, id asc
    `.execute(this.database);
    const grouped = new Map<string, PersistedOperationalObservation[]>();
    for (const row of observed.rows) {
      const mapped = mapObservation(row);
      const entityId = mapped.mobilityEntityId;
      if (entityId === null) continue;
      const list = grouped.get(entityId) ?? [];
      list.push(mapped);
      grouped.set(entityId, list);
    }
    const states = [...grouped.keys()]
      .sort()
      .map((entityId) =>
        this.projector.project(
          entityId,
          grouped.get(entityId) ?? [],
          input.stateCutoffAt,
        ),
      );
    const stateRows = states.map((state) => ({
      ...state,
      stateFingerprint: this.projector.fingerprint(state),
    }));
    const canonicalConfiguration = canonicalValue(
      input.configuration,
    ) as Record<string, unknown>;
    const contentHash = hash({
      transitDatasetVersionId: input.transitDatasetVersionId,
      spatialDatasetVersionId: input.spatialDatasetVersionId,
      processingVersion: input.processingVersion,
      stateCutoffAt: input.stateCutoffAt.toISOString(),
      configuration: canonicalConfiguration,
      manifestRef: input.manifestRef,
      states: stateRows,
    });
    const snapshotId = stableUuid('network-snapshot', contentHash);
    return this.database.transaction().execute(async (transaction) => {
      const inserted = await sql<{ id: string }>`
        insert into twin.network_snapshot (
          id, transit_dataset_version_id, spatial_dataset_version_id, processing_version,
          state_cutoff_at, configuration_json, manifest_ref, content_hash, status
        ) values (
          ${snapshotId}::uuid, ${input.transitDatasetVersionId}::uuid,
          ${input.spatialDatasetVersionId}::uuid, ${input.processingVersion},
          ${input.stateCutoffAt.toISOString()}::timestamptz,
          ${canonicalJson(canonicalConfiguration)}::jsonb, ${input.manifestRef}, ${contentHash}, 'DRAFT'
        ) on conflict (content_hash) do nothing returning id
      `.execute(transaction);
      const existingId = inserted.rows[0]?.id ?? snapshotId;
      if (inserted.rows[0] === undefined)
        return this.loadSnapshot(transaction, existingId);
      for (const state of stateRows) {
        await sql`
          insert into twin.network_snapshot_state (
            id, snapshot_id, mobility_entity_id, operational_state, evidence_type,
            freshness_status, observation_id, source_id, observed_at, expires_at,
            confidence_status, confidence, provenance_ref, state_as_of, state_fingerprint
          ) values (
            ${stableUuid('network-snapshot-state', `${snapshotId}:${state.mobilityEntityId}`)}::uuid,
            ${snapshotId}::uuid, ${state.mobilityEntityId}::uuid, ${state.operationalState},
            ${state.evidenceType}, ${state.freshnessStatus}, ${state.observationId}::uuid,
            ${state.sourceId}::uuid, ${state.observedAt}::timestamptz, ${state.expiresAt}::timestamptz,
            ${state.confidenceStatus}, ${state.confidence}, ${state.provenanceRef},
            ${state.stateAsOf}::timestamptz, ${state.stateFingerprint}
          )
        `.execute(transaction);
      }
      await sql`
        update twin.network_snapshot set status='FINALIZED', finalized_at=now()
        where id=${snapshotId}::uuid
      `.execute(transaction);
      return this.loadSnapshot(transaction, snapshotId);
    });
  }

  async getSnapshot(snapshotId: string): Promise<NetworkSnapshot> {
    return this.loadSnapshot(this.database, snapshotId);
  }

  private async loadSnapshot(
    database: Kysely<FoundationDatabase>,
    snapshotId: string,
  ): Promise<NetworkSnapshot> {
    const result = await sql<SnapshotRow>`
      select s.id as "snapshotId", s.transit_dataset_version_id as "transitDatasetVersionId",
        s.spatial_dataset_version_id as "spatialDatasetVersionId", s.processing_version as "processingVersion",
        s.state_cutoff_at as "stateCutoffAt", s.configuration_json as configuration,
        s.manifest_ref as "manifestRef", s.content_hash as "contentHash", s.status,
        s.created_at as "createdAt", s.finalized_at as "finalizedAt",
        count(ss.id)::int as "materializedStateCount"
      from twin.network_snapshot s left join twin.network_snapshot_state ss on ss.snapshot_id=s.id
      where s.id=${snapshotId}::uuid
      group by s.id
    `.execute(database);
    const row = result.rows[0];
    if (row === undefined)
      throw new Error(`Network snapshot not found: ${snapshotId}`);
    return mapSnapshot(row);
  }

  async projectStateInTransaction(
    transaction: Kysely<FoundationDatabase>,
    entityId: string,
    asOf: Date,
  ): Promise<EffectiveMobilityState> {
    await sql`select pg_advisory_xact_lock(hashtext(${entityId}))`.execute(
      transaction,
    );
    const observations = await this.loadObservations(
      entityId,
      asOf,
      transaction,
    );
    const state = this.projector.project(entityId, observations, asOf);
    const previous = await sql<{
      operationalState: EffectiveMobilityState['operationalState'];
    }>`
      select operational_state as "operationalState"
      from twin.mobility_state
      where mobility_entity_id=${entityId}::uuid
      for update
    `.execute(transaction);
    const previousState = previous.rows[0]?.operationalState ?? null;
    const stateFingerprint = this.projector.fingerprint(state);
    await sql`
      insert into twin.mobility_state (
        id, mobility_entity_id, operational_state, evidence_type, freshness_status,
        observation_id, source_id, observed_at, expires_at, confidence_status,
        confidence, provenance_ref, state_as_of, projection_version, state_fingerprint
      ) values (
        ${stableUuid('mobility-current-state', entityId)}::uuid, ${entityId}::uuid,
        ${state.operationalState}, ${state.evidenceType}, ${state.freshnessStatus},
        ${state.observationId}::uuid, ${state.sourceId}::uuid, ${state.observedAt}::timestamptz,
        ${state.expiresAt}::timestamptz, ${state.confidenceStatus}, ${state.confidence},
        ${state.provenanceRef}, ${state.stateAsOf}::timestamptz, ${state.projectionVersion},
        ${stateFingerprint}
      )
      on conflict (mobility_entity_id) do update set
        operational_state=excluded.operational_state,
        evidence_type=excluded.evidence_type,
        freshness_status=excluded.freshness_status,
        observation_id=excluded.observation_id,
        source_id=excluded.source_id,
        observed_at=excluded.observed_at,
        expires_at=excluded.expires_at,
        confidence_status=excluded.confidence_status,
        confidence=excluded.confidence,
        provenance_ref=excluded.provenance_ref,
        state_as_of=excluded.state_as_of,
        projection_version=excluded.projection_version,
        updated_at=now(),
        state_fingerprint=excluded.state_fingerprint
    `.execute(transaction);
    if (previousState !== state.operationalState) {
      const effectiveAt = state.observedAt ?? state.stateAsOf;
      const transitionFingerprint = this.projector.transitionFingerprint(
        entityId,
        previousState,
        state,
      );
      await sql`
        insert into twin.mobility_state_history (
          id, mobility_entity_id, previous_state, new_state, effective_at,
          triggering_observation_id, evidence_type, freshness_status, source_id,
          provenance_ref, reason, projection_version, transition_fingerprint
        ) values (
          ${stableUuid('mobility-state-history', transitionFingerprint)}::uuid,
          ${entityId}::uuid, ${previousState}, ${state.operationalState},
          ${effectiveAt}::timestamptz, ${state.observationId}::uuid, ${state.evidenceType},
          ${state.freshnessStatus}, ${state.sourceId}::uuid, ${state.provenanceRef},
          ${state.reason}, ${state.projectionVersion}, ${transitionFingerprint}
        ) on conflict (transition_fingerprint) do nothing
      `.execute(transaction);
    }
    return state;
  }

  private async loadObservations(
    entityIds: string | readonly string[],
    asOf?: Date,
    database: Kysely<FoundationDatabase> = this.database,
  ): Promise<readonly PersistedOperationalObservation[]> {
    const ids = typeof entityIds === 'string' ? [entityIds] : entityIds;
    const cutoff = asOf?.toISOString() ?? null;
    const result = await sql<ObservationRow>`
      select id, incident_id as "incidentId", mobility_entity_id as "mobilityEntityId",
        source_id as "sourceId", source_classification as "sourceClassification",
        affected_entity_refs as "affectedEntityRefs", affected_modes as "affectedModes",
        incident_type as "incidentType", operational_state as "operationalState",
        evidence_type as "evidenceType", source_authority as "sourceAuthority",
        source_channel as "sourceChannel", impact_basis as "impactBasis",
        observed_at as "observedAt", received_at as "receivedAt", updated_at as "updatedAt",
        expires_at as "expiresAt", reason, confidence_status as "confidenceStatus", confidence,
        raw_reference as "rawReference", lineage_reference as "lineageReference",
        retrieved_at as "retrievedAt", source_attributes as "sourceAttributes"
      from twin.operational_observation observation
      where mobility_entity_id = any(${ids}::uuid[])
        and (${cutoff}::timestamptz is null or (
          observed_at <= ${cutoff}::timestamptz and
          received_at <= ${cutoff}::timestamptz
        ))
        and not exists (
          select 1 from disruption.operational_incident incident
          where incident.id=observation.incident_id
            and not (
              coalesce((
                select journal.lifecycle_status
                from disruption.operational_incident_journal journal
                where journal.incident_id=incident.id
                  and (${cutoff}::timestamptz is null or journal.changed_at <= ${cutoff}::timestamptz)
                order by journal.changed_at desc, journal.revision desc
                limit 1
              ), 'INGESTED_UNVERIFIED') = 'VERIFIED_ACTIVE'
              and incident.effective_from <= coalesce(${cutoff}::timestamptz, now())
              and incident.expires_at > coalesce(${cutoff}::timestamptz, now())
              and (incident.effective_to is null or incident.effective_to > coalesce(${cutoff}::timestamptz, now()))
            )
        )
      order by mobility_entity_id, observed_at asc, received_at asc, id asc
    `.execute(database);
    return result.rows.map(mapObservation);
  }
}
