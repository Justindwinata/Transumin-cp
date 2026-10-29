import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('passenger proxy allowlist includes copilot/messages as guarded POST', () => {
  const source = readFileSync(
    new URL('../app/api/passenger/[...path]/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /\^copilot\\\/messages\$/);
  // must still retain owner/service token checks and origin guard
  assert.match(source, /x-passenger-service-token/);
  assert.match(source, /x-journey-owner/);
  assert.match(source, /Cross-site request denied/);
  assert.match(source, /PASSENGER_SESSION_SECRET/);
  // must not echo client-supplied owner/service token
  assert.doesNotMatch(source, /request\.headers\.get\(['\"]x-journey-owner/);
  assert.doesNotMatch(
    source,
    /request\.headers\.get\(['\"]x-passenger-service-token/,
  );
});

test('proxy allowlist regexes: copilot resources only, not suffixes', () => {
  const allowed = [
    /^transit\/places$/,
    /^journeys\/(?:plan|planning-health)$/,
    /^journeys\/[0-9a-f-]{36}(?:\/(?:activate|progress|status|alerts(?:\/stream)?|boarding\/\d+|alighting\/\d+))?$/i,
    /^recoveries(?:\/[0-9a-f-]{36}(?:\/accept)?)?$/i,
    /^passenger-reports(?:\/[0-9a-f-]{36})?$/i,
    /^copilot\/messages$/,
    /^copilot\/sessions\/[0-9a-f-]{36}$/i,
  ];
  assert.equal(
    allowed.some((r) => r.test('copilot/messages')),
    true,
  );
  assert.equal(
    allowed.some((r) =>
      r.test('copilot/sessions/123e4567-e89b-12d3-a456-426614174000'),
    ),
    true,
  );
  assert.equal(
    allowed.some((r) => r.test('copilot/sessions/not-a-uuid')),
    false,
  );
  assert.equal(
    allowed.some((r) => r.test('copilot/messages/extra')),
    false,
  );
  assert.equal(
    allowed.some((r) => r.test('copilot')),
    false,
  );
  assert.equal(
    allowed.some((r) => r.test('controlled/passenger-reports')),
    false,
  );
});

test('passenger config includes request IDs and prevents caching', () => {
  const source = readFileSync(
    new URL('../app/api/passenger/config/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /request_id: randomUUID\(\)/);
  assert.match(source, /'cache-control': 'no-store'/);
});

test('copilot drawer defaults recovery question when recovery context present', () => {
  const source = readFileSync(
    new URL('../components/copilot-drawer.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /Jelaskan rute pengganti ini/);
  // mounted with snake journey_id / recovery_id in passenger-app
  const appSource = readFileSync(
    new URL('../app/passenger-app.tsx', import.meta.url),
    'utf8',
  );
  assert.match(appSource, /CopilotDrawer/);
  assert.match(appSource, /key=\{\s*recovery\?\.recovery_id\s*/s);
  assert.match(appSource, /journeyId=\{\s*recovery/);
  assert.match(appSource, /recoveryId=\{\s*recovery/);
  // provenance comes from server, not hardcoded SCHEDULED claim
  assert.match(source, /Sumber data:.*evidence_type/s);
  assert.doesNotMatch(
    source,
    /Evidence is.*<code>SCHEDULED<\/code>.*not live tracking/,
  );
});
