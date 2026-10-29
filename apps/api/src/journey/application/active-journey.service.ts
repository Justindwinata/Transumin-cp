import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import {
  ACTIVE_JOURNEY_REPOSITORY,
  type ActiveJourneyRepositoryPort,
} from './active-journey.repository.port.js';
import type {
  ActiveJourney,
  JourneyAlert,
  JourneyDependency,
} from '../domain/active-journey.js';
import { ActiveJourneyError } from '../domain/active-journey.js';
import type { JourneyAlternative } from '../domain/journey.js';
import { assertCanonicalStateBindings } from './journey-planner.service.js';

@Injectable()
export class ActiveJourneyService {
  constructor(
    @Inject(ACTIVE_JOURNEY_REPOSITORY)
    private readonly repository: ActiveJourneyRepositoryPort,
  ) {}

  async activate(input: {
    ownerRef: string;
    selectedJourney: JourneyAlternative;
    activatedAt?: string;
    idempotencyKey?: string;
  }): Promise<ActiveJourney> {
    assertOwnerRef(input.ownerRef);
    assertCanonicalStateBindings(input.selectedJourney.legs);
    const activatedAt = input.activatedAt ?? new Date().toISOString();
    assertIsoDate(activatedAt, 'activatedAt');
    if (
      input.idempotencyKey !== undefined &&
      !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)
    )
      throw new ActiveJourneyError(
        'ACTIVATION_CONFLICT',
        'Invalid activation idempotency key.',
      );
    const journeyId = input.idempotencyKey
      ? randomUUID()
      : activeJourneyInstanceId(
          input.ownerRef,
          input.selectedJourney.journeyId,
        );
    return this.repository.activate({
      journeyId,
      ownerRef: input.ownerRef,
      selectedJourney: input.selectedJourney,
      planFingerprint: selectedJourneyFingerprint(input.selectedJourney),
      ...(input.idempotencyKey
        ? {
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: productActivationFingerprint(
              input.selectedJourney,
            ),
          }
        : {}),
      dependencies: extractJourneyDependencies(input.selectedJourney).map(
        (dependency) => ({ ...dependency, journeyId }),
      ),
      activatedAt,
    });
  }

  get(journeyId: string, ownerRef: string): Promise<ActiveJourney> {
    assertOwnerRef(ownerRef);
    return this.repository.get(journeyId, ownerRef);
  }

  async updateProgress(input: {
    journeyId: string;
    ownerRef: string;
    completedLegCount: number;
    currentLegSequence: number | null;
    recordedAt: string;
    acceptedRecoveryId?: string | null;
  }): Promise<ActiveJourney> {
    assertOwnerRef(input.ownerRef);
    assertIsoDate(input.recordedAt, 'recordedAt');
    if (
      !Number.isInteger(input.completedLegCount) ||
      input.completedLegCount < 0
    )
      throw new ActiveJourneyError(
        'INVALID_PROGRESS',
        'completedLegCount must be a non-negative integer.',
      );
    if (
      input.currentLegSequence !== null &&
      (!Number.isInteger(input.currentLegSequence) ||
        input.currentLegSequence < input.completedLegCount)
    )
      throw new ActiveJourneyError(
        'INVALID_PROGRESS',
        'currentLegSequence must identify the current or an upcoming leg.',
      );
    return this.repository.updateProgress({
      journeyId: input.journeyId,
      ownerRef: input.ownerRef,
      completedLegCount: input.completedLegCount,
      currentLegSequence: input.currentLegSequence,
      recordedAt: input.recordedAt,
      acceptedRecoveryId: input.acceptedRecoveryId,
    });
  }

  confirmBoarding(input: {
    journeyId: string;
    ownerRef: string;
    legSequence: number;
    confirmedAt: string;
    acceptedRecoveryId?: string | null;
  }): Promise<ActiveJourney> {
    assertOwnerRef(input.ownerRef);
    assertConfirmation(input);
    return this.repository.confirmBoarding(input);
  }

  confirmAlighting(input: {
    journeyId: string;
    ownerRef: string;
    legSequence: number;
    confirmedAt: string;
    acceptedRecoveryId?: string | null;
  }): Promise<ActiveJourney> {
    assertOwnerRef(input.ownerRef);
    assertConfirmation(input);
    return this.repository.confirmAlighting(input);
  }

  listAlerts(
    journeyId: string,
    ownerRef: string,
  ): Promise<readonly JourneyAlert[]> {
    assertOwnerRef(ownerRef);
    return this.repository.listAlerts(journeyId, ownerRef);
  }
}

export function activeJourneyInstanceId(
  ownerRef: string,
  routingJourneyId: string,
  planFingerprint?: string,
): string {
  const scope = planFingerprint
    ? `${ownerRef}:${routingJourneyId}:${planFingerprint}`
    : `${ownerRef}:${routingJourneyId}`;
  return stableUuid('active-journey-instance', scope);
}

export function selectedJourneyFingerprint(
  journey: JourneyAlternative,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(journey)))
    .digest('hex');
}

/**
 * ponytail: product-layer identity that ignores only volatile planned_at.
 * Frozen research fingerprints continue to use the original hash.
 * Route, stop, service_date, and timing stay meaningful; only request-time is dropped.
 */
export function productActivationFingerprint(
  journey: JourneyAlternative,
): string {
  const { plannedAt: _unusedPlannedAt, ...stableContext } =
    journey.routingContext;
  void _unusedPlannedAt;
  return createHash('sha256')
    .update('product-activation-v1:')
    .update(
      JSON.stringify(
        canonicalValue({ ...journey, routingContext: stableContext }),
      ),
    )
    .digest('hex');
}

export function extractJourneyDependencies(
  journey: JourneyAlternative,
): readonly Omit<JourneyDependency, 'dependencyId'>[] {
  const dependencies = journey.legs.flatMap((leg) =>
    leg.entityBindings.map((binding) => {
      if (binding.mobilityEntityId === null)
        throw new ActiveJourneyError(
          'ACTIVATION_CONFLICT',
          `Entity ${binding.otpEntityId} has no state-bearing canonical identity.`,
        );
      return {
        journeyId: journey.journeyId,
        legSequence: leg.sequence,
        mobilityEntityId: binding.mobilityEntityId,
        canonicalEntityId: binding.canonicalEntityId,
        entityType: binding.entityType,
        productMode: binding.productMode,
        provenanceRef: binding.provenanceRef,
      };
    }),
  );
  return [
    ...new Map(
      dependencies.map((dependency) => [
        `${dependency.legSequence}:${dependency.mobilityEntityId}`,
        dependency,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      left.legSequence - right.legSequence ||
      left.mobilityEntityId.localeCompare(right.mobilityEntityId),
  );
}

export function dependencyId(
  journeyId: string,
  legSequence: number,
  mobilityEntityId: string,
): string {
  return stableUuid(
    'journey-dependency',
    `${journeyId}:${legSequence}:${mobilityEntityId}`,
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  return value;
}

function assertOwnerRef(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    throw new ActiveJourneyError(
      'OWNER_SCOPE_MISMATCH',
      'ownerRef must be a bounded opaque session reference.',
    );
}

export function assertConfirmation(input: {
  legSequence: number;
  confirmedAt: string;
}): void {
  assertIsoDate(input.confirmedAt, 'confirmedAt');
  if (!Number.isInteger(input.legSequence) || input.legSequence < 0)
    throw new ActiveJourneyError(
      'INVALID_BOARDING',
      'legSequence must be a non-negative integer.',
    );
}

function assertIsoDate(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)))
    throw new ActiveJourneyError(
      'INVALID_PROGRESS',
      `${field} must be an ISO date-time.`,
    );
}
