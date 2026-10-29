import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../infrastructure/database/database.constants.js';
import { JourneyImpactService } from '../journey/application/journey-impact.service.js';
import {
  INCIDENT_LIFECYCLE_PORT,
  type IncidentLifecyclePort,
} from '../operational-data/application/incident-lifecycle.port.js';
import { stableUuid } from '../spatial/domain/spatial-identity.js';
import type { IncidentEvidenceInput } from '../operational-data/domain/hazard-incident.js';
import { OPERATIONAL_INCIDENT_TYPES } from '../operational-data/domain/operational-data.js';

function validReference(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function validText(value: unknown, maximum: number): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function validTimestamp(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
    return null;
  const instant = Date.parse(value);
  if (
    !Number.isFinite(instant) ||
    new Date(instant).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    return null;
  return instant;
}

type ReportRow = Readonly<{
  id: string;
  ownerRef: string;
  activeJourneyId: string | null;
  category: string;
  observationTime: Date;
  receivedAt: Date;
  mobilityEntityId: string;
  entityType: string;
  description: string;
  source: string;
  verificationStatus: string;
  requestFingerprint: string;
}>;
type ReportInput = Readonly<{
  ownerRef: string;
  journeyId: string | null;
  category: string;
  observedAt: string;
  entityId: string;
  entityType: string;
  description: string;
  key: string;
}>;
type ReviewInput = Readonly<{
  reportId: string;
  reviewer: string;
  state: string;
  reason: string;
  incidentType: string;
}>;
export type AdminFieldReview = Readonly<{
  actorUserId: string;
  evidenceReference: string;
  observedAt: string;
  validForMinutes: number;
}>;
type CloseInput = Readonly<{
  reportId: string;
  reviewer: string;
  decision: string;
  reason: string;
}>;
const CLOSE_DECISIONS = ['RESOLVED', 'RETRACTED'] as const;
/** Reviewer-supplied incident class validated against the lifecycle evidence contract. */
const REVIEW_INCIDENT_TYPES = new Set<string>(OPERATIONAL_INCIDENT_TYPES);
const CATEGORIES = [
  'CLEANLINESS',
  'CROWDING',
  'ACCESSIBILITY',
  'SAFETY',
  'SERVICE',
  'OTHER',
] as const;
const STATES = ['DEGRADED', 'DISRUPTED', 'UNAVAILABLE', 'RECOVERING'] as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PassengerReportRateLimitException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Passenger report limit reached.', 429);
  }
}

@Injectable()
export class PassengerReportService {
  constructor(
    @Inject(DATABASE) private readonly database: Kysely<FoundationDatabase>,
    @Inject(INCIDENT_LIFECYCLE_PORT)
    private readonly lifecycle: IncidentLifecyclePort,
    @Inject(JourneyImpactService)
    private readonly impacts: JourneyImpactService,
  ) {}

  async submit(input: ReportInput): Promise<Record<string, unknown>> {
    if (!validReference(input.ownerRef))
      throw new BadRequestException(
        'x-journey-owner must be 1-128 identity characters.',
      );
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.key))
      throw new BadRequestException('Valid Idempotency-Key is required.');
    if (!(CATEGORIES as readonly string[]).includes(input.category))
      throw new BadRequestException('Unsupported category.');
    if (
      !UUID.test(input.entityId) ||
      !['STOP', 'STATION', 'ROUTE'].includes(input.entityType)
    )
      throw new BadRequestException('Unsupported target entity.');
    const observed = validTimestamp(input.observedAt);
    if (observed === null)
      throw new BadRequestException('observed_at must be an ISO date-time.');
    if (observed > Date.now())
      throw new BadRequestException('observed_at must not be in the future.');
    if (!validText(input.description, 2000))
      throw new BadRequestException(
        'description must be 1-2000 characters without control characters.',
      );
    if (input.journeyId !== null && !UUID.test(input.journeyId))
      throw new BadRequestException('journey_id must be a UUID.');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          journeyId: input.journeyId,
          category: input.category,
          observedAt: new Date(input.observedAt).toISOString(),
          entityId: input.entityId,
          entityType: input.entityType,
          description: input.description,
        }),
      )
      .digest('hex');
    return this.database.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.ownerRef}))`.execute(
        tx,
      );
      const existing =
        await sql<ReportRow>`select id, owner_ref as "ownerRef", active_journey_id as "activeJourneyId", category, observation_time as "observationTime", received_at as "receivedAt", mobility_entity_id as "mobilityEntityId", entity_type as "entityType", description, source, verification_status as "verificationStatus", request_fingerprint as "requestFingerprint" from report.passenger_report where owner_ref=${input.ownerRef} and idempotency_key=${input.key}`.execute(
          tx,
        );
      if (existing.rows[0]) {
        if (existing.rows[0].requestFingerprint !== fingerprint)
          throw new ConflictException(
            'Idempotency key belongs to different report content.',
          );
        return this.map(existing.rows[0]);
      }
      // Transaction time predates lock waits. Capture wall time once, after lock
      // and replay lookup; the tenth newest row frees the next slot, even for legacy overages.
      const recent = await sql<{
        checkedAt: string;
        retryAfterSeconds: number | null;
      }>`with quota_clock as materialized (select clock_timestamp() as checked_at)
        select checked_at::text as "checkedAt",
          (select greatest(0, ceil(extract(epoch from
            (created_at + interval '10 minutes' - checked_at))))::int
           from report.passenger_report
           where owner_ref=${input.ownerRef}
             and created_at > checked_at - interval '10 minutes'
           order by created_at desc offset 9 limit 1) as "retryAfterSeconds"
        from quota_clock`.execute(tx);
      const quota = recent.rows[0]!;
      if (quota.retryAfterSeconds !== null)
        throw new PassengerReportRateLimitException(quota.retryAfterSeconds);
      const entity = await sql<{
        type: string;
      }>`select entity_type as type from twin.mobility_entity where id=${input.entityId}::uuid`.execute(
        tx,
      );
      if (entity.rows[0]?.type !== input.entityType)
        throw new BadRequestException(
          'Target entity is unknown or type does not match.',
        );
      if (input.journeyId !== null) {
        const journeyState = await sql<{
          lifecycle: string;
        }>`select lifecycle_status as lifecycle from journey.active_journey where journey_id=${input.journeyId}::uuid for update`.execute(
          tx,
        );
        if (journeyState.rows[0]?.lifecycle === 'COMPLETED')
          throw new BadRequestException('Journey is completed.');
        const selected = await sql<{
          ownerRef: string;
          entityId: string;
        }>`select p.owner_ref as "ownerRef", d.mobility_entity_id as "entityId"
          from journey.journey_plan p
          join (
            select d.journey_id, d.mobility_entity_id
            from journey.journey_dependency d
            left join journey.active_journey a on a.journey_id=d.journey_id
            where a.accepted_recovery_id is null
            union all
            select d.journey_id, d.mobility_entity_id
            from journey.active_journey_dependency d
            join journey.active_journey a
              on a.journey_id=d.journey_id
             and a.accepted_recovery_id=d.recovery_id
          ) d on d.journey_id=p.id
          where p.id=${input.journeyId}::uuid
            and d.mobility_entity_id=${input.entityId}::uuid`.execute(tx);
        if (selected.rows.length === 0)
          throw new NotFoundException('Journey or selected target not found.');
        if (selected.rows[0]?.ownerRef !== input.ownerRef)
          throw new ForbiddenException('Journey is outside owner scope.');
      }
      const inserted =
        await sql<ReportRow>`insert into report.passenger_report (id, owner_ref, active_journey_id, category, observation_time, mobility_entity_id, entity_type, description, idempotency_key, request_fingerprint) values (${randomUUID()}::uuid, ${input.ownerRef}, ${input.journeyId}::uuid, ${input.category}, ${input.observedAt}::timestamptz, ${input.entityId}::uuid, ${input.entityType}, ${input.description}, ${input.key}, ${fingerprint}) returning id, owner_ref as "ownerRef", active_journey_id as "activeJourneyId", category, observation_time as "observationTime", received_at as "receivedAt", mobility_entity_id as "mobilityEntityId", entity_type as "entityType", description, source, verification_status as "verificationStatus", request_fingerprint as "requestFingerprint"`.execute(
          tx,
        );
      return this.map(inserted.rows[0]!);
    });
  }

  async lookupByIdempotencyKey(
    ownerRef: string,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    if (!validReference(ownerRef))
      throw new BadRequestException('Invalid owner.');
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      throw new BadRequestException('idempotency_key must be 8-128 chars.');
    const result =
      await sql<ReportRow>`select id, owner_ref as "ownerRef", active_journey_id as "activeJourneyId", category, observation_time as "observationTime", received_at as "receivedAt", mobility_entity_id as "mobilityEntityId", entity_type as "entityType", description, source, verification_status as "verificationStatus", request_fingerprint as "requestFingerprint" from report.passenger_report where owner_ref=${ownerRef} and idempotency_key=${key}`.execute(
        this.database,
      );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async list(
    ownerRef: string,
    journeyId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    if (!validReference(ownerRef))
      throw new BadRequestException('Invalid owner.');
    if (!UUID.test(journeyId))
      throw new BadRequestException('active_journey_id must be a UUID.');
    const result =
      await sql<ReportRow>`select id, owner_ref as "ownerRef", active_journey_id as "activeJourneyId", category, observation_time as "observationTime", received_at as "receivedAt", mobility_entity_id as "mobilityEntityId", entity_type as "entityType", description, source, verification_status as "verificationStatus", request_fingerprint as "requestFingerprint" from report.passenger_report where owner_ref=${ownerRef} and active_journey_id=${journeyId}::uuid order by received_at desc limit 100`.execute(
        this.database,
      );
    return result.rows.map((row) => this.map(row));
  }

  async get(id: string, ownerRef: string): Promise<Record<string, unknown>> {
    if (!UUID.test(id) || !validReference(ownerRef))
      throw new BadRequestException('Invalid report ID or owner.');
    const result =
      await sql<ReportRow>`select id, owner_ref as "ownerRef", active_journey_id as "activeJourneyId", category, observation_time as "observationTime", received_at as "receivedAt", mobility_entity_id as "mobilityEntityId", entity_type as "entityType", description, source, verification_status as "verificationStatus", request_fingerprint as "requestFingerprint" from report.passenger_report where id=${id}::uuid and owner_ref=${ownerRef}`.execute(
        this.database,
      );
    if (!result.rows[0]) throw new NotFoundException('Report not found.');
    return this.map(result.rows[0]);
  }

  async restrictAdmin(
    input: ReviewInput,
    review: AdminFieldReview,
  ): Promise<Record<string, unknown>> {
    const observed = validTimestamp(review.observedAt);
    const now = Date.now();
    if (
      !UUID.test(review.actorUserId) ||
      input.reviewer !== `admin:${review.actorUserId}` ||
      !validText(review.evidenceReference, 1000) ||
      observed === null ||
      observed > now ||
      now - observed > 30 * 60_000 ||
      !Number.isInteger(review.validForMinutes) ||
      review.validForMinutes < 5 ||
      review.validForMinutes > 60
    )
      throw new BadRequestException(
        'Admin review requires documented evidence, observation within 30 minutes and 5–60 minute validity.',
      );
    return this.verify(input, review);
  }

  async reviewQueue(): Promise<Record<string, unknown>[]> {
    const result = await sql<
      ReportRow & {
        reviewAuthority: string | null;
        incidentId: string | null;
        expiresAt: Date | null;
        lifecycle: string | null;
        actorUserId: string | null;
        supportingReference: string | null;
      }
    >`select r.id, r.owner_ref as "ownerRef", r.active_journey_id as "activeJourneyId", r.category,
      r.observation_time as "observationTime", r.received_at as "receivedAt", r.mobility_entity_id as "mobilityEntityId",
      r.entity_type as "entityType", r.description, r.source, r.verification_status as "verificationStatus",
      r.request_fingerprint as "requestFingerprint", review.review_authority as "reviewAuthority",
      review.actor_user_id as "actorUserId", review.supporting_reference as "supportingReference",
      incident.id as "incidentId", incident.expires_at as "expiresAt", incident.lifecycle_status as lifecycle
      from report.passenger_report r left join report.passenger_report_review review on review.report_id=r.id
      left join disruption.operational_incident incident on incident.id=review.incident_id
      order by r.received_at desc, r.id desc limit 100`.execute(this.database);
    return result.rows.map((row) => ({
      ...this.map(row),
      review_authority: row.reviewAuthority,
      incident_id: row.incidentId,
      expires_at: row.expiresAt?.toISOString() ?? null,
      lifecycle_status: row.lifecycle,
      actor_user_id: row.actorUserId,
      evidence_reference: row.supportingReference,
      restriction_active:
        row.lifecycle === 'VERIFIED_ACTIVE' &&
        row.expiresAt !== null &&
        row.expiresAt.getTime() > Date.now(),
    }));
  }

  async verify(
    input: ReviewInput,
    admin?: AdminFieldReview,
  ): Promise<Record<string, unknown>> {
    const id = input.reportId;
    const reviewer = input.reviewer;
    const state = input.state;
    const reason = input.reason;
    const incidentType = input.incidentType;
    if (
      !UUID.test(id) ||
      !validReference(reviewer) ||
      !(STATES as readonly string[]).includes(state) ||
      !validText(reason, 1000) ||
      !REVIEW_INCIDENT_TYPES.has(incidentType) ||
      ['FLOOD', 'WEATHER_DISRUPTION'].includes(incidentType)
    )
      throw new BadRequestException('Invalid controlled verification fields.');
    const deterministicIncidentId = stableUuid('passenger-report-incident', id);
    const claimed = await this.database.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`passenger-review:${id}`}))`.execute(
        tx,
      );
      const row =
        await sql<ReportRow>`select r.id, r.owner_ref as "ownerRef", r.active_journey_id as "activeJourneyId", r.category, r.observation_time as "observationTime", r.received_at as "receivedAt", r.mobility_entity_id as "mobilityEntityId", r.entity_type as "entityType", r.description, r.source, r.verification_status as "verificationStatus", r.request_fingerprint as "requestFingerprint" from report.passenger_report r where r.id=${id}::uuid for update`.execute(
          tx,
        );
      const target = row.rows[0];
      if (!target) throw new NotFoundException('Report not found.');
      // Resolve the current-generation mode: once a recovery is accepted the
      // replacement dependency is authoritative; the immutable original plan
      // only supplies mode while no accepted generation exists.
      let mode: string | null = null;
      if (target.activeJourneyId !== null) {
        await sql`select 1 from journey.active_journey where journey_id=${target.activeJourneyId}::uuid for update`.execute(
          tx,
        );
        const resolved = await sql<{
          mode: string;
        }>`select d.product_mode as mode from (
            select d.journey_id, d.mobility_entity_id, d.product_mode
            from journey.journey_dependency d
            left join journey.active_journey a on a.journey_id=d.journey_id
            where a.accepted_recovery_id is null
            union all
            select d.journey_id, d.mobility_entity_id, d.product_mode
            from journey.active_journey_dependency d
            join journey.active_journey a
              on a.journey_id=d.journey_id
             and a.accepted_recovery_id=d.recovery_id
          ) d
          where d.journey_id=${target.activeJourneyId}::uuid
            and d.mobility_entity_id=${target.mobilityEntityId}::uuid
          limit 1`.execute(tx);
        mode = resolved.rows[0]?.mode ?? null;
      }
      const pending = await sql<{
        evidence: IncidentEvidenceInput;
        reviewerRef: string;
        reviewAuthority: string;
        supportingReference: string | null;
      }>`select evidence_json as evidence, reviewer_ref as "reviewerRef", review_authority as "reviewAuthority", supporting_reference as "supportingReference" from report.passenger_report_review where report_id=${id}::uuid`.execute(
        tx,
      );
      if (pending.rows[0]) {
        const stored = pending.rows[0].evidence;
        if (
          pending.rows[0].reviewerRef !== reviewer ||
          stored.operationalState !== state ||
          stored.reason !== reason ||
          stored.incidentType !== incidentType ||
          pending.rows[0].reviewAuthority !==
            (admin ? 'ADMIN_FIELD_REVIEW' : 'CONTROLLED_SIMULATION') ||
          (admin &&
            (pending.rows[0].supportingReference !== admin.evidenceReference ||
              stored.observedAt !== admin.observedAt ||
              Date.parse(stored.expiresAt) -
                Date.parse(stored.effectiveFrom) !==
                admin.validForMinutes * 60_000))
        )
          throw new ConflictException(
            'Review already claimed with different evidence.',
          );
        return { evidence: stored, replay: true as const };
      }
      if (target.verificationStatus !== 'REPORTED_UNVERIFIED')
        throw new ConflictException('Report already reviewed.');
      if (!mode)
        throw new BadRequestException(
          'Report target has no supported journey mode.',
        );
      // The reviewer asserts the condition is currently active; the bounded
      // effective window starts at review time, not the historical observation.
      const reviewedAt = new Date();
      const evidence: IncidentEvidenceInput = {
        incidentId: deterministicIncidentId,
        incidentType: incidentType as IncidentEvidenceInput['incidentType'],
        affectedEntityIds: [target.mobilityEntityId],
        affectedModes: [mode as IncidentEvidenceInput['affectedModes'][number]],
        operationalState: state as IncidentEvidenceInput['operationalState'],
        sourceClass: admin ? 'ADMIN_FIELD_REVIEW' : 'SIMULATED',
        sourceId: id,
        sourceAuthority: admin ? 'ADMIN_FIELD_REVIEW' : 'SIMULATION',
        sourceChannel: admin ? 'ADMIN_REVIEW' : 'CONTROLLED_SIMULATION',
        evidenceType: admin ? 'OBSERVED' : 'SIMULATED',
        sourceClassification: admin ? 'UNKNOWN' : 'PARTNERSHIP_REQUIRED',
        observedAt: admin?.observedAt ?? reviewedAt.toISOString(),
        effectiveFrom: reviewedAt.toISOString(),
        expiresAt: new Date(
          reviewedAt.getTime() + (admin?.validForMinutes ?? 60) * 60_000,
        ).toISOString(),
        receivedAt: reviewedAt.toISOString(),
        reason,
        provenanceRef: `${admin ? 'admin-field-review' : 'controlled-review'}:${reviewer}:passenger-report:${id}`,
        rawReference: `passenger-report:${id}`,
        supportingHazardEventId: null,
      };
      await sql`insert into report.passenger_report_review (report_id, incident_id, reviewer_ref, evidence_json, review_authority, actor_user_id, supporting_reference) values (${id}::uuid, ${deterministicIncidentId}::uuid, ${reviewer}, ${JSON.stringify(evidence)}::jsonb, ${admin ? 'ADMIN_FIELD_REVIEW' : 'CONTROLLED_SIMULATION'}, ${admin?.actorUserId ?? null}::uuid, ${admin?.evidenceReference ?? null})`.execute(
        tx,
      );
      return { evidence, replay: false as const };
    });
    const evidence = claimed.evidence;
    const ingest = await this.lifecycle.ingest(
      evidence,
      'VERIFIED',
      new Date(),
    );
    await this.impacts.whenIdle();
    await this.database.transaction().execute(async (tx) => {
      await sql`insert into report.passenger_report_verification (id, report_id, reviewer_ref, incident_id, decision, operational_state, reason) values (${randomUUID()}::uuid, ${id}::uuid, ${reviewer}, ${deterministicIncidentId}::uuid, 'VERIFIED', ${evidence.operationalState}, ${reason}) on conflict (report_id) do nothing`.execute(
        tx,
      );
      await sql`update report.passenger_report set verification_status=${admin ? 'ADMIN_RESTRICTED' : 'CONTROLLED_VERIFIED'} where id=${id}::uuid`.execute(
        tx,
      );
    });
    return {
      report_id: id,
      verification_status: admin ? 'ADMIN_RESTRICTED' : 'CONTROLLED_VERIFIED',
      incident_id: deterministicIncidentId,
      review_replay: claimed.replay,
      evidence_status: ingest.status,
    };
  }

  /**
   * Terminal control: the same dev/test-only reviewer that asserted a
   * SIMULATED condition can close it (Resolved = condition cleared,
   * Retracted = assertion withdrawn). Keeps controlled evidence from
   * permanently blocking planning between acceptance runs.
   */
  async closeAdmin(input: CloseInput): Promise<Record<string, unknown>> {
    return this.close(input, true);
  }

  async close(
    input: CloseInput,
    admin = false,
  ): Promise<Record<string, unknown>> {
    const id = input.reportId;
    if (
      !UUID.test(id) ||
      !validReference(input.reviewer) ||
      !(CLOSE_DECISIONS as readonly string[]).includes(input.decision) ||
      !validText(input.reason, 1000)
    )
      throw new BadRequestException('Invalid controlled close fields.');
    const row = await sql<{
      incidentId: string;
      reviewerRef: string;
      lifecycle: string;
      reviewAuthority: string;
    }>`select review.incident_id as "incidentId", review.reviewer_ref as "reviewerRef", review.review_authority as "reviewAuthority", incident.lifecycle_status as lifecycle from report.passenger_report_review review join disruption.operational_incident incident on incident.id=review.incident_id where review.report_id=${id}::uuid`.execute(
      this.database,
    );
    const claimed = row.rows[0];
    if (!claimed)
      throw new NotFoundException('Report has no controlled review.');
    if (
      admin
        ? claimed.reviewAuthority !== 'ADMIN_FIELD_REVIEW'
        : claimed.reviewAuthority !== 'CONTROLLED_SIMULATION' ||
          claimed.reviewerRef !== input.reviewer
    )
      throw new ForbiddenException(
        'Close must be performed by the original reviewing authority.',
      );
    if (claimed.lifecycle !== 'VERIFIED_ACTIVE')
      throw new ConflictException('Reviewed incident is not active.');
    const projection = await this.lifecycle.transition({
      incidentId: claimed.incidentId,
      toStatus: input.decision as 'RESOLVED' | 'RETRACTED',
      changedAt: new Date().toISOString(),
      reason: input.reason,
      provenanceRef: `${admin ? 'admin-field-review' : 'controlled-review'}:${input.reviewer}:passenger-report:${id}:close`,
    });
    await this.impacts.whenIdle();
    return {
      report_id: id,
      incident_id: claimed.incidentId,
      lifecycle_status: projection.lifecycleStatus,
      decision: input.decision,
    };
  }

  private map(row: ReportRow): Record<string, unknown> {
    return {
      report_id: row.id,
      active_journey_id: row.activeJourneyId,
      category: row.category,
      observed_at: row.observationTime.toISOString(),
      received_at: row.receivedAt.toISOString(),
      mobility_entity_id: row.mobilityEntityId,
      entity_type: row.entityType,
      description: row.description,
      source: row.source,
      verification_status: row.verificationStatus,
      created_at: row.receivedAt.toISOString(),
    };
  }
}
