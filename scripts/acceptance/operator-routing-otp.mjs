#!/usr/bin/env node
// Real OTP GraphQL acceptance. Read-only, serial, no mocks or DB writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const endpoint = new URL(
  process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1',
);
assert.equal(endpoint.origin, 'http://127.0.0.1:8080');
assert.equal(endpoint.pathname, '/otp/gtfs/v1');
assert.equal(
  endpoint.username + endpoint.password + endpoint.search + endpoint.hash,
  '',
);
const root = resolve(new URL('../..', import.meta.url).pathname);
const manifest = JSON.parse(
  await readFile(`${root}/data/manifests/PHASE-4B-A-ROUTER-INPUT.json`),
);
const runtime = JSON.parse(
  await readFile(`${root}/data/manifests/PHASE-4B-A-OTP-RUNTIME.json`),
);
const query = `query OperatorRouting($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput!, $modes: PlanModesInput!, $first: Int!) { planConnection(origin: $origin, destination: $destination, dateTime: $dateTime, modes: $modes, first: $first) { routingErrors { code description } edges { node { start end duration walkDistance legs { mode serviceDate distance duration from { name lat lon stop { gtfsId } } to { name lat lon stop { gtfsId } } route { gtfsId shortName } trip { gtfsId } intermediateStops { gtfsId name lat lon } legGeometry { points } } } } } }`;
// OTP returns encoded polyline, not coordinate arrays.
export function decodeGeometry(encoded) {
  assert.equal(typeof encoded, 'string');
  const points = [];
  let index = 0,
    lat = 0,
    lon = 0;
  const read = () => {
    let result = 0,
      shift = 0,
      byte;
    do {
      assert.ok(index < encoded.length && shift <= 30, 'invalid polyline');
      byte = encoded.charCodeAt(index++) - 63;
      assert.ok(byte >= 0 && byte <= 63, 'invalid polyline byte');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += read();
    lon += read();
    assert.ok(Math.abs(lat / 1e5) <= 90 && Math.abs(lon / 1e5) <= 180);
    points.push([lon / 1e5, lat / 1e5]);
  }
  assert.ok(points.length >= 2, 'geometry needs two coordinates');
  return points;
}
assert.deepEqual(decodeGeometry('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
  [-120.2, 38.5],
  [-120.95, 40.7],
  [-126.453, 43.252],
]);
assert.throws(() => decodeGeometry('!'));
const productMode = (id) =>
  manifest.modeMapping[id?.match(/:tnx:([^:]+):/)?.[1]];

const cases = [
  {
    id: 'WALK',
    mode: 'WALK',
    origin: [-6.174612, 106.8304],
    destination: [-6.1755, 106.8314],
  },
  {
    id: 'TRANSJAKARTA',
    mode: 'BUS',
    origin: [-6.205627, 106.822295],
    destination: [-6.193596, 106.82306],
  },
  {
    id: 'MIKROTRANS',
    mode: 'BUS',
    origin: [-6.109718, 106.8834],
    destination: [-6.11025, 106.8842],
  },
  {
    id: 'KRL',
    mode: 'RAIL',
    origin: [-6.5942887, 106.7907695],
    destination: [-6.5307239, 106.8006884],
  },
  {
    id: 'MRT_JAKARTA',
    mode: 'SUBWAY',
    origin: [-6.2892744, 106.7749355],
    destination: [-6.2924511, 106.7924644],
  },
  {
    id: 'LRT_JAKARTA',
    mode: 'TRAM',
    origin: [-6.1574335, 106.9142078],
    destination: [-6.1921304, 106.8911841],
  },
  {
    id: 'LRT_JABODEBEK',
    mode: 'TRAM',
    origin: [-6.3738926, 106.8956698],
    destination: [-6.3237693, 106.8866433],
  },
  {
    id: 'TRANSFER_LRTJ_MRT',
    modes: ['TRAM', 'SUBWAY'],
    origin: [-6.1574335, 106.9142078],
    destination: [-6.2924511, 106.7924644],
  },
  {
    id: 'TRANSFER_LRTJB_MRT',
    modes: ['TRAM', 'SUBWAY'],
    operators: ['LRT_JABODEBEK', 'MRT_JAKARTA'],
    origin: [-6.3738926, 106.8956698],
    destination: [-6.2924511, 106.7924644],
  },
  {
    id: 'TRANSFER_KRL_MRT',
    modes: ['RAIL', 'SUBWAY'],
    operators: ['KRL', 'MRT_JAKARTA'],
    origin: [-6.5942887, 106.7907695],
    destination: [-6.2924511, 106.7924644],
  },
];
const point = ([latitude, longitude]) => {
  assert.ok(Number.isFinite(latitude) && Math.abs(latitude) <= 90);
  assert.ok(Number.isFinite(longitude) && Math.abs(longitude) <= 180);
  return { latitude, longitude };
};
const results = [];
let observedStops = null;
let executionError = null;
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ stops { gtfsId } }' }),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.errors, undefined);
  assert.ok(Array.isArray(payload.data?.stops));
  observedStops = { total: payload.data.stops.length, by_operator: {} };
  for (const stop of payload.data.stops) {
    const mode = productMode(stop.gtfsId);
    assert.ok(mode, 'unmapped observed stop');
    observedStops.by_operator[mode] =
      (observedStops.by_operator[mode] ?? 0) + 1;
  }
  for (const item of cases) {
    const requested = item.modes ?? [item.mode];
    const variables = {
      origin: { label: 'Origin', location: { coordinate: point(item.origin) } },
      destination: {
        label: 'Destination',
        location: { coordinate: point(item.destination) },
      },
      dateTime: { earliestDeparture: '2026-10-02T08:00:00+07:00' },
      modes:
        item.id === 'WALK'
          ? { direct: ['WALK'], directOnly: true }
          : {
              direct: ['WALK'],
              transit: {
                access: ['WALK'],
                egress: ['WALK'],
                transfer: ['WALK'],
                transit: requested.map((mode) => ({ mode })),
              },
            },
      first: 12,
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.errors, undefined, `${item.id}: GraphQL errors`);
    const plan = payload.data?.planConnection;
    assert.ok(
      plan && Array.isArray(plan.edges) && Array.isArray(plan.routingErrors),
    );
    const transitLegs = plan.edges.flatMap(({ node }) =>
      node.legs.filter((leg) => leg.mode !== 'WALK'),
    );
    const matched =
      item.id === 'WALK'
        ? plan.edges.some(
            ({ node }) =>
              node.legs.length && node.legs.every((leg) => leg.mode === 'WALK'),
          )
        : item.modes
          ? plan.edges.some(
              ({ node }) =>
                new Set(
                  node.legs
                    .filter((leg) => leg.mode !== 'WALK')
                    .map((leg) => productMode(leg.route?.gtfsId)),
                ).size >= 2,
            )
          : transitLegs.some(
              (leg) => productMode(leg.route?.gtfsId) === item.id,
            );
    const verdict = matched ? 'PASS' : 'NOT_VERIFIED';
    for (const { node } of plan.edges)
      for (const leg of node.legs) {
        decodeGeometry(leg.legGeometry?.points);
        if (leg.mode !== 'WALK') {
          assert.ok(
            leg.route?.gtfsId &&
              leg.trip?.gtfsId &&
              leg.from?.stop?.gtfsId &&
              leg.to?.stop?.gtfsId,
          );
          assert.equal(leg.serviceDate, '2026-10-02');
          assert.ok(productMode(leg.route.gtfsId), 'unmapped operator');
        }
      }
    results.push({
      id: item.id,
      request: variables,
      requested_modes: requested,
      verdict,
      edge_count: plan.edges.length,
      routingErrors: plan.routingErrors,
      itineraries: plan.edges.map(({ node }) => ({
        ...node,
        legs: node.legs.map((leg) => ({
          ...leg,
          product_mode:
            leg.mode === 'WALK' ? 'WALK' : productMode(leg.route?.gtfsId),
          geometry_coordinates: decodeGeometry(leg.legGeometry.points),
        })),
      })),
    });
    console.log(
      `${item.id}: ${verdict}, edges=${plan.edges.length}, modes=${[...new Set(transitLegs.map((leg) => productMode(leg.route?.gtfsId)))].join(',')}`,
    );
  }
} catch (error) {
  executionError = error?.message ?? String(error);
}
const evidence = {
  status:
    !executionError && results.every((r) => r.verdict === 'PASS')
      ? 'PASS'
      : 'NOT_VERIFIED',
  checked_at: new Date().toISOString(),
  endpoint: endpoint.href,
  service_date: '2026-10-02',
  query_sha256: createHash('sha256').update(query).digest('hex'),
  graph_manifest_sha256: runtime.graph.sha256,
  graph_counts: runtime.graph,
  observed_stops: observedStops,
  feed_manifest: manifest.feeds.map(
    ({
      feedKey,
      productMode,
      counts,
      timingPrecision,
      representativeDate,
    }) => ({
      feedKey,
      productMode,
      counts,
      timingPrecision,
      representativeDate,
    }),
  ),
  rights_note:
    'Feed rights remain governed by existing data/licenses/phase-1-multi-operator-source-rights.md; this acceptance does not grant license or redistribution permission.',
  execution_error: executionError,
  results,
};
evidence.limitations = [
  'Graph counts and checksum are manifest references, not independent loaded-graph attestation. observed_stops is actual GraphQL inventory.',
  'No UI, app API, DB, realtime position or live operating-service claim. This is historical 2026-10-02 OTP graph routing only.',
  'Rail feeds are locally derived controlled research representations, not official operator GTFS. KRL manifest says EXACT_SCHEDULE; MRT/LRT manifests say FREQUENCY_DERIVED. Bus feeds are source GTFS with frequencies.',
  'Rail geometry may connect station coordinates directly; valid OTP geometry is not proof of track-aligned geometry or independently verified timetable accuracy.',
  'Existing rights record: TransJakarta/Mikrotrans CC-BY-4.0; rail open licensing/redistribution unresolved, local academic no-redistribution policy only. LRT Jakarta automated retrieval VERIFIED_RESTRICTED. No new provider approval inferred.',
];
await mkdir(`${root}/.release-evidence`, { recursive: true });
await writeFile(
  `${root}/.release-evidence/closure-operator-routing.json`,
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(
  `Evidence: .release-evidence/closure-operator-routing.json; overall=${evidence.status}`,
);
if (executionError) {
  console.error(executionError);
  process.exitCode = 1;
}
// NOT_VERIFIED coverage alone is not a GraphQL execution failure.
