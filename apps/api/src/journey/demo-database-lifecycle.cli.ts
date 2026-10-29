import { lifecycle } from './demo-database-lifecycle.js';

const command = process.argv[2];
const action =
  (command === 'seed' || command === 'run' || command === 'present') &&
  process.argv.length === 3
    ? lifecycle(command)
    : Promise.reject(new Error('Expected command: seed, run or present'));

await action.catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Unknown lifecycle error'}\n`,
  );
  process.exitCode = 1;
});
