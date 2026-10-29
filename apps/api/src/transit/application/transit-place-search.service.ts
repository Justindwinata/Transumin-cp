import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import {
  comparePlaces,
  LocalPlaceIndexAdapter,
} from '../infrastructure/local-place-index.adapter.js';

export type TransitPlace = Readonly<{
  placeId: string;
  externalId: string;
  name: string;
  kind: 'STOP' | 'STATION' | 'ADDRESS' | 'POI';
  productMode:
    | 'TRANSJAKARTA'
    | 'MIKROTRANS'
    | 'KRL'
    | 'MRT_JAKARTA'
    | 'LRT_JAKARTA'
    | 'LRT_JABODEBEK'
    | null;
  latitude: number;
  longitude: number;
  datasetVersionId: string;
  provenance:
    | 'OFFICIAL_TRANSJAKARTA_GTFS'
    | 'OSM_OFFICIAL_CORROBORATED_TOPOLOGY'
    | 'OSM_LOCAL_BOUNDED_INDEX';
}>;

@Injectable()
export class TransitPlaceSearchService {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
    @Inject(LocalPlaceIndexAdapter)
    private readonly localPlaces: LocalPlaceIndexAdapter,
  ) {}

  async search(
    query: string,
    snapshotId: string,
    limit = 20,
  ): Promise<readonly TransitPlace[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new RangeError('PLACE_SEARCH_LIMIT_OUT_OF_RANGE');
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || normalizedQuery.length > 80)
      throw new RangeError('PLACE_SEARCH_QUERY_OUT_OF_RANGE');
    const needle = normalizedQuery.toLowerCase();
    const result = await sql<TransitPlace>`
      with snapshot as (
        select transit_dataset_version_id, spatial_dataset_version_id
        from twin.network_snapshot where id=${snapshotId}::uuid and status='FINALIZED'
      ), stop_matches as (
        select s.id, s.external_id, s.name, s.geom, s.dataset_version_id
        from transit.stop s, snapshot v
        where s.dataset_version_id=v.transit_dataset_version_id
          and position(${needle} in lower(s.name)) > 0
        order by (lower(s.name)=${needle}) desc,
          starts_with(lower(s.name), ${needle}) desc, s.name, s.id
        limit 35
      ), places as (
        select s.id as place_id, s.external_id, s.name, 'STOP'::text as kind,
          modes.product_mode, ST_Y(s.geom) as latitude,
          ST_X(s.geom) as longitude, s.dataset_version_id,
          'OFFICIAL_TRANSJAKARTA_GTFS'::text as provenance
        from stop_matches s
        cross join lateral (
          select distinct case when r.description='Mikrotrans'
            then 'MIKROTRANS' else 'TRANSJAKARTA' end as product_mode
          from transit.stop_time st
          join transit.trip t on t.id=st.trip_id
          join transit.route r on r.id=t.route_id
          where st.stop_id=s.id
        ) modes
        union all
        select s.id, s.external_id, s.name, 'STATION',
          'TRANSJAKARTA', ST_Y(s.geom), ST_X(s.geom),
          s.dataset_version_id, 'OFFICIAL_TRANSJAKARTA_GTFS'
        from transit.station s, snapshot v
        where s.dataset_version_id=v.transit_dataset_version_id
          and position(${needle} in lower(s.name)) > 0
        union all
        select s.id, s.external_id, s.name, 'STATION', upper(s.operator_key),
          ST_Y(s.geom), ST_X(s.geom), s.dataset_version_id,
          'OSM_OFFICIAL_CORROBORATED_TOPOLOGY'
        from spatial.rail_topology_station s, snapshot v
        where s.dataset_version_id=v.spatial_dataset_version_id
          and upper(s.operator_key) in ('KRL', 'MRT_JAKARTA', 'LRT_JAKARTA', 'LRT_JABODEBEK')
          and position(${needle} in lower(s.name)) > 0
      )
      select place_id as "placeId", external_id as "externalId", name,
        kind, product_mode as "productMode", latitude, longitude,
        dataset_version_id as "datasetVersionId", provenance
      from places
      order by (lower(name)=${needle}) desc,
        starts_with(lower(name), ${needle}) desc,
        name, product_mode, kind, place_id
      limit ${limit}
    `.execute(this.database);
    const snapshot = await sql<{ datasetVersionId: string }>`
      select spatial_dataset_version_id as "datasetVersionId"
      from twin.network_snapshot where id=${snapshotId}::uuid and status='FINALIZED'
    `.execute(this.database);
    const version = snapshot.rows[0]?.datasetVersionId;
    const local = version
      ? await this.localPlaces.search(normalizedQuery, version, limit)
      : [];
    return [...result.rows, ...local]
      .sort((left, right) => comparePlaces(left, right, needle))
      .slice(0, limit);
  }
}
