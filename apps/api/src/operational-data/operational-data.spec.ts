import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AiIncidentExtractionValidator } from './ai/ai-incident-extraction.js';
import { OperationalConflictResolutionService } from './application/conflict-resolution.service.js';
import { FreshnessEvaluator } from './application/freshness-evaluator.js';
import { OperationalContractValidator } from './application/operational-contract-validator.js';
import { OperatorConfirmedIncidentService } from './application/operator-confirmed-incident.service.js';
import { SourcePriorityComparator } from './application/source-priority.js';
import type { OperationalObservation } from './domain/operational-data.js';
import { PetaBencanaOperationalAdapter } from './infrastructure/petabencana-operational.adapter.js';

const validator = new OperationalContractValidator();
const freshness = new FreshnessEvaluator();
const conflict = new OperationalConflictResolutionService(
  freshness,
  new SourcePriorityComparator(),
  validator,
);

function observation(
  overrides: Partial<OperationalObservation> = {},
): OperationalObservation {
  return {
    observationId: '11111111-1111-4111-8111-111111111111',
    incidentId: '22222222-2222-4222-8222-222222222222',
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityRefs: ['ROUTE:TEST'],
    affectedModes: ['KRL'],
    operationalState: 'AVAILABLE',
    evidenceType: 'LIVE',
    sourceAuthority: 'OFFICIAL_MACHINE',
    sourceChannel: 'MACHINE_FEED',
    impactBasis: 'DIRECT_OPERATIONAL_REPORT',
    observedAt: '2026-09-30T02:00:00.000Z',
    receivedAt: '2026-09-30T02:00:05.000Z',
    updatedAt: '2026-09-30T02:00:05.000Z',
    expiresAt: '2026-09-30T02:05:00.000Z',
    reason: 'Official machine feed reports normal service.',
    confidenceStatus: 'SOURCE_REPORTED',
    confidence: 1,
    provenance: {
      sourceId: '33333333-3333-4333-8333-333333333333',
      sourceClassification: 'VERIFIED_PUBLIC_FEED',
      rawReference: 'https://operator.example/alerts/1',
      lineageReference: 'fixture:official:1',
      retrievedAt: '2026-09-30T02:00:05.000Z',
    },
    sourceAttributes: {},
    ...overrides,
  };
}

describe('operational evidence foundation', () => {
  it('expires evidence at the exclusive TTL boundary', () => {
    const item = observation();
    assert.equal(
      freshness.evaluate(item, new Date('2026-09-30T02:04:59.999Z')),
      'FRESH',
    );
    assert.equal(
      freshness.evaluate(item, new Date('2026-09-30T02:05:00.000Z')),
      'EXPIRED',
    );
  });

  it('selects official live AVAILABLE over crowdsourced UNAVAILABLE', () => {
    const crowd = observation({
      observationId: '44444444-4444-4444-8444-444444444444',
      operationalState: 'UNAVAILABLE',
      evidenceType: 'OBSERVED',
      sourceAuthority: 'CROWDSOURCED_OBSERVATION',
      sourceChannel: 'CROWDSOURCED',
      provenance: {
        ...observation().provenance,
        sourceId: '55555555-5555-4555-8555-555555555555',
        sourceClassification: 'VERIFIED_PUBLIC_INFORMATION',
        rawReference: 'fixture:crowd:1',
        lineageReference: 'fixture:crowd:1',
      },
    });
    const result = conflict.resolve(
      [crowd, observation()],
      new Date('2026-09-30T02:03:00.000Z'),
    );
    assert.equal(result.operationalState, 'AVAILABLE');
    assert.equal(
      result.selectedObservation?.sourceAuthority,
      'OFFICIAL_MACHINE',
    );
    assert.deepEqual(result.supersededObservationIds, [crowd.observationId]);
  });

  it('returns UNKNOWN instead of retaining an expired closure', () => {
    const closure = observation({ operationalState: 'UNAVAILABLE' });
    const result = conflict.resolve(
      [closure],
      new Date('2026-09-30T02:05:00.000Z'),
    );
    assert.equal(result.operationalState, 'UNKNOWN');
    assert.equal(result.selectedObservation, null);
    assert.deepEqual(result.expiredObservationIds, [closure.observationId]);
  });

  it('keeps evidence type separate and rejects fake LIVE evidence', () => {
    const result = validator.validate(
      observation({
        operationalState: 'DISRUPTED',
        sourceAuthority: 'OFFICIAL_PUBLIC_UPDATE',
        sourceChannel: 'PUBLIC_INFORMATION',
        provenance: {
          ...observation().provenance,
          sourceClassification: 'VERIFIED_PUBLIC_INFORMATION',
        },
      }),
    );
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /LIVE evidence requires/);
  });

  it('rejects operational closure inferred only from environmental evidence', () => {
    const result = validator.validate(
      observation({
        operationalState: 'UNAVAILABLE',
        evidenceType: 'OBSERVED',
        sourceAuthority: 'VERIFIED_GOVERNMENT_OR_DISRUPTION',
        sourceChannel: 'ENVIRONMENTAL_OBSERVATION',
        impactBasis: 'ENVIRONMENTAL_INDICATOR',
        provenance: {
          ...observation().provenance,
          sourceClassification: 'VERIFIED_PUBLIC_API',
        },
      }),
    );
    assert.equal(result.valid, false);
    assert.match(
      result.errors.join(' '),
      /cannot assert an operational closure/,
    );
  });

  it('creates a validated, provenance-linked operator-confirmed candidate', () => {
    const service = new OperatorConfirmedIncidentService(validator);
    const candidate = service.createCandidate(
      {
        sourceId: '66666666-6666-4666-8666-666666666666',
        sourceOperator: 'Fixture Operator',
        submittedByActorId: 'operator-user-1',
        affectedEntityRefs: ['STATION:FIXTURE'],
        affectedModes: ['MRT_JAKARTA'],
        incidentType: 'STATION_CLOSURE',
        operationalState: 'UNAVAILABLE',
        reason: 'Operator confirms temporary closure.',
        startTime: '2026-09-30T02:00:00.000Z',
        expiresAt: '2026-09-30T04:00:00.000Z',
        rawReference: 'operator-console:submission:1',
      },
      new Date('2026-09-30T02:01:00.000Z'),
    );
    assert.equal(candidate.sourceAuthority, 'OFFICIAL_OPERATOR_CONFIRMED');
    assert.equal(candidate.evidenceType, 'OBSERVED');
    assert.equal(candidate.candidateStatus, 'VALIDATED');
    assert.equal(
      candidate.provenance.lineageReference,
      'operator-console:operator-user-1',
    );
    assert.equal(validator.validateCandidate(candidate).valid, true);
  });

  it('requires exact source support and rejects unsupported AI inference', () => {
    const ai = new AiIncidentExtractionValidator();
    const source =
      'MRT Jakarta: Stasiun Bundaran HI ditutup mulai 2026-09-30T08:00:00+07:00 hingga 2026-09-30T10:00:00+07:00 karena pemeriksaan infrastruktur.';
    const valid = ai.validate(
      {
        incidentType: 'STATION_CLOSURE',
        affectedEntities: ['Stasiun Bundaran HI'],
        affectedModes: ['MRT_JAKARTA'],
        state: 'UNAVAILABLE',
        startTime: '2026-09-30T08:00:00+07:00',
        endTime: '2026-09-30T10:00:00+07:00',
        reason: 'pemeriksaan infrastruktur',
        sourceClaims: [
          { field: 'incident_type', quote: 'ditutup' },
          { field: 'affected_entities', quote: 'Stasiun Bundaran HI' },
          { field: 'affected_mode', quote: 'MRT Jakarta' },
          { field: 'state', quote: 'ditutup' },
          { field: 'start_time', quote: '2026-09-30T08:00:00+07:00' },
          { field: 'end_time', quote: '2026-09-30T10:00:00+07:00' },
          { field: 'reason', quote: 'pemeriksaan infrastruktur' },
        ],
        unsupportedFields: [],
        confidence: 0.95,
      },
      source,
    );
    assert.equal(valid.validCandidate, true);

    const unsupported = ai.validate(
      {
        incidentType: 'STATION_CLOSURE',
        affectedEntities: ['Stasiun Bundaran HI'],
        affectedModes: ['MRT_JAKARTA'],
        state: 'UNAVAILABLE',
        startTime: '2026-09-30T08:00:00+07:00',
        endTime: '2026-09-30T10:00:00+07:00',
        reason: 'Banjir',
        sourceClaims: [],
        unsupportedFields: ['reason'],
        confidence: 0.95,
      },
      source,
    );
    assert.equal(unsupported.validCandidate, false);
    assert.match(unsupported.errors.join(' '), /unsupported fields/);
  });

  it('normalizes documented PetaBencana data without asserting transport impact', async () => {
    const recorded = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../../../data/fixtures/petabencana/recorded-flood-area-minimized.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    ) as { response: unknown };
    const adapter = new PetaBencanaOperationalAdapter(
      async () =>
        new Response(JSON.stringify(recorded.response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const [item] = await adapter.fetchObservations({
      receivedAt: new Date('2026-09-30T00:00:00.000Z'),
    });
    assert.ok(item);
    assert.equal(item.operationalState, 'UNKNOWN');
    assert.equal(item.evidenceType, 'OBSERVED');
    assert.equal(item.impactBasis, 'ENVIRONMENTAL_INDICATOR');
    assert.equal(item.expiresAt, '2024-09-27T17:02:28.940Z');
    assert.equal(validator.validate(item).valid, true);
    assert.equal(
      freshness.evaluate(item, new Date('2026-09-30T00:00:00.000Z')),
      'EXPIRED',
    );
  });
});
