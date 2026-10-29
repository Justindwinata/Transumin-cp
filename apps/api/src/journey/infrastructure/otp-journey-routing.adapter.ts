import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { Injectable } from '@nestjs/common';
import {
  ROUTING_SEARCH_PROFILES,
  searchPreferences,
} from './routing-search-profiles.js';

import {
  productModeForRouterEntity,
  type FeedKey,
  type ProductMode,
} from '../../routing-data/domain/otp-input.js';
import type {
  JourneyRoutingPort,
  RouterHealth,
  RouterPlanRequest,
} from '../application/journey-routing.port.js';
import {
  type JourneyAlternative,
  type JourneyLeg,
  type JourneyTimingPrecision,
  type JourneyWalkingStep,
  JourneyRoutingError,
} from '../domain/journey.js';

const repositoryRoot = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);
const routerManifestPath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-4B-A-ROUTER-INPUT.json',
);
const runtimeManifestPath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-4B-A-OTP-RUNTIME.json',
);

type OtpStop = Readonly<{
  gtfsId: string;
  name: string;
  lat: number;
  lon: number;
}>;
type OtpLeg = Readonly<{
  mode: string;
  serviceDate: string | null;
  distance: number | null;
  duration: number | null;
  from: {
    name: string;
    lat: number;
    lon: number;
    stop: { gtfsId: string } | null;
  };
  to: {
    name: string;
    lat: number;
    lon: number;
    stop: { gtfsId: string } | null;
  };
  route: { gtfsId: string; shortName: string | null } | null;
  trip: { gtfsId: string } | null;
  intermediateStops: readonly OtpStop[] | null;
  steps?: readonly OtpWalkStep[] | null;
  legGeometry: { points: string | null } | null;
  start: { scheduledTime: string };
  end: { scheduledTime: string };
}>;
type OtpWalkStep = Readonly<{
  lat: number | null;
  lon: number | null;
  distance: number | null;
  streetName: string | null;
  relativeDirection: string | null;
  absoluteDirection: string | null;
  area: boolean | null;
  bogusName: boolean | null;
  stayOn: boolean | null;
}>;
type OtpPlan = Readonly<{
  planConnection: {
    routingErrors: readonly { code: string; description: string }[];
    edges: readonly {
      node: {
        start: string;
        end: string;
        duration: number;
        walkDistance: number;
        legs: readonly OtpLeg[];
      };
    }[];
  };
}>;

type RouterManifest = Readonly<{
  snapshotId: string;
  timezone: 'Asia/Jakarta';
  serviceDates: readonly { representativeDate: string }[];
}>;
type RuntimeManifest = Readonly<{
  otp: { version: string };
  graph: { sha256: string };
}>;

const planQuery = `
query ProductJourneyPlan(
  $origin: PlanLabeledLocationInput!,
  $destination: PlanLabeledLocationInput!,
  $dateTime: PlanDateTimeInput!,
  $modes: PlanModesInput!,
  $preferences: PlanPreferencesInput,
  $first: Int!
) {
  planConnection(
    origin: $origin,
    destination: $destination,
    dateTime: $dateTime,
    modes: $modes,
    preferences: $preferences,
    itineraryFilter: {
      groupSimilarityKeepOne: 0.85,
      groupSimilarityKeepThree: 0.68
    },
    first: $first
  ) {
    routingErrors { code description }
    edges {
      node {
        start end duration walkDistance
        legs {
          mode serviceDate distance duration
          from { name lat lon stop { gtfsId } }
          to { name lat lon stop { gtfsId } }
          route { gtfsId shortName }
          trip { gtfsId }
          intermediateStops { gtfsId name lat lon }
          steps {
            lat lon distance streetName relativeDirection absoluteDirection area bogusName stayOn
          }
          legGeometry { points }
          start { scheduledTime }
          end { scheduledTime }
        }
      }
    }
  }
}`;

@Injectable()
export class OtpJourneyRoutingAdapter implements JourneyRoutingPort {
  private readonly inFlightSearches = new Map<
    string,
    Promise<readonly OtpPlan[]>
  >();
  private readonly endpoint =
    process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1';
  private readonly routerManifest = JSON.parse(
    readFileSync(routerManifestPath, 'utf8'),
  ) as RouterManifest;
  private readonly runtimeManifest = JSON.parse(
    readFileSync(runtimeManifestPath, 'utf8'),
  ) as RuntimeManifest;
  private readonly manifestSha256 = createHash('sha256')
    .update(readFileSync(routerManifestPath))
    .digest('hex');

  async planJourney(
    request: RouterPlanRequest,
  ): Promise<readonly JourneyAlternative[]> {
    const allowedModes = request.allowedModes ?? [
      'WALK',
      'TRANSJAKARTA',
      'MIKROTRANS',
      'KRL',
      'MRT_JAKARTA',
      'LRT_JAKARTA',
      'LRT_JABODEBEK',
    ];
    const otpTransitModes = [
      ...new Set(
        allowedModes.flatMap((mode) =>
          mode === 'TRANSJAKARTA' || mode === 'MIKROTRANS'
            ? ['BUS']
            : mode === 'KRL'
              ? ['RAIL']
              : mode === 'MRT_JAKARTA'
                ? ['SUBWAY']
                : mode === 'LRT_JAKARTA' || mode === 'LRT_JABODEBEK'
                  ? ['TRAM']
                  : [],
        ),
      ),
    ];
    const transitEnabled = otpTransitModes.length > 0;
    // Mixed research feeds only evidence their manifested common service dates.
    // OTP may return walking-only edges instead of OUTSIDE_SERVICE_PERIOD.
    const departure = new Date(request.departureAt);
    const serviceDate = Number.isFinite(departure.getTime())
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: this.routerManifest.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(departure)
      : '';
    if (
      transitEnabled &&
      !this.routerManifest.serviceDates.some(
        (entry) => entry.representativeDate === serviceDate,
      )
    )
      throw new JourneyRoutingError(
        'INVALID_TIME',
        'Requested time is outside the manifested service dates. Choose a supported historical service date.',
        {
          supportedServiceDates: [
            ...new Set(
              this.routerManifest.serviceDates.map(
                (entry) => entry.representativeDate,
              ),
            ),
          ],
        },
      );
    const variables = {
      origin: {
        label: 'Titik awal',
        location: { coordinate: request.origin },
      },
      destination: {
        label: 'Tujuan',
        location: { coordinate: request.destination },
      },
      dateTime: { earliestDeparture: request.departureAt },
      modes: transitEnabled
        ? {
            direct: allowedModes.includes('WALK') ? ['WALK'] : [],
            transit: {
              access: ['WALK'],
              egress: ['WALK'],
              transfer: ['WALK'],
              transit: otpTransitModes.map((mode) => ({ mode })),
            },
          }
        : { direct: ['WALK'], directOnly: true },
      first: Math.max(6, (request.maximumAlternatives ?? 3) * 4),
    };
    const profiles = transitEnabled
      ? ROUTING_SEARCH_PROFILES
      : ROUTING_SEARCH_PROFILES.slice(0, 1);
    // Rapid ranking changes share only an identical in-flight network search.
    // Completed results/errors are not cached; every call still validates current
    // canonical operational state and outages cannot be masked by a stale cache.
    const searchKey = JSON.stringify({
      variables,
      excludedRoutes: request.excludedRouteIds,
    });
    let pending = this.inFlightSearches.get(searchKey);
    if (!pending) {
      pending = Promise.all(
        profiles.map((profile) =>
          this.query<OtpPlan>(planQuery, {
            ...variables,
            ...('busOnly' in profile && otpTransitModes.includes('BUS')
              ? {
                  modes: {
                    direct: allowedModes.includes('WALK') ? ['WALK'] : [],
                    transit: {
                      access: ['WALK'],
                      egress: ['WALK'],
                      transfer: ['WALK'],
                      transit: [{ mode: 'BUS' }],
                    },
                  },
                }
              : {}),
            preferences: searchPreferences(profile, request.excludedRouteIds),
          }),
        ),
      );
      this.inFlightSearches.set(searchKey, pending);
      void pending.then(
        () => this.inFlightSearches.delete(searchKey),
        () => this.inFlightSearches.delete(searchKey),
      );
    }
    const payloads = await pending;
    const edges = payloads.flatMap((payload) => payload.planConnection.edges);
    const errors = payloads.flatMap(
      (payload) => payload.planConnection.routingErrors,
    );
    if (
      edges.length === 0 &&
      errors.some((item) => item.code === 'OUTSIDE_SERVICE_PERIOD')
    )
      throw new JourneyRoutingError(
        'INVALID_TIME',
        'Requested time is outside the manifested service period.',
        { routingErrors: errors },
      );

    // Collapse identical physical itineraries before expensive identity lookups.
    // The shortest duration wins within a path, with earliest arrival as a tie.
    const unique = new Map<string, (typeof edges)[number]>();
    for (const edge of [...edges].sort(
      (a, b) =>
        a.node.duration - b.node.duration ||
        a.node.end.localeCompare(b.node.end),
    )) {
      const key = JSON.stringify(
        edge.node.legs.map((leg) => ({
          mode: leg.mode,
          route: leg.route?.gtfsId,
          from: leg.from.stop?.gtfsId ?? [leg.from.lat, leg.from.lon],
          to: leg.to.stop?.gtfsId ?? [leg.to.lat, leg.to.lon],
        })),
      );
      if (!unique.has(key)) unique.set(key, edge);
    }
    return [...unique.values()].map(({ node }) => {
      const legs = node.legs.map((leg, sequence) =>
        normalizeLeg(leg, sequence),
      );
      return {
        journeyId: 'pending-state-validation',
        origin: request.origin,
        destination: request.destination,
        startAt: node.start,
        endAt: node.end,
        durationSeconds: node.duration,
        transferCount: Math.max(
          0,
          legs.filter((leg) => leg.mode !== 'WALK').length - 1,
        ),
        walkingDistanceMeters: node.walkDistance,
        legs,
        fareStatus: 'UNKNOWN',
        routingContext: {
          provider: 'OTP',
          providerVersion: '2.10.0',
          routingSnapshotId: this.routerManifest.snapshotId,
          routingManifestSha256: this.manifestSha256,
          graphSha256: this.runtimeManifest.graph.sha256,
          networkSnapshotId: request.networkSnapshotId,
          networkSnapshotHash: 'pending-state-validation',
          mobilityProjectionVersion: 'pending-state-validation',
          plannedAt: new Date().toISOString(),
          commonServiceDate:
            this.routerManifest.serviceDates[0]?.representativeDate ?? '',
          timezone: this.routerManifest.timezone,
          attemptCount: request.attempt,
          excludedRouteIds: request.excludedRouteIds,
        },
      };
    });
  }

  async routerHealth(): Promise<RouterHealth> {
    const started = performance.now();
    try {
      await this.query<{ __typename: string }>('{ __typename }', {});
      return {
        status: 'AVAILABLE',
        provider: 'OTP',
        version: this.runtimeManifest.otp.version,
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: round(performance.now() - started),
      };
    } catch {
      return {
        status: 'UNAVAILABLE',
        provider: 'OTP',
        version: this.runtimeManifest.otp.version,
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: round(performance.now() - started),
      };
    }
  }

  routingSnapshot() {
    return {
      snapshotId: this.routerManifest.snapshotId,
      manifestSha256: this.manifestSha256,
      graphSha256: this.runtimeManifest.graph.sha256,
      commonServiceDate:
        this.routerManifest.serviceDates[0]?.representativeDate ?? '',
      timezone: this.routerManifest.timezone,
    } as const;
  }

  private async query<T>(document: string, variables: object): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: document, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new JourneyRoutingError(
        'ROUTER_UNAVAILABLE',
        'OTP could not be reached.',
        { cause: error instanceof Error ? error.message : 'unknown' },
      );
    }
    if (!response.ok)
      throw new JourneyRoutingError(
        'ROUTER_UNAVAILABLE',
        `OTP returned HTTP ${response.status}.`,
      );
    const payload = (await response.json()) as {
      data?: T;
      errors?: readonly { message: string }[];
    };
    if (payload.errors !== undefined || payload.data === undefined)
      throw new JourneyRoutingError(
        'ROUTER_UNAVAILABLE',
        'OTP returned an invalid GraphQL response.',
        { errors: payload.errors ?? [] },
      );
    return payload.data;
  }
}

export function normalizeLeg(leg: OtpLeg, sequence: number): JourneyLeg {
  const routeIdentity =
    leg.route === null ? null : parseNamespacedId(leg.route.gtfsId);
  const mode =
    routeIdentity === null
      ? ('WALK' as const)
      : productModeForRouterEntity({
          feedKey: routeIdentity.feedKey,
          otpMode: leg.mode,
        });
  return {
    sequence,
    mode,
    otpMode: leg.mode,
    from: {
      name: leg.from.name,
      otpStopId: leg.from.stop?.gtfsId ?? null,
      latitude: leg.from.lat,
      longitude: leg.from.lon,
    },
    to: {
      name: leg.to.name,
      otpStopId: leg.to.stop?.gtfsId ?? null,
      latitude: leg.to.lat,
      longitude: leg.to.lon,
    },
    intermediateStops: (leg.intermediateStops ?? []).map((stop) => ({
      name: stop.name,
      otpStopId: stop.gtfsId,
      latitude: stop.lat,
      longitude: stop.lon,
    })),
    startAt: leg.start.scheduledTime,
    endAt: leg.end.scheduledTime,
    durationSeconds: leg.duration ?? 0,
    distanceMeters: leg.distance ?? 0,
    routeId: leg.route?.gtfsId ?? null,
    routeShortName: leg.route?.shortName ?? null,
    tripId: leg.trip?.gtfsId ?? null,
    serviceDate: leg.serviceDate,
    timingPrecision: timingPrecision(mode),
    geometry: decodeLegGeometry(leg.legGeometry?.points ?? null),
    walkingSteps:
      mode === 'WALK' ? normalizeWalkingSteps(leg.steps ?? null) : [],
    entityBindings: [],
    operationalFlags: [],
  };
}

function decodeLegGeometry(encoded: string | null): JourneyLeg['geometry'] {
  if (!encoded || encoded.length > 120_000) return null;
  const coordinates: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  function delta(): number | null {
    let value = 0;
    for (let shift = 0; shift <= 25; shift += 5) {
      if (index >= encoded!.length) return null;
      const byte = encoded!.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null;
      value += (byte & 31) * 2 ** shift;
      if (byte < 32) return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
    }
    return null;
  }
  while (index < encoded.length) {
    if (coordinates.length >= 10_000) return null;
    const latitudeDelta = delta();
    const longitudeDelta = delta();
    if (latitudeDelta === null || longitudeDelta === null) return null;
    latitude += latitudeDelta;
    longitude += longitudeDelta;
    if (Math.abs(latitude) > 9_000_000 || Math.abs(longitude) > 18_000_000)
      return null;
    coordinates.push([longitude / 1e5, latitude / 1e5]);
  }
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

export function normalizeWalkingSteps(
  steps: readonly OtpWalkStep[] | null,
): JourneyWalkingStep[] {
  if (!steps) return [];
  const normalized: JourneyWalkingStep[] = [];
  for (const step of steps) {
    if (!step) continue;
    const { lat, lon, distance } = step;
    if (
      lat === null ||
      lon === null ||
      distance === null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(distance) ||
      distance < 0
    )
      continue;
    normalized.push({
      latitude: lat,
      longitude: lon,
      distanceMeters: distance,
      relativeDirection: step.relativeDirection ?? null,
      absoluteDirection: step.absoluteDirection ?? null,
      streetName: step.streetName ?? null,
      bogusName: step.bogusName === true,
      area: step.area === true,
      stayOn: step.stayOn === true,
    });
  }
  // Steps remain in OTP order, including the DEPART step at the leg origin.
  return normalized;
}

export function parseNamespacedId(value: string): Readonly<{
  feedKey: FeedKey;
  entityType: string;
  originalId: string;
}> | null {
  const match = /(?:^|:)tnx:(tj|mikro|krl|mrt|lrtj|lrtjb):([^:]+):(.+)$/.exec(
    value,
  );
  if (match === null) return null;
  return {
    feedKey: match[1] as FeedKey,
    entityType: match[2] as string,
    originalId: decodeURIComponent(match[3] as string),
  };
}

function timingPrecision(mode: ProductMode): JourneyTimingPrecision {
  if (mode === 'KRL') return 'EXACT_SCHEDULE';
  if (
    mode === 'MRT_JAKARTA' ||
    mode === 'LRT_JAKARTA' ||
    mode === 'LRT_JABODEBEK'
  )
    return 'FREQUENCY_DERIVED';
  if (mode === 'TRANSJAKARTA' || mode === 'MIKROTRANS')
    return 'SOURCE_GTFS_WITH_FREQUENCIES';
  return 'ESTIMATED';
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
