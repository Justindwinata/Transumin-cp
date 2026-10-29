import { spawn } from 'node:child_process';

export type NodeTestResult = Readonly<{
  stdout: string;
  stderr: string;
  passed: number;
  failed: number;
}>;

type TestSummary = Readonly<{
  type?: string;
  data?: {
    success?: boolean;
    counts?: { passed?: number; failed?: number; cancelled?: number };
    details?: { passed?: boolean };
  };
}>;

export function runNodeTests(
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
  }>,
): Promise<NodeTestResult> {
  return new Promise((resolve, reject) => {
    // node:test marks test processes with NODE_TEST_CONTEXT; an inherited copy
    // makes the child skip its own files ("called recursively"), returning a
    // bogus green run. Strip it so the child runs a real isolated suite.
    const environment = { ...options.env };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(command, args, {
      ...options,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs);
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      action();
    };
    child.once('close', (code, signal) => {
      // Node 22 quirk: an after-hook failure can exit 0 with test:summary
      // success:true. A passing test:summary does NOT prove hooks passed.
      // Scan every event line: any test:fail or passed:false completion
      // (suite/test) is a hard failure.
      let failedEvent = false;
      let summary: TestSummary['data'] | null = null;
      for (const line of stdout.split('\n')) {
        if (line === '') continue;
        let event: TestSummary & { type?: string };
        try {
          event = JSON.parse(line) as TestSummary & { type?: string };
        } catch {
          continue;
        }
        if (event.type === 'test:fail') failedEvent = true;
        if (event.type === 'test:complete') {
          try {
            if (
              (JSON.parse(line) as { data?: { passed?: boolean } }).data
                ?.passed === false
            )
              failedEvent = true;
          } catch {
            failedEvent = true;
          }
        }
        if (event.type === 'test:summary') summary = event.data ?? null;
      }
      const counts = summary?.counts;
      if (
        code !== 0 ||
        signal !== null ||
        failedEvent ||
        summary?.success !== true ||
        counts?.failed !== 0 ||
        counts.cancelled !== 0
      ) {
        const reasons = [
          timedOut ? 'timeout' : null,
          code === 0 ? null : `exit=${String(code)}`,
          signal === null ? null : `signal=${signal}`,
          failedEvent ? 'test-fail-event' : null,
          summary?.success === false ? 'summary-failure' : null,
          counts !== undefined && counts.failed !== 0 ? 'counts-failed' : null,
          counts !== undefined && counts.cancelled !== 0
            ? 'counts-cancelled'
            : null,
          counts === undefined ? 'missing-summary' : null,
        ].filter((entry): entry is string => entry !== null);
        finish(() =>
          reject(
            new Error(
              `${command} tests failed [${reasons.join(',')}]: exit=${String(code)} signal=${String(signal)} summary=${JSON.stringify(summary ?? null)} stderr=${stderr.slice(-500)}`,
            ),
          ),
        );
        return;
      }
      finish(() =>
        resolve({
          stdout,
          stderr,
          passed: counts?.passed ?? 0,
          failed: counts?.failed ?? 0,
        }),
      );
    });
  });
}
