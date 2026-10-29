import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Guardrail for the MODES combined-run timeout: `choose()` must prove the
// passenger app is hydrated and its config snapshot is ready before typing
// into the place combobox. Otherwise the React onChange never fires, no
// /transit/places request is emitted, and waitForResponse times out.
const source = readFileSync(
  new URL('./passenger-modes-browser-acceptance.mjs', import.meta.url),
  'utf8',
);

const choose = source.slice(
  source.indexOf('async function choose('),
  source.indexOf('function assertGeometry('),
);

test('choose() awaits an interactive snapshot-ready app before typing', () => {
  assert.ok(choose.length > 0, 'choose() helper not found');
  const gate = choose.indexOf(".getByRole('button', { name: 'Cari perjalanan'");
  const trial = choose.indexOf('click({ trial: true })');
  const wait = choose.indexOf('page.waitForResponse');
  const fill = choose.indexOf('.fill(query)');
  assert.ok(gate >= 0, 'Cari perjalanan readiness gate missing from choose()');
  assert.ok(
    trial > gate,
    'readiness gate must be an actionability trial click, not a real click',
  );
  assert.ok(
    wait > trial && fill > wait,
    'order must be: readiness gate < waitForResponse < fill(query)',
  );
});

test('the combobox wait still keys on the exact query and places endpoint', () => {
  assert.match(choose, /endswith\('\/api\/passenger\/transit\/places'\)/i);
  assert.match(
    choose,
    /searchParams\.get\('q'\) === query/,
    'response matcher must stay query-specific',
  );
});

test('the readiness gate tolerates only the enabled state, not disabled markup', () => {
  // A disabled trial click waits for enablement; ensure no assertion flips the
  // gate into a best-effort catch that would reintroduce the race.
  assert.ok(
    !/\.click\(\{ trial: true \}\)\.catch/.test(choose),
    'readiness gate must fail closed, not swallow a never-ready app',
  );
});
