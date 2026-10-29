#!/usr/bin/env node
// Loads the ignored root .env into the child environment, then starts the
// requested workspace script. dev servers read process.env directly, so the
// root .env must be loaded here rather than by each app.
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  loadEnvFile(`${root}.env`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  // CI or an operator shell may inject environment variables directly.
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/dev/with-env.mjs <pnpm args...>');
  process.exitCode = 2;
} else {
  const child = spawn('pnpm', targets, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
