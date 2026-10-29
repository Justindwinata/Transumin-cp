import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * D11 presenter runtime. Deliberately holds no database authority: it never
 * opens a connection, never issues SQL, and forwards only allowlisted payloads
 * built below — terminal input itself never reaches the child process.
 */
export const PRESENTER_PORT = 3001;
export const WEB_URL = 'http://127.0.0.1:3000';
export const PRESENTER_SNAPSHOT = '07d3393e-e7f4-5708-b467-807406c25a10';
/** Canonical route 6H identity from data/manifests/DEMO-20261011-EVIDENCE.json. */
export const PRESENTER_ENTITY = 'c95bde93-682f-5742-ab1f-3b0f653ecbae';

export const PRESENTER_HELP = [
  'presenter commands (anything else is refused and never forwarded):',
  '  help     this list',
  '  status   session status: database, evidence, child processes',
  '  hazard   SIMULATED hazard-geometry evidence path (real PostGIS write)',
  '  incident UNAVAILABLE on canonical 6H (fixed SIMULATED evidence identity)',
  '  resolve  UNKNOWN on canonical 6H (same fixed identities, resolution state)',
  '  stop     graceful API shutdown, then same-invocation scratch teardown',
].join('\n');

export type PresenterRequest = Readonly<Record<string, string | boolean>>;

/**
 * Fixed identities keep re-ingest idempotent inside one scratch: replaying the
 * same command repeats identical evidence instead of appending a second record.
 */
const INCIDENT_IDS = {
  observationId: 'd11d0001-1001-4001-8001-000000000001',
  incidentId: 'd11d0001-1001-4001-8001-000000000002',
} as const;
const RESOLVE_IDS = {
  observationId: 'd11d0002-1002-4002-8002-000000000001',
  incidentId: 'd11d0002-1002-4002-8002-000000000002',
} as const;

export const PRESENTER_ACTIONS = [
  'help',
  'status',
  'hazard',
  'incident',
  'resolve',
  'stop',
] as const;
export type PresenterAction = (typeof PRESENTER_ACTIONS)[number];

/** Allowlist guard: fixed, argument-free commands only; anything else throws. */
export function presenterAction(input: string): PresenterAction {
  const action = input.trim();
  assert.ok(
    (PRESENTER_ACTIONS as readonly string[]).includes(action),
    `Refused command, not forwarded: ${JSON.stringify(action.slice(0, 64))}`,
  );
  return action as PresenterAction;
}

export function presenterRequest(
  command: 'hazard' | 'incident' | 'resolve',
): PresenterRequest {
  if (command === 'hazard') return { event: 'hazard_geometry' };
  if (command === 'incident')
    return {
      entityId: PRESENTER_ENTITY,
      mode: 'TRANSJAKARTA',
      state: 'UNAVAILABLE',
      ...INCIDENT_IDS,
    };
  if (command === 'resolve')
    return {
      entityId: PRESENTER_ENTITY,
      mode: 'TRANSJAKARTA',
      state: 'UNKNOWN',
      ...RESOLVE_IDS,
    };
  throw new Error('Invalid mutation command');
}

export const presenterPayload = presenterRequest;

export type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

export type PresenterChild = Readonly<{
  pid: number;
  startedAt: number;
  /** Resolves when the child closes, whether expected or not; never rejects. */
  closing: Promise<ChildExit>;
  send(request: PresenterRequest): Promise<Record<string, unknown>>;
  /** Ends stdin and waits for close. Never signals the child. */
  stop(): Promise<ChildExit>;
  diagnostics(): readonly string[];
}>;

export type PresenterChildOptions = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  readyPattern: string;
  readyTimeoutMs?: number;
}>;

/** Provider/DB diagnostics can carry credentials; never print them back. */
function redact(value: string): string {
  return value.replace(
    /(postgresql?:\/\/[^\s:/@]+:)[^\s@]+@/gi,
    '$1[REDACTED]@',
  );
}

export async function startPresenterChild(
  options: PresenterChildOptions,
): Promise<PresenterChild> {
  const startedAt = Date.now();
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const notes: string[] = [];
  const lines: string[] = [];
  let exited = false;
  const note = (value: string) => {
    notes.push(redact(value));
    if (notes.length > 40) notes.shift();
  };
  let pending = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    pending += chunk;
    let boundary = pending.indexOf('\n');
    while (boundary >= 0) {
      lines.push(pending.slice(0, boundary).trim());
      pending = pending.slice(boundary + 1);
      boundary = pending.indexOf('\n');
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => note(chunk));
  child.stdin!.on('error', (error) => note(String(error)));
  const closing = new Promise<ChildExit>((resolveClose) => {
    child.once('error', (error) => {
      note(String(error));
      exited = true;
      resolveClose({ code: null, signal: null });
    });
    child.once('close', (code, signal) => {
      exited = true;
      resolveClose({ code, signal });
    });
  });
  const diagnostics = () => notes.slice(-8);
  let ready = false;
  const shutdown = async (): Promise<void> => {
    if (ready || exited) return;
    if (!child.stdin!.destroyed) child.stdin!.end();
    await Promise.race([closing, delay(10_000)]);
  };
  // Polling instead of a wake-up channel: one consumer, 50 ms ceiling, no race.
  const takeLine = async (timeoutMs: number): Promise<string | null> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const line = lines.shift();
      if (line !== undefined) return line;
      if (exited || Date.now() >= deadline) return null;
      await delay(50);
    }
  };
  const readyDeadline = Date.now() + (options.readyTimeoutMs ?? 60_000);
  try {
    for (;;) {
      const remaining = readyDeadline - Date.now();
      if (remaining <= 0)
        throw new Error(
          `Presenter API was not ready; diagnostics:\n${diagnostics()}`,
        );
      const line = await takeLine(remaining);
      if (line === null)
        throw new Error(
          `Presenter API stopped before ready:\n${diagnostics()}`,
        );
      if (line.includes(options.readyPattern)) break;
      note(line);
    }
    ready = true;
  } catch (error) {
    await shutdown();
    throw error;
  }
  const send = async (
    request: PresenterRequest,
  ): Promise<Record<string, unknown>> => {
    if (exited)
      throw new Error(
        `Presenter API stopped; command not sent:\n${diagnostics()}`,
      );
    child.stdin!.write(`${JSON.stringify(request)}\n`);
    for (;;) {
      const line = await takeLine(60_000);
      if (line === null)
        throw new Error(
          `Presenter API produced no response:\n${diagnostics()}`,
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        note(line);
        continue;
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
      note(line);
    }
  };
  // Let Nest drain first. An open SSE request can wedge both stdin close and
  // SIGTERM, so escalation remains bounded to this exact session-owned child.
  const stop = async (): Promise<ChildExit> => {
    if (!exited && !child.stdin!.destroyed) child.stdin!.end();
    const graceful = await Promise.race([closing, delay(15_000)]);
    if (graceful !== undefined) return graceful;
    child.kill('SIGTERM');
    const terminated = await Promise.race([closing, delay(5_000)]);
    if (terminated !== undefined) return terminated;
    child.kill('SIGKILL');
    return closing;
  };
  return { pid: child.pid!, startedAt, closing, send, stop, diagnostics };
}

export type PresenterIo = Readonly<{
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
}>;

export async function runPresenterTerminal(
  child: PresenterChild,
  status: () => Record<string, unknown> | Promise<Record<string, unknown>>,
  io: PresenterIo = { input: process.stdin, output: process.stdout },
): Promise<'STOPPED' | 'UNEXPECTED_END'> {
  const write = (value: string) => io.output.write(`${value}\n`);
  const input = createInterface({
    input: io.input,
    output: io.output,
    terminal: io.input.isTTY === true,
    prompt: 'present> ',
  });
  let stopped = false;
  void child.closing.then(() => input.close());
  input.on('SIGINT', () => input.close());
  write(PRESENTER_HELP);
  input.prompt();
  try {
    for await (const line of input) {
      const command = line.trim();
      if (command === '') {
        input.prompt();
        continue;
      }
      let action: PresenterAction;
      try {
        action = presenterAction(command);
      } catch (error) {
        write(error instanceof Error ? error.message : 'Refused command');
        input.prompt();
        continue;
      }
      if (action === 'stop') {
        stopped = true;
        break;
      }
      if (action === 'help') {
        write(PRESENTER_HELP);
        input.prompt();
        continue;
      }
      if (action === 'status') {
        write(JSON.stringify(await status(), null, 2));
        input.prompt();
        continue;
      }
      try {
        write(JSON.stringify(await child.send(presenterRequest(action))));
      } catch (error) {
        write(error instanceof Error ? error.message : 'Command failed');
        break;
      }
      input.prompt();
    }
  } finally {
    input.close();
  }
  return stopped ? 'STOPPED' : 'UNEXPECTED_END';
}

/** Refuse to start when the presenter port has an owner we do not control. */
export function assertPortFree(
  port: number,
  host = '127.0.0.1',
): Promise<void> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) =>
      rejectPort(
        new Error(`Port ${port} is already in use; refusing unknown owner`, {
          cause: error,
        }),
      ),
    );
    server.listen(port, host, () => server.close(() => resolvePort()));
  });
}

export type WebOwnership = 'PRESENT' | 'ABSENT' | 'UNKNOWN_OWNER';

/**
 * A live passenger UI must be this repository's app: the presenter proxy and
 * demo control are the only trustworthy ownership signals available locally.
 */
export async function webReadiness(url = WEB_URL): Promise<WebOwnership> {
  let response: Response;
  let config: Response;
  try {
    [response, config] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(30_000) }),
      fetch(`${url}/api/passenger/config`, {
        signal: AbortSignal.timeout(30_000),
      }),
    ]);
  } catch {
    return 'ABSENT';
  }
  if (response.status !== 200 || config.status !== 200) return 'UNKNOWN_OWNER';
  const html = await response.text();
  const configured = (await config.json()) as {
    data?: { network_snapshot_id?: string };
  };
  return html.includes('Load presentation scenario') &&
    configured.data?.network_snapshot_id === PRESENTER_SNAPSHOT
    ? 'PRESENT'
    : 'UNKNOWN_OWNER';
}

export async function webConfigSnapshot(
  root: string,
): Promise<Readonly<Record<string, string>>> {
  const proxy = await readFile(
    resolve(root, 'apps/web/src/app/api/passenger/[...path]/route.ts'),
    'utf8',
  );
  assert.ok(
    proxy.includes("'http://127.0.0.1:3001/api/v1'"),
    'Passenger web must proxy to the local presenter API',
  );
  const packageJson = await readFile(
    resolve(root, 'apps/web/package.json'),
    'utf8',
  );
  assert.equal(
    (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts
      ?.dev,
    'next dev --port 3000',
    'Web dev port snapshot changed',
  );
  const nextConfig = await readFile(
    resolve(root, 'apps/web/next.config.mjs'),
    'utf8',
  );
  const sha = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  return {
    proxy: sha(proxy),
    packageJson: sha(packageJson),
    nextConfig: sha(nextConfig),
  };
}

function sha256File(path: string): string {
  return execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0]!;
}

/**
 * Provenance gate for the shared OTP instance: pinned manifest checksums plus
 * a live health answer. Existing local jar/graph only — never rebuild here.
 */
export async function otpReadiness(
  root: string,
  endpoint = process.env.OTP_URL ?? 'http://127.0.0.1:8080/otp/gtfs/v1',
): Promise<Readonly<Record<string, string | number>>> {
  const manifest = JSON.parse(
    await readFile(
      resolve(root, 'data/manifests/PHASE-4B-A-OTP-RUNTIME.json'),
      'utf8',
    ),
  ) as {
    otp: { version: string; sha256: string; bytes: number };
    graph: { sha256: string; bytes: number };
  };
  const jar = resolve(
    root,
    `data/processed/routing/phase4b-a/runtime/otp-shaded-${manifest.otp.version}.jar`,
  );
  const graph = resolve(
    root,
    'data/processed/routing/phase4b-a/input/graph.obj',
  );
  assert.equal(
    (await stat(jar)).size,
    manifest.otp.bytes,
    'OTP jar bytes differ from the pinned runtime manifest',
  );
  assert.equal(
    (await stat(graph)).size,
    manifest.graph.bytes,
    'graph.obj bytes differ from the pinned runtime manifest',
  );
  assert.equal(
    sha256File(jar),
    manifest.otp.sha256,
    'OTP jar checksum differs from the pinned runtime manifest',
  );
  assert.equal(
    sha256File(graph),
    manifest.graph.sha256,
    'graph checksum differs from the pinned runtime manifest',
  );
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok, `OTP health returned HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: { __typename?: string } };
  assert.ok(
    ['Query', 'QueryType'].includes(payload.data?.__typename ?? ''),
    'OTP health answer unexpected',
  );
  return {
    version: manifest.otp.version,
    endpoint,
    jarSha256: manifest.otp.sha256,
    graphSha256: manifest.graph.sha256,
    graphBytes: manifest.graph.bytes,
    healthMs: Date.now() - startedAt,
  };
}

export type StartedWeb = Readonly<{
  child: ChildProcess | null;
  started: boolean;
}>;

/** Start the passenger web dev server only when port 3000 has no owner. */
export async function ensureWeb(root: string): Promise<StartedWeb> {
  const state = await webReadiness();
  if (state === 'PRESENT') return { child: null, started: false };
  if (state === 'UNKNOWN_OWNER')
    throw new Error('Port 3000 serves an unknown owner; refusing to start web');
  const child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '--port', '3000'],
    {
      cwd: resolve(root, 'apps/web'),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        PASSENGER_NETWORK_SNAPSHOT_ID: PRESENTER_SNAPSHOT,
        PASSENGER_API_BASE_URL: 'http://127.0.0.1:3001/api/v1',
        NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3001/api/v1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostic = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostic = `${diagnostic}${chunk.toString()}`.slice(-2000);
  });
  const deadline = Date.now() + 120_000;
  for (;;) {
    if ((await webReadiness()) === 'PRESENT') return { child, started: true };
    if (child.exitCode !== null)
      throw new Error(`Web dev server exited ${child.exitCode}: ${diagnostic}`);
    if (Date.now() >= deadline) {
      child.kill('SIGTERM');
      throw new Error(`Web dev server never became ready: ${diagnostic}`);
    }
    await delay(500);
  }
}

/** Stop only a child this session started; existing web is left alone. */
export async function stopWeb(web: StartedWeb): Promise<void> {
  const child = web.child;
  if (!web.started || child === null) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      resolveStop();
    }, 10_000);
    timer.unref();
    child.once('close', () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill('SIGTERM');
  });
}
