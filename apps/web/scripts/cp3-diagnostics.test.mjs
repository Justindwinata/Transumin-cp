import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(
  new URL(
    './passenger-cp3-recovery-navigation-acceptance.mjs',
    import.meta.url,
  ),
  'utf8',
);

test('CP3 failure diagnostics retain route/status, never inspect response payload', () => {
  const helper = source.slice(
    source.indexOf('let stage ='),
    source.indexOf('async function direct('),
  );
  const context = vm.createContext({ assert });
  vm.runInContext(helper, context);
  const response = {
    status: () => 500,
    url() {
      throw new Error('URL must not be read');
    },
    request() {
      throw new Error('request/cookies must not be read');
    },
    json() {
      throw new Error('body/coordinates must not be read');
    },
  };
  context.response = response;
  assert.throws(
    () =>
      vm.runInContext(
        "assertResponse(response, 'POST /api/passenger/journeys/plan', [201])",
        context,
      ),
    /POST \/api\/passenger\/journeys\/plan: expected 201, received 500/,
  );
  response.status = () => 201;
  vm.runInContext(
    "assertResponse(response, 'POST /api/passenger/journeys/plan', [201])",
    context,
  );
  assert.ok(!source.includes('JSON.stringify(submittedBody)'));
  assert.ok(!source.includes('JSON.stringify(body)'));
  assert.ok(!source.includes('error.message'));
});
