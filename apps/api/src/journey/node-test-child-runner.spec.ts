/**
 * Fail-closed self-test for the Tier A child runner.
 *
 * Reproduces the observed product defect: `node --test` exits 0 and prints a
 * passing summary when only an `after` hook fails, so the prior runner printed
 * PASS while the database was left mutated. These checks assert that the runner
 * rejects on a failing assertion, an after-hook failure, and a hang, without
 * requiring any database.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { runNodeTests } from './node-test-child-runner.js';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const reporter = fileURLToPath(
  new URL('./acceptance-test-reporter.mjs', import.meta.url),
);
const fixtures = 'src/journey/__fixtures__';

function run(fixture: string, timeoutMs?: number) {
  return runNodeTests(
    'node',
    [
      '--import',
      'tsx',
      '--test',
      '--test-reporter',
      reporter,
      `${fixtures}/${fixture}`,
    ],
    { cwd, env: process.env, timeoutMs },
  );
}

describe('Tier A child runner is fail-closed', () => {
  it('accepts a green fixture', async () => {
    const result = await run('runner-positive.spec.ts');
    assert.equal(result.failed, 0);
    assert.ok(result.passed >= 1);
  });

  it('rejects a failing assertion with a nonzero exit', async () => {
    await assert.rejects(
      run('runner-negative-assert.spec.ts'),
      (error: Error) => {
        assert.match(error.message, /\[exit=1,/);
        assert.doesNotMatch(error.message, /"success":true/);
        return true;
      },
    );
  });

  it('rejects an after-hook failure even though the child exits 0', async () => {
    // Regression: prior runner trusted stdio + exit code and printed PASS.
    await assert.rejects(
      run('runner-negative-hook.spec.ts'),
      (error: Error) => {
        assert.match(error.message, /exit=0/);
        assert.match(error.message, /test-fail-event/);
        assert.doesNotMatch(error.message, /"status":"PASS"/);
        return true;
      },
    );
  });

  it('rejects a hang instead of waiting forever', async () => {
    await assert.rejects(run('runner-hang.spec.ts', 1_500), (error: Error) => {
      assert.match(error.message, /timeout/);
      return true;
    });
  });
});
