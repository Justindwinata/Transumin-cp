import { Injectable } from '@nestjs/common';

import type {
  OperationalIncidentType,
  OperationalMode,
  OperationalState,
} from '../domain/operational-data.js';
import {
  OPERATIONAL_INCIDENT_TYPES,
  OPERATIONAL_MODES,
  OPERATIONAL_STATES,
} from '../domain/operational-data.js';

export type AiSourceClaimField =
  | 'incident_type'
  | 'affected_entities'
  | 'affected_mode'
  | 'state'
  | 'start_time'
  | 'end_time'
  | 'reason';

export type AiSourceClaim = Readonly<{
  field: AiSourceClaimField;
  quote: string;
}>;

export type AiIncidentExtraction = Readonly<{
  incidentType: OperationalIncidentType | null;
  affectedEntities: readonly string[];
  affectedModes: readonly OperationalMode[];
  state: OperationalState | null;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  sourceClaims: readonly AiSourceClaim[];
  unsupportedFields: readonly AiSourceClaimField[];
  confidence: number;
}>;

export type AiExtractionValidation = Readonly<{
  validCandidate: boolean;
  errors: readonly string[];
}>;

function claimedFields(extraction: AiIncidentExtraction): AiSourceClaimField[] {
  const fields: AiSourceClaimField[] = [];
  if (extraction.incidentType !== null) fields.push('incident_type');
  if (extraction.affectedEntities.length > 0) fields.push('affected_entities');
  if (extraction.affectedModes.length > 0) fields.push('affected_mode');
  if (extraction.state !== null) fields.push('state');
  if (extraction.startTime !== null) fields.push('start_time');
  if (extraction.endTime !== null) fields.push('end_time');
  if (extraction.reason !== null) fields.push('reason');
  return fields;
}

@Injectable()
export class AiIncidentExtractionValidator {
  validate(
    extraction: AiIncidentExtraction,
    sourceText: string,
  ): AiExtractionValidation {
    const errors: string[] = [];
    if (
      !Number.isFinite(extraction.confidence) ||
      extraction.confidence < 0 ||
      extraction.confidence > 1
    )
      errors.push('confidence must be between 0 and 1');
    if (extraction.incidentType === null)
      errors.push('incident_type is required for a valid candidate');
    if (extraction.affectedEntities.length === 0)
      errors.push('affected_entities is required for a valid candidate');
    if (extraction.affectedModes.length === 0)
      errors.push('affected_mode is required for a valid candidate');
    if (extraction.state === null)
      errors.push('state is required for a valid candidate');
    if (extraction.startTime === null)
      errors.push('start_time is required for a valid candidate');
    if (extraction.reason === null)
      errors.push('reason is required for a valid candidate');
    if (
      extraction.incidentType !== null &&
      !OPERATIONAL_INCIDENT_TYPES.includes(extraction.incidentType)
    )
      errors.push('incident_type is unsupported');
    if (
      extraction.state !== null &&
      !OPERATIONAL_STATES.includes(extraction.state)
    )
      errors.push('state is unsupported');
    if (
      extraction.affectedModes.some((mode) => !OPERATIONAL_MODES.includes(mode))
    )
      errors.push('affected_mode contains an unsupported mode');
    if (
      extraction.affectedEntities.some(
        (entity) => typeof entity !== 'string' || entity.trim() === '',
      )
    )
      errors.push('affected_entities contains an empty entity');
    for (const [field, value] of [
      ['start_time', extraction.startTime],
      ['end_time', extraction.endTime],
    ] as const) {
      if (value !== null && !Number.isFinite(Date.parse(value)))
        errors.push(`${field} must be an ISO-8601 timestamp when populated`);
    }
    if (extraction.unsupportedFields.length > 0)
      errors.push(
        `unsupported fields require review: ${extraction.unsupportedFields.join(', ')}`,
      );
    for (const claim of extraction.sourceClaims) {
      if (claim.quote.trim() === '' || !sourceText.includes(claim.quote))
        errors.push(
          `source claim for ${claim.field} is not an exact source span`,
        );
    }
    const supported = new Set(
      extraction.sourceClaims.map((claim) => claim.field),
    );
    for (const field of claimedFields(extraction)) {
      if (!supported.has(field))
        errors.push(`${field} has no supporting source claim`);
    }
    return { validCandidate: errors.length === 0, errors };
  }
}
