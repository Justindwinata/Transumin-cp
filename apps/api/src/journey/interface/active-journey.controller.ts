import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import { OperationalEventBus } from '../../disruption/application/operational-event-bus.js';
import { ActiveJourneyService } from '../application/active-journey.service.js';
import type { ActiveJourney, JourneyAlert } from '../domain/active-journey.js';
import { ActiveJourneyError } from '../domain/active-journey.js';
import type {
  CanonicalEntityBinding,
  GeoPoint,
  JourneyAlternative,
  JourneyLeg,
  JourneyOperationalFlag,
  RoutingContext,
} from '../domain/journey.js';
import { mapAlternative } from './journey.controller.js';
import { PassengerServiceGuard } from './passenger-service.guard.js';

@Controller('journeys')
@UseGuards(PassengerServiceGuard)
export class ActiveJourneyController {
  constructor(
    @Inject(ActiveJourneyService)
    private readonly journeys: ActiveJourneyService,
    @Inject(OperationalEventBus)
    private readonly events: OperationalEventBus,
  ) {}

  @Post(':journeyId/activate')
  async activate(
    @Param('journeyId') journeyId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { selected_journey?: unknown; activated_at?: string },
  ): Promise<Record<string, unknown>> {
    try {
      const owner = requiredOwner(ownerRef);
      const selected = parseSelectedJourney(body.selected_journey, journeyId);
      if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))
        throw new BadRequestException('Valid Idempotency-Key is required.');
      const active = await this.journeys.activate({
        ownerRef: owner,
        selectedJourney: selected,
        activatedAt: body.activated_at,
        idempotencyKey,
      });
      return envelope(mapActiveJourney(active));
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Get(':journeyId')
  async get(
    @Param('journeyId') journeyId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ): Promise<Record<string, unknown>> {
    try {
      return envelope(
        mapActiveJourney(
          await this.journeys.get(journeyId, requiredOwner(ownerRef)),
        ),
      );
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Patch(':journeyId/progress')
  async progress(
    @Param('journeyId') journeyId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Body()
    body: {
      completed_segment_count?: number;
      current_segment_sequence?: number | null;
      recorded_at?: string;
      accepted_recovery_id?: unknown;
    },
  ): Promise<Record<string, unknown>> {
    if (
      body.completed_segment_count === undefined ||
      body.recorded_at === undefined
    )
      throw new BadRequestException('Progress fields are required.');
    try {
      return envelope(
        mapActiveJourney(
          await this.journeys.updateProgress({
            journeyId,
            ownerRef: requiredOwner(ownerRef),
            completedLegCount: body.completed_segment_count,
            currentLegSequence: body.current_segment_sequence ?? null,
            recordedAt: body.recorded_at,
            acceptedRecoveryId: routeId(body.accepted_recovery_id),
          }),
        ),
      );
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Post(':journeyId/boarding/:legSequence')
  async boarding(
    @Param('journeyId') journeyId: string,
    @Param('legSequence') legSequence: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Body() body: { confirmed_at?: unknown; accepted_recovery_id?: unknown },
  ): Promise<Record<string, unknown>> {
    const sequence = Number(legSequence);
    if (!Number.isInteger(sequence) || sequence < 0)
      throw new BadRequestException(
        'legSequence must be a non-negative integer.',
      );
    if (body.confirmed_at === undefined)
      throw new BadRequestException('confirmed_at is required.');
    const confirmedAt = timestamp(body.confirmed_at, 'confirmed_at');
    try {
      return envelope(
        mapActiveJourney(
          await this.journeys.confirmBoarding({
            journeyId,
            ownerRef: requiredOwner(ownerRef),
            legSequence: sequence,
            confirmedAt,
            acceptedRecoveryId: routeId(body.accepted_recovery_id),
          }),
        ),
      );
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Post(':journeyId/alighting/:legSequence')
  async alighting(
    @Param('journeyId') journeyId: string,
    @Param('legSequence') legSequence: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Body() body: { confirmed_at?: unknown; accepted_recovery_id?: unknown },
  ): Promise<Record<string, unknown>> {
    const sequence = Number(legSequence);
    if (!Number.isInteger(sequence) || sequence < 0)
      throw new BadRequestException(
        'legSequence must be a non-negative integer.',
      );
    if (body.confirmed_at === undefined)
      throw new BadRequestException('confirmed_at is required.');
    const confirmedAt = timestamp(body.confirmed_at, 'confirmed_at');
    try {
      return envelope(
        mapActiveJourney(
          await this.journeys.confirmAlighting({
            journeyId,
            ownerRef: requiredOwner(ownerRef),
            legSequence: sequence,
            confirmedAt,
            acceptedRecoveryId: routeId(body.accepted_recovery_id),
          }),
        ),
      );
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Get(':journeyId/status')
  async status(
    @Param('journeyId') journeyId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ): Promise<Record<string, unknown>> {
    try {
      const owner = requiredOwner(ownerRef);
      const [journey, alerts] = await Promise.all([
        this.journeys.get(journeyId, owner),
        this.journeys.listAlerts(journeyId, owner),
      ]);
      const openAlerts = alerts.filter((alert) => alert.resolvedAt === null);
      return envelope({
        journey_id: journey.journeyId,
        status: journey.lifecycleStatus,
        availability: openAlerts.some((alert) => alert.alertType === 'BLOCKING')
          ? 'UNAVAILABLE'
          : openAlerts.length > 0
            ? 'DISRUPTED'
            : 'UNKNOWN',
        progress: mapProgress(journey),
        open_alert_count: openAlerts.length,
      });
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Get(':journeyId/alerts')
  async alerts(
    @Param('journeyId') journeyId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
  ): Promise<Record<string, unknown>> {
    try {
      return envelope(
        (
          await this.journeys.listAlerts(journeyId, requiredOwner(ownerRef))
        ).map(mapAlert),
      );
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }

  @Sse(':journeyId/alerts/stream')
  async alertStream(
    @Param('journeyId') journeyId: string,
    @Headers('x-journey-owner') ownerRef: string | undefined,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    try {
      const owner = requiredOwner(ownerRef);
      await this.journeys.get(journeyId, owner);
      return this.events.streamJourney(journeyId, owner, lastEventId).pipe(
        map((event) => ({
          id: event.id,
          type: event.type,
          data: event,
          retry: 5000,
        })),
      );
    } catch (error) {
      throw mapActiveJourneyError(error);
    }
  }
}

function mapActiveJourney(journey: ActiveJourney): Record<string, unknown> {
  return {
    ...mapAlternative(journey.currentPlan ?? journey.originalPlan),
    journey_id: journey.journeyId,
    plan_journey_id: journey.originalPlan.journeyId,
    status: journey.lifecycleStatus,
    activated_at: journey.activatedAt,
    completed_at: journey.completedAt,
    plan_fingerprint: journey.planFingerprint,
    accepted_recovery_id: journey.acceptedRecoveryId ?? null,
    accepted_before_segment_count: journey.acceptedBeforeLegCount ?? null,
    original_plan: mapAlternative(journey.originalPlan),
    progress: mapProgress(journey),
    dependencies: journey.dependencies.map((dependency) => ({
      dependency_id: dependency.dependencyId,
      leg_sequence: dependency.legSequence,
      mobility_entity_id: dependency.mobilityEntityId,
      canonical_entity_id: dependency.canonicalEntityId,
      entity_type: dependency.entityType,
      product_mode: dependency.productMode,
      provenance_ref: dependency.provenanceRef,
    })),
  };
}

function mapProgress(journey: ActiveJourney) {
  return {
    completed_segment_count: journey.progress.completedLegCount,
    current_segment_sequence: journey.progress.currentLegSequence,
    method: journey.progress.method,
    recorded_at: journey.progress.recordedAt,
    revision: journey.progress.revision,
    boarding_confirmed_segment_sequence:
      journey.progress.boardingConfirmedLegSequence,
    boarding_confirmed_at: journey.progress.boardingConfirmedAt,
    alighting_confirmed_segment_sequence:
      journey.progress.alightingConfirmedLegSequence,
    alighting_confirmed_at: journey.progress.alightingConfirmedAt,
  };
}

function mapAlert(alert: JourneyAlert) {
  return {
    alert_id: alert.alertId,
    impact_id: alert.impactId,
    journey_id: alert.journeyId,
    alert_type: alert.alertType,
    message: alert.message,
    mobility_entity_id: alert.mobilityEntityId,
    affected_segment_sequences: alert.affectedLegSequences,
    operational_state: alert.operationalState,
    evidence_type: alert.evidenceType,
    freshness_status: alert.freshnessStatus,
    observation_id: alert.observationId,
    source_id: alert.sourceId,
    observed_at: alert.observedAt,
    received_at: alert.receivedAt,
    expires_at: alert.expiresAt,
    provenance_ref: alert.provenanceRef,
    projection_version: alert.projectionVersion,
    created_at: alert.createdAt,
    resolved_at: alert.resolvedAt,
  };
}

function parseSelectedJourney(
  value: unknown,
  journeyId: string,
): JourneyAlternative {
  const journey = record(value, 'selected_journey');
  if (string(journey.journey_id, 'journey_id') !== journeyId)
    throw new BadRequestException(
      'Path journeyId must match selected_journey.',
    );
  if (string(journey.fare_status, 'fare_status') !== 'UNKNOWN')
    throw new BadRequestException(
      'Selected journey fare_status must remain UNKNOWN.',
    );
  const routing = record(journey.routing_context, 'routing_context');
  const legs = array(journey.segments, 'segments').map((value, index) =>
    parseLeg(record(value, `segments[${index}]`)),
  );
  return {
    journeyId,
    origin: point(journey.origin, 'origin'),
    destination: point(journey.destination, 'destination'),
    startAt: string(journey.start_at, 'start_at'),
    endAt: string(journey.end_at, 'end_at'),
    durationSeconds: number(journey.duration_seconds, 'duration_seconds'),
    transferCount: number(journey.transfer_count, 'transfer_count'),
    walkingDistanceMeters: number(
      journey.walking_distance_meters,
      'walking_distance_meters',
    ),
    fareStatus: 'UNKNOWN',
    legs,
    routingContext: parseRoutingContext(routing),
  };
}

function parseLeg(value: Record<string, unknown>): JourneyLeg {
  const mode = oneOf(value.mode, 'mode', [
    'WALK',
    'TRANSJAKARTA',
    'MIKROTRANS',
    'KRL',
    'MRT_JAKARTA',
    'LRT_JAKARTA',
    'LRT_JABODEBEK',
  ] as const);
  const bindings = array(value.entity_bindings, 'entity_bindings').map(
    (binding) => parseBinding(record(binding, 'entity_binding'), mode),
  );
  return {
    sequence: number(value.sequence, 'sequence'),
    mode,
    otpMode: string(value.otp_mode, 'otp_mode'),
    from: endpoint(value.from, 'from'),
    to: endpoint(value.to, 'to'),
    intermediateStops: [],
    startAt: string(value.start_at, 'start_at'),
    endAt: string(value.end_at, 'end_at'),
    durationSeconds: number(value.duration_seconds, 'duration_seconds'),
    distanceMeters: number(value.distance_meters, 'distance_meters'),
    routeId: nullableString(value.route_id, 'route_id'),
    routeShortName: nullableString(value.route_short_name, 'route_short_name'),
    tripId: nullableString(value.trip_id, 'trip_id'),
    serviceDate: nullableString(value.service_date, 'service_date'),
    timingPrecision: oneOf(value.timing_precision, 'timing_precision', [
      'EXACT_SCHEDULE',
      'FREQUENCY_DERIVED',
      'SOURCE_GTFS_WITH_FREQUENCIES',
      'ESTIMATED',
    ] as const),
    geometry: parseGeometry(value.geometry),
    walkingSteps: parseWalkingSteps(value.walking_steps),
    entityBindings: bindings,
    operationalFlags: array(value.operational_flags, 'operational_flags').map(
      (flag) => parseOperationalFlag(record(flag, 'operational_flag')),
    ),
  };
}

function parseWalkingSteps(value: unknown): JourneyLeg['walkingSteps'] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value))
    throw new BadRequestException(
      'segment walking_steps must be an array or null.',
    );
  return value.map((item, index) => {
    const step = record(item, `walking_steps[${index}]`);
    const latitude = number(step.latitude, `walking_steps[${index}].latitude`);
    const longitude = number(
      step.longitude,
      `walking_steps[${index}].longitude`,
    );
    const distanceMeters = number(
      step.distance_meters,
      `walking_steps[${index}].distance_meters`,
    );
    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      distanceMeters < 0
    )
      throw new BadRequestException('walking step coordinates are invalid.');
    return {
      latitude,
      longitude,
      distanceMeters,
      relativeDirection: nullableString(
        step.relative_direction,
        `walking_steps[${index}].relative_direction`,
      ),
      absoluteDirection: nullableString(
        step.absolute_direction,
        `walking_steps[${index}].absolute_direction`,
      ),
      streetName: nullableString(
        step.street_name,
        `walking_steps[${index}].street_name`,
      ),
      bogusName: step.bogus_name === true,
      area: step.area === true,
      stayOn: step.stay_on === true,
    };
  });
}

function parseGeometry(value: unknown): JourneyLeg['geometry'] {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object')
    throw new BadRequestException(
      'segment geometry must be null or an object.',
    );
  const geometry = value as Record<string, unknown>;
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates))
    throw new BadRequestException(
      'segment geometry must be a GeoJSON LineString.',
    );
  if (geometry.coordinates.length > 10_000)
    throw new BadRequestException(
      'segment geometry must contain at most 10000 points.',
    );
  const coordinates = geometry.coordinates.map((coordinate) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length !== 2 ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    )
      throw new BadRequestException(
        'segment geometry coordinates must be [longitude, latitude] pairs.',
      );
    const [longitude, latitude] = coordinate as [number, number];
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
      throw new BadRequestException(
        'segment geometry coordinates are out of range.',
      );
    return [longitude, latitude] as const;
  });
  if (coordinates.length < 2)
    throw new BadRequestException(
      'segment geometry must contain at least two points.',
    );
  return { type: 'LineString' as const, coordinates };
}

function parseBinding(
  value: Record<string, unknown>,
  mode: JourneyLeg['mode'],
): CanonicalEntityBinding {
  return {
    otpEntityId: string(value.otp_entity_id, 'otp_entity_id'),
    productMode: mode,
    canonicalEntityId: string(value.canonical_entity_id, 'canonical_entity_id'),
    mobilityEntityId: nullableString(
      value.mobility_entity_id,
      'mobility_entity_id',
    ),
    entityType: oneOf(value.entity_type, 'entity_type', [
      'STOP',
      'STATION',
      'ROUTE',
    ] as const),
    resolutionMethod: oneOf(value.resolution_method, 'resolution_method', [
      'EXACT_SOURCE_REFERENCE',
      'OPERATOR_SCOPED_EXACT_ALIAS',
      'CONTROLLED_ROUTING_IDENTITY',
    ] as const),
    provenanceRef: string(value.provenance_ref, 'provenance_ref'),
  };
}

function parseOperationalFlag(
  value: Record<string, unknown>,
): JourneyOperationalFlag {
  return {
    mobilityEntityId: string(value.mobility_entity_id, 'mobility_entity_id'),
    operationalState: string(
      value.availability,
      'availability',
    ) as JourneyOperationalFlag['operationalState'],
    evidenceType: nullableString(value.evidence_type, 'evidence_type'),
    freshnessStatus: string(value.freshness_status, 'freshness_status'),
    provenanceRef: nullableString(value.provenance_ref, 'provenance_ref'),
  };
}

function parseRoutingContext(value: Record<string, unknown>): RoutingContext {
  if (string(value.provider, 'provider') !== 'OTP')
    throw new BadRequestException('routing_context.provider must be OTP.');
  if (string(value.provider_version, 'provider_version') !== '2.10.0')
    throw new BadRequestException(
      'routing_context.provider_version must be 2.10.0.',
    );
  if (string(value.timezone, 'timezone') !== 'Asia/Jakarta')
    throw new BadRequestException(
      'routing_context.timezone must be Asia/Jakarta.',
    );
  return {
    provider: 'OTP',
    providerVersion: '2.10.0',
    routingSnapshotId: string(value.routing_snapshot_id, 'routing_snapshot_id'),
    routingManifestSha256: string(
      value.routing_manifest_sha256,
      'routing_manifest_sha256',
    ),
    graphSha256: string(value.graph_sha256, 'graph_sha256'),
    networkSnapshotId: string(value.network_snapshot_id, 'network_snapshot_id'),
    networkSnapshotHash: string(
      value.network_snapshot_hash,
      'network_snapshot_hash',
    ),
    mobilityProjectionVersion: string(
      value.mobility_projection_version,
      'mobility_projection_version',
    ),
    plannedAt: string(value.planned_at, 'planned_at'),
    commonServiceDate: string(value.common_service_date, 'common_service_date'),
    timezone: 'Asia/Jakarta',
    attemptCount: number(value.attempt_count, 'attempt_count'),
    excludedRouteIds: array(value.excluded_route_ids, 'excluded_route_ids').map(
      (item) => string(item, 'excluded_route_id'),
    ),
  };
}

function endpoint(value: unknown, field: string) {
  const item = record(value, field);
  return {
    name: string(item.name, `${field}.name`),
    otpStopId: nullableString(item.otp_stop_id, `${field}.otp_stop_id`),
    latitude: optionalNumber(item.latitude, `${field}.latitude`),
    longitude: optionalNumber(item.longitude, `${field}.longitude`),
  };
}

function point(value: unknown, field: string): GeoPoint {
  const item = record(value, field);
  return {
    latitude: number(item.latitude, `${field}.latitude`),
    longitude: number(item.longitude, `${field}.longitude`),
  };
}

function timestamp(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!Number.isFinite(Date.parse(parsed)))
    throw new BadRequestException(`${field} must be an ISO date-time.`);
  return parsed;
}

function requiredOwner(value: string | undefined): string {
  if (value === undefined)
    throw new ForbiddenException('x-journey-owner is required.');
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value))
    throw new BadRequestException(`${field} must be an array.`);
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new BadRequestException(`${field} must be a non-empty string.`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return string(value, field);
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new BadRequestException(`${field} must be a finite number.`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return number(value, field);
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  field: string,
  values: Values,
): Values[number] {
  const parsed = string(value, field);
  if (!values.includes(parsed))
    throw new BadRequestException(`${field} has an unsupported value.`);
  return parsed as Values[number];
}

function envelope(data: unknown): Record<string, unknown> {
  return { data, meta: { request_id: randomUUID(), warnings: [] } };
}

function mapActiveJourneyError(error: unknown): Error {
  if (!(error instanceof ActiveJourneyError)) return error as Error;
  if (error.code === 'JOURNEY_NOT_FOUND')
    return new NotFoundException(error.message);
  if (error.code === 'OWNER_SCOPE_MISMATCH')
    return new ForbiddenException(error.message);
  if (error.code === 'ACTIVATION_CONFLICT' || error.code === 'STALE_ROUTE')
    return new ConflictException(error.message);
  return new BadRequestException(error.message);
}

function routeId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException(
      'accepted_recovery_id must be a UUID or null.',
    );
  return value;
}
