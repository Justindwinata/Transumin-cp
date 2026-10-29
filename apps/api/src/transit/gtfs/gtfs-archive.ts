import { stat } from 'node:fs/promises';

import yauzl, { type Entry, type ZipFile } from 'yauzl';

import type { GtfsArchive, GtfsArchiveEntry } from './gtfs.types.js';

const MAX_ENTRY_COUNT = 100;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

function openZip(archivePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, zipFile) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (zipFile === undefined) {
          reject(new Error('ZIP reader did not return an archive handle'));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function assertSafeEntry(entry: Entry): void {
  const name = entry.fileName;
  const pathParts = name.split('/');
  if (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    pathParts.includes('..') ||
    pathParts.includes('.') ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(name)}`);
  }
  if (name.endsWith('/')) {
    throw new Error(
      `Directory entries are not allowed in GTFS archives: ${name}`,
    );
  }
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error(`Encrypted ZIP entries are not supported: ${name}`);
  }
}

function readEntry(zipFile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null) {
        reject(error);
        return;
      }
      if (stream === undefined) {
        reject(new Error(`Unable to read ZIP entry: ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

export async function readGtfsArchive(
  archivePath: string,
): Promise<GtfsArchive> {
  const archiveStat = await stat(archivePath);
  const zipFile = await openZip(archivePath);
  const entries = new Map<string, GtfsArchiveEntry>();
  const normalizedNames = new Set<string>();
  let totalUncompressedBytes = 0;
  let entryCount = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.once('error', fail);
    zipFile.once('end', () => {
      if (settled) return;
      settled = true;
      resolve({ entries, archiveBytes: archiveStat.size });
    });
    zipFile.on('entry', (entry: Entry) => {
      void (async () => {
        assertSafeEntry(entry);
        entryCount += 1;
        if (entryCount > MAX_ENTRY_COUNT) {
          throw new Error(`GTFS archive exceeds ${MAX_ENTRY_COUNT} entries`);
        }
        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          throw new Error('GTFS archive exceeds the uncompressed size limit');
        }
        const normalizedName = entry.fileName.normalize('NFC').toLowerCase();
        if (normalizedNames.has(normalizedName)) {
          throw new Error(
            `Duplicate or case-colliding ZIP path: ${entry.fileName}`,
          );
        }
        normalizedNames.add(normalizedName);
        const bytes = await readEntry(zipFile, entry);
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          throw new Error(`GTFS entry is not valid UTF-8: ${entry.fileName}`);
        }
        entries.set(entry.fileName, {
          name: entry.fileName,
          compressedBytes: entry.compressedSize,
          uncompressedBytes: entry.uncompressedSize,
          text,
        });
        zipFile.readEntry();
      })().catch(fail);
    });
    zipFile.readEntry();
  });
}
