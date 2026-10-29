#!/usr/bin/env node
// FR-001 read-only real OTP probe. No API/DB, graph/config changes, intercepts or mocks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const endpoint = new URL(
  process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1',
);
assert.equal(endpoint.origin, 'http://127.0.0.1:8080');
assert.equal(endpoint.pathname, '/otp/gtfs/v1');
assert.equal(
  endpoint.username + endpoint.password + endpoint.search + endpoint.hash,
  '',
);
const root = new URL('../../', import.meta.url);
const adapter = readFileSync(
  new URL(
    'apps/api/src/journey/infrastructure/otp-journey-routing.adapter.ts',
    root,
  ),
  'utf8',
);
// Reuse actual adapter query, fail closed if declaration changes.
const query = adapter.match(/const planQuery = `([\s\S]*?)`;/)?.[1];
assert.ok(query, 'adapter planQuery not found');
const runtime = JSON.parse(
  readFileSync(new URL('data/manifests/PHASE-4B-A-OTP-RUNTIME.json', root)),
);
const manifest = readFileSync(
  new URL('data/manifests/PHASE-4B-A-ROUTER-INPUT.json', root),
);
const transit = {
  direct: ['WALK'],
  transit: {
    access: ['WALK'],
    egress: ['WALK'],
    transfer: ['WALK'],
    transit: ['BUS', 'RAIL', 'SUBWAY', 'TRAM'].map((mode) => ({ mode })),
  },
};
const cases = [
  {
    name: 'routable-control',
    origin: [-6.174612, 106.8304],
    destination: [-6.278404, 106.82972],
    modes: transit,
    expected: null,
  },
  // Valid numeric in-region endpoints. OTP explicitly finds location, but no transit stops.
  // This is genuine provider no-route, NOT proof of topological disconnection.
  {
    name: 'bounded-transit-no-route',
    origin: [-6.175, 106.83],
    destination: [-6.02, 106.62],
    modes: transit,
    expected: 'NO_STOPS_IN_RANGE',
  },
  {
    name: 'bounded-walk-no-direct-connection',
    origin: [-6.2, 106.82],
    destination: [-6.2, 106.6],
    modes: { direct: ['WALK'], directOnly: true },
    expected: 'NO_DIRECT_MODE_CONNECTION',
  },
];
const results = [];
try {
  for (const item of cases) {
    const point = ([latitude, longitude]) => {
      assert.ok(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90);
      assert.ok(
        Number.isFinite(longitude) && longitude >= -180 && longitude <= 180,
      );
      return { latitude, longitude };
    };
    const variables = {
      origin: { label: 'Origin', location: { coordinate: point(item.origin) } },
      destination: {
        label: 'Destination',
        location: { coordinate: point(item.destination) },
      },
      dateTime: { earliestDeparture: '2026-10-02T08:00:00+07:00' },
      modes: item.modes,
      first: 12, // Adapter default maximumAlternatives=3, Math.max(6, 3*4).
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(
      payload.errors,
      undefined,
      'GraphQL errors are not routing no-path',
    );
    const plan = payload.data?.planConnection;
    assert.ok(Array.isArray(plan?.edges) && Array.isArray(plan?.routingErrors));
    if (item.expected === null) {
      assert.ok(plan.edges.length > 0);
      assert.deepEqual(plan.routingErrors, []);
    } else {
      assert.equal(plan.edges.length, 0);
      assert.deepEqual(
        plan.routingErrors.map((error) => error.code),
        [item.expected],
      );
    }
    results.push({
      name: item.name,
      verdict: 'PASS',
      request: variables,
      http_status: response.status,
      edge_count: plan.edges.length,
      routingErrors: plan.routingErrors,
    });
  }
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        checked_at: new Date().toISOString(),
        endpoint: endpoint.href,
        query_sha256: createHash('sha256').update(query).digest('hex'),
        manifested_graph_sha256: runtime.graph.sha256,
        graph_identity_limit:
          'Manifest reference only; HTTP probe does not independently attest loaded graph checksum.',
        router_manifest_sha256: createHash('sha256')
          .update(manifest)
          .digest('hex'),
        results,
        semantics: {
          provider:
            'Actual OTP routingErrors and zero edges; no literal OTP NO_PATH code observed. NO_STOPS_IN_RANGE is coverage/search-radius failure; NO_DIRECT_MODE_CONNECTION may mean distance limit or disconnected streets, not proven topological disconnection.',
          planner:
            'Adapter returns []; planner raises NO_ROUTE on empty first attempt. NO_VALID_ROUTE_AFTER_STATE_VALIDATION instead means returned candidates rejected by current state within two attempts.',
          recovery:
            'Recovery maps NO_ROUTE or NO_VALID_ROUTE_AFTER_STATE_VALIDATION to null repair and status NO_PATH. NO_RECOVERY_PATH is separate recovery rejection, including blocked merged candidate.',
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({ status: 'FAIL', results, error: error.message }),
  );
  process.exitCode = 1;
}
