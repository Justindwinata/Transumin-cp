import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import type {
  AcceptRecoveryInput,
  RecoveryRepositoryPort,
} from '../application/recovery.repository.port.js';
import type {
  RecoveryAcceptance,
  RecoveryImpact,
  RecoveryProposal,
} from '../domain/recovery.js';
import { RecoveryError } from '../domain/recovery.js';

@Injectable()
export class KyselyRecoveryRepository implements RecoveryRepositoryPort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async findByIdempotency(
    ownerRef: string,
    idempotencyKey: string,
  ): Promise<RecoveryProposal | null> {
    const result = await sql<{ proposal: RecoveryProposal }>`
      select comparison_json as proposal from recovery.recovery_plan
      where owner_ref=${ownerRef} and idempotency_key=${idempotencyKey}
    `.execute(this.database);
    return result.rows[0]?.proposal ?? null;
  }

  async getCurrentImpact(
    impactId: string,
    journeyId: string,
    ownerRef: string,
  ): Promise<RecoveryImpact | null> {
    // Legacy original dependency graph joins the union bound to the live pointer.
    const result = await sql<RecoveryImpact>`
      (select distinct i.id as "impactId", i.journey_id as "journeyId",
        i.mobility_entity_id as "mobilityEntityId",
        i.state_transition_id as "stateTransitionId",
        i.operational_state as "operationalState",
        i.projection_version as "projectionVersion",
        i.provenance_ref as "provenanceRef"
      from journey.journey_impact i
      join journey.journey_plan p on p.id=i.journey_id
      join journey.active_journey a on a.journey_id=i.journey_id
      join journey.journey_progress pr on pr.journey_id=i.journey_id
      join journey.journey_impact_dependency x on x.impact_id=i.id
      join journey.journey_dependency d on d.id=x.dependency_id
      where i.id=${impactId}::uuid and i.journey_id=${journeyId}::uuid
        and p.owner_ref=${ownerRef} and a.lifecycle_status='ACTIVE'
        and a.accepted_recovery_id is null
        and i.impact_status='BLOCKING' and i.resolved_at is null
        and (i.expires_at is null or i.expires_at > now())
        and d.leg_sequence >= pr.completed_leg_count)
      union all
      (select distinct i.id as "impactId", i.journey_id as "journeyId",
        i.mobility_entity_id as "mobilityEntityId",
        i.state_transition_id as "stateTransitionId",
        i.operational_state as "operationalState",
        i.projection_version as "projectionVersion",
        i.provenance_ref as "provenanceRef"
      from journey.journey_impact i
      join journey.journey_plan p on p.id=i.journey_id
      join journey.active_journey a on a.journey_id=i.journey_id
      join journey.journey_progress pr on pr.journey_id=i.journey_id
      join journey.current_impact_dependency x on x.impact_id=i.id
      join journey.active_journey_dependency d on d.id=x.dependency_id
      where i.id=${impactId}::uuid and i.journey_id=${journeyId}::uuid
        and p.owner_ref=${ownerRef} and a.lifecycle_status='ACTIVE'
        and d.recovery_id=a.accepted_recovery_id
        and i.impact_status='BLOCKING' and i.resolved_at is null
        and (i.expires_at is null or i.expires_at > now())
        and d.leg_sequence >= pr.completed_leg_count)
      limit 1
    `.execute(this.database);
    return result.rows[0] ?? null;
  }

  async save(
    proposal: RecoveryProposal,
    idempotencyKey: string,
  ): Promise<RecoveryProposal> {
    return this.database.transaction().execute(async (transaction) => {
      const inserted = await sql<{ id: string }>`
        insert into recovery.recovery_plan (
          id, active_journey_id, impact_id, owner_ref, idempotency_key,
          method, status, progress_revision, completed_leg_count,
          recovery_anchor_name, recovery_anchor_lat, recovery_anchor_lon,
          recovery_at, network_snapshot_id, mobility_projection_version,
          original_journey_fingerprint, proposed_fingerprint, baseline_fingerprint,
          preserved_leg_count, eligible_remaining_leg_count, changed_leg_count,
          added_travel_time_seconds, added_transfers, plan_change_count,
          disrupted_entity_avoided, state_validation_ms,
          preservation_processing_ms, proposed_routing_ms, baseline_routing_ms,
          total_computation_ms, triggering_entity_id, state_transition_id,
          reason, proposed_journey_json, baseline_journey_json, comparison_json
        ) values (
          ${proposal.recoveryId}::uuid, ${proposal.activeJourneyId}::uuid,
          ${proposal.impactId}::uuid, ${proposal.ownerRef}, ${idempotencyKey},
          ${proposal.method}, ${proposal.status}, ${proposal.progressRevision},
          ${proposal.completedLegCount}, ${proposal.recoveryAnchor.name},
          ${proposal.recoveryAnchor.point.latitude}, ${proposal.recoveryAnchor.point.longitude},
          ${proposal.recoveryAt}::timestamptz, ${proposal.networkSnapshotId}::uuid,
          ${proposal.mobilityProjectionVersion}, ${proposal.originalJourneyFingerprint},
          ${proposal.proposedFingerprint}, ${proposal.baselineFingerprint},
          ${proposal.metrics.preservedLegCount},
          ${proposal.metrics.eligibleRemainingLegCount},
          ${proposal.metrics.changedLegCount},
          ${proposal.metrics.addedTravelTimeSeconds}, ${proposal.metrics.addedTransfers},
          ${proposal.metrics.planChangeCount}, ${proposal.metrics.disruptedEntityAvoidance},
          ${proposal.metrics.stateValidationMilliseconds},
          ${proposal.metrics.preservationProcessingMilliseconds},
          ${proposal.metrics.proposedRoutingMilliseconds},
          ${proposal.metrics.baselineRoutingMilliseconds},
          ${proposal.metrics.totalComputationMilliseconds},
          ${proposal.triggeringEntityId}::uuid, ${proposal.stateTransitionId}::uuid,
          ${proposal.reason}, ${JSON.stringify(proposal.proposedJourney)}::jsonb,
          ${JSON.stringify(proposal.baselineJourney)}::jsonb,
          ${JSON.stringify(proposal)}::jsonb
        ) on conflict (owner_ref, idempotency_key) do nothing returning id
      `.execute(transaction);
      if (inserted.rows[0] === undefined) {
        const existing = await sql<{
          id: string;
          requestMatches: boolean;
        }>`
          select id,
            impact_id=${proposal.impactId}::uuid
              and active_journey_id=${proposal.activeJourneyId}::uuid
              and progress_revision=${proposal.progressRevision}
              and recovery_at=${proposal.recoveryAt}::timestamptz
              and coalesce(comparison_json->>'baseRecoveryId', '')=
                coalesce(${proposal.baseRecoveryId ?? null}, '')
              as "requestMatches"
          from recovery.recovery_plan
          where owner_ref=${proposal.ownerRef} and idempotency_key=${idempotencyKey}
        `.execute(transaction);
        const row = existing.rows[0];
        if (row === undefined || !row.requestMatches)
          throw new RecoveryError(
            'IDEMPOTENCY_CONFLICT',
            'The idempotency key belongs to different recovery input.',
          );
        return this.get(row.id, proposal.ownerRef);
      }
      let sequence = 0;
      for (const [classification, structure, legs] of [
        ['COMPLETED', 'COMPLETED', proposal.completedLegs],
        ['STILL_VALID', 'PRESERVED', proposal.preservedLegs],
        ['INVALIDATED', 'INVALIDATED', proposal.invalidatedLegs],
        ['REPAIRED_REPLACED', 'REPAIRED', proposal.repairedLegs],
        ['STILL_VALID', 'REJOINED', proposal.rejoinedLegs],
      ] as const)
        for (const leg of legs) {
          await sql`
            insert into recovery.recovery_segment (
              id, recovery_id, sequence, classification,
              original_leg_sequence, result_leg_json
            ) values (
              ${stableUuid('recovery-segment', `${proposal.recoveryId}:${sequence}`)}::uuid,
              ${proposal.recoveryId}::uuid, ${sequence}, ${classification},
              ${structure === 'REPAIRED' ? null : leg.sequence},
              ${JSON.stringify({ ...leg, recoveryStructure: structure })}::jsonb
            )
          `.execute(transaction);
          sequence += 1;
        }
      return proposal;
    });
  }

  async get(recoveryId: string, ownerRef: string): Promise<RecoveryProposal> {
    const result = await sql<{ ownerRef: string; proposal: RecoveryProposal }>`
      select owner_ref as "ownerRef", comparison_json as proposal
      from recovery.recovery_plan where id=${recoveryId}::uuid
    `.execute(this.database);
    const row = result.rows[0];
    if (row === undefined || row.ownerRef !== ownerRef)
      throw new RecoveryError(
        'RECOVERY_NOT_FOUND',
        'Recovery proposal not found.',
      );
    return row.proposal;
  }

  /**
   * ponytail: acceptance pointer lives beside the immutable plan. Original
   * journey_plan/journey_leg/progress/confirmation/event history stay untouched;
   * upgrade path is a separate current-itinerary snapshot table if acceptance
   * divergence grows beyond a recovery pointer.
   */
  async accept(input: AcceptRecoveryInput): Promise<RecoveryAcceptance> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`
        select pg_advisory_xact_lock(hashtext(${`accept:${input.ownerRef}:${input.idempotencyKey}`}))
      `.execute(transaction);
      const duplicate = await sql<{
        acceptance: RecoveryAcceptance;
        payloadMatches: boolean;
      }>`
        select acceptance_json as acceptance,
          accepted_journey_fingerprint=${input.acceptedJourneyFingerprint}
            and accepted_journey_json=${JSON.stringify(input.acceptedJourney)}::jsonb
            as "payloadMatches"
        from recovery.recovery_acceptance
        where owner_ref=${input.ownerRef}
          and idempotency_key=${input.idempotencyKey}
        for update
      `.execute(transaction);
      const duplicateRow = duplicate.rows[0];
      const recorded = duplicateRow?.acceptance ?? null;
      if (recorded !== null) {
        if (recorded.recoveryId !== input.recoveryId)
          throw new RecoveryError(
            'IDEMPOTENCY_CONFLICT',
            'The acceptance idempotency key belongs to a different recovery proposal.',
          );
        if (
          recorded.acceptedProgressRevision !== input.progressRevision ||
          recorded.acceptedJourneyFingerprint !==
            input.acceptedJourneyFingerprint ||
          duplicateRow?.payloadMatches !== true
        )
          throw new RecoveryError(
            'IDEMPOTENCY_CONFLICT',
            'The acceptance idempotency key belongs to a different acceptance request.',
          );
        return recorded;
      }
      const candidate = await sql<{
        ownerRef: string;
        impactId: string;
        progressRevision: number;
        projectionVersion: string;
        transitionId: string;
        baseRecoveryId: string | null;
      }>`
        select owner_ref as "ownerRef", impact_id as "impactId",
          progress_revision as "progressRevision",
          mobility_projection_version as "projectionVersion",
          state_transition_id as "transitionId",
          coalesce(comparison_json->>'baseRecoveryId', null) as "baseRecoveryId"
        from recovery.recovery_plan
        where id=${input.recoveryId}::uuid
        for update
      `.execute(transaction);
      const plan = candidate.rows[0];
      // Legacy G0 fixtures omit baseRecoveryId; absent means the original
      // generation, never an unknown.
      const persistedProposalBase = plan?.baseRecoveryId ?? null;
      if (plan === undefined || plan.ownerRef !== input.ownerRef)
        throw new RecoveryError(
          'RECOVERY_NOT_FOUND',
          'Recovery proposal not found.',
        );
      const acceptedForRecovery = await sql<{ idempotencyKey: string }>`
        select idempotency_key as "idempotencyKey"
        from recovery.recovery_acceptance
        where recovery_id=${input.recoveryId}::uuid
        for update
      `.execute(transaction);
      const recordedForRecovery = acceptedForRecovery.rows[0];
      if (
        recordedForRecovery !== undefined &&
        recordedForRecovery.idempotencyKey !== input.idempotencyKey
      )
        throw new RecoveryError(
          'IDEMPOTENCY_CONFLICT',
          'This recovery proposal was already accepted under a different idempotency key.',
        );
      const locked = await sql<{
        lifecycleStatus: string;
        acceptedRecoveryId: string | null;
        completedLegCount: number;
        revision: number;
        recordedAt: Date;
        boardingLeg: number | null;
        boardingAt: Date | null;
        alightingLeg: number | null;
        alightingAt: Date | null;
      }>`
        select a.lifecycle_status as "lifecycleStatus",
          a.accepted_recovery_id as "acceptedRecoveryId",
          pr.completed_leg_count as "completedLegCount",
          pr.revision, pr.recorded_at as "recordedAt",
          pr.boarding_confirmed_leg_sequence as "boardingLeg",
          pr.boarding_confirmed_at as "boardingAt",
          pr.alighting_confirmed_leg_sequence as "alightingLeg",
          pr.alighting_confirmed_at as "alightingAt"
        from journey.active_journey a
        join journey.journey_plan p on p.id=a.journey_id
        join journey.journey_progress pr on pr.journey_id=a.journey_id
        where a.journey_id=(
          select active_journey_id from recovery.recovery_plan
          where id=${input.recoveryId}::uuid
        )
          and p.owner_ref=${input.ownerRef}
        for update of a, pr
      `.execute(transaction);
      const journey = locked.rows[0];
      if (
        journey === undefined ||
        journey.lifecycleStatus !== 'ACTIVE' ||
        journey.revision !== plan.progressRevision ||
        journey.revision !== input.progressRevision ||
        journey.acceptedRecoveryId !== persistedProposalBase
      )
        throw new RecoveryError(
          'RECOVERY_STALE',
          'The journey progressed since this proposal was computed; request a fresh recovery.',
        );
      const impact = await sql<{
        entityId: string;
        transitionId: string;
        projectionVersion: string;
        operationalState: string;
      }>`
        select i.mobility_entity_id as "entityId",
          i.state_transition_id as "transitionId",
          i.projection_version as "projectionVersion",
          i.operational_state as "operationalState"
        from journey.journey_impact i
        where i.id=${plan.impactId}::uuid
          and i.resolved_at is null
          and (i.expires_at is null or i.expires_at > now())
          and i.impact_status='BLOCKING'
        for update
      `.execute(transaction);
      const activeImpact = impact.rows[0];
      if (
        activeImpact === undefined ||
        activeImpact.transitionId !== plan.transitionId ||
        activeImpact.projectionVersion !== plan.projectionVersion
      )
        throw new RecoveryError(
          'RECOVERY_STALE',
          'The triggering impact resolved or changed since this proposal was computed.',
        );
      if (input.acceptedJourney === null)
        throw new RecoveryError(
          'RECOVERY_NOT_ACCEPTABLE',
          'Only a completed proposal with a proposed journey can be accepted.',
        );
      const entityIds = [
        ...new Set(
          input.acceptedJourney.legs.flatMap((leg) =>
            leg.entityBindings.flatMap((binding) =>
              binding.mobilityEntityId === null
                ? []
                : [binding.mobilityEntityId],
            ),
          ),
        ),
      ].sort();
      if (entityIds.length > 0) {
        const blocked = await sql<{ entityId: string }>`
          select mobility_entity_id as "entityId" from twin.mobility_state
          where mobility_entity_id = any(${entityIds}::uuid[])
            and operational_state='UNAVAILABLE'
            and freshness_status not in ('EXPIRED','NOT_YET_VALID')
        `.execute(transaction);
        const blockedSet = new Set(blocked.rows.map((row) => row.entityId));
        if (blockedSet.size > 0)
          throw new RecoveryError(
            'RECOVERY_CANDIDATE_BLOCKED',
            'The proposed replacement now depends on a currently unavailable canonical entity; request a fresh recovery.',
          );
      }
      const acceptance: RecoveryAcceptance = {
        recoveryId: input.recoveryId,
        activeJourneyId: (
          await sql<{ journeyId: string }>`
          select active_journey_id as "journeyId"
          from recovery.recovery_plan where id=${input.recoveryId}::uuid
        `.execute(transaction)
        ).rows[0]!.journeyId,
        ownerRef: plan.ownerRef,
        predecessorRecoveryId: persistedProposalBase,
        acceptedProgressRevision: input.progressRevision,
        acceptedImpactId: plan.impactId,
        acceptedStateTransitionId: plan.transitionId,
        acceptedMobilityProjectionVersion: plan.projectionVersion,
        acceptedJourneyFingerprint: input.acceptedJourneyFingerprint,
        acceptedJourney: input.acceptedJourney,
        acceptedAt: input.acceptedAt,
      };
      await sql`
        insert into recovery.recovery_acceptance (
          recovery_id, owner_ref, idempotency_key, active_journey_id,
          accepted_progress_revision, accepted_impact_id,
          accepted_state_transition_id, accepted_projection_version,
          accepted_journey_fingerprint, accepted_journey_json,
          accepted_at, acceptance_json
        ) values (
          ${input.recoveryId}::uuid, ${input.ownerRef}, ${input.idempotencyKey},
          ${acceptance.activeJourneyId}::uuid, ${input.progressRevision},
          ${plan.impactId}::uuid, ${plan.transitionId}::uuid,
          ${plan.projectionVersion}, ${input.acceptedJourneyFingerprint},
          ${JSON.stringify(input.acceptedJourney)}::jsonb,
          ${input.acceptedAt}::timestamptz, ${JSON.stringify(acceptance)}::jsonb
        ) on conflict (owner_ref, idempotency_key) do nothing
      `.execute(transaction);
      const conflict = await sql<{ recoveryId: string }>`
        select recovery_id as "recoveryId" from recovery.recovery_acceptance
        where owner_ref=${input.ownerRef} and idempotency_key=${input.idempotencyKey}
      `.execute(transaction);
      if (conflict.rows[0]?.recoveryId !== input.recoveryId)
        throw new RecoveryError(
          'IDEMPOTENCY_CONFLICT',
          'The acceptance idempotency key belongs to a different recovery proposal.',
        );
      await sql`
        update journey.active_journey set
          accepted_recovery_id=${input.recoveryId}::uuid,
          recovery_accepted_at=${input.acceptedAt}::timestamptz,
          updated_at=now()
        where journey_id=${acceptance.activeJourneyId}::uuid
      `.execute(transaction);
      await sql`
        insert into journey.journey_state_event (
          id, journey_id, event_type, occurred_at, event_fingerprint, payload_json
        ) values (
          ${stableUuid('recovery-acceptance-event', `${input.recoveryId}:${input.acceptedAt}`)}::uuid,
          ${acceptance.activeJourneyId}::uuid, 'RECOVERY_ACCEPTED',
          ${input.acceptedAt}::timestamptz,
          ${`RECOVERY_ACCEPTED:${input.recoveryId}:${input.acceptedAt}`},
          ${JSON.stringify({
            recoveryId: input.recoveryId,
            progressRevision: input.progressRevision,
            acceptedJourneyFingerprint: input.acceptedJourneyFingerprint,
          })}::jsonb
        ) on conflict (event_fingerprint) do nothing
      `.execute(transaction);
      const persisted = await sql<{ acceptance: RecoveryAcceptance }>`
        select acceptance_json as acceptance from recovery.recovery_acceptance
        where recovery_id=${input.recoveryId}::uuid
      `.execute(transaction);
      if (persisted.rows[0] === undefined)
        throw new RecoveryError(
          'RECOVERY_NOT_ACCEPTABLE',
          'Recovery acceptance was not persisted.',
        );
      return persisted.rows[0].acceptance;
    });
  }

  async findAcceptance(
    recoveryId: string,
    ownerRef: string,
  ): Promise<RecoveryAcceptance | null> {
    const result = await sql<{
      ownerRef: string;
      acceptance: RecoveryAcceptance;
    }>`
      select owner_ref as "ownerRef", acceptance_json as acceptance
      from recovery.recovery_acceptance where recovery_id=${recoveryId}::uuid
    `.execute(this.database);
    const row = result.rows[0];
    if (row === undefined || row.ownerRef !== ownerRef) return null;
    return row.acceptance;
  }

  async findAcceptanceByIdempotency(
    ownerRef: string,
    idempotencyKey: string,
  ): Promise<RecoveryAcceptance | null> {
    const result = await sql<{ acceptance: RecoveryAcceptance }>`
      select acceptance_json as acceptance
      from recovery.recovery_acceptance
      where owner_ref=${ownerRef} and idempotency_key=${idempotencyKey}
    `.execute(this.database);
    return result.rows[0]?.acceptance ?? null;
  }
}
