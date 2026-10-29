import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type {
  EffectiveMobilityState,
  MobilityStateHistoryRecord,
} from '../../mobility-twin/domain/mobility-twin.js';
import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import type {
  ActivateJourneyInput,
  ActiveJourneyRepositoryPort,
  ImpactProcessingResult,
  ProgressUpdateInput,
} from '../application/active-journey.repository.port.js';
import { dependencyId } from '../application/active-journey.service.js';
import type {
  ActiveJourney,
  JourneyAlert,
  JourneyDependency,
} from '../domain/active-journey.js';
import { ActiveJourneyError } from '../domain/active-journey.js';
import type { JourneyAlternative } from '../domain/journey.js';

type JourneyRow = Readonly<{
  journeyId: string;
  ownerRef: string;
  lifecycleStatus: ActiveJourney['lifecycleStatus'];
  planFingerprint: string;
  originalPlan: JourneyAlternative;
  currentPlan: JourneyAlternative | null;
  acceptedRecoveryId: string | null;
  acceptedBeforeLegCount: number | null;
  activatedAt: Date;
  completedAt: Date | null;
  completedLegCount: number;
  currentLegSequence: number | null;
  progressMethod: 'CONTROLLED_MANUAL';
  recordedAt: Date;
  revision: number;
  boardingConfirmedLegSequence: number | null;
  boardingConfirmedAt: Date | null;
  alightingConfirmedLegSequence: number | null;
  alightingConfirmedAt: Date | null;
}>;

type DependencyRow = Readonly<{
  accepted?: boolean;
  dependencyId: string;
  journeyId: string;
  legSequence: number;
  mobilityEntityId: string;
  canonicalEntityId: string;
  entityType: JourneyDependency['entityType'];
  productMode: string;
  provenanceRef: string;
}>;

type AlertRow = Readonly<{
  alertId: string;
  impactId: string;
  journeyId: string;
  ownerRef: string;
  alertType: JourneyAlert['alertType'];
  message: string;
  mobilityEntityId: string;
  operationalState: JourneyAlert['operationalState'];
  evidenceType: string | null;
  freshnessStatus: string;
  observationId: string | null;
  sourceId: string | null;
  observedAt: Date | null;
  receivedAt: Date | null;
  expiresAt: Date | null;
  provenanceRef: string | null;
  projectionVersion: string;
  createdAt: Date;
  resolvedAt: Date | null;
  affectedLegSequences: number[];
}>;

@Injectable()
export class KyselyActiveJourneyRepository implements ActiveJourneyRepositoryPort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async activate(input: ActivateJourneyInput): Promise<ActiveJourney> {
    let resolvedId = input.journeyId;
    await this.database.transaction().execute(async (transaction) => {
      const journey = input.selectedJourney;
      const activeId = input.journeyId;
      const receiptKey =
        input.idempotencyKey !== undefined &&
        input.requestFingerprint !== undefined
          ? {
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: input.requestFingerprint,
            }
          : undefined;
      if (receiptKey !== undefined) {
        // Serialize identical activation retries; the loser replays the winner's instance.
        await sql`
          select pg_advisory_xact_lock(hashtext(${`${input.ownerRef}:${receiptKey.idempotencyKey}`}))
        `.execute(transaction);
        const existing = await sql<{
          activeJourneyId: string;
          requestFingerprint: string;
        }>`
          select active_journey_id as "activeJourneyId", request_fingerprint as "requestFingerprint"
          from journey.activation_receipt
          where owner_ref=${input.ownerRef} and idempotency_key=${receiptKey.idempotencyKey}
        `.execute(transaction);
        const row = existing.rows[0];
        if (row !== undefined) {
          if (row.requestFingerprint !== receiptKey.requestFingerprint)
            throw new ActiveJourneyError(
              'ACTIVATION_CONFLICT',
              'Activation idempotency key belongs to different plan content.',
            );
          resolvedId = row.activeJourneyId;
          return;
        }
      }
      const inserted = await sql<{ id: string }>`
        insert into journey.journey_plan (
          id, owner_ref, plan_fingerprint, original_plan_json,
          origin_lat, origin_lon, destination_lat, destination_lon,
          planned_start_at, planned_end_at, routing_snapshot_id,
          routing_manifest_sha256, graph_sha256, network_snapshot_id,
          network_snapshot_hash, mobility_projection_version, service_date,
          timezone, planned_at
        ) values (
          ${activeId}::uuid, ${input.ownerRef}, ${input.planFingerprint},
          ${JSON.stringify(journey)}::jsonb,
          ${journey.origin.latitude}, ${journey.origin.longitude},
          ${journey.destination.latitude}, ${journey.destination.longitude},
          ${journey.startAt}::timestamptz, ${journey.endAt}::timestamptz,
          ${journey.routingContext.routingSnapshotId},
          ${journey.routingContext.routingManifestSha256},
          ${journey.routingContext.graphSha256},
          ${journey.routingContext.networkSnapshotId}::uuid,
          ${journey.routingContext.networkSnapshotHash},
          ${journey.routingContext.mobilityProjectionVersion},
          ${journey.routingContext.commonServiceDate}::date,
          ${journey.routingContext.timezone},
          ${journey.routingContext.plannedAt}::timestamptz
        ) on conflict do nothing returning id
      `.execute(transaction);
      if (inserted.rows[0] === undefined) {
        const existing = await sql<{ ownerRef: string; fingerprint: string }>`
          select owner_ref as "ownerRef", plan_fingerprint as fingerprint
          from journey.journey_plan where id=${activeId}::uuid
        `.execute(transaction);
        const row = existing.rows[0];
        if (
          row === undefined ||
          row.ownerRef !== input.ownerRef ||
          row.fingerprint !== input.planFingerprint
        )
          throw new ActiveJourneyError(
            'ACTIVATION_CONFLICT',
            'Journey identity already belongs to different immutable plan content or owner.',
          );
      } else {
        for (const leg of journey.legs)
          await sql`
            insert into journey.journey_leg (
              id, journey_id, sequence, mode, start_at, end_at,
              timing_precision, leg_fingerprint, original_leg_json
            ) values (
              ${stableUuid('journey-leg', `${activeId}:${leg.sequence}`)}::uuid,
              ${activeId}::uuid, ${leg.sequence}, ${leg.mode},
              ${leg.startAt}::timestamptz, ${leg.endAt}::timestamptz,
              ${leg.timingPrecision}, ${hash(leg)}, ${JSON.stringify(leg)}::jsonb
            )
          `.execute(transaction);
        for (const dependency of input.dependencies)
          await sql`
            insert into journey.journey_dependency (
              id, journey_id, leg_sequence, mobility_entity_id,
              canonical_entity_id, entity_type, product_mode, provenance_ref
            ) values (
              ${dependencyId(activeId, dependency.legSequence, dependency.mobilityEntityId)}::uuid,
              ${activeId}::uuid, ${dependency.legSequence},
              ${dependency.mobilityEntityId}::uuid,
              ${dependency.canonicalEntityId}::uuid, ${dependency.entityType},
              ${dependency.productMode}, ${dependency.provenanceRef}
            )
          `.execute(transaction);
      }
      await sql`
        insert into journey.active_journey (journey_id, lifecycle_status, activated_at)
        values (${activeId}::uuid, 'ACTIVE', ${input.activatedAt}::timestamptz)
        on conflict (journey_id) do nothing
      `.execute(transaction);
      await sql`
        insert into journey.journey_progress (
          journey_id, completed_leg_count, current_leg_sequence,
          progress_method, recorded_at
        ) values (
          ${activeId}::uuid, 0, 0, 'CONTROLLED_MANUAL',
          ${input.activatedAt}::timestamptz
        ) on conflict (journey_id) do nothing
      `.execute(transaction);
      await this.insertStateEvent(
        transaction,
        activeId,
        'ACTIVATED',
        input.activatedAt,
        { planFingerprint: input.planFingerprint },
      );
      if (receiptKey !== undefined)
        await sql`
          insert into journey.activation_receipt (
            owner_ref, idempotency_key, request_fingerprint, active_journey_id
          ) values (
            ${input.ownerRef}, ${receiptKey.idempotencyKey},
            ${receiptKey.requestFingerprint}, ${activeId}::uuid
          )
        `.execute(transaction);
    });
    return this.get(resolvedId, input.ownerRef);
  }

  async get(journeyId: string, ownerRef: string): Promise<ActiveJourney> {
    const result = await sql<JourneyRow>`
      select p.id as "journeyId", p.owner_ref as "ownerRef",
        a.lifecycle_status as "lifecycleStatus", p.plan_fingerprint as "planFingerprint",
        p.original_plan_json as "originalPlan", a.activated_at as "activatedAt",
        a.current_itinerary_json as "currentPlan",
        a.accepted_recovery_id as "acceptedRecoveryId",
        a.accepted_before_leg_count as "acceptedBeforeLegCount",
        a.completed_at as "completedAt", pr.completed_leg_count as "completedLegCount",
        pr.current_leg_sequence as "currentLegSequence",
        pr.progress_method as "progressMethod", pr.recorded_at as "recordedAt",
        pr.revision,
        pr.boarding_confirmed_leg_sequence as "boardingConfirmedLegSequence",
        pr.boarding_confirmed_at as "boardingConfirmedAt",
        pr.alighting_confirmed_leg_sequence as "alightingConfirmedLegSequence",
        pr.alighting_confirmed_at as "alightingConfirmedAt"
      from journey.journey_plan p
      join journey.active_journey a on a.journey_id=p.id
      join journey.journey_progress pr on pr.journey_id=p.id
      where p.id=${journeyId}::uuid
    `.execute(this.database);
    const row = result.rows[0];
    if (row === undefined)
      throw new ActiveJourneyError(
        'JOURNEY_NOT_FOUND',
        'Active journey not found.',
      );
    if (row.ownerRef !== ownerRef)
      throw new ActiveJourneyError(
        'OWNER_SCOPE_MISMATCH',
        'Journey is outside the supplied owner scope.',
      );
    return {
      journeyId: row.journeyId,
      ownerRef: row.ownerRef,
      lifecycleStatus: row.lifecycleStatus,
      planFingerprint: row.planFingerprint,
      originalPlan: row.originalPlan,
      currentPlan: row.currentPlan ?? row.originalPlan,
      acceptedRecoveryId: row.acceptedRecoveryId,
      acceptedBeforeLegCount: row.acceptedBeforeLegCount,
      activatedAt: row.activatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      progress: {
        completedLegCount: row.completedLegCount,
        currentLegSequence: row.currentLegSequence,
        method: row.progressMethod,
        recordedAt: row.recordedAt.toISOString(),
        revision: row.revision,
        boardingConfirmedLegSequence: row.boardingConfirmedLegSequence,
        boardingConfirmedAt: row.boardingConfirmedAt?.toISOString() ?? null,
        alightingConfirmedLegSequence: row.alightingConfirmedLegSequence,
        alightingConfirmedAt: row.alightingConfirmedAt?.toISOString() ?? null,
      },
      dependencies: await this.dependencies(journeyId),
    };
  }

  async updateProgress(input: ProgressUpdateInput): Promise<ActiveJourney> {
    await this.database.transaction().execute(async (transaction) => {
      const current = await sql<{
        ownerRef: string;
        status: ActiveJourney['lifecycleStatus'];
        completedLegCount: number;
        currentLegSequence: number | null;
        recordedAt: Date;
        boardingConfirmedLegSequence: number | null;
        alightingConfirmedLegSequence: number | null;
        acceptedRecoveryId: string | null;
        legCount: number;
        currentPlan: JourneyAlternative | null;
        acceptedBefore: number | null;
      }>`
        select p.owner_ref as "ownerRef", a.lifecycle_status as status,
          a.accepted_recovery_id as "acceptedRecoveryId",
          pr.completed_leg_count as "completedLegCount",
          pr.current_leg_sequence as "currentLegSequence",
          pr.recorded_at as "recordedAt",
          pr.boarding_confirmed_leg_sequence as "boardingConfirmedLegSequence",
          pr.alighting_confirmed_leg_sequence as "alightingConfirmedLegSequence",
          a.current_itinerary_json as "currentPlan",
          a.accepted_before_leg_count as "acceptedBefore",
          coalesce(
            case when a.current_itinerary_json is not null
              then jsonb_array_length(a.current_itinerary_json->'legs')
              else null end,
            (select count(*)::int from journey.journey_leg l where l.journey_id=p.id)
          ) as "legCount"
        from journey.journey_plan p
        join journey.active_journey a on a.journey_id=p.id
        join journey.journey_progress pr on pr.journey_id=p.id
        where p.id=${input.journeyId}::uuid
        for update of a, pr
      `.execute(transaction);
      const row = current.rows[0];
      if (row === undefined)
        throw new ActiveJourneyError(
          'JOURNEY_NOT_FOUND',
          'Active journey not found.',
        );
      if (row.ownerRef !== input.ownerRef)
        throw new ActiveJourneyError(
          'OWNER_SCOPE_MISMATCH',
          'Journey owner scope mismatch.',
        );
      assertCurrentRoute(row.acceptedRecoveryId, input.acceptedRecoveryId);
      if (row.status !== 'ACTIVE')
        throw new ActiveJourneyError(
          'JOURNEY_NOT_ACTIVE',
          'Only an ACTIVE journey can progress.',
        );
      if (
        input.completedLegCount < row.completedLegCount ||
        input.completedLegCount > row.legCount ||
        Date.parse(input.recordedAt) < row.recordedAt.getTime() ||
        (input.completedLegCount < row.legCount &&
          (input.currentLegSequence === null ||
            input.currentLegSequence !== input.completedLegCount)) ||
        (input.completedLegCount === row.legCount &&
          input.currentLegSequence !== null)
      )
        throw new ActiveJourneyError(
          'INVALID_PROGRESS',
          'Progress must be monotonic and remain within the immutable leg sequence.',
        );
      // Transit leg cannot be marked completed before explicit alighting for that leg.
      // Route-aware: accepted replacement mode resolved from materialized current itinerary;
      // original journey_leg rows remain immutable history only.
      if (input.completedLegCount > row.completedLegCount) {
        const transitToComplete =
          row.currentPlan === null
            ? (
                await sql<{
                  sequence: number;
                }>`select sequence from journey.journey_leg
              where journey_id=${input.journeyId}::uuid
                and sequence >= ${row.completedLegCount}
                and sequence < ${input.completedLegCount}
                and mode <> 'WALK'`.execute(transaction)
              ).rows.map((leg) => leg.sequence)
            : (row.currentPlan.legs ?? [])
                .filter(
                  (leg) =>
                    leg.sequence >= row.completedLegCount &&
                    leg.sequence < input.completedLegCount &&
                    leg.mode !== 'WALK',
                )
                .map((leg) => leg.sequence);
        for (const sequence of transitToComplete)
          if (
            row.alightingConfirmedLegSequence === null ||
            sequence !== row.alightingConfirmedLegSequence
          )
            throw new ActiveJourneyError(
              'INVALID_PROGRESS',
              'Transit progress requires alighting confirmation for the completed leg.',
            );
      }
      const unchanged =
        input.completedLegCount === row.completedLegCount &&
        input.currentLegSequence === row.currentLegSequence &&
        input.recordedAt === row.recordedAt.toISOString();
      if (unchanged) return;
      await sql`
        update journey.journey_progress set
          completed_leg_count=${input.completedLegCount},
          current_leg_sequence=${input.currentLegSequence},
          recorded_at=${input.recordedAt}::timestamptz,
          revision=revision+1, updated_at=now()
        where journey_id=${input.journeyId}::uuid
      `.execute(transaction);
      const completed = input.completedLegCount === row.legCount;
      if (completed)
        await sql`
          update journey.active_journey set lifecycle_status='COMPLETED',
            completed_at=${input.recordedAt}::timestamptz, updated_at=now()
          where journey_id=${input.journeyId}::uuid
        `.execute(transaction);
      await this.insertStateEvent(
        transaction,
        input.journeyId,
        completed ? 'COMPLETED' : 'PROGRESS_UPDATED',
        input.recordedAt,
        {
          completedLegCount: input.completedLegCount,
          currentLegSequence: input.currentLegSequence,
        },
      );
    });
    return this.get(input.journeyId, input.ownerRef);
  }

  async confirmBoarding(
    input: Readonly<{
      journeyId: string;
      ownerRef: string;
      legSequence: number;
      confirmedAt: string;
      acceptedRecoveryId?: string | null;
    }>,
  ): Promise<ActiveJourney> {
    await this.database.transaction().execute(async (transaction) => {
      const current = await sql<{
        ownerRef: string;
        status: ActiveJourney['lifecycleStatus'];
        completedLegCount: number;
        currentLegSequence: number | null;
        recordedAt: Date;
        boardingConfirmedLegSequence: number | null;
        boardingConfirmedAt: Date | null;
        alightingConfirmedLegSequence: number | null;
        acceptedRecoveryId: string | null;
        legCount: number;
        mode: string | null;
      }>`
        select p.owner_ref as "ownerRef", a.lifecycle_status as status,
          a.accepted_recovery_id as "acceptedRecoveryId",
          pr.completed_leg_count as "completedLegCount",
          pr.current_leg_sequence as "currentLegSequence",
          pr.recorded_at as "recordedAt",
          pr.boarding_confirmed_leg_sequence as "boardingConfirmedLegSequence",
          pr.boarding_confirmed_at as "boardingConfirmedAt",
          pr.alighting_confirmed_leg_sequence as "alightingConfirmedLegSequence",
          (select count(*)::int from journey.journey_leg l where l.journey_id=p.id) as "legCount",
          case when a.current_itinerary_json is not null
             then a.current_itinerary_json->'legs'->${input.legSequence}::int->>'mode'
             else (select mode from journey.journey_leg l where l.journey_id=p.id and l.sequence=${input.legSequence} limit 1) end as "mode"
        from journey.journey_plan p
        join journey.active_journey a on a.journey_id=p.id
        join journey.journey_progress pr on pr.journey_id=p.id
        where p.id=${input.journeyId}::uuid
        for update of a, pr
      `.execute(transaction);
      const row = current.rows[0];
      if (row === undefined)
        throw new ActiveJourneyError(
          'JOURNEY_NOT_FOUND',
          'Active journey not found.',
        );
      if (row.ownerRef !== input.ownerRef)
        throw new ActiveJourneyError(
          'OWNER_SCOPE_MISMATCH',
          'Journey owner scope mismatch.',
        );
      assertCurrentRoute(row.acceptedRecoveryId, input.acceptedRecoveryId);
      if (row.status !== 'ACTIVE')
        throw new ActiveJourneyError(
          'JOURNEY_NOT_ACTIVE',
          'Only an ACTIVE journey can be boarded.',
        );
      if (row.mode === null)
        throw new ActiveJourneyError('INVALID_BOARDING', 'Leg does not exist.');
      if (row.mode === 'WALK')
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Cannot board a walking leg; walking is not vehicle boarding.',
        );
      // Ensure monotonic confirmedAt regardless of current DB timestamp (avoid client clock skew).
      // ponytail: no request-scoped idempotency key; retries matched by identical timestamp.
      if (
        row.boardingConfirmedLegSequence === input.legSequence &&
        row.boardingConfirmedAt !== null &&
        row.boardingConfirmedAt.toISOString() ===
          new Date(input.confirmedAt).toISOString()
      )
        return;
      if (row.boardingConfirmedLegSequence === input.legSequence)
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'This leg is already boarded.',
        );
      if (input.legSequence < row.completedLegCount)
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Cannot board a completed leg.',
        );
      if (input.legSequence !== row.currentLegSequence)
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Boarding is valid only for the current leg.',
        );
      if (Date.parse(input.confirmedAt) < row.recordedAt.getTime())
        throw new ActiveJourneyError(
          'INVALID_PROGRESS',
          'Boarding confirmation cannot be older than journey progress.',
        );
      // Multi-leg enforcement: require alighting of prior boarded leg before boarding next leg.
      if (
        row.boardingConfirmedLegSequence !== null &&
        row.alightingConfirmedLegSequence !== row.boardingConfirmedLegSequence
      )
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Alight the previously boarded leg before boarding another leg.',
        );
      if (
        row.alightingConfirmedLegSequence !== null &&
        input.legSequence <= row.alightingConfirmedLegSequence
      )
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Cannot re-board an already exited leg.',
        );
      await sql`
        update journey.journey_progress set
          boarding_confirmed_leg_sequence=${input.legSequence},
          boarding_confirmed_at=${input.confirmedAt}::timestamptz,
          recorded_at=${input.confirmedAt}::timestamptz,
          revision=revision+1, updated_at=now()
        where journey_id=${input.journeyId}::uuid
      `.execute(transaction);
      await this.insertStateEvent(
        transaction,
        input.journeyId,
        'BOARDED',
        input.confirmedAt,
        {
          legSequence: input.legSequence,
        },
      );
    });
    return this.get(input.journeyId, input.ownerRef);
  }

  async confirmAlighting(
    input: Readonly<{
      journeyId: string;
      ownerRef: string;
      legSequence: number;
      confirmedAt: string;
      acceptedRecoveryId?: string | null;
    }>,
  ): Promise<ActiveJourney> {
    await this.database.transaction().execute(async (transaction) => {
      const current = await sql<{
        ownerRef: string;
        status: ActiveJourney['lifecycleStatus'];
        completedLegCount: number;
        currentLegSequence: number | null;
        recordedAt: Date;
        boardingConfirmedLegSequence: number | null;
        alightingConfirmedLegSequence: number | null;
        alightingConfirmedAt: Date | null;
        mode: string | null;
        acceptedRecoveryId: string | null;
        legCount: number;
      }>`
        select p.owner_ref as "ownerRef", a.lifecycle_status as status,
          a.accepted_recovery_id as "acceptedRecoveryId",
          pr.completed_leg_count as "completedLegCount",
          pr.current_leg_sequence as "currentLegSequence",
          pr.recorded_at as "recordedAt",
          pr.boarding_confirmed_leg_sequence as "boardingConfirmedLegSequence",
          pr.alighting_confirmed_leg_sequence as "alightingConfirmedLegSequence",
          pr.alighting_confirmed_at as "alightingConfirmedAt",
          case when a.current_itinerary_json is not null
             then a.current_itinerary_json->'legs'->${input.legSequence}::int->>'mode'
             else (select mode from journey.journey_leg l where l.journey_id=p.id and l.sequence=${input.legSequence} limit 1) end as "mode",
          (select count(*)::int from journey.journey_leg l where l.journey_id=p.id) as "legCount"
        from journey.journey_plan p
        join journey.active_journey a on a.journey_id=p.id
        join journey.journey_progress pr on pr.journey_id=p.id
        where p.id=${input.journeyId}::uuid
        for update of a, pr
      `.execute(transaction);
      const row = current.rows[0];
      if (row === undefined)
        throw new ActiveJourneyError(
          'JOURNEY_NOT_FOUND',
          'Active journey not found.',
        );
      if (row.ownerRef !== input.ownerRef)
        throw new ActiveJourneyError(
          'OWNER_SCOPE_MISMATCH',
          'Journey owner scope mismatch.',
        );
      assertCurrentRoute(row.acceptedRecoveryId, input.acceptedRecoveryId);
      if (row.status !== 'ACTIVE')
        throw new ActiveJourneyError(
          'JOURNEY_NOT_ACTIVE',
          'Only an ACTIVE journey can be exited.',
        );
      if (row.mode === null)
        throw new ActiveJourneyError('INVALID_BOARDING', 'Leg does not exist.');
      if (row.mode === 'WALK')
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Cannot record alighting for a walking leg.',
        );
      if (row.boardingConfirmedLegSequence !== input.legSequence)
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Alighting requires boarding for the same leg first.',
        );
      if (Date.parse(input.confirmedAt) < row.recordedAt.getTime())
        throw new ActiveJourneyError(
          'INVALID_PROGRESS',
          'Alighting cannot be older than journey progress.',
        );
      const unchanged =
        row.alightingConfirmedLegSequence === input.legSequence &&
        row.alightingConfirmedAt !== null &&
        row.alightingConfirmedAt.toISOString() ===
          new Date(input.confirmedAt).toISOString();
      if (unchanged) return;
      if (row.alightingConfirmedLegSequence === input.legSequence)
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'This leg is already exited.',
        );
      if (
        input.legSequence !== row.currentLegSequence ||
        input.legSequence < row.completedLegCount
      )
        throw new ActiveJourneyError(
          'INVALID_BOARDING',
          'Alighting is valid only for the current leg.',
        );
      await sql`
        update journey.journey_progress set
          alighting_confirmed_leg_sequence=${input.legSequence},
          alighting_confirmed_at=${input.confirmedAt}::timestamptz,
          recorded_at=${input.confirmedAt}::timestamptz,
          revision=revision+1, updated_at=now()
        where journey_id=${input.journeyId}::uuid
      `.execute(transaction);
      await this.insertStateEvent(
        transaction,
        input.journeyId,
        'ALIGHTED',
        input.confirmedAt,
        {
          legSequence: input.legSequence,
        },
      );
    });
    return this.get(input.journeyId, input.ownerRef);
  }

  async listAlerts(
    journeyId: string,
    ownerRef: string,
  ): Promise<readonly JourneyAlert[]> {
    await this.assertOwner(journeyId, ownerRef);
    const result = await this.alertRows(
      sql`where a.journey_id=${journeyId}::uuid`,
    );
    return result.rows.map(mapAlert);
  }

  async processTransition(
    history: MobilityStateHistoryRecord,
    state: EffectiveMobilityState,
  ): Promise<ImpactProcessingResult> {
    if (
      state.operationalState === 'AVAILABLE' ||
      state.operationalState === 'UNKNOWN' ||
      state.freshnessStatus === 'EXPIRED' ||
      state.freshnessStatus === 'NOT_YET_VALID'
    ) {
      await sql`
        update journey.journey_impact set resolved_at=${history.effectiveAt}::timestamptz
        where mobility_entity_id=${state.mobilityEntityId}::uuid and resolved_at is null
      `.execute(this.database);
      await sql`
        update journey.targeted_alert a set resolved_at=${history.effectiveAt}::timestamptz
        from journey.journey_impact i
        where a.impact_id=i.id and i.mobility_entity_id=${state.mobilityEntityId}::uuid
          and a.resolved_at is null
      `.execute(this.database);
      return { affectedJourneyIds: [], alerts: [], duplicateCount: 0 };
    }
    if (
      !['UNAVAILABLE', 'DEGRADED', 'DISRUPTED', 'RECOVERING'].includes(
        state.operationalState,
      )
    )
      return { affectedJourneyIds: [], alerts: [], duplicateCount: 0 };

    const dependencies = await sql<DependencyRow>`
      select d.id as "dependencyId", d.journey_id as "journeyId",
        d.leg_sequence as "legSequence", d.mobility_entity_id as "mobilityEntityId",
        d.canonical_entity_id as "canonicalEntityId", d.entity_type as "entityType",
        d.product_mode as "productMode", d.provenance_ref as "provenanceRef", false as accepted
      from journey.journey_dependency d
      join journey.active_journey a on a.journey_id=d.journey_id
      join journey.journey_progress p on p.journey_id=d.journey_id
      where d.mobility_entity_id=${state.mobilityEntityId}::uuid
        and a.lifecycle_status='ACTIVE' and a.accepted_recovery_id is null
        and d.leg_sequence >= p.completed_leg_count
      union all
      select d.id, d.journey_id, d.leg_sequence, d.mobility_entity_id,
        d.canonical_entity_id, d.entity_type, d.product_mode, d.provenance_ref, true
      from journey.active_journey_dependency d
      join journey.active_journey a on a.journey_id=d.journey_id and a.accepted_recovery_id=d.recovery_id
      join journey.journey_progress p on p.journey_id=d.journey_id
      where d.mobility_entity_id=${state.mobilityEntityId}::uuid and a.lifecycle_status='ACTIVE'
        and d.leg_sequence >= p.completed_leg_count
      order by "journeyId", "legSequence", "dependencyId"
    `.execute(this.database);
    const byJourney = new Map<string, DependencyRow[]>();
    for (const dependency of dependencies.rows) {
      const rows = byJourney.get(dependency.journeyId) ?? [];
      rows.push(dependency);
      byJourney.set(dependency.journeyId, rows);
    }
    const alerts: JourneyAlert[] = [];
    let duplicates = 0;
    for (const [journeyId, affectedDependencies] of byJourney) {
      const alert = await this.database
        .transaction()
        .execute(async (transaction) => {
          const owner = await sql<{ ownerRef: string }>`
          select p.owner_ref as "ownerRef" from journey.journey_plan p
          join journey.active_journey a on a.journey_id=p.id
          where p.id=${journeyId}::uuid and a.lifecycle_status='ACTIVE'
        `.execute(transaction);
          const ownerRef = owner.rows[0]?.ownerRef;
          if (ownerRef === undefined) return null;
          if (state.operationalState === 'RECOVERING')
            await Promise.all([
              sql`
                update journey.journey_impact set resolved_at=${history.effectiveAt}::timestamptz
                where journey_id=${journeyId}::uuid
                  and mobility_entity_id=${state.mobilityEntityId}::uuid
                  and resolved_at is null
              `.execute(transaction),
              sql`
                update journey.targeted_alert a
                set resolved_at=${history.effectiveAt}::timestamptz
                from journey.journey_impact i
                where a.impact_id=i.id
                  and i.journey_id=${journeyId}::uuid
                  and i.mobility_entity_id=${state.mobilityEntityId}::uuid
                  and a.resolved_at is null
              `.execute(transaction),
            ]);
          const impactId = stableUuid(
            'journey-impact',
            `${journeyId}:${history.id}`,
          );
          const impactStatus =
            state.operationalState === 'UNAVAILABLE'
              ? 'BLOCKING'
              : state.operationalState === 'RECOVERING'
                ? 'RECOVERING'
                : 'AFFECTED';
          const received = state.observationId
            ? await sql<{ receivedAt: Date }>`
              select received_at as "receivedAt" from twin.operational_observation
              where id=${state.observationId}::uuid
            `.execute(transaction)
            : { rows: [] };
          const inserted = await sql<{ id: string }>`
          insert into journey.journey_impact (
            id, journey_id, owner_ref, state_transition_id, mobility_entity_id,
            impact_status, operational_state, evidence_type, freshness_status,
            observation_id, source_id, observed_at, received_at, expires_at,
            provenance_ref, projection_version
          ) values (
            ${impactId}::uuid, ${journeyId}::uuid, ${ownerRef}, ${history.id}::uuid,
            ${state.mobilityEntityId}::uuid, ${impactStatus}, ${state.operationalState},
            ${state.evidenceType}, ${state.freshnessStatus}, ${state.observationId}::uuid,
            ${state.sourceId}::uuid, ${state.observedAt}::timestamptz,
            ${received.rows[0]?.receivedAt.toISOString() ?? null}::timestamptz,
            ${state.expiresAt}::timestamptz, ${state.provenanceRef},
            ${state.projectionVersion}
          ) on conflict (journey_id, state_transition_id) do nothing returning id
        `.execute(transaction);
          if (inserted.rows[0] === undefined) return null;
          for (const dependency of affectedDependencies) {
            if (dependency.accepted) {
              await sql`insert into journey.current_impact_dependency (impact_id, dependency_id)
                values (${impactId}::uuid, ${dependency.dependencyId}::uuid) on conflict do nothing`.execute(
                transaction,
              );
              continue;
            }
            await sql`
            insert into journey.journey_impact_dependency (impact_id, dependency_id)
            values (${impactId}::uuid, ${dependency.dependencyId}::uuid)
            on conflict do nothing
          `.execute(transaction);
          }
          const alertId = stableUuid('journey-targeted-alert', impactId);
          const alertType =
            impactStatus === 'BLOCKING'
              ? 'BLOCKING'
              : impactStatus === 'RECOVERING'
                ? 'RECOVERY_UPDATE'
                : 'DISRUPTION';
          await sql`
          insert into journey.targeted_alert (
            id, impact_id, journey_id, owner_ref, alert_type, message
          ) values (
            ${alertId}::uuid, ${impactId}::uuid, ${journeyId}::uuid, ${ownerRef},
            ${alertType}, ${alertMessage(state.operationalState)}
          )
        `.execute(transaction);
          await this.insertStateEvent(
            transaction,
            journeyId,
            'IMPACT_DETECTED',
            history.effectiveAt,
            { impactId, alertId, mobilityEntityId: state.mobilityEntityId },
          );
          return alertId;
        });
      if (alert === null) duplicates += 1;
      else {
        const loaded = await this.alertRows(sql`where a.id=${alert}::uuid`);
        if (loaded.rows[0]) alerts.push(mapAlert(loaded.rows[0]));
      }
    }
    return {
      affectedJourneyIds: [
        ...new Set(alerts.map((alert) => alert.journeyId)),
      ].sort(),
      alerts,
      duplicateCount: duplicates,
    };
  }

  private async dependencies(
    journeyId: string,
  ): Promise<readonly JourneyDependency[]> {
    const result = await sql<DependencyRow>`
      select d.id as "dependencyId", d.journey_id as "journeyId",
        d.leg_sequence as "legSequence", d.mobility_entity_id as "mobilityEntityId",
        d.canonical_entity_id as "canonicalEntityId", d.entity_type as "entityType",
        d.product_mode as "productMode", d.provenance_ref as "provenanceRef"
      from journey.journey_dependency d join journey.active_journey a on a.journey_id=d.journey_id
      where d.journey_id=${journeyId}::uuid and a.accepted_recovery_id is null
      union all
      select d.id, d.journey_id, d.leg_sequence, d.mobility_entity_id,
        d.canonical_entity_id, d.entity_type, d.product_mode, d.provenance_ref
      from journey.active_journey_dependency d join journey.active_journey a on a.journey_id=d.journey_id
      where d.journey_id=${journeyId}::uuid and d.recovery_id=a.accepted_recovery_id
      order by "legSequence", "mobilityEntityId"
    `.execute(this.database);
    return result.rows;
  }

  private async assertOwner(
    journeyId: string,
    ownerRef: string,
  ): Promise<void> {
    const result = await sql<{ ownerRef: string }>`
      select owner_ref as "ownerRef" from journey.journey_plan
      where id=${journeyId}::uuid
    `.execute(this.database);
    if (result.rows[0] === undefined)
      throw new ActiveJourneyError(
        'JOURNEY_NOT_FOUND',
        'Active journey not found.',
      );
    if (result.rows[0].ownerRef !== ownerRef)
      throw new ActiveJourneyError(
        'OWNER_SCOPE_MISMATCH',
        'Journey owner scope mismatch.',
      );
  }

  private alertRows(where: ReturnType<typeof sql>) {
    return sql<AlertRow>`
      select a.id as "alertId", a.impact_id as "impactId",
        a.journey_id as "journeyId", a.owner_ref as "ownerRef",
        a.alert_type as "alertType", a.message, i.mobility_entity_id as "mobilityEntityId",
        i.operational_state as "operationalState", i.evidence_type as "evidenceType",
        i.freshness_status as "freshnessStatus", i.observation_id as "observationId",
        i.source_id as "sourceId", i.observed_at as "observedAt",
        i.received_at as "receivedAt", i.expires_at as "expiresAt",
        i.provenance_ref as "provenanceRef", i.projection_version as "projectionVersion",
        a.created_at as "createdAt", a.resolved_at as "resolvedAt",
        array_agg(distinct d.leg_sequence order by d.leg_sequence)::int[] as "affectedLegSequences"
      from journey.targeted_alert a
      join journey.journey_impact i on i.id=a.impact_id
      join (
        select x.impact_id, d.leg_sequence from journey.journey_impact_dependency x
        join journey.journey_dependency d on d.id=x.dependency_id
        union all
        select x.impact_id, d.leg_sequence from journey.current_impact_dependency x
        join journey.active_journey_dependency d on d.id=x.dependency_id
      ) d on d.impact_id=i.id
      ${where}
      group by a.id, i.id
      order by a.created_at asc, a.id asc
    `.execute(this.database);
  }

  private async insertStateEvent(
    database: Kysely<FoundationDatabase>,
    journeyId: string,
    eventType: string,
    occurredAt: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const fingerprint = hash({ journeyId, eventType, occurredAt, payload });
    await sql`
      insert into journey.journey_state_event (
        id, journey_id, event_type, occurred_at, event_fingerprint, payload_json
      ) values (
        ${stableUuid('journey-state-event', fingerprint)}::uuid,
        ${journeyId}::uuid, ${eventType}, ${occurredAt}::timestamptz,
        ${fingerprint}, ${JSON.stringify(payload)}::jsonb
      ) on conflict (event_fingerprint) do nothing
    `.execute(database);
  }
}

function mapAlert(row: AlertRow): JourneyAlert {
  return {
    ...row,
    observedAt: row.observedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function alertMessage(
  state: EffectiveMobilityState['operationalState'],
): string {
  if (state === 'UNAVAILABLE')
    return 'An upcoming journey dependency is currently unavailable.';
  if (state === 'RECOVERING')
    return 'An affected journey dependency is recovering.';
  return 'An upcoming journey dependency has an operational disruption.';
}

export function assertCurrentRoute(
  current: string | null,
  supplied: string | null | undefined,
): void {
  if (current !== (supplied ?? null))
    throw new ActiveJourneyError(
      'STALE_ROUTE',
      'Action targets a superseded itinerary; reload the journey.',
    );
}
