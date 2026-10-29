import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type {
  IncidentIngestResult,
  IncidentLifecyclePort,
  IncidentTerminalTransitionInput,
} from '../../operational-data/application/incident-lifecycle.port.js';
import {
  OperationalIncidentService,
  OperationalIncidentServiceError,
  type IncidentVerification,
} from '../../operational-data/application/operational-incident.service.js';
import type {
  IncidentEvidenceInput,
  IncidentLifecycleStatus,
  PersistedIncidentProjection,
} from '../../operational-data/domain/hazard-incident.js';
import type { EffectiveMobilityState } from '../../mobility-twin/domain/mobility-twin.js';
import { KyselyMobilityStateRepository } from '../../mobility-twin/infrastructure/kysely-mobility-state.repository.js';
import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import { OperationalEventBus } from '../application/operational-event-bus.js';

type IncidentRow = Readonly<{
  id: string;
  lifecycleStatus: IncidentLifecycleStatus;
  sourceClass: PersistedIncidentProjection['sourceClass'];
  operationalState: PersistedIncidentProjection['operationalState'];
  observedAt: Date;
  receivedAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  provenanceRef: string;
  evidenceType: PersistedIncidentProjection['evidenceType'];
}>;

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function projection(row: IncidentRow): PersistedIncidentProjection {
  return {
    observationId: row.id,
    incidentId: row.id,
    lifecycleStatus: row.lifecycleStatus,
    sourceClass: row.sourceClass,
    observedAt: row.observedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    provenanceRef: row.provenanceRef,
    operationalState: row.operationalState,
    evidenceType: row.evidenceType,
  };
}

@Injectable()
export class KyselyIncidentLifecycleRepository implements IncidentLifecyclePort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
    @Inject(OperationalIncidentService)
    private readonly incidents: OperationalIncidentService,
    @Inject(KyselyMobilityStateRepository)
    private readonly states: KyselyMobilityStateRepository,
    @Inject(OperationalEventBus)
    private readonly events: OperationalEventBus,
  ) {}

  async ingest(
    input: IncidentEvidenceInput,
    verification: IncidentVerification,
    asOf: Date = new Date(),
  ): Promise<IncidentIngestResult> {
    const plan = this.incidents.planEvidence(input, verification);
    const entityIds = plan.observations.map((item) => item.mobilityEntityId);
    const entityTypes = await this.loadEntityTypes(entityIds);
    for (const entityId of entityIds) {
      const entityType = entityTypes.get(entityId);
      if (!['ROUTE', 'STOP', 'STATION'].includes(entityType ?? ''))
        throw new OperationalIncidentServiceError({
          code: 'INCIDENT_ENTITY_UNKNOWN',
          message: `Incident entity ${entityId} is missing or has unsupported type ${entityType ?? 'UNKNOWN'}.`,
        });
    }

    const transactionResult = await this.database
      .transaction()
      .execute(async (transaction) => {
        const conflicts = await sql<{ id: string; evidenceIdentity: string }>`
        select id, evidence_identity as "evidenceIdentity"
        from disruption.operational_incident
        where id=${input.incidentId}::uuid or evidence_identity=${plan.identity}
        for update
      `.execute(transaction);
        const conflict = conflicts.rows.find(
          (row) =>
            row.id !== input.incidentId ||
            row.evidenceIdentity !== plan.identity,
        );
        if (conflict)
          throw new OperationalIncidentServiceError({
            code: 'INCIDENT_IDENTITY_CONFLICT',
            message: `Incident ${input.incidentId} already exists with different evidence.`,
          });
        let alreadyPersisted = conflicts.rows.length > 0;

        const insertedIncident = await sql<{ id: string }>`
        insert into disruption.operational_incident (
          id, incident_type, lifecycle_status, source_class, source_id,
          source_authority, source_channel, evidence_type, operational_state,
          observed_at, effective_from, effective_to, expires_at, received_at,
          reason, provenance_ref, raw_reference, supporting_hazard_event_id,
          evidence_identity
        ) values (
          ${input.incidentId}::uuid, ${input.incidentType}, ${plan.lifecycleStatus},
          ${input.sourceClass}, ${input.sourceId}::uuid, ${input.sourceAuthority},
          ${input.sourceChannel}, ${input.evidenceType}, ${input.operationalState},
          ${input.observedAt}::timestamptz, ${input.effectiveFrom}::timestamptz,
          null, ${input.expiresAt}::timestamptz, ${input.receivedAt}::timestamptz,
          ${input.reason}, ${input.provenanceRef}, ${input.rawReference},
          ${input.supportingHazardEventId}::uuid, ${plan.identity}
        ) on conflict do nothing returning id
      `.execute(transaction);
        if (!alreadyPersisted && insertedIncident.rows[0] === undefined) {
          const concurrent = await sql<{
            id: string;
            evidenceIdentity: string;
          }>`
            select id, evidence_identity as "evidenceIdentity"
            from disruption.operational_incident
            where id=${input.incidentId}::uuid or evidence_identity=${plan.identity}
          `.execute(transaction);
          if (
            concurrent.rows.some(
              (row) =>
                row.id !== input.incidentId ||
                row.evidenceIdentity !== plan.identity,
            ) ||
            concurrent.rows.length === 0
          )
            throw new OperationalIncidentServiceError({
              code: 'INCIDENT_IDENTITY_CONFLICT',
              message: `Incident ${input.incidentId} conflicted with concurrent evidence.`,
            });
          alreadyPersisted = true;
        }

        const observationIds: string[] = [];
        const insertedObservationIds: string[] = [];
        for (const item of plan.observations) {
          const persisted = await this.states.persistObservationInTransaction(
            transaction,
            item.observation,
            item.mobilityEntityId,
          );
          observationIds.push(persisted.observationId);
          if (persisted.status === 'INSERTED')
            insertedObservationIds.push(persisted.observationId);
          for (const mode of new Set(input.affectedModes))
            await sql`
            insert into disruption.operational_incident_entity (
              incident_id, mobility_entity_id, entity_type, mode
            ) values (
              ${input.incidentId}::uuid, ${item.mobilityEntityId}::uuid,
              ${entityTypes.get(item.mobilityEntityId)}, ${mode}
            ) on conflict do nothing
          `.execute(transaction);
        }

        await sql`
        insert into disruption.operational_incident_journal (
          id, incident_id, revision, lifecycle_status, changed_at, reason,
          provenance_ref, observation_id, hazard_event_id, entry_identity
        ) values (
          ${stableUuid('x1a-journal', `${plan.identity}:1`)}::uuid,
          ${input.incidentId}::uuid, 1, ${plan.lifecycleStatus},
          ${input.receivedAt}::timestamptz, ${input.reason}, ${input.provenanceRef},
          ${observationIds[0]}::uuid, ${input.supportingHazardEventId}::uuid,
          ${hash(['journal', plan.identity, '1'])}
        ) on conflict do nothing
      `.execute(transaction);

        const projections: EffectiveMobilityState[] = [];
        if (!alreadyPersisted || insertedObservationIds.length > 0)
          for (const entityId of entityIds)
            projections.push(
              await this.states.projectStateInTransaction(
                transaction,
                entityId,
                asOf,
              ),
            );
        return { alreadyPersisted, observationIds, projections };
      });

    this.publishChanges(input.incidentId, transactionResult.projections);
    return {
      incidentId: input.incidentId,
      evidenceIdentity: plan.identity,
      status: transactionResult.alreadyPersisted
        ? 'ALREADY_PERSISTED'
        : 'INSERTED',
      observationIds: transactionResult.observationIds,
      projectedEntityIds: entityIds,
    };
  }

  async transition(
    input: IncidentTerminalTransitionInput,
  ): Promise<PersistedIncidentProjection> {
    const changedAt = new Date(input.changedAt);
    if (
      !Number.isFinite(changedAt.getTime()) ||
      input.reason.trim() === '' ||
      input.provenanceRef.trim() === ''
    )
      throw new OperationalIncidentServiceError({
        code: 'INCIDENT_INPUT_INVALID',
        message:
          'Lifecycle transition requires valid changedAt, reason, and provenance.',
      });

    const transactionResult = await this.database
      .transaction()
      .execute(async (transaction) => {
        const current = await this.loadIncident(
          input.incidentId,
          transaction,
          true,
        );
        if (current === null)
          throw new OperationalIncidentServiceError({
            code: 'INCIDENT_NOT_FOUND',
            message: `Incident ${input.incidentId} does not exist.`,
          });
        const latestJournal = await sql<{ changedAt: Date; revision: number }>`
          select changed_at as "changedAt", revision
          from disruption.operational_incident_journal
          where incident_id=${input.incidentId}::uuid
          order by revision desc
          limit 1
          for update
        `.execute(transaction);
        const latest = latestJournal.rows[0];
        if (
          latest !== undefined &&
          changedAt.getTime() < latest.changedAt.getTime()
        )
          throw new OperationalIncidentServiceError({
            code: 'INCIDENT_INPUT_INVALID',
            message:
              'Lifecycle transition cannot predate the latest accepted journal transition.',
          });
        const transition = this.incidents.planTransition({
          ...input,
          fromStatus: current.lifecycleStatus,
          observationId: null,
          hazardEventId: null,
        });
        const revisionResult = await sql<{ revision: number }>`
        select coalesce(max(revision), 0)::int + 1 as revision
        from disruption.operational_incident_journal
        where incident_id=${input.incidentId}::uuid
      `.execute(transaction);
        const revision = revisionResult.rows[0]?.revision ?? 1;
        await sql`
        update disruption.operational_incident
        set lifecycle_status=${input.toStatus}, updated_at=${input.changedAt}::timestamptz
        where id=${input.incidentId}::uuid
      `.execute(transaction);
        await sql`
        insert into disruption.operational_incident_journal (
          id, incident_id, revision, lifecycle_status, changed_at, reason,
          provenance_ref, observation_id, hazard_event_id, entry_identity
        ) values (
          ${transition.journalId}::uuid, ${input.incidentId}::uuid, ${revision},
          ${input.toStatus}, ${input.changedAt}::timestamptz, ${input.reason},
          ${input.provenanceRef}, null, null,
          ${hash(['journal', input.incidentId, input.toStatus, input.changedAt])}
        )
      `.execute(transaction);
        const entityIds = await this.loadEntityIds(
          input.incidentId,
          transaction,
        );
        const projections: EffectiveMobilityState[] = [];
        for (const entityId of entityIds)
          projections.push(
            await this.states.projectStateInTransaction(
              transaction,
              entityId,
              changedAt,
            ),
          );
        const updated = await this.loadIncident(input.incidentId, transaction);
        if (!updated) throw new Error('Incident transition readback failed');
        return { updated, projections };
      });

    this.publishChanges(input.incidentId, transactionResult.projections);
    return transactionResult.updated;
  }

  async get(incidentId: string): Promise<PersistedIncidentProjection | null> {
    return this.loadIncident(incidentId, this.database);
  }

  private publishChanges(
    incidentId: string,
    projections: readonly EffectiveMobilityState[],
  ): void {
    for (const state of projections)
      this.events.publish({
        type: 'operational.state.changed',
        entityId: state.mobilityEntityId,
        incidentId,
        observationId: state.observationId,
        evidenceType: state.evidenceType,
        operationalState: state.operationalState,
        sourceId: state.sourceId,
        metadata: {
          incident_lifecycle: true,
          freshness: state.freshnessStatus,
        },
      });
  }

  private async loadIncident(
    incidentId: string,
    database: Kysely<FoundationDatabase>,
    forUpdate = false,
  ): Promise<PersistedIncidentProjection | null> {
    const lock = forUpdate ? sql`for update` : sql``;
    const result = await sql<IncidentRow>`
      select id, lifecycle_status as "lifecycleStatus", source_class as "sourceClass",
        operational_state as "operationalState", observed_at as "observedAt",
        received_at as "receivedAt", updated_at as "updatedAt", expires_at as "expiresAt",
        effective_from as "effectiveFrom", effective_to as "effectiveTo",
        provenance_ref as "provenanceRef", evidence_type as "evidenceType"
      from disruption.operational_incident where id=${incidentId}::uuid ${lock}
    `.execute(database);
    return result.rows[0] ? projection(result.rows[0]) : null;
  }

  private async loadEntityTypes(
    entityIds: readonly string[],
  ): Promise<Map<string, string>> {
    const result = await sql<{ id: string; entityType: string }>`
      select id, entity_type as "entityType" from twin.mobility_entity
      where id = any(${entityIds}::uuid[])
    `.execute(this.database);
    return new Map(result.rows.map((row) => [row.id, row.entityType]));
  }

  private async loadEntityIds(
    incidentId: string,
    database: Kysely<FoundationDatabase>,
  ): Promise<string[]> {
    const result = await sql<{ mobilityEntityId: string }>`
      select distinct mobility_entity_id as "mobilityEntityId"
      from disruption.operational_incident_entity
      where incident_id=${incidentId}::uuid
    `.execute(database);
    return result.rows.map((row) => row.mobilityEntityId);
  }
}
