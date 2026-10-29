import { stat } from 'node:fs/promises';
import path from 'node:path';

// Full verification stays the default. CI may validate manifest metadata only;
// that explicit mode never claims private, unshipped artifacts were verified.
export async function verifyManifestArtifacts(
  artifacts,
  { root, metadataOnly = false },
) {
  for (const artifact of artifacts) {
    const artifactPath = artifact.path ?? artifact.opl_path;
    const expectedBytes = artifact.bytes ?? artifact.opl_bytes;
    if (
      typeof artifactPath !== 'string' ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 0
    )
      throw new Error('Phase 2A manifest artifact is incomplete');
    const absolute = path.resolve(root, artifactPath);
    const relative = path.relative(root, absolute);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error('Manifest artifact path must stay inside the repository');
    if (!metadataOnly) {
      const metadata = await stat(absolute);
      if (metadata.size !== expectedBytes)
        throw new Error(
          `Phase 2A artifact byte size mismatch: ${artifactPath}`,
        );
    }
  }
  return metadataOnly
    ? 'NOT VERIFIED (explicit metadata-only mode)'
    : 'VERIFIED (byte sizes; not checksum verification)';
}
