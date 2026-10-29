import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

const sourceUrl = new URL('../../docs/api/openapi-v1.yaml', import.meta.url);
const outputUrl = new URL(
  '../../packages/shared-types/src/generated/openapi.ts',
  import.meta.url,
);
const header = `// DO NOT EDIT MANUALLY. Generated from docs/api/openapi-v1.yaml.\n`;

const ast = await openapiTS(sourceUrl);
const expected = `${header}${astToString(ast)}`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputUrl, 'utf8').catch(() => '');

  if (current !== expected) {
    console.error(
      `Generated OpenAPI types are stale: ${fileURLToPath(outputUrl)}`,
    );
    process.exitCode = 1;
  } else {
    console.log('Generated OpenAPI types match the canonical contract.');
  }
} else {
  await writeFile(outputUrl, expected, 'utf8');
  console.log(`Generated ${fileURLToPath(outputUrl)}`);
}
