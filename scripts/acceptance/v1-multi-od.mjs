#!/usr/bin/env node
// Prototype V1 multi-OD acceptance: real API/OTP routing plus preference ranking invariants.
// Usage: PASSENGER_NETWORK_SNAPSHOT_ID=<uuid> node scripts/acceptance/v1-multi-od.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const api = (
  process.env.PASSENGER_API_URL ?? 'http://127.0.0.1:3001/api/v1'
).replace(/\/$/, '');
const snapshot = process.env.PASSENGER_NETWORK_SNAPSHOT_ID;
assert.ok(snapshot, 'PASSENGER_NETWORK_SNAPSHOT_ID is required');
const preferenceDeparture = '2026-10-02T08:00:00+07:00';

// Named public-transit corridors are resolved from live place search, never hard-coded.
const corridors = [
  { id: 'BOGOR_CILEBUT', origin: 'Bogor', destination: 'Cilebut' },
  {
    id: 'KELAPA_GADING_MANGGARAI',
    origin: 'Kelapa Gading',
    destination: 'Manggarai',
  },
  {
    id: 'LEBAK_BULUS_FATMAWATI',
    origin: 'Lebak Bulus',
    destination: 'Fatmawati',
  },
  { id: 'BOGOR_SUDIRMAN', origin: 'Bogor', destination: 'Sudirman' },
  { id: 'DEPOK_MANGGARAI', origin: 'Depok', destination: 'Manggarai' },
  { id: 'TANGERANG_MANGGARAI', origin: 'Tangerang', destination: 'Manggarai' },
  { id: 'BEKASI_MANGGARAI', origin: 'Bekasi', destination: 'Manggarai' },
  { id: 'BSD_MANGGARAI', origin: 'BSD', destination: 'Manggarai' },
  { id: 'TANJUNG_PRIOK_KOTA', origin: 'Tanjung Priok', destination: 'Kota' },
  { id: 'CILEBUT_DEPOK', origin: 'Cilebut', destination: 'Depok' },
];

// Kemang has no licensed POI index yet; the destination is an approximate street coordinate,
// recorded as such rather than presented as a resolved place.
const coordinateCase = {
  id: 'MANGGARAI_KEMANG_COORDINATE',
  origin: 'Manggarai',
  destinationCoordinate: { latitude: -6.2607, longitude: 106.8135 },
  destinationLabel:
    'Kemang Raya street area (approximate coordinate, no POI source)',
};

async function json(path) {
  const response = await fetch(`${api}/${path}`);
  const body = await response.json();
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return body.data;
}

async function places(query) {
  return json(
    `transit/places?q=${encodeURIComponent(query)}&snapshot_id=${snapshot}&limit=25`,
  );
}

function chooseStation(results, name) {
  const lowered = name.toLowerCase();
  const exact = results.filter((place) => place.name.toLowerCase() === lowered);
  const candidates =
    exact.length > 0
      ? exact
      : results.filter((place) => place.name.toLowerCase().startsWith(lowered));
  const preferred = candidates.filter((place) => place.kind === 'STATION');
  const chosen = preferred[0] ?? candidates[0] ?? null;
  assert.ok(
    chosen,
    `place search returned no exact or prefix-matching stop for "${name}"`,
  );
  return chosen;
}

async function plan(origin, destination, preference) {
  const response = await fetch(`${api}/journeys/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: {
        latitude: destination.latitude,
        longitude: destination.longitude,
      },
      departure_at: preferenceDeparture,
      network_snapshot_id: snapshot,
      preference,
    }),
  });
  const body = await response.json();
  return { status: response.status, data: body.data ?? [], error: body.error };
}

function assertPreferenceInvariant(id, preference, alternatives) {
  const metric = {
    FASTEST: (journey) => journey.duration_seconds,
    FEWEST_TRANSFERS: (journey) => journey.transfer_count,
    LEAST_WALKING: (journey) => journey.walking_distance_meters,
  }[preference];
  const best = Math.min(...alternatives.map(metric));
  const first = metric(alternatives[0]);
  // Ties are retained; the invariant is that the extreme value is offered first.
  assert.ok(
    first <= best + 1e-6,
    `${id}: ${preference} first option is not the extreme value (${first} > ${best})`,
  );
}

const evidence = {
  evidence_type: 'SCHEDULED',
  network_snapshot_id: snapshot,
  cases: [],
};

for (const corridor of corridors) {
  const [originMatches, destinationMatches] = await Promise.all([
    places(corridor.origin),
    places(corridor.destination),
  ]);
  const origin = chooseStation(originMatches, corridor.origin);
  const destination = chooseStation(destinationMatches, corridor.destination);
  const caseEvidence = {
    id: corridor.id,
    origin: {
      name: origin.name,
      place_id: origin.place_id,
      kind: origin.kind,
      mode: origin.product_mode,
    },
    destination: {
      name: destination.name,
      place_id: destination.place_id,
      kind: destination.kind,
      mode: destination.product_mode,
    },
    preferences: [],
  };
  for (const preference of ['FASTEST', 'FEWEST_TRANSFERS', 'LEAST_WALKING']) {
    const result = await plan(origin, destination, preference);
    assert.equal(result.status, 201, `${corridor.id}: HTTP ${result.status}`);
    assert.ok(
      result.data.length > 0,
      `${corridor.id}: no alternative returned`,
    );
    assertPreferenceInvariant(corridor.id, preference, result.data);
    for (const journey of result.data) {
      assert.equal(
        journey.network_snapshot_id,
        snapshot,
        `${corridor.id}: snapshot provenance drift`,
      );
      assert.equal(
        journey.routing_context.common_service_date,
        '2026-10-02',
        `${corridor.id}: service-date provenance drift`,
      );
      assert.ok(journey.segments.length > 0, `${corridor.id}: empty itinerary`);
      assert.ok(
        journey.segments.every((segment) => segment.geometry !== null),
        `${corridor.id}: missing real leg geometry`,
      );
    }
    caseEvidence.preferences.push({
      preference,
      alternatives: result.data.length,
      first: {
        journey_id: result.data[0].journey_id,
        duration_seconds: result.data[0].duration_seconds,
        transfer_count: result.data[0].transfer_count,
        walking_distance_meters: result.data[0].walking_distance_meters,
        modes: result.data[0].segments.map((segment) => segment.mode),
        fare_status: result.data[0].fare_status,
      },
    });
  }
  evidence.cases.push(caseEvidence);
}

// Coordinate destination case: must either return real alternatives or a truthful no-route state.
{
  const originMatches = await places(coordinateCase.origin);
  const origin = chooseStation(originMatches, coordinateCase.origin);
  const result = await plan(
    origin,
    coordinateCase.destinationCoordinate,
    'BALANCED',
  );
  assert.ok(
    result.status === 201 || result.status === 422,
    `${coordinateCase.id}: unexpected HTTP ${result.status}`,
  );
  if (result.status === 201)
    assert.ok(
      result.data.length > 0,
      `${coordinateCase.id}: 201 without alternatives`,
    );
  else
    assert.equal(
      result.error?.code,
      'NO_ROUTE',
      `${coordinateCase.id}: 422 must be NO_ROUTE`,
    );
  evidence.cases.push({
    id: coordinateCase.id,
    origin: { name: origin.name, place_id: origin.place_id },
    destination: coordinateCase.destinationLabel,
    http_status: result.status,
    alternatives: result.data.length,
    error_code: result.error?.code ?? null,
  });
}

const evidencePath = join(
  repositoryRoot,
  'data/processed/acceptance/v1-multi-od.json',
);
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: 'PASS',
    evidence: 'real OTP and database through the canonical API',
    evidence_path: 'data/processed/acceptance/v1-multi-od.json',
    cases: evidence.cases.map((item) => ({
      id: item.id,
      alternatives: item.preferences
        ? item.preferences.map(
            (entry) => `${entry.preference}:${entry.alternatives}`,
          )
        : `${item.http_status}:${item.alternatives}`,
    })),
  }),
);
