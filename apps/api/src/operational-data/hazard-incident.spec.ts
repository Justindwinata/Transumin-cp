import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OperationalContractValidator } from './application/operational-contract-validator.js';
import {
  OperationalIncidentService,
  OperationalIncidentServiceError,
} from './application/operational-incident.service.js';
import {
  incidentBlocksAt,
  incidentEvidenceIdentity,
  validateBoundedHazardGeometry,
  validateIncidentEvidence,
  type IncidentEvidenceInput,
} from './domain/hazard-incident.js';

const ENTITY = '90000000-0000-4000-8000-000000000001';
const SOURCE = '90000000-0000-4000-8000-000000000002';
const INCIDENT = '90000000-0000-4000-8000-000000000003';

function evidence(
  overrides: Partial<IncidentEvidenceInput> = {},
): IncidentEvidenceInput {
  return {
    incidentId: INCIDENT,
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityIds: [ENTITY],
    affectedModes: ['TRANSJAKARTA'],
    operationalState: 'UNAVAILABLE',
    sourceClass: 'SIMULATED',
    sourceId: SOURCE,
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    evidenceType: 'SIMULATED',
    sourceClassification: 'NOT_AVAILABLE',
    observedAt: '2026-10-07T00:00:00.000Z',
    effectiveFrom: '2026-10-07T00:00:00.000Z',
    expiresAt: '2026-10-07T02:00:00.000Z',
    receivedAt: '2026-10-07T00:00:01.000Z',
    reason: 'Controlled simulated closure fixture.',
    provenanceRef: 'fixture:x1a:1',
    rawReference: 'fixture:x1a:1',
    supportingHazardEventId: null,
    ...overrides,
  };
}

describe('X1-A incident evidence domain', () => {
  it('produces a deterministic identity regardless of entity order', () => {
    const first = incidentEvidenceIdentity(evidence());
    const second = incidentEvidenceIdentity(
      evidence({ affectedEntityIds: [ENTITY] }),
    );
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
    const changed = incidentEvidenceIdentity(
      evidence({ reason: 'Different reason.' }),
    );
    assert.notEqual(first, changed);
  });

  it('rejects hazards, AVAILABLE resolution, and non-runtime source classes', () => {
    assert.match(
      validateIncidentEvidence(evidence({ incidentType: 'FLOOD' })).join(' '),
      /hazards cannot be operational incidents/,
    );
    assert.match(
      validateIncidentEvidence(
        evidence({ operationalState: 'AVAILABLE' }),
      ).join(' '),
      /cannot assert AVAILABLE/,
    );
    assert.match(
      validateIncidentEvidence(evidence({ sourceClass: 'GTFS_RT' })).join(' '),
      /fail closed/,
    );
    assert.match(
      validateIncidentEvidence(evidence({ affectedModes: ['WALKING'] })).join(
        ' ',
      ),
      /WALKING/,
    );
    assert.match(
      validateIncidentEvidence(
        evidence({
          sourceClass: 'MANUAL_VERIFIED',
          evidenceType: 'SIMULATED',
        }),
      ).join(' '),
      /MANUAL_VERIFIED/,
    );
    assert.equal(validateIncidentEvidence(evidence()).length, 0);
  });

  it('blocks only verified-active evidence inside its effective window', () => {
    const active = {
      lifecycleStatus: 'VERIFIED_ACTIVE' as const,
      effectiveFrom: '2026-10-07T00:00:00.000Z',
      effectiveTo: null,
      expiresAt: '2026-10-07T02:00:00.000Z',
    };
    assert.equal(
      incidentBlocksAt(active, new Date('2026-10-07T01:00:00.000Z')),
      true,
    );
    assert.equal(
      incidentBlocksAt(active, new Date('2026-10-06T23:59:59.999Z')),
      false,
    );
    assert.equal(
      incidentBlocksAt(active, new Date('2026-10-07T02:00:00.000Z')),
      false,
    );
    assert.equal(
      incidentBlocksAt(
        { ...active, effectiveTo: '2026-10-07T01:00:00.000Z' },
        new Date('2026-10-07T01:00:00.000Z'),
      ),
      false,
    );
    for (const lifecycleStatus of [
      'INGESTED_UNVERIFIED',
      'RESOLVED',
      'RETRACTED',
    ] as const)
      assert.equal(
        incidentBlocksAt(
          { ...active, lifecycleStatus },
          new Date('2026-10-07T01:00:00.000Z'),
        ),
        false,
      );
  });

  it('validates bounded finite hazard geometry', () => {
    const ring = [
      [106.8, -6.2],
      [106.801, -6.2],
      [106.801, -6.199],
      [106.8, -6.199],
      [106.8, -6.2],
    ];
    assert.equal(
      validateBoundedHazardGeometry(
        { type: 'Polygon', coordinates: [ring] },
        { maxCoordinates: 10_000, maxAreaDegreesSquared: 2 },
      ).valid,
      true,
    );
    assert.equal(
      validateBoundedHazardGeometry(
        { type: 'Polygon', coordinates: [[ring.slice(0, 4)]] },
        { maxCoordinates: 10_000, maxAreaDegreesSquared: 2 },
      ).valid,
      false,
    );
    assert.equal(
      validateBoundedHazardGeometry(
        { type: 'Polygon', coordinates: [] },
        { maxCoordinates: 10_000, maxAreaDegreesSquared: 2 },
      ).valid,
      false,
    );
    assert.equal(
      validateBoundedHazardGeometry(
        {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [5, 0],
              [5, 5],
              [0, 5],
              [0, 0],
            ],
          ],
        },
        { maxCoordinates: 10_000, maxAreaDegreesSquared: 2 },
      ).valid,
      false,
    );
  });
});

describe('X1-A operational incident service', () => {
  const service = new OperationalIncidentService(
    new OperationalContractValidator(),
  );

  it('plans one deterministic CANONICAL observation per entity', () => {
    const other = '90000000-0000-4000-8000-000000000004';
    const plan = service.planEvidence(
      evidence({ affectedEntityIds: [other, ENTITY] }),
      'VERIFIED',
    );
    assert.equal(plan.lifecycleStatus, 'VERIFIED_ACTIVE');
    assert.equal(plan.observations.length, 2);
    assert.deepEqual(
      plan.observations.map((item) => item.observation.affectedEntityRefs),
      [[`CANONICAL:${ENTITY}`], [`CANONICAL:${other}`]],
    );
    const repeat = service.planEvidence(
      evidence({ affectedEntityIds: [ENTITY, other] }),
      'VERIFIED',
    );
    assert.deepEqual(
      plan.observations.map((item) => item.observation.observationId),
      repeat.observations.map((item) => item.observation.observationId),
    );
    const unverified = service.planEvidence(evidence(), 'UNVERIFIED');
    assert.equal(unverified.lifecycleStatus, 'INGESTED_UNVERIFIED');
    assert.equal(
      unverified.observations[0]?.observation.confidenceStatus,
      'SOURCE_REPORTED',
    );
  });

  it('fails closed on non-runtime source classes and terminal transitions', () => {
    assert.throws(
      () =>
        service.planEvidence(evidence({ sourceClass: 'GTFS_RT' }), 'VERIFIED'),
      (error: unknown) =>
        error instanceof OperationalIncidentServiceError &&
        error.failure.code === 'HAZARD_SOURCE_UNSUPPORTED',
    );
    assert.throws(
      () =>
        service.planTransition({
          incidentId: INCIDENT,
          fromStatus: 'RESOLVED',
          toStatus: 'RETRACTED',
          reason: 'Late correction.',
          provenanceRef: 'fixture:x1a:1',
          observationId: null,
          hazardEventId: null,
        }),
      /already RESOLVED/,
    );
  });
});

describe('ADR-010 admin field restriction evidence', () => {
  const admin = () =>
    evidence({
      sourceClass: 'ADMIN_FIELD_REVIEW',
      sourceAuthority: 'ADMIN_FIELD_REVIEW',
      sourceChannel: 'ADMIN_REVIEW',
      evidenceType: 'OBSERVED',
      effectiveFrom: '2026-10-07T00:00:01.000Z',
      expiresAt: '2026-10-07T00:05:01.000Z',
      reason:
        'SAMPLE synthetic unit fixture for admin policy, not real field evidence.',
    });
  it('requires distinct authority, recent observation and bounded lifetime', () => {
    assert.deepEqual(validateIncidentEvidence(admin()), []);
    for (const invalid of [
      { sourceAuthority: 'OFFICIAL_OPERATOR_CONFIRMED' },
      { evidenceType: 'LIVE' },
      { observedAt: '2026-10-06T23:00:00.000Z' },
      { expiresAt: '2026-10-07T01:01:01.000Z' },
      { expiresAt: '2026-10-07T00:04:01.000Z' },
      { effectiveFrom: '2026-10-07T00:00:00.000Z' },
    ])
      assert.ok(
        validateIncidentEvidence({
          ...admin(),
          ...invalid,
        } as IncidentEvidenceInput).length > 0,
      );
    assert.ok(
      validateIncidentEvidence(
        evidence({ sourceAuthority: 'ADMIN_FIELD_REVIEW' }),
      ).length > 0,
    );
  });
  it('creates time-bound observations without invented numeric confidence', () => {
    const service = new OperationalIncidentService(
      new OperationalContractValidator(),
    );
    assert.throws(
      () => service.planEvidence(admin(), 'UNVERIFIED'),
      /authenticated verified review/,
    );
    const plan = service.planEvidence(admin(), 'VERIFIED');
    const observation = plan.observations[0]!.observation;
    assert.equal(observation.sourceAuthority, 'ADMIN_FIELD_REVIEW');
    assert.equal(observation.evidenceType, 'OBSERVED');
    assert.equal(observation.confidence, null);
    assert.equal(plan.lifecycleStatus, 'VERIFIED_ACTIVE');
  });
});
