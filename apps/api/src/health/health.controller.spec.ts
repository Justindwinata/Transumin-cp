import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports only process liveness', () => {
    const controller = new HealthController();

    assert.deepEqual(controller.live(), {
      status: 'ok',
      service: 'transum-in-nexus-api',
    });
  });
});
