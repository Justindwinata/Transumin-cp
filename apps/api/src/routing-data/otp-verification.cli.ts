import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  productModeForRouterEntity,
  type FeedKey,
  type ProductMode,
} from './domain/otp-input.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const endpoint = process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1';
const localEvidencePath = path.join(
  repositoryRoot,
  'data/processed/routing/phase4b-a/routeability-evidence.json',
);
const trackedEvidencePath = path.join(
  repositoryRoot,
  'data/manifests/PHASE-4B-A-ROUTEABILITY-EVIDENCE.json',
);

interface GraphQlResponse<T> {
  readonly data?: T;
  readonly errors?: readonly { readonly message: string }[];
}

interface StopResult {
  readonly gtfsId: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

interface RouteResult {
  readonly gtfsId: string;
}

interface StopIdentity {
  readonly gtfsId: string;
  readonly name: string;
}

interface LegResult {
  readonly mode: string;
  readonly serviceDate: string | null;
  readonly distance: number | null;
  readonly duration: number | null;
  readonly from: {
    readonly name: string;
    readonly stop: { readonly gtfsId: string } | null;
  };
  readonly to: {
    readonly name: string;
    readonly stop: { readonly gtfsId: string } | null;
  };
  readonly route: {
    readonly gtfsId: string;
    readonly shortName: string | null;
    readonly mode: string;
    readonly agency: {
      readonly gtfsId: string;
      readonly name: string;
      readonly timezone: string;
    };
  } | null;
  readonly trip: { readonly gtfsId: string } | null;
  readonly intermediateStops: readonly StopIdentity[];
  readonly start: { readonly scheduledTime: string };
  readonly end: { readonly scheduledTime: string };
}

interface PlanResult {
  readonly planConnection: {
    readonly routingErrors: readonly {
      readonly code: string;
      readonly description: string;
    }[];
    readonly edges: readonly {
      readonly node: {
        readonly start: string;
        readonly end: string;
        readonly duration: number;
        readonly walkDistance: number;
        readonly legs: readonly LegResult[];
      };
    }[];
  };
}

const planQuery = `
query Routeability(
  $origin: PlanLabeledLocationInput!,
  $destination: PlanLabeledLocationInput!,
  $dateTime: PlanDateTimeInput!,
  $modes: PlanModesInput!,
  $preferences: PlanPreferencesInput
) {
  planConnection(
    origin: $origin,
    destination: $destination,
    dateTime: $dateTime,
    modes: $modes,
    preferences: $preferences,
    first: 3
  ) {
    routingErrors { code description }
    edges {
      node {
        start end duration walkDistance
        legs {
          mode transitLeg serviceDate distance duration
          from { name stop { gtfsId } }
          to { name stop { gtfsId } }
          route {
            gtfsId shortName mode
            agency { gtfsId name timezone }
          }
          trip { gtfsId }
          intermediateStops { gtfsId name }
          start { scheduledTime }
          end { scheduledTime }
        }
      }
    }
  }
}`;

async function query<T>(document: string, variables: object = {}): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OTP HTTP ${response.status}`);
  const payload = (await response.json()) as GraphQlResponse<T>;
  if (payload.errors !== undefined)
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  if (payload.data === undefined) throw new Error('OTP response has no data');
  return payload.data;
}

function namespacedSuffix(
  feed: FeedKey,
  entity: string,
  original: string,
): string {
  return `:tnx:${feed}:${entity}:${encodeURIComponent(original)}`;
}

const transitCases = [
  {
    productMode: 'TRANSJAKARTA',
    feedKey: 'tj',
    otpMode: 'BUS',
    from: 'B03282P',
    to: 'B03211P',
    dateTime: '2026-10-02T08:00:00+07:00',
    precision: 'SOURCE_GTFS_WITH_FREQUENCIES',
    route: '10A',
  },
  {
    productMode: 'MIKROTRANS',
    feedKey: 'mikro',
    otpMode: 'BUS',
    from: 'B05729P',
    to: 'B01634P',
    dateTime: '2026-10-02T08:00:00+07:00',
    precision: 'SOURCE_GTFS_WITH_FREQUENCIES',
    route: 'JAK.01',
  },
  {
    productMode: 'KRL',
    feedKey: 'krl',
    otpMode: 'RAIL',
    from: 'BOO',
    to: 'CLT',
    dateTime: '2026-10-02T04:00:00+07:00',
    precision: 'EXACT_SCHEDULE',
    route: 'Boo-Jakk',
  },
  {
    productMode: 'MRT_JAKARTA',
    feedKey: 'mrt',
    otpMode: 'SUBWAY',
    from: 'mrt-lebak-bulus',
    to: 'mrt-fatmawati',
    dateTime: '2026-10-02T08:00:00+07:00',
    precision: 'FREQUENCY_DERIVED',
    route: 'MRT_JAKARTA',
  },
  {
    productMode: 'LRT_JAKARTA',
    feedKey: 'lrtj',
    otpMode: 'TRAM',
    from: 'lrtj-kelapa-gading',
    to: 'lrtj-manggarai',
    dateTime: '2026-10-02T06:00:00+07:00',
    precision: 'FREQUENCY_DERIVED',
    route: 'LRT_JAKARTA',
    expectedTripFragment: 'lrt-jakarta-full-eastbound',
    expectedStopCount: 11,
  },
  {
    caseId: 'LRT_JABODEBEK_CIBUBUR_BRANCH',
    productMode: 'LRT_JABODEBEK',
    feedKey: 'lrtjb',
    otpMode: 'TRAM',
    from: 'lrtjb-harjamukti',
    to: 'lrtjb-ciracas',
    dateTime: '2026-10-02T06:00:00+07:00',
    precision: 'FREQUENCY_DERIVED',
    route: 'LRT_JABODEBEK',
    expectedTripFragment: 'lrt-jabodebek-cibubur-inbound',
  },
  {
    caseId: 'LRT_JABODEBEK_BEKASI_BRANCH',
    productMode: 'LRT_JABODEBEK',
    feedKey: 'lrtjb',
    otpMode: 'TRAM',
    from: 'lrtjb-jati-mulya',
    to: 'lrtjb-bekasi-barat',
    dateTime: '2026-10-02T06:00:00+07:00',
    precision: 'FREQUENCY_DERIVED',
    route: 'LRT_JABODEBEK',
    expectedTripFragment: 'lrt-jabodebek-bekasi-inbound',
  },
] as const;

async function verify(): Promise<object> {
  const healthStarted = performance.now();
  await query<{ __typename: string }>('{ __typename }');
  const healthMs = performance.now() - healthStarted;
  const stops = (
    await query<{ stops: readonly StopResult[] }>(
      '{ stops { gtfsId name lat lon } }',
    )
  ).stops;
  const routes = (
    await query<{ routes: readonly RouteResult[] }>('{ routes { gtfsId } }')
  ).routes;
  const transit = [];
  for (const testCase of transitCases) {
    const origin = stops.find((stop) =>
      stop.gtfsId.endsWith(
        namespacedSuffix(testCase.feedKey, 'stop', testCase.from),
      ),
    );
    const destination = stops.find((stop) =>
      stop.gtfsId.endsWith(
        namespacedSuffix(testCase.feedKey, 'stop', testCase.to),
      ),
    );
    if (origin === undefined || destination === undefined)
      throw new Error(
        `${testCase.productMode}: stop identity not found in OTP`,
      );
    const route = routes.find((candidate) =>
      candidate.gtfsId.endsWith(
        namespacedSuffix(testCase.feedKey, 'route', testCase.route),
      ),
    );
    if (route === undefined)
      throw new Error(
        `${testCase.productMode}: route identity not found in OTP`,
      );
    const started = performance.now();
    const result = await query<PlanResult>(planQuery, {
      origin: { location: { stopLocation: { stopLocationId: origin.gtfsId } } },
      destination: {
        location: { stopLocation: { stopLocationId: destination.gtfsId } },
      },
      dateTime: { earliestDeparture: testCase.dateTime },
      modes: {
        direct: [],
        transitOnly: true,
        transit: {
          access: ['WALK'],
          egress: ['WALK'],
          transfer: ['WALK'],
          transit: [{ mode: testCase.otpMode }],
        },
      },
      preferences: {
        transit: { filters: { include: { routes: [route.gtfsId] } } },
      },
    });
    const queryMs = performance.now() - started;
    const itinerary = result.planConnection.edges[0]?.node;
    const targetLeg = itinerary?.legs.find(
      (leg) =>
        leg.route?.gtfsId.includes(`:tnx:${testCase.feedKey}:route:`) === true,
    );
    if (targetLeg === undefined)
      throw new Error(
        `${testCase.productMode}: no target-feed transit leg; ${result.planConnection.routingErrors
          .map((error) => error.code)
          .join(
            ',',
          )}; legs=${JSON.stringify(itinerary?.legs.map((leg) => ({ mode: leg.mode, route: leg.route?.gtfsId })) ?? [])}`,
      );
    const resolvedMode = productModeForRouterEntity({
      feedKey: testCase.feedKey,
      otpMode: targetLeg.mode,
    });
    if (resolvedMode !== testCase.productMode)
      throw new Error(`${testCase.productMode}: product-mode mapping mismatch`);
    if (targetLeg.route?.agency.timezone !== 'Asia/Jakarta')
      throw new Error(`${testCase.productMode}: timezone mismatch`);
    if (
      'expectedTripFragment' in testCase &&
      targetLeg.trip?.gtfsId.includes(testCase.expectedTripFragment) !== true
    )
      throw new Error(`${testCase.productMode}: unexpected trip pattern`);
    const legSequence = [
      ...(targetLeg.from.stop === null
        ? []
        : [
            {
              gtfsId: targetLeg.from.stop.gtfsId,
              name: targetLeg.from.name,
            },
          ]),
      ...targetLeg.intermediateStops,
      ...(targetLeg.to.stop === null
        ? []
        : [{ gtfsId: targetLeg.to.stop.gtfsId, name: targetLeg.to.name }]),
    ];
    if (
      'expectedStopCount' in testCase &&
      legSequence.length !== testCase.expectedStopCount
    )
      throw new Error(
        `${testCase.productMode}: expected ${testCase.expectedStopCount} stops, got ${legSequence.length}`,
      );
    transit.push({
      caseId: 'caseId' in testCase ? testCase.caseId : testCase.productMode,
      productMode: resolvedMode,
      feedKey: testCase.feedKey,
      od: `${origin.name} -> ${destination.name}`,
      requestedDateTime: testCase.dateTime,
      serviceDate: targetLeg.serviceDate,
      otpMode: targetLeg.mode,
      routeId: targetLeg.route.gtfsId,
      tripId: targetLeg.trip?.gtfsId ?? null,
      legSequence,
      scheduledStart: targetLeg.start.scheduledTime,
      scheduledEnd: targetLeg.end.scheduledTime,
      timingPrecision: testCase.precision,
      fare: 'UNKNOWN',
      queryMs: Number(queryMs.toFixed(3)),
      status: 'PASS',
    });
  }
  const walkStarted = performance.now();
  const walkResult = await query<PlanResult>(planQuery, {
    origin: {
      label: 'Dukuh Atas south',
      location: { coordinate: { latitude: -6.2024, longitude: 106.8229 } },
    },
    destination: {
      label: 'Dukuh Atas north',
      location: { coordinate: { latitude: -6.1995, longitude: 106.823 } },
    },
    dateTime: { earliestDeparture: '2026-10-02T08:00:00+07:00' },
    modes: { direct: ['WALK'], directOnly: true },
  });
  const walkMs = performance.now() - walkStarted;
  const walk = walkResult.planConnection.edges[0]?.node;
  if (
    walk === undefined ||
    walk.legs.length === 0 ||
    walk.legs.some((leg) => leg.mode !== 'WALK')
  )
    throw new Error('WALK: OTP did not return a pedestrian-network itinerary');
  const graphPath = path.join(
    repositoryRoot,
    'data/processed/routing/phase4b-a/input/graph.obj',
  );
  const graphBytes = (await stat(graphPath)).size;
  const graphSha256 = createHash('sha256')
    .update(await readFile(graphPath))
    .digest('hex');
  const buildLog = await readFile(
    path.join(
      repositoryRoot,
      'data/processed/routing/phase4b-a/runtime/build.log',
    ),
    'utf8',
  );
  const graphCounts = [
    ...buildLog.matchAll(/Graph built\.\s+\|V\|=([\d,]+) \|E\|=([\d,]+)/g),
  ].at(-1);
  const transitCounts = [
    ...buildLog.matchAll(
      /Transit built\. \|Stops\|=([\d,]+) \|Patterns\|=([\d,]+)/g,
    ),
  ].at(-1);
  if (graphCounts === undefined || transitCounts === undefined)
    throw new Error('OTP build log does not contain graph-count evidence');
  const count = (value: string | undefined): number =>
    Number((value ?? '').replaceAll(',', ''));
  const inputManifestPath = path.join(
    repositoryRoot,
    'data/manifests/PHASE-4B-A-ROUTER-INPUT.json',
  );
  const inputManifest = JSON.parse(
    await readFile(inputManifestPath, 'utf8'),
  ) as {
    readonly snapshotId: string;
    readonly serviceDates: readonly { readonly representativeDate: string }[];
  };
  const commonServiceDates = new Set(
    inputManifest.serviceDates.map((item) => item.representativeDate),
  );
  if (commonServiceDates.size !== 1 || !commonServiceDates.has('2026-10-02'))
    throw new Error(
      'Router input does not use the required common service date',
    );
  const inputManifestSha256 = createHash('sha256')
    .update(await readFile(inputManifestPath))
    .digest('hex');
  return {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    otp: {
      version: '2.10.0',
      commit: '521cd5d8acaae628878f43bf5946f4942c118548',
      endpoint,
      healthMs: Number(healthMs.toFixed(3)),
    },
    graph: {
      filePolicy: 'LOCAL_GIT_IGNORED',
      bytes: graphBytes,
      sha256: graphSha256,
      vertices: count(graphCounts[1]),
      edges: count(graphCounts[2]),
      stops: count(transitCounts[1]),
      patterns: count(transitCounts[2]),
    },
    input: {
      snapshotId: inputManifest.snapshotId,
      manifestSha256: inputManifestSha256,
      commonServiceDate: '2026-10-02',
      timezone: 'Asia/Jakarta',
    },
    walk: {
      productMode: 'WALK' satisfies ProductMode,
      od: 'Dukuh Atas south -> Dukuh Atas north',
      requestedDateTime: '2026-10-02T08:00:00+07:00',
      otpMode: 'WALK',
      networkDistanceM: walk.walkDistance,
      durationSeconds: walk.duration,
      queryMs: Number(walkMs.toFixed(3)),
      fare: 'UNKNOWN',
      legSequence: ['Dukuh Atas south', 'Dukuh Atas north'],
      status: 'PASS',
    },
    transit,
  };
}

const command = process.argv[2];
if (command !== 'verify' && command !== 'record')
  throw new Error('Expected command: verify or record');
const evidence = await verify();
await writeFile(localEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
  mode: 0o600,
});
if (command === 'record')
  await writeFile(
    trackedEvidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
process.stdout.write(`${JSON.stringify(evidence)}\n`);
