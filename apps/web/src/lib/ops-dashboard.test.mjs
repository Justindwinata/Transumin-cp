import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('dashboard fetch lifecycle has cancellation, stale guards, and no self-triggering snapshot dependency', () => {
  const source = readFileSync(
    new URL('../app/ops/ops-dashboard.tsx', import.meta.url),
    'utf8',
  );
  const effect = source.slice(
    source.indexOf("if (authState !== 'ready')"),
    source.indexOf('\n  async function loadMoreScenarios'),
  );
  assert.match(effect, /let active = true/);
  assert.match(effect, /if \(!active\) return/);
  assert.match(effect, /active = false/);
  assert.match(effect, /controller\.abort\(\)/);
  assert.match(effect, /\[authState, view, scenarioId, runId, snapshotId\]/);
  assert.doesNotMatch(
    effect,
    /\[authState, view, scenarioId, runId, snapshotId, snapshot\]/,
  );
});
