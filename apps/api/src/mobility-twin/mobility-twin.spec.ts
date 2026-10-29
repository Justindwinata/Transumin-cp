import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperationalObservation } from '../operational-data/domain/operational-data.js';
import { EffectiveStateProjector } from './application/state-projector.js';
import type { PersistedOperationalObservation } from './domain/mobility-twin.js';

const ENTITY = '11111111-1111-4111-8111-111111111111';

function observation(
  overrides: Partial<OperationalObservation> = {},
): PersistedOperationalObservation {
  return {
    mobilityEntityId: ENTITY,
    observationId: '22222222-2222-4222-8222-222222222222',
    incidentId: '33333333-3333-4333-8333-333333333333',
    incidentType: 'MANUAL_OPERATOR_INCIDENT',
    affectedEntityRefs: ['fixture:entity'],
    affectedModes: ['MRT_JAKARTA'],
    operationalState: 'AVAILABLE',
    evidenceType: 'LIVE',
    sourceAuthority: 'OFFICIAL_MACHINE',
    sourceChannel: 'MACHINE_FEED',
    impactBasis: 'DIRECT_OPERATIONAL_REPORT',
    observedAt: '2026-10-01T00:00:00.000Z',
    receivedAt: '2026-10-01T00:00:01.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
    expiresAt: '2026-10-01T01:00:00.000Z',
    reason: 'Official feed reports current service.',
    confidenceStatus: 'SOURCE_REPORTED',
    confidence: 1,
    provenance: {
      sourceId: '44444444-4444-4444-8444-444444444444',
      sourceClassification: 'VERIFIED_PUBLIC_FEED',
      rawReference: 'fixture:official',
      lineageReference: 'fixture:official',
      retrievedAt: '2026-10-01T00:00:01.000Z',
    },
    sourceAttributes: {},
    ...overrides,
  };
}

describe('Phase 2B effective state projector', () => {
  const projector = new EffectiveStateProjector();
  const asOf = new Date('2026-10-01T00:10:00.000Z');

  it('selects fresh official evidence over a conflicting weak observation', () => {
    const crowd = observation({
      observationId: '55555555-5555-4555-8555-555555555555',
      operationalState: 'UNAVAILABLE',
      evidenceType: 'OBSERVED',
      sourceAuthority: 'CROWDSOURCED_OBSERVATION',
      sourceChannel: 'CROWDSOURCED',
      provenance: {
        ...observation().provenance,
        sourceId: '66666666-6666-4666-8666-666666666666',
        sourceClassification: 'VERIFIED_PUBLIC_INFORMATION',
        rawReference: 'fixture:crowd',
        lineageReference: 'fixture:crowd',
      },
    });
    const state = projector.project(ENTITY, [crowd, observation()], asOf);
    assert.equal(state.operationalState, 'AVAILABLE');
    assert.equal(state.evidenceType, 'LIVE');
    assert.equal(state.observationId, observation().observationId);
  });

  it('returns UNKNOWN after the only evidence expires', () => {
    const state = projector.project(
      ENTITY,
      [observation({ operationalState: 'UNAVAILABLE' })],
      new Date('2026-10-01T01:00:00.000Z'),
    );
    assert.equal(state.operationalState, 'UNKNOWN');
    assert.equal(state.evidenceType, null);
    assert.equal(state.freshnessStatus, 'UNKNOWN');
  });

  it('keeps simulated evidence distinct and reports aging freshness', () => {
    const simulated = observation({
      evidenceType: 'SIMULATED',
      sourceAuthority: 'SIMULATION',
      sourceChannel: 'CONTROLLED_SIMULATION',
      impactBasis: 'CONTROLLED_SIMULATION',
      confidenceStatus: 'SIMULATED',
      operationalState: 'DEGRADED',
      expiresAt: '2026-10-01T00:20:00.000Z',
      provenance: {
        ...observation().provenance,
        sourceClassification: 'NOT_AVAILABLE',
      },
    });
    const state = projector.project(
      ENTITY,
      [simulated],
      new Date('2026-10-01T00:12:00.000Z'),
    );
    assert.equal(state.evidenceType, 'SIMULATED');
    assert.equal(state.operationalState, 'DEGRADED');
    assert.equal(state.freshnessStatus, 'AGING');
  });

  it('reconstructs the same state and fingerprint deterministically', () => {
    const first = projector.project(ENTITY, [observation()], asOf);
    const second = projector.project(ENTITY, [observation()], asOf);
    assert.deepEqual(first, second);
    assert.equal(projector.fingerprint(first), projector.fingerprint(second));
  });
});
