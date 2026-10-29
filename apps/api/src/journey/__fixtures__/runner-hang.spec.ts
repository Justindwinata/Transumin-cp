import { it } from 'node:test';
// Keeps the event loop alive so only the runner timeout can end the child.
it('hangs forever', () =>
  new Promise((resolve) => setTimeout(resolve, 60_000)));
