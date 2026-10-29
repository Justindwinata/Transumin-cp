import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import type { OperationalObservation } from '../domain/operational-data.js';
import {
  INCIDENT_EVIDENCE_SCHEMA_VERSION,
  incidentEvidenceIdentity,
  isRuntimeOperableSourceClass,
  validateIncidentEvidence,
  type HazardSourceClass,
  type IncidentEvidenceInput,
  type IncidentLifecycleStatus,
} from '../domain/hazard-incident.js';
import { OperationalContractValidator } from './operational-contract-validator.js';

export type IncidentVerification = 'UNVERIFIED' | 'VERIFIED';

export type IncidentEvidencePlan = Readonly<{
  identity: string;
  schemaVersion: string;
  lifecycleStatus: IncidentLifecycleStatus;
  observations: readonly Readonly<{
    mobilityEntityId: string;
    observation: OperationalObservation;
  }>[];
}>;

export type IncidentLifecycleTransitionPlan = Readonly<{
  journalId: string;
  incidentId: string;
  fromStatus: IncidentLifecycleStatus;
  toStatus: Extract<IncidentLifecycleStatus, 'RESOLVED' | 'RETRACTED'>;
  changedAt: string;
  reason: string;
  provenanceRef: string;
  observationId: string | null;
  hazardEventId: string | null;
}>;

export type IncidentServiceFailure = Readonly<{
  code:
    | 'HAZARD_SOURCE_UNSUPPORTED'
    | 'LIFECYCLE_ALREADY_TERMINAL'
    | 'INCIDENT_NOT_FOUND'
    | 'INCIDENT_IDENTITY_CONFLICT'
    | 'INCIDENT_ENTITY_UNKNOWN'
    | 'INCIDENT_INPUT_INVALID';
  message: string;
  errors?: readonly string[];
}>;

export class OperationalIncidentServiceError extends Error {
  constructor(readonly failure: IncidentServiceFailure) {
    super(failure.message);
    this.name = 'OperationalIncidentServiceError';
  }
}

/**
 * Produces validated `OperationalObservation` evidence plus its append-only
 * lifecycle classification. Hazard source classes that are not runtime-operable
 * fail closed here before any persistence.
 */
@Injectable()
export class OperationalIncidentService {
  constructor(
    @Inject(OperationalContractValidator)
    private readonly validator: OperationalContractValidator,
  ) {}

  private assertSourceClass(sourceClass: HazardSourceClass): void {
    if (!isRuntimeOperableSourceClass(sourceClass))
      throw new OperationalIncidentServiceError({
        code: 'HAZARD_SOURCE_UNSUPPORTED',
        message: `Source class ${sourceClass} is not permitted at runtime and fails closed.`,
      });
  }

  planEvidence(
    input: IncidentEvidenceInput,
    verification: IncidentVerification,
  ): IncidentEvidencePlan {
    this.assertSourceClass(input.sourceClass);
    const errors = [...validateIncidentEvidence(input)];
    if (verification !== 'VERIFIED' && verification !== 'UNVERIFIED')
      errors.push('verification must be VERIFIED or UNVERIFIED');
    if (
      input.sourceClass === 'ADMIN_FIELD_REVIEW' &&
      verification !== 'VERIFIED'
    )
      errors.push(
        'Admin field restriction requires an authenticated verified review',
      );
    if (errors.length > 0)
      throw new OperationalIncidentServiceError({
        code: 'INCIDENT_INPUT_INVALID',
        message: `Invalid incident evidence: ${errors.join('; ')}`,
        errors,
      });

    const identity = incidentEvidenceIdentity(input);
    const observations = [...new Set(input.affectedEntityIds)]
      .sort()
      .map((mobilityEntityId) => {
        const observation: OperationalObservation = {
          observationId: stableUuid(
            'x1a-observation',
            `${identity}:${mobilityEntityId}`,
          ),
          incidentId: input.incidentId,
          incidentType: input.incidentType,
          affectedEntityRefs: [`CANONICAL:${mobilityEntityId}`],
          affectedModes: [...input.affectedModes],
          operationalState: input.operationalState,
          evidenceType: input.evidenceType,
          sourceAuthority: input.sourceAuthority,
          sourceChannel: input.sourceChannel,
          impactBasis:
            input.sourceClass === 'SIMULATED'
              ? 'CONTROLLED_SIMULATION'
              : input.sourceAuthority === 'OFFICIAL_OPERATOR_CONFIRMED'
                ? 'OPERATOR_CONFIRMED'
                : 'DIRECT_OPERATIONAL_REPORT',
          observedAt: input.observedAt,
          receivedAt: input.receivedAt,
          updatedAt: input.receivedAt,
          expiresAt: input.expiresAt,
          reason: input.reason,
          confidenceStatus:
            verification === 'VERIFIED'
              ? input.sourceClass === 'SIMULATED'
                ? 'SIMULATED'
                : 'CONFIRMED'
              : 'SOURCE_REPORTED',
          confidence:
            verification === 'VERIFIED' &&
            input.sourceClass !== 'ADMIN_FIELD_REVIEW'
              ? 1
              : null,
          provenance: {
            sourceId: input.sourceId,
            sourceClassification: input.sourceClassification,
            rawReference: input.rawReference,
            lineageReference: input.provenanceRef,
            retrievedAt: input.receivedAt,
          },
          sourceAttributes: {
            incident_schema_version: INCIDENT_EVIDENCE_SCHEMA_VERSION,
            ...(input.sourceClass === 'ADMIN_FIELD_REVIEW'
              ? { admin_review_policy_version: 'ADMIN_FIELD_V1' }
              : {}),
            source_class: input.sourceClass,
            verification,
            effective_from: input.effectiveFrom,
          },
        };
        this.validator.assertValid(observation);
        return { mobilityEntityId, observation };
      });
    return {
      identity,
      schemaVersion: INCIDENT_EVIDENCE_SCHEMA_VERSION,
      lifecycleStatus:
        verification === 'VERIFIED' ? 'VERIFIED_ACTIVE' : 'INGESTED_UNVERIFIED',
      observations,
    };
  }

  planTransition(
    input: Readonly<{
      incidentId: string;
      fromStatus: IncidentLifecycleStatus;
      toStatus: Extract<IncidentLifecycleStatus, 'RESOLVED' | 'RETRACTED'>;
      reason: string;
      provenanceRef: string;
      observationId: string | null;
      hazardEventId: string | null;
      changedAt?: string;
    }>,
  ): IncidentLifecycleTransitionPlan {
    if (input.fromStatus === 'RESOLVED' || input.fromStatus === 'RETRACTED')
      throw new OperationalIncidentServiceError({
        code: 'LIFECYCLE_ALREADY_TERMINAL',
        message: `Incident ${input.incidentId} is already ${input.fromStatus}.`,
      });
    if (input.reason.trim() === '' || input.provenanceRef.trim() === '')
      throw new OperationalIncidentServiceError({
        code: 'INCIDENT_INPUT_INVALID',
        message: 'Lifecycle transitions require a reason and provenance.',
      });
    return {
      journalId: randomUUID(),
      incidentId: input.incidentId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      changedAt: input.changedAt ?? new Date().toISOString(),
      reason: input.reason,
      provenanceRef: input.provenanceRef,
      observationId: input.observationId,
      hazardEventId: input.hazardEventId,
    };
  }
}
