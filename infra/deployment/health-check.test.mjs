#!/usr/bin/env node
// SAMPLE servers only; no database, graph, secrets, or host listeners.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

let degraded = false;
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><title>SAMPLE monitoring fixture</title>');
  }
  res.setHeader('content-type', 'application/json');
  const body =
    req.url === '/health/live'
      ? { status: 'ok' }
      : req.url === '/health/ready'
        ? {
            status: 'ready',
            dependencies: { database: { status: 'up', postgis: 'available' } },
          }
        : degraded
          ? {
              data: { __typename: 'Query' },
              errors: [{ message: 'SAMPLE failure' }],
            }
          : { data: { __typename: 'Query' } };
  res.end(JSON.stringify(body));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function run(overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [new URL('./health-check.mjs', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          API_BASE_URL: origin,
          WEB_BASE_URL: origin,
          OTP_URL: `${origin}/otp`,
          ...overrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}
try {
  assert.equal((await run()).code, 0);
  console.log('PASS SAMPLE startup and four health probes');
  degraded = true;
  const failure = await run();
  assert.equal(failure.code, 1);
  assert.match(failure.output, /FAIL otp/);
  console.log('PASS OTP GraphQL errors fail despite HTTP 200');
  const invalid = await run({ OTP_URL: 'http://sample:private@localhost/otp' });
  assert.equal(invalid.code, 1);
  assert.ok(!invalid.output.includes('private'));
  console.log('PASS credential URL rejected without secret output');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
