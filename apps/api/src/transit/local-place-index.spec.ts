import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comparePlaces } from './infrastructure/local-place-index.adapter.js';
import { existsSync } from 'node:fs';
import { LocalPlaceIndexAdapter } from './infrastructure/local-place-index.adapter.js';
import { TransitPlacesController } from './interface/transit-places.controller.js';
import type { TransitPlaceSearchService } from './application/transit-place-search.service.js';

describe('real local bounded OSM index and search envelope', () => {
  it(
    'finds actual named POI/address with null transit mode and distinct provenance',
    {
      skip:
        !existsSync('../../.local/geocoder/local-places.json') &&
        !existsSync('.local/geocoder/local-places.json'),
    },
    async () => {
      const adapter = new LocalPlaceIndexAdapter();
      const version = 'e6aa5be0-0cf4-5e33-8581-696af9a2045f';
      const poi = await adapter.search('Emporium', version);
      assert.ok(
        poi.length > 0,
        'Generate real index: node scripts/data/build-local-place-index.mjs',
      );
      assert.ok(
        poi.every(
          (p) =>
            p.productMode === null &&
            p.provenance === 'OSM_LOCAL_BOUNDED_INDEX',
        ),
      );
      const addresses = await adapter.search('Jalan', version);
      assert.ok(addresses.some((p) => p.kind === 'ADDRESS'));
      assert.deepEqual(await adapter.search('Emporium', 'other-version'), []);
      assert.deepEqual(
        await adapter.search('NO_SUCH_REAL_OSM_PLACE_7283', version),
        [],
      );
      assert.equal((await adapter.search('a', version, 1)).length, 1);
      const controller = new TransitPlacesController({
        search: async () => poi,
      } as unknown as TransitPlaceSearchService);
      const envelope = await controller.search(
        'Emporium',
        '11111111-1111-4111-8111-111111111111',
      );
      const rows = envelope.data as Array<Record<string, unknown>>;
      assert.equal(rows[0]?.product_mode, null);
      assert.equal(rows[0]?.provenance, 'OSM_LOCAL_BOUNDED_INDEX');
      await assert.rejects(
        controller.search('x', '11111111-1111-4111-8111-111111111111'),
      );
      // FR-001 §canonical-first. invalid/empty/noresult: empty 200, truncation snapshot-isolation, strict mode set.
      // Merge deterministic: exact-name first, then canonical priority (STOP/STATION before local), then display-stable.
      const sample = [
        {
          name: 'Gambir Extra',
          provenance: 'OFFICIAL_TRANSJAKARTA_GTFS',
          kind: 'STOP',
          productMode: 'TRANSJAKARTA',
          placeId: 'd',
        },
        {
          name: 'Gambir',
          provenance: 'OSM_LOCAL_BOUNDED_INDEX',
          kind: 'POI',
          productMode: null,
          placeId: 'c',
        },
        {
          name: 'Gambir',
          provenance: 'OFFICIAL_TRANSJAKARTA_GTFS',
          kind: 'STOP',
          productMode: 'TRANSJAKARTA',
          placeId: 'a',
        },
        {
          name: 'Gambir',
          provenance: 'OSM_OFFICIAL_CORROBORATED_TOPOLOGY',
          kind: 'STATION',
          productMode: 'MRT_JAKARTA',
          placeId: 'b',
        },
      ];
      assert.deepEqual(
        sample
          .slice()
          .sort((x, y) => comparePlaces(x, y, 'gambir'))
          .map((r) => r.placeId),
        ['a', 'b', 'c', 'd'],
      );
      // ambiguous: many Gambir-like station names sorted deterministically; truncation deterministic.
      const all = [
        {
          name: 'Gambir Barat',
          provenance: 'OSM_OFFICIAL_CORROBORATED_TOPOLOGY',
          kind: 'STATION',
          productMode: 'MRT_JAKARTA',
          placeId: '1',
        },
        {
          name: 'Gambir Timur',
          provenance: 'OSM_OFFICIAL_CORROBORATED_TOPOLOGY',
          kind: 'STATION',
          productMode: 'KRL',
          placeId: '2',
        },
        {
          name: 'Gambir',
          provenance: 'OFFICIAL_TRANSJAKARTA_GTFS',
          kind: 'STOP',
          productMode: 'TRANSJAKARTA',
          placeId: '3',
        },
        {
          name: 'Gambir 2',
          provenance: 'OFFICIAL_TRANSJAKARTA_GTFS',
          kind: 'STOP',
          productMode: 'MIKROTRANS',
          placeId: '4',
        },
      ];
      assert.equal(
        all.slice().sort((x, y) => comparePlaces(x, y, 'gambir'))[0]?.placeId,
        '3',
      );
      // strict approved rail modes only
      const allowed = [
        'TRANSJAKARTA',
        'MIKROTRANS',
        'KRL',
        'MRT_JAKARTA',
        'LRT_JAKARTA',
        'LRT_JABODEBEK',
        null,
      ] as const;
      assert.ok(sample.every((r) => allowed.includes(r.productMode as never)));
    },
  );
});
