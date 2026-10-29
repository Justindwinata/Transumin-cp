import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyManifestArtifacts } from './verify-manifest-artifacts.mjs';

test('FR-012: absent and corrupt artifacts fail full verification; metadata-only makes no availability claim', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tnx-artifact-SAMPLE-'));
  try {
    const artifacts = [{ path: 'sample.bin', bytes: 3 }];
    await assert.rejects(verifyManifestArtifacts(artifacts, { root }), {
      code: 'ENOENT',
    });
    assert.match(
      await verifyManifestArtifacts(artifacts, { root, metadataOnly: true }),
      /^NOT VERIFIED/,
    );
    await writeFile(path.join(root, 'sample.bin'), 'xx');
    await assert.rejects(
      verifyManifestArtifacts(artifacts, { root }),
      /byte size mismatch/,
    );
    await writeFile(path.join(root, 'sample.bin'), 'xxx');
    assert.match(
      await verifyManifestArtifacts(artifacts, { root }),
      /^VERIFIED/,
    );
    for (const artifact of [
      { path: '../escape', bytes: 3 },
      { path: 'sample.bin', bytes: -1 },
      { path: 'sample.bin', bytes: 1.5 },
    ])
      await assert.rejects(
        verifyManifestArtifacts([artifact], { root, metadataOnly: true }),
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
