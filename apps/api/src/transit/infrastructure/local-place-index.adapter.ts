import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { TransitPlace } from '../application/transit-place-search.service.js';
import { stableUuid } from '../../spatial/domain/spatial-identity.js';

type LocalEntry = {
  externalId: string;
  name: string;
  kind: 'ADDRESS' | 'POI';
  latitude: number;
  longitude: number;
};
export const LOCAL_PLACE_WARNING =
  'Local OSM address/POI index may be unavailable; coverage is sparse, historical and unverified. Empty local results do not prove absence; use map pin. © OpenStreetMap contributors https://www.openstreetmap.org/copyright';

const SOURCE_ORDER: Record<string, number> = {
  OFFICIAL_TRANSJAKARTA_GTFS: 0,
  OSM_OFFICIAL_CORROBORATED_TOPOLOGY: 1,
  OSM_LOCAL_BOUNDED_INDEX: 2,
};

function kindOrder(value: string): number {
  return value === 'STATION' || value === 'STOP'
    ? 0
    : value === 'ADDRESS'
      ? 1
      : 2;
}

function productOrder(value: string | null): string {
  return value === null ? '\uFFFF' : value;
}

export function comparePlaces(
  left: {
    name: string;
    provenance: string;
    kind: string;
    productMode: string | null;
    placeId: string;
  },
  right: {
    name: string;
    provenance: string;
    kind: string;
    productMode: string | null;
    placeId: string;
  },
  needle: string,
): number {
  return (
    Number(right.name.toLowerCase() === needle) -
      Number(left.name.toLowerCase() === needle) ||
    Number(right.name.toLowerCase().startsWith(needle)) -
      Number(left.name.toLowerCase().startsWith(needle)) ||
    (SOURCE_ORDER[left.provenance] ?? 99) -
      (SOURCE_ORDER[right.provenance] ?? 99) ||
    kindOrder(left.kind) - kindOrder(right.kind) ||
    productOrder(left.productMode).localeCompare(
      productOrder(right.productMode),
    ) ||
    left.name.localeCompare(right.name) ||
    left.placeId.localeCompare(right.placeId)
  );
}

@Injectable()
export class LocalPlaceIndexAdapter {
  private loaded?: Promise<{
    datasetVersionId: string;
    entries: LocalEntry[];
  } | null>;

  async search(
    query: string,
    datasetVersionId: string,
    limit = 20,
  ): Promise<readonly TransitPlace[]> {
    this.loaded ??= this.load();
    const index = await this.loaded;
    if (!index || index.datasetVersionId !== datasetVersionId) return [];
    const q = query.toLowerCase();
    return index.entries
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase() === q) -
            Number(a.name.toLowerCase() === q) ||
          Number(b.name.toLowerCase().startsWith(q)) -
            Number(a.name.toLowerCase().startsWith(q)) ||
          a.name.localeCompare(b.name) ||
          a.externalId.localeCompare(b.externalId),
      )
      .slice(0, limit)
      .map((p) => ({
        ...p,
        placeId: stableUuid(
          'local-osm-place',
          `${datasetVersionId}:${p.externalId}`,
        ),
        productMode: null,
        datasetVersionId,
        provenance: 'OSM_LOCAL_BOUNDED_INDEX',
      }));
  }

  private async load(): Promise<{
    datasetVersionId: string;
    entries: LocalEntry[];
  } | null> {
    try {
      let root = process.cwd();
      while (true) {
        try {
          await readFile(resolve(root, 'pnpm-workspace.yaml'));
          break;
        } catch {
          const parent = dirname(root);
          if (parent === root) return null;
          root = parent;
        }
      }
      const manifest = JSON.parse(
        await readFile(
          resolve(root, 'data/manifests/LOCAL-PLACE-INDEX.json'),
          'utf8',
        ),
      ) as {
        index_sha256: string;
        dataset_version_id: string;
        envelope: { west: number; east: number; south: number; north: number };
      };
      const indexPath = resolve(root, '.local/geocoder/local-places.json');
      if ((await stat(indexPath)).size > 8 * 1024 * 1024) return null;
      const bytes = await readFile(indexPath);
      if (
        createHash('sha256').update(bytes).digest('hex') !==
        manifest.index_sha256
      )
        return null;
      const index = JSON.parse(bytes.toString('utf8')) as {
        version: number;
        datasetVersionId: string;
        entries: LocalEntry[];
      };
      const e = manifest.envelope;
      if (
        index.version !== 1 ||
        index.datasetVersionId !== manifest.dataset_version_id ||
        !Array.isArray(index.entries) ||
        index.entries.length > 10000 ||
        index.entries.some(
          (p) =>
            !p ||
            !/^osm:n\d+$/.test(p.externalId) ||
            typeof p.name !== 'string' ||
            !p.name ||
            p.name.length > 500 ||
            /[\p{Cc}\p{Cf}]/u.test(p.name) ||
            !['ADDRESS', 'POI'].includes(p.kind) ||
            !Number.isFinite(p.latitude) ||
            !Number.isFinite(p.longitude) ||
            p.longitude < e.west ||
            p.longitude > e.east ||
            p.latitude < e.south ||
            p.latitude > e.north,
        )
      )
        return null;
      return index;
    } catch {
      // Missing/corrupt index never removes existing canonical stop/station search.
      return null;
    }
  }
}
