import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Get,
  Header,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { JourneyPlannerService } from '../application/journey-planner.service.js';
import type {
  GeoPoint,
  JourneyAlternative,
  JourneyPlanRequest,
} from '../domain/journey.js';
import { JourneyRoutingError } from '../domain/journey.js';

type JourneyPlanBody = Readonly<{
  origin?: GeoPoint | null;
  destination?: GeoPoint | null;
  departure_at?: string;
  network_snapshot_id?: string;
  preference?: JourneyPlanRequest['preference'];
}>;

@Controller('journeys')
export class JourneyController {
  constructor(
    @Inject(JourneyPlannerService)
    private readonly planner: JourneyPlannerService,
  ) {}

  @Get('planning-health')
  @Header('cache-control', 'no-store')
  async planningHealth(): Promise<Record<string, unknown>> {
    const health = await this.planner.health();
    return {
      data: {
        status: health.status,
        provider: health.provider,
        version: health.version,
        checked_at: health.checkedAt,
        latency_milliseconds: health.latencyMilliseconds,
      },
    };
  }

  @Post('plan')
  async plan(@Body() body: JourneyPlanBody): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    const request = parseRequest(body, requestId);
    try {
      const result = await this.planner.plan(request);
      return {
        data: result.alternatives.map(mapAlternative),
        meta: {
          request_id: requestId,
          warnings: [],
          provenance: {
            evidence_type: 'SCHEDULED',
            reference_ids: [
              'data/manifests/PHASE-4B-A-ROUTER-INPUT.json',
              'data/manifests/PHASE-4B-A-OTP-RUNTIME.json',
              `network-snapshot:${request.networkSnapshotId}`,
            ],
            observed_at: null,
            limitations: [
              'Fare is unavailable.',
              'Frequency-derived legs are not exact departure guarantees.',
            ],
          },
          planning: {
            strategy: result.strategy,
            rejected_candidate_count: result.rejectedCandidateCount,
            candidate_rejections: (result.candidateRejections ?? []).map(
              (rejection) => ({
                attempt: rejection.attempt,
                route_ids: [...rejection.routeIds],
                blocked_entity_ids: [...rejection.blockedEntityIds],
                reason: rejection.reason,
              }),
            ),
            routing_ms: result.routingMilliseconds,
            state_validation_ms: result.stateValidationMilliseconds,
            total_ms: result.totalMilliseconds,
          },
        },
      };
    } catch (error) {
      if (error instanceof JourneyRoutingError)
        throw mapRoutingError(error, requestId);
      throw new ServiceUnavailableException({
        error: {
          code: 'ROUTER_UNAVAILABLE',
          message: 'Journey planning could not be completed.',
          request_id: requestId,
        },
      });
    }
  }
}

function parseRequest(
  body: JourneyPlanBody,
  requestId: string,
): JourneyPlanRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    invalid('request body must be an object.', requestId);
  assertPoint(body.origin, 'origin', requestId);
  assertPoint(body.destination, 'destination', requestId);
  if (
    typeof body.departure_at !== 'string' ||
    !isExplicitDateTime(body.departure_at)
  )
    invalid(
      'departure_at must be a valid RFC3339 date-time with timezone.',
      requestId,
    );
  if (
    body.network_snapshot_id === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.network_snapshot_id,
    )
  )
    invalid('network_snapshot_id must be a UUID.', requestId);
  const preference = body.preference ?? 'BALANCED';
  if (
    !['BALANCED', 'FASTEST', 'FEWEST_TRANSFERS', 'LEAST_WALKING'].includes(
      preference,
    )
  )
    invalid('preference is invalid.', requestId);
  return {
    origin: body.origin,
    destination: body.destination,
    departureAt: body.departure_at,
    networkSnapshotId: body.network_snapshot_id,
    preference,
    maximumAlternatives: 3,
  };
}

function isExplicitDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (match === null) return false;
  const [, year, month, day, hour, minute, second, , timezone] = match;
  if (
    timezone !== undefined &&
    timezone !== 'Z' &&
    (Number(timezone.slice(1, 3)) > 23 || Number(timezone.slice(4)) > 59)
  )
    return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const y = Number(year);
  const leapYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const daysInMonth =
    [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
      Number(month) - 1
    ] ?? 0;
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59
  );
}

function assertPoint(
  point: GeoPoint | null | undefined,
  field: string,
  requestId: string,
): asserts point is GeoPoint {
  if (
    point === null ||
    point === undefined ||
    typeof point !== 'object' ||
    Array.isArray(point) ||
    !Number.isFinite((point as GeoPoint).latitude) ||
    !Number.isFinite((point as GeoPoint).longitude) ||
    (point as GeoPoint).latitude < -90 ||
    (point as GeoPoint).latitude > 90 ||
    (point as GeoPoint).longitude < -180 ||
    (point as GeoPoint).longitude > 180
  )
    invalid(`${field} must contain valid latitude and longitude.`, requestId);
}

function invalid(message: string, requestId: string): never {
  throw new BadRequestException({
    error: { code: 'INVALID_PARAMETER', message, request_id: requestId },
  });
}

export function mapAlternative(journey: JourneyAlternative) {
  return {
    journey_id: journey.journeyId,
    origin: journey.origin,
    destination: journey.destination,
    network_snapshot_id: journey.routingContext.networkSnapshotId,
    status: 'PLANNED',
    start_at: journey.startAt,
    end_at: journey.endAt,
    duration_seconds: journey.durationSeconds,
    transfer_count: journey.transferCount,
    walking_distance_meters: journey.walkingDistanceMeters,
    fare_status: journey.fareStatus,
    segments: journey.legs.map((leg) => ({
      sequence: leg.sequence,
      mode: leg.mode,
      otp_mode: leg.otpMode,
      from: {
        name: leg.from.name,
        otp_stop_id: leg.from.otpStopId,
        latitude: leg.from.latitude ?? null,
        longitude: leg.from.longitude ?? null,
      },
      to: {
        name: leg.to.name,
        otp_stop_id: leg.to.otpStopId,
        latitude: leg.to.latitude ?? null,
        longitude: leg.to.longitude ?? null,
      },
      start_at: leg.startAt,
      end_at: leg.endAt,
      duration_seconds: leg.durationSeconds,
      distance_meters: leg.distanceMeters,
      route_id: leg.routeId,
      route_short_name: leg.routeShortName,
      trip_id: leg.tripId,
      service_date: leg.serviceDate,
      timing_precision: leg.timingPrecision,
      geometry: leg.geometry ?? null,
      walking_steps: (leg.walkingSteps ?? []).map((step) => ({
        latitude: step.latitude,
        longitude: step.longitude,
        distance_meters: step.distanceMeters,
        relative_direction: step.relativeDirection,
        absolute_direction: step.absoluteDirection,
        street_name: step.streetName,
        bogus_name: step.bogusName,
        area: step.area,
        stay_on: step.stayOn,
      })),
      evidence_type: leg.mode === 'WALK' ? 'ESTIMATED' : 'SCHEDULED',
      entity_bindings: leg.entityBindings.map((binding) => ({
        otp_entity_id: binding.otpEntityId,
        canonical_entity_id: binding.canonicalEntityId,
        mobility_entity_id: binding.mobilityEntityId,
        entity_type: binding.entityType,
        resolution_method: binding.resolutionMethod,
        provenance_ref: binding.provenanceRef,
      })),
      operational_flags: leg.operationalFlags.map((flag) => ({
        mobility_entity_id: flag.mobilityEntityId,
        availability: flag.operationalState,
        evidence_type: flag.evidenceType,
        freshness_status: flag.freshnessStatus,
        provenance_ref: flag.provenanceRef,
      })),
    })),
    routing_context: {
      provider: journey.routingContext.provider,
      provider_version: journey.routingContext.providerVersion,
      routing_snapshot_id: journey.routingContext.routingSnapshotId,
      routing_manifest_sha256: journey.routingContext.routingManifestSha256,
      graph_sha256: journey.routingContext.graphSha256,
      network_snapshot_id: journey.routingContext.networkSnapshotId,
      network_snapshot_hash: journey.routingContext.networkSnapshotHash,
      mobility_projection_version:
        journey.routingContext.mobilityProjectionVersion,
      planned_at: journey.routingContext.plannedAt,
      common_service_date: journey.routingContext.commonServiceDate,
      timezone: journey.routingContext.timezone,
      attempt_count: journey.routingContext.attemptCount,
      excluded_route_ids: journey.routingContext.excludedRouteIds,
    },
  };
}

function mapRoutingError(error: JourneyRoutingError, requestId: string): Error {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      request_id: requestId,
      details: error.details,
    },
  };
  if (error.code === 'ROUTER_UNAVAILABLE')
    return new ServiceUnavailableException(body);
  return new UnprocessableEntityException(body);
}
