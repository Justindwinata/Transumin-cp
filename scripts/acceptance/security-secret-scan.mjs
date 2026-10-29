// Client-bundle / release secret scan. Reports locations and categories only, never values.
// Local full scan (exact secret values): requires an ignored .env and built web+api output.
// CI scan: no secrets present, so exact-value matching is skipped and category scanning runs.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const categoryOnly = process.argv.includes('--category-only');
const envPath = path.join(root, '.env');
const env = existsSync(envPath)
  ? Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const i = line.indexOf('=');
          return [
            line.slice(0, i),
            line
              .slice(i + 1)
              .trim()
              .replace(/^(['"])(.*)\1$/, '$2'),
          ];
        }),
    )
  : {};
const tokens = [
  'PASSENGER_SERVICE_TOKEN',
  'CONTROLLED_REVIEW_TOKEN',
  'PASSENGER_SESSION_SECRET',
];
const keys = [...tokens, 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL'];
// Full (default) mode is fail-closed: it needs all three real tokens and a production build.
// CI passes --category-only because it has no secrets and no build output.
const missingTokens = tokens.filter((key) => !(env[key]?.length >= 32));
const valueScan = !categoryOnly;
if (valueScan && missingTokens.length) {
  console.error(
    `security:scan requires .env with ${missingTokens.join(', ')} each >=32 chars (or pass --category-only in CI)`,
  );
  process.exit(2);
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? files(p) : entry.isFile() ? [p] : [];
  });
}
const notes = [];
const dist = path.join(
  root,
  'apps/web',
  process.env.PRODUCT_ACCEPTANCE_DIST_DIR ?? '.next',
);
const buildPresent = existsSync(path.join(dist, 'BUILD_ID'));
const client = buildPresent ? files(path.join(dist, 'static')) : [];
const publicDir = path.join(root, 'apps/web/public');
if (existsSync(publicDir)) client.push(...files(publicDir));
if (valueScan && !buildPresent) {
  console.error(
    `security:scan requires production web build output at ${path.relative(root, dist)} (BUILD_ID missing)`,
  );
  process.exit(2);
}
if (!valueScan && !buildPresent)
  notes.push(
    'web production build absent: client bundle skipped in --category-only mode',
  );
else if (buildPresent && !client.some((p) => p.endsWith('.js'))) {
  const message = 'no browser JavaScript chunks found in build output';
  if (valueScan) {
    console.error(`security:scan: ${message}`);
    process.exit(2);
  }
  notes.push(message);
}
const tracked = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root },
)
  .toString()
  .split('\0')
  .filter(Boolean)
  .map((p) => path.join(root, p))
  .filter((p) => {
    const relative = path.relative(root, p);
    if (relative === 'data/raw' || relative === 'data/processed') {
      try {
        if (lstatSync(p).isSymbolicLink()) return false;
      } catch {
        // Let the scanner read the path and fail closed below.
      }
    }
    return true;
  });
const failures = [];
function scan(group, paths) {
  for (const p of paths) {
    const bytes = readFileSync(p);
    if (valueScan)
      for (const key of keys) {
        const value = env[key];
        if (!value) continue;
        const forms = [
          value,
          encodeURIComponent(value),
          JSON.stringify(value).slice(1, -1),
        ];
        if (forms.some((v) => bytes.includes(Buffer.from(v))))
          failures.push({ group, file: path.relative(root, p), category: key });
      }
    // Category scan: privileged config names or credential-bearing URLs must never reach a client bundle.
    if (
      group === 'CLIENT' &&
      /(?:PASSENGER_SERVICE_TOKEN|CONTROLLED_REVIEW_TOKEN|PASSENGER_SESSION_SECRET|POSTGRES_PASSWORD|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@)/.test(
        bytes.toString(),
      )
    )
      failures.push({
        group,
        file: path.relative(root, p),
        category: 'PRIVILEGED_CONFIG_OR_URL',
      });
  }
}
scan('TRACKED_SOURCE', tracked);
scan('CLIENT', client);
const serverDir = path.join(dist, 'server');
if (existsSync(serverDir)) scan('SERVER_BUILD', files(serverDir));
else if (valueScan) {
  console.error('security:scan requires production web server build output');
  process.exit(2);
} else notes.push('web server build absent: skipped in --category-only mode');
const api = path.join(root, 'apps/api/dist');
if (existsSync(api)) scan('API_BUILD', files(api));
else if (valueScan) {
  console.error('security:scan requires apps/api/dist (run pnpm build first)');
  process.exit(2);
} else
  notes.push('api build absent: server build skipped in --category-only mode');
// Turbopack caches are private local artifacts; recorded but never release inputs.
const caches = ['cache', 'dev/cache']
  .map((p) => path.join(dist, p))
  .filter(existsSync);
const cacheHits = [];
if (valueScan)
  for (const p of caches.flatMap(files)) {
    const bytes = readFileSync(p);
    for (const key of keys.filter((k) => k !== 'POSTGRES_USER'))
      if (env[key] && bytes.includes(Buffer.from(env[key])))
        cacheHits.push({ file: path.relative(root, p), category: key });
  }
console.log(
  JSON.stringify({
    status: failures.length ? 'FAIL' : 'PASS',
    mode: valueScan ? 'EXACT_AND_CATEGORY' : 'CATEGORY_ONLY',
    tracked_files: tracked.length,
    client_files: client.length,
    failures,
    private_cache_matches: cacheHits,
    notes,
    release_policy:
      'SOURCE_ONLY; exclude .env, .next, dist, caches, data and runtime artifacts; caches may contain server configuration and must never be uploaded',
  }),
);
process.exitCode = failures.length ? 1 : 0;
