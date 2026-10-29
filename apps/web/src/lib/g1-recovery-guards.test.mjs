import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptanceReconcileOutcome,
  canCommitRecovery,
  recoveryProposalKey,
  recoverySource,
  sameRecoverySource,
  nextRecoveryAttempt,
} from './passenger-api.ts';

const journey = (id, revision, accepted_recovery_id = null) => ({
  journey_id: id,
  accepted_recovery_id,
  progress: { revision },
});

test('G1-A guards reject stale generation/source and scope proposal after acceptance', () => {
  const original = recoverySource(journey('j1', 4));
  const accepted = recoverySource(journey('j1', 4, 'r1'));
  assert.notEqual(
    recoveryProposalKey({
      journeyId: 'j1',
      impactId: 'i1',
      revision: 4,
      acceptedRecoveryId: null,
    }),
    recoveryProposalKey({
      journeyId: 'j1',
      impactId: 'i1',
      revision: 4,
      acceptedRecoveryId: 'r1',
    }),
  );
  assert.equal(sameRecoverySource(original, original), true);
  assert.equal(sameRecoverySource(original, accepted), false);
  const valid = {
    requestId: 2,
    latestRequestId: 2,
    generation: 7,
    latestGeneration: 7,
    captured: original,
    latest: original,
  };
  assert.equal(canCommitRecovery(valid), true);
  assert.equal(canCommitRecovery({ ...valid, latestGeneration: 8 }), false);
  assert.equal(canCommitRecovery({ ...valid, latest: accepted }), false);
  assert.equal(canCommitRecovery({ ...valid, requestId: 1 }), false);
});

test('G1-A reconcile distinguishes applied, safe retry, and unreadable state', () => {
  assert.equal(
    acceptanceReconcileOutcome({
      journey: { accepted_recovery_id: 'r1' },
      recoveryId: 'r1',
    }),
    'APPLIED',
  );
  assert.equal(
    acceptanceReconcileOutcome({
      journey: { accepted_recovery_id: null },
      recoveryId: 'r1',
    }),
    'NOT_APPLIED',
  );
  assert.equal(
    acceptanceReconcileOutcome({ journey: null, recoveryId: 'r1' }),
    'UNKNOWN',
  );
});

test('R6-C stale responses must not overwrite a generation-changing recovery', () => {
  const applied = { accepted_recovery_id: 'r2', accepted_before_leg_count: 1 };
  assert.equal(
    acceptanceReconcileOutcome({ journey: applied, recoveryId: 'r2' }),
    'APPLIED',
  );
  assert.equal(
    acceptanceReconcileOutcome({ journey: applied, recoveryId: 'r1' }),
    'NOT_APPLIED',
  );
  const capture = recoverySource({
    journey_id: 'j1',
    accepted_recovery_id: 'r1',
    progress: { revision: 2 },
  });
  const live = recoverySource({
    journey_id: 'j1',
    accepted_recovery_id: 'r2',
    progress: { revision: 2 },
  });
  assert.equal(
    canCommitRecovery({
      requestId: 2,
      latestRequestId: 2,
      generation: 1,
      latestGeneration: 1,
      captured: capture,
      latest: live,
    }),
    false,
  );
});

test('Recovery key stable for uncertain retry; fresh allowed only after known outcome', () => {
  assert.throws(() => nextRecoveryAttempt(null, true));
  assert.throws(() => nextRecoveryAttempt({ nonce: 0, known: false }, true));
  const after = nextRecoveryAttempt({ nonce: 0, known: true }, true);
  assert.equal(after.nonce, 1);
  assert.equal(after.known, false);
  // unknown outcome → same idempotencyKey on retry
  const stable = recoveryProposalKey({ journeyId: 'j1', impactId: 'i1', revision: 4, acceptedRecoveryId: null });
  const stable2 = recoveryProposalKey({ journeyId: 'j1', impactId: 'i1', revision: 4, acceptedRecoveryId: null, attemptNonce: 0 });
  assert.equal(stable, stable2);
  const fresh = recoveryProposalKey({ journeyId: 'j1', impactId: 'i1', revision: 4, acceptedRecoveryId: null, attemptNonce: 1 });
  assert.notEqual(stable, fresh);
  const transient = nextRecoveryAttempt({ nonce: 0, known: true }, false);
  assert.equal(transient.nonce, 0);
});
