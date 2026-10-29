import { Injectable } from '@nestjs/common';

import {
  CONFIDENCE_STATUSES,
  IMPACT_BASES,
  OPERATIONAL_EVIDENCE_TYPES,
  OPERATIONAL_INCIDENT_TYPES,
  OPERATIONAL_MODES,
  OPERATIONAL_SOURCE_CLASSIFICATIONS,
  OPERATIONAL_STATES,
  SOURCE_CHANNELS,
  SOURCE_AUTHORITIES,
  type OperationalObservation,
  type OperationalIncidentCandidate,
} from '../domain/operational-data.js';

export type ContractValidationResult = Readonly<{
  valid: boolean;
  errors: readonly string[];
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class OperationalContractValidator {
  validate(observation: OperationalObservation): ContractValidationResult {
    const errors: string[] = [];
    if (!UUID_PATTERN.test(observation.observationId))
      errors.push('observationId must be a UUID');
    if (!UUID_PATTERN.test(observation.incidentId))
      errors.push('incidentId must be a UUID');
    if (!UUID_PATTERN.test(observation.provenance.sourceId))
      errors.push('provenance.sourceId must be a UUID');
    if (!OPERATIONAL_INCIDENT_TYPES.includes(observation.incidentType))
      errors.push('incidentType is unsupported');
    if (!OPERATIONAL_STATES.includes(observation.operationalState))
      errors.push('operationalState is unsupported');
    if (!OPERATIONAL_EVIDENCE_TYPES.includes(observation.evidenceType))
      errors.push('evidenceType is unsupported');
    if (!SOURCE_AUTHORITIES.includes(observation.sourceAuthority))
      errors.push('sourceAuthority is unsupported');
    if (!SOURCE_CHANNELS.includes(observation.sourceChannel))
      errors.push('sourceChannel is unsupported');
    if (!IMPACT_BASES.includes(observation.impactBasis))
      errors.push('impactBasis is unsupported');
    if (!CONFIDENCE_STATUSES.includes(observation.confidenceStatus))
      errors.push('confidenceStatus is unsupported');
    if (
      !OPERATIONAL_SOURCE_CLASSIFICATIONS.includes(
        observation.provenance.sourceClassification,
      )
    )
      errors.push('sourceClassification is unsupported');
    if (
      observation.affectedModes.some(
        (mode) => !OPERATIONAL_MODES.includes(mode),
      )
    )
      errors.push('affectedModes contains an unsupported mode');
    if (
      observation.affectedEntityRefs.length === 0 ||
      observation.affectedEntityRefs.some(
        (reference) => typeof reference !== 'string' || reference.trim() === '',
      )
    )
      errors.push('at least one affected entity reference is required');
    if (observation.reason.trim() === '') errors.push('reason is required');
    if (observation.provenance.rawReference.trim() === '')
      errors.push('rawReference is required');
    if (observation.provenance.lineageReference.trim() === '')
      errors.push('lineageReference is required');

    const observedAt = timestamp(observation.observedAt);
    const receivedAt = timestamp(observation.receivedAt);
    const updatedAt = timestamp(observation.updatedAt);
    const expiresAt = timestamp(observation.expiresAt);
    const retrievedAt = timestamp(observation.provenance.retrievedAt);
    if ([observedAt, receivedAt, updatedAt, expiresAt].includes(null)) {
      errors.push('all temporal fields must be valid ISO-8601 timestamps');
    } else if (
      observedAt! > receivedAt! ||
      receivedAt! > updatedAt! ||
      observedAt! >= expiresAt!
    ) {
      errors.push(
        'timestamps must satisfy observedAt < expiresAt and observedAt <= receivedAt <= updatedAt',
      );
    }
    if (retrievedAt === null)
      errors.push('provenance.retrievedAt must be a valid ISO-8601 timestamp');

    if (
      observation.confidence !== null &&
      (observation.confidence < 0 || observation.confidence > 1)
    )
      errors.push('confidence must be null or between 0 and 1');

    if (
      observation.evidenceType === 'LIVE' &&
      (observation.sourceAuthority !== 'OFFICIAL_MACHINE' ||
        observation.sourceChannel !== 'MACHINE_FEED' ||
        !['VERIFIED_PUBLIC_API', 'VERIFIED_PUBLIC_FEED'].includes(
          observation.provenance.sourceClassification,
        ))
    ) {
      errors.push(
        'LIVE evidence requires a verified official machine API/feed',
      );
    }
    if (
      observation.evidenceType === 'SIMULATED' &&
      observation.sourceAuthority !== 'SIMULATION'
    )
      errors.push('SIMULATED evidence requires SIMULATION authority');
    if (
      observation.operationalState === 'UNAVAILABLE' &&
      ['ENVIRONMENTAL_INDICATOR', 'FORECAST_INDICATOR'].includes(
        observation.impactBasis,
      )
    ) {
      errors.push(
        'environmental or forecast evidence cannot assert an operational closure',
      );
    }

    if (
      observation.sourceAuthority === 'ADMIN_FIELD_REVIEW' ||
      observation.sourceChannel === 'ADMIN_REVIEW'
    ) {
      const received = Date.parse(observation.receivedAt);
      const observed = Date.parse(observation.observedAt);
      const expires = Date.parse(observation.expiresAt);
      if (
        observation.sourceAuthority !== 'ADMIN_FIELD_REVIEW' ||
        observation.sourceChannel !== 'ADMIN_REVIEW' ||
        observation.evidenceType !== 'OBSERVED' ||
        observation.impactBasis !== 'DIRECT_OPERATIONAL_REPORT' ||
        observation.confidence !== null ||
        observation.confidenceStatus !== 'CONFIRMED' ||
        observation.sourceAttributes.source_class !== 'ADMIN_FIELD_REVIEW' ||
        observation.sourceAttributes.verification !== 'VERIFIED' ||
        received - observed > 30 * 60_000 ||
        observed > received ||
        expires - received < 5 * 60_000 ||
        expires - received > 60 * 60_000
      )
        errors.push(
          'Admin field observation requires a confirmed bounded ADMIN_FIELD_REVIEW decision',
        );
    }
    return { valid: errors.length === 0, errors };
  }

  assertValid(observation: OperationalObservation): void {
    const result = this.validate(observation);
    if (!result.valid)
      throw new Error(
        `Invalid operational observation: ${result.errors.join('; ')}`,
      );
  }

  validateCandidate(
    candidate: OperationalIncidentCandidate,
  ): ContractValidationResult {
    const errors = [...this.validate(candidate).errors];
    if (candidate.affectedModes.length === 0)
      errors.push('incident candidate must affect at least one mode');
    if (
      !['VALIDATED', 'REQUIRES_REVIEW', 'REJECTED'].includes(
        candidate.candidateStatus,
      )
    )
      errors.push('candidateStatus is unsupported');
    return { valid: errors.length === 0, errors };
  }

  assertValidCandidate(candidate: OperationalIncidentCandidate): void {
    const result = this.validateCandidate(candidate);
    if (!result.valid)
      throw new Error(
        `Invalid operational incident candidate: ${result.errors.join('; ')}`,
      );
  }
}
