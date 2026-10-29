import assert from 'node:assert/strict';
import { it } from 'node:test';
import { sql } from 'kysely';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';
import { LocalPlaceIndexAdapter } from './infrastructure/local-place-index.adapter.js';
import { TransitPlaceSearchService } from './application/transit-place-search.service.js';

it(
  'read-only real snapshot keeps stations and adds bounded local OSM places',
  {
    skip:
      process.env.RUN_LOCAL_PLACE_READONLY !== '1' ||
      process.env.RUN_ISOLATED_PLACE_DB !== '1',
  },
  async () => {
    const database = createDatabase();
    try {
      await assertInvocationScratchDatabase(database);
      // No product writes, ingestion or routing calls.
      const snapshots = await sql<{
        id: string;
      }>`select id from twin.network_snapshot where status='FINALIZED' and spatial_dataset_version_id='e6aa5be0-0cf4-5e33-8581-696af9a2045f'::uuid order by finalized_at desc limit 1`.execute(
        database,
      );
      const id = snapshots.rows[0]?.id;
      assert.ok(id, 'Matching accepted snapshot required');
      const service = new TransitPlaceSearchService(
        database,
        new LocalPlaceIndexAdapter(),
      );
      const poi = await service.search('Emporium', id);
      assert.ok(poi.some((p) => p.kind === 'POI' && p.productMode === null));
      const address = await service.search('Jalan', id);
      assert.ok(address.some((p) => p.kind === 'ADDRESS'));
      const station = await service.search('Gambir', id);
      assert.ok(
        station.some(
          (p) => ['STOP', 'STATION'].includes(p.kind) && p.productMode !== null,
        ),
      );
      // Invalid/no-result density: empty 200 indistinguishable from no match; invalid400 exclusive.
      assert.deepEqual(
        await service.search(
          'Emporium',
          '00000000-0000-4000-8000-000000000000',
        ),
        [],
      );
      const nonsense = await service.search('NO_SUCH_REAL_OSM_PLACE_7283', id);
      assert.deepEqual(nonsense, []);
      await assert.rejects(service.search('x', id), (err: unknown) => {
        const code = (err as { message?: string })?.message ?? '';
        return (
          code === 'PLACE_SEARCH_QUERY_OUT_OF_RANGE' ||
          (err as RangeError).name === 'RangeError'
        );
      });
      const all = await service.search('Gambir', id);
      assert.ok(all.length > 1);
      assert.ok(all.some((p) => p.provenance === 'OFFICIAL_TRANSJAKARTA_GTFS'));
      if (all.length >= 2)
        assert.ok(
          all[0]?.name === 'Gambir' ||
            all[0]?.name.toLowerCase().startsWith('gambir'),
        );
      const truncated = await service.search('Gambir', id, 2);
      assert.equal(truncated.length, 2);
      assert.deepEqual(
        truncated.map((x) => x.placeId),
        all.slice(0, 2).map((x) => x.placeId),
      );
      const snapshotIsolation = await service.search(
        'Gambir',
        '11111111-1111-4111-8111-111111111111',
      );
      assert.deepEqual(snapshotIsolation, []);
      console.log(
        JSON.stringify({
          snapshot_id: id,
          poi: poi.length,
          address: address.length,
          canonical: station.length,
          writes: 0,
        }),
      );
    } finally {
      await database.destroy();
    }
  },
);
