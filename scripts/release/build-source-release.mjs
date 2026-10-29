import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

// R6-F source release: tracked files only, allowlist-verified, checksummed.
// Source-only package: no .env, databases, OTP graph, caches, or runtime state.
const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const outputDir = resolve(
  process.argv[2] ??
    process.env.SOURCE_RELEASE_DIR ??
    '.release-evidence/source-release',
);
const forbidden = [
  /(^|\/)\.env(?!\.example$)($|\.)/,
  /(^|\/)node_modules\//,
  /(^|\/)\.next/,
  /(^|\/)dist\//,
  /(^|\/)data\/(raw|processed)\//,
  /(^|\/)\.release-evidence\//,
  /(^|\/)\.transum-r0a-persistent\//,
];
let localEnv = '';
try {
  localEnv = readFileSync('.env', 'utf8');
} catch {
  localEnv = '';
}
const secrets = localEnv
  .split('\n')
  .filter((line) =>
    /^(CONTROLLED_REVIEW_TOKEN|PASSENGER_SESSION_SECRET|PASSENGER_SERVICE_TOKEN|POSTGRES_PASSWORD)=/.test(
      line,
    ),
  )
  .map((line) => line.slice(line.indexOf('=') + 1).trim())
  .filter((value) => value.length >= 16);

const tracked = execFileSync(
  'git',
  ['ls-tree', '-r', '--name-only', '-z', sha],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .sort();
assert.equal(
  secrets.length,
  4,
  'four local release-scan credentials required; values never printed',
);
mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const zip = join(outputDir, `transum-in-nexus-source-${sha.slice(0, 12)}.zip`);
execFileSync('git', [
  'archive',
  '--format=zip',
  `--prefix=transum-in-nexus-${sha.slice(0, 12)}/`,
  '-o',
  zip,
  sha,
]);
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((entry) => entry.replace(/^transum-in-nexus-[0-9a-f]+\//, ''))
  .filter(Boolean);
const directories = new Set(entries.filter((entry) => entry.endsWith('/')));
const files = entries.filter((entry) => !entry.endsWith('/'));
assert.equal(
  files.length,
  tracked.length,
  'archive file count matches tracked files',
);
assert.deepEqual(
  [...files].sort(),
  tracked,
  'archive contents match the tracked allowlist',
);
for (const entry of entries)
  assert.ok(
    !forbidden.some((re) => re.test(entry)),
    `forbidden path in archive: ${entry}`,
  );
const scanned = [];
for (const entry of files) {
  const body = execFileSync(
    'unzip',
    [
      '-p',
      zip,
      `transum-in-nexus-${sha.slice(0, 12)}/${entry.replaceAll('[', '[[]')}`,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  scanned.push(body);
  if (entry === '.env.example') {
    for (const name of [
      'CONTROLLED_REVIEW_TOKEN',
      'PASSENGER_SESSION_SECRET',
      'PASSENGER_SERVICE_TOKEN',
      'POSTGRES_PASSWORD',
    ])
      assert.match(
        body,
        new RegExp(`^${name}=\\s*$`, 'm'),
        `${name} template must stay empty`,
      );
  } else {
    const findings = [
      ...secrets.filter((secret) => body.includes(secret)),
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(body) ? 'private key' : null,
    ].filter(Boolean);
    assert.ok(
      !findings.length,
      `secret-like content in ${entry}: ${findings.length} exact matches`,
    );
  }
}
const body = Buffer.concat(scanned.map((text) => Buffer.from(text)));
chmodSync(zip, 0o600);
const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(`${zip}.sha256`, `${digest}  ${zip.split('/').pop()}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      sha,
      zip,
      bytes: statSync(zip).size,
      files: files.length,
      directories: directories.size,
      sha256: digest,
      scan_bytes: body.length,
      verification: 'PASS',
    },
    null,
    2,
  ),
);
