import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  OperationalIncidentCandidate,
  OperationalIncidentType,
  OperationalMode,
  OperationalState,
} from '../domain/operational-data.js';
import { OperationalContractValidator } from './operational-contract-validator.js';

export type OperatorConfirmedIncidentInput = Readonly<{
  sourceId: string;
  sourceOperator: string;
  submittedByActorId: string;
  affectedEntityRefs: readonly string[];
  affectedModes: readonly OperationalMode[];
  incidentType: OperationalIncidentType;
  operationalState: OperationalState;
  reason: string;
  startTime: string;
  expiresAt: string;
  rawReference: string;
}>;

@Injectable()
export class OperatorConfirmedIncidentService {
  constructor(
    @Inject(OperationalContractValidator)
    private readonly validator: OperationalContractValidator,
  ) {}

  createCandidate(
    input: OperatorConfirmedIncidentInput,
    receivedAt: Date = new Date(),
  ): OperationalIncidentCandidate {
    if (input.submittedByActorId.trim() === '')
      throw new Error('submittedByActorId is required');
    if (input.sourceOperator.trim() === '')
      throw new Error('sourceOperator is required');
    if (Date.parse(input.expiresAt) <= receivedAt.getTime())
      throw new Error('expiresAt must be later than the submission time');
    const received = receivedAt.toISOString();
    const candidate: OperationalIncidentCandidate = {
      observationId: randomUUID(),
      incidentId: randomUUID(),
      incidentType: input.incidentType,
      affectedEntityRefs: input.affectedEntityRefs,
      affectedModes: input.affectedModes,
      operationalState: input.operationalState,
      evidenceType: 'OBSERVED',
      sourceAuthority: 'OFFICIAL_OPERATOR_CONFIRMED',
      sourceChannel: 'OPERATOR_CONFIRMED',
      impactBasis: 'OPERATOR_CONFIRMED',
      observedAt: input.startTime,
      receivedAt: received,
      updatedAt: received,
      expiresAt: input.expiresAt,
      reason: input.reason,
      confidenceStatus: 'CONFIRMED',
      confidence: 1,
      provenance: {
        sourceId: input.sourceId,
        sourceClassification: 'PARTNERSHIP_REQUIRED',
        rawReference: input.rawReference,
        lineageReference: `operator-console:${input.submittedByActorId}`,
        retrievedAt: received,
      },
      sourceAttributes: {
        source_operator: input.sourceOperator,
        submitted_by_actor_id: input.submittedByActorId,
      },
      candidateStatus: 'VALIDATED',
    };
    this.validator.assertValidCandidate(candidate);
    return candidate;
  }
}
