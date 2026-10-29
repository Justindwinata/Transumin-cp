import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// MapLibre v6 workers import a sibling shared module. Both must stay together;
// a bundler-emitted entry alone can leave GeoJSON sources pending forever.
export function prepareMapWorkerAssets() {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve('maplibre-gl/package.json'));
  const { version } = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8'),
  );
  const output = fileURLToPath(
    new URL('../public/vendor/maplibre/', import.meta.url),
  );
  mkdirSync(output, { recursive: true });
  const manifest = { package: 'maplibre-gl', version, files: [] };
  for (const name of [
    'maplibre-gl-worker.mjs',
    'maplibre-gl-shared.mjs',
    'LICENSE.txt',
  ]) {
    const input = join(
      packageRoot,
      name === 'LICENSE.txt' ? name : `dist/${name}`,
    );
    const bytes = readFileSync(input);
    const target = join(output, name);
    let same = false;
    try {
      same = readFileSync(target).equals(bytes);
    } catch {
      /* first build */
    }
    if (!same) writeFileSync(target, bytes);
    manifest.files.push({
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  writeFileSync(
    join(output, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
