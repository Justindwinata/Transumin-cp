import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PRESENTER_ACTIONS,
  presenterAction,
  presenterPayload,
  startPresenterChild,
} from './presenter-session.js';

describe('D11 presenter session allowlist', () => {
  it('accepts only the fixed, argument-free command allowlist', () => {
    for (const action of PRESENTER_ACTIONS)
      assert.equal(presenterAction(`  ${action}  `), action);
    for (const rejected of [
      '',
      'help please',
      'status --all',
      'hazard now',
      'incident 12345',
      'resolve other',
      'stop now',
      'dispose seed.json',
      'DROP DATABASE',
      'seed',
      'run',
    ])
      assert.throws(
        () => presenterAction(rejected),
        `must reject ${JSON.stringify(rejected)}`,
      );
  });

  it('builds fixed payloads that cannot target arbitrary entities or incidents', () => {
    assert.deepEqual(presenterPayload('hazard'), {
      event: 'hazard_geometry',
    });

    const incident = presenterPayload('incident');
    assert.equal(incident.entityId, 'c95bde93-682f-5742-ab1f-3b0f653ecbae');
    assert.equal(incident.mode, 'TRANSJAKARTA');
    assert.equal(incident.state, 'UNAVAILABLE');

    const resolve = presenterPayload('resolve');
    assert.equal(resolve.entityId, incident.entityId);
    assert.equal(resolve.mode, 'TRANSJAKARTA');
    assert.equal(resolve.state, 'UNKNOWN');

    assert.throws(() =>
      presenterPayload('stop' as 'hazard' | 'incident' | 'resolve'),
    );
    assert.throws(() =>
      presenterPayload('run' as 'hazard' | 'incident' | 'resolve'),
    );
  });

  it(
    'terminates only its owned child when graceful stdin shutdown is wedged',
    { timeout: 30_000 },
    async () => {
      const child = await startPresenterChild({
        command: process.execPath,
        args: [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdin.resume(); console.log('READY'); setInterval(() => {}, 1000)",
        ],
        cwd: process.cwd(),
        env: process.env,
        readyPattern: 'READY',
      });
      const startedAt = Date.now();
      const exit = await child.stop();

      assert.equal(exit.signal, 'SIGKILL');
      assert.ok(Date.now() - startedAt >= 19_000);
      assert.ok(Date.now() - startedAt < 25_000);
    },
  );
});
