#!/usr/bin/env node
// Read-only probes. Never print URLs, response bodies, cookies, or error details.
const names = ['API_BASE_URL', 'WEB_BASE_URL', 'OTP_URL'];
const urls = {};
try {
  for (const name of names) {
    const url = new URL(process.env[name]);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    if (name !== 'OTP_URL' && url.pathname !== '/') throw new Error();
    urls[name] = url;
  }
} catch {
  console.error(
    'FAIL configuration: set API_BASE_URL, WEB_BASE_URL origins and OTP_URL; no credentials/query/fragment',
  );
  process.exit(1);
}
const checks = [
  [
    'api-live',
    new URL('/health/live', urls.API_BASE_URL),
    {},
    async (r) => (await r.json()).status === 'ok',
  ],
  [
    'api-ready',
    new URL('/health/ready', urls.API_BASE_URL),
    {},
    async (r) => {
      const body = await r.json();
      return (
        body.status === 'ready' &&
        body.dependencies?.database?.status === 'up' &&
        body.dependencies?.database?.postgis === 'available'
      );
    },
  ],
  [
    'web',
    urls.WEB_BASE_URL,
    {},
    async (r) => (r.headers.get('content-type') ?? '').includes('text/html'),
  ],
  [
    'otp',
    urls.OTP_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    },
    async (r) => {
      const body = await r.json();
      return (
        !body.errors?.length &&
        ['Query', 'QueryType'].includes(body.data?.__typename)
      );
    },
  ],
];
await Promise.all(
  checks.map(async ([name, url, options, valid]) => {
    const start = performance.now();
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !(await valid(response))) throw new Error();
      if (!response.bodyUsed) await response.body?.cancel();
      console.log(`PASS ${name} ${Math.round(performance.now() - start)}ms`);
    } catch {
      console.error(`FAIL ${name} ${Math.round(performance.now() - start)}ms`);
      process.exitCode = 1;
    }
  }),
);
