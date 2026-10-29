import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'csv-parse/sync';
import { sql, type Kysely } from 'kysely';

import type { FoundationDatabase } from '../../infrastructure/database/database.constants.js';
import {
  normalizeAlias,
  stableUuid,
} from '../../spatial/domain/spatial-identity.js';
import { readGtfsArchive } from '../../transit/gtfs/gtfs-archive.js';

const repositoryRoot = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);
export const controlledRoutingDatasetVersionId = stableUuid(
  'phase4b-routing-dataset-version',
  'phase4b-a-router-input-20261002-v2',
);
const controlledRoutingSourceId = stableUuid(
  'phase4b-routing-dataset-source',
  'phase4b-controlled-research-router-input',
);
const spatialDatasetVersionId = 'e6aa5be0-0cf4-5e33-8581-696af9a2045f';
const routingSnapshotId = 'phase4b-a-router-input-20261002-v2';
const routingManifestSha256 =
  '1f493716d20ad5ffa2e3628ece67f2511235f2abfacef4cd7b2b2af9f73dfb77';
const sourceKey = 'phase4b-a-controlled-router-input';
const feeds = [
  ['krl', 'KRL', 'KRL'],
  ['mrt', 'MRT_JAKARTA', 'MRT Jakarta'],
  ['lrtj', 'LRT_JAKARTA', 'LRT Jakarta'],
  ['lrtjb', 'LRT_JABODEBEK', 'LRT Jabodebek'],
] as const;

type StopRow = Readonly<{
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  tnx_source_reference?: string;
}>;
type RouteRow = Readonly<{
  route_id: string;
  route_short_name?: string;
  route_long_name?: string;
}>;

export type RoutingIdentityPreparationResult = Readonly<{
  datasetVersionId: string;
  stationReferences: number;
  routeReferences: number;
  createdMobilityEntities: number;
  canonicalStations: number;
  canonicalRoutes: number;
}>;

export async function prepareRoutingIdentities(
  database: Kysely<FoundationDatabase>,
): Promise<RoutingIdentityPreparationResult> {
  let stationReferences = 0;
  let routeReferences = 0;
  let createdMobilityEntities = 0;
  let canonicalStations = 0;
  let canonicalRoutes = 0;
  await database.transaction().execute(async (transaction) => {
    await registerControlledDataset(transaction);
    for (const [feed, operatorKey, operatorName] of feeds) {
      const operatorId = stableUuid(
        'phase4b-routing-operator',
        `${routingSnapshotId}:${operatorKey}`,
      );
      await sql`
        insert into transit.operator
          (id, dataset_version_id, external_id, code, name, mode_group)
        values (
          ${operatorId}::uuid, ${controlledRoutingDatasetVersionId}::uuid,
          ${operatorKey}, ${operatorKey}, ${operatorName}, 'RAIL'
        )
        on conflict (id) do nothing
      `.execute(transaction);

      const archive = await readGtfsArchive(
        path.join(
          repositoryRoot,
          `data/processed/routing/phase4b-a/input/${feed}.gtfs.zip`,
        ),
      );
      const stopsEntry = archive.entries.get('stops.txt');
      const routesEntry = archive.entries.get('routes.txt');
      if (stopsEntry === undefined || routesEntry === undefined)
        throw new Error(`${feed}: stops.txt or routes.txt missing`);
      const stops = parse(stopsEntry.text, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
      }) as StopRow[];
      const routes = parse(routesEntry.text, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
      }) as RouteRow[];

      for (const stop of stops) {
        const entityId = await canonicalStationMobilityId(
          transaction,
          operatorKey,
          stop,
        );
        const entityInsert = await insertMobilityEntity(
          transaction,
          entityId,
          'STATION',
        );
        createdMobilityEntities += entityInsert;
        const stationId = stableUuid(
          'phase4b-routing-canonical-station',
          `${routingSnapshotId}:${entityId}`,
        );
        const stationInsert = await sql`
          insert into transit.station
            (id, mobility_entity_id, dataset_version_id, external_id, name,
             station_type, geom)
          values (
            ${stationId}::uuid, ${entityId}::uuid,
            ${controlledRoutingDatasetVersionId}::uuid, ${stop.stop_id},
            ${stop.stop_name}, 'CONTROLLED_ROUTING_STATION',
            ST_SetSRID(ST_MakePoint(
              ${Number(stop.stop_lon)}, ${Number(stop.stop_lat)}
            ), 4326)
          )
          on conflict (id) do nothing
        `.execute(transaction);
        canonicalStations += Number(stationInsert.numAffectedRows ?? 0);
        stationReferences += await insertReference(
          transaction,
          operatorKey,
          stop.stop_id,
          'STATION',
          entityId,
        );
      }

      for (const route of routes) {
        const entityId = stableUuid(
          'phase4b-routing-route-mobility',
          `${routingSnapshotId}:${route.route_id}`,
        );
        createdMobilityEntities += await insertMobilityEntity(
          transaction,
          entityId,
          'ROUTE',
        );
        const routeId = stableUuid(
          'phase4b-routing-canonical-route',
          `${routingSnapshotId}:${route.route_id}`,
        );
        const shortName = route.route_short_name?.trim() || null;
        const longName = route.route_long_name?.trim() || null;
        const routeInsert = await sql`
          insert into transit.route
            (id, mobility_entity_id, dataset_version_id, operator_id,
             external_id, short_name, long_name, mode)
          values (
            ${routeId}::uuid, ${entityId}::uuid,
            ${controlledRoutingDatasetVersionId}::uuid, ${operatorId}::uuid,
            ${route.route_id}, ${shortName}, ${longName}, ${operatorKey}
          )
          on conflict (id) do nothing
        `.execute(transaction);
        canonicalRoutes += Number(routeInsert.numAffectedRows ?? 0);
        routeReferences += await insertReference(
          transaction,
          operatorKey,
          route.route_id,
          'ROUTE',
          entityId,
        );
      }
    }
  });
  return {
    datasetVersionId: controlledRoutingDatasetVersionId,
    stationReferences,
    routeReferences,
    createdMobilityEntities,
    canonicalStations,
    canonicalRoutes,
  };
}

async function registerControlledDataset(
  database: Kysely<FoundationDatabase>,
): Promise<void> {
  await sql`
    insert into meta.dataset_source
      (id, source_key, name, provider, source_type, canonical_url,
       license_name, access_method, access_notes, coverage_notes,
       redistribution_rule, verification_status)
    values (
      ${controlledRoutingSourceId}::uuid, ${sourceKey},
      'Phase 4 controlled research routing representation',
      'TRANSUM-IN NEXUS research pipeline', 'CONTROLLED_DERIVED_ROUTING_INPUT',
      null, 'SOURCE_SPECIFIC_RESTRICTED_RESEARCH_RIGHTS',
      'LOCAL_DETERMINISTIC_DERIVATION',
      'Not official operator GTFS; raw and derived restricted artifacts remain local.',
      'KRL, MRT Jakarta, LRT Jakarta, and LRT Jabodebek routing identities.',
      'NO_REDISTRIBUTION_WITHOUT_OPERATOR_PERMISSION', 'VERIFIED'
    )
    on conflict (id) do nothing
  `.execute(database);
  await sql`
    insert into meta.dataset_version
      (id, source_id, version_label, checksum_sha256, retrieved_at,
       effective_from, raw_path_ref, manifest_path, validation_status,
       metadata_json)
    values (
      ${controlledRoutingDatasetVersionId}::uuid,
      ${controlledRoutingSourceId}::uuid, ${routingSnapshotId},
      ${routingManifestSha256}, '2026-10-02T15:56:56Z'::timestamptz,
      '2026-10-02T00:00:00+07:00'::timestamptz,
      'data/processed/routing/phase4b-a/input (Git-ignored)',
      'data/manifests/PHASE-4B-A-ROUTER-INPUT.json', 'VALID',
      ${JSON.stringify({
        evidence_type: 'SCHEDULED',
        rights: 'SOURCE_SPECIFIC_LOCAL_CONTROLLED_RESEARCH',
        redistribution: 'PROHIBITED_WITHOUT_PERMISSION',
        canonical_identity_scope: ['STATION', 'ROUTE'],
      })}::jsonb
    )
    on conflict (id) do nothing
  `.execute(database);
}

async function canonicalStationMobilityId(
  database: Kysely<FoundationDatabase>,
  operatorKey: string,
  stop: StopRow,
): Promise<string> {
  const sourceMatches = stop.tnx_source_reference
    ? await sql<{ entityId: string }>`
        select mobility_entity_id as "entityId"
        from spatial.rail_topology_station
        where dataset_version_id=${spatialDatasetVersionId}::uuid
          and operator_key=${operatorKey}
          and ('osm:' || external_id)=${stop.tnx_source_reference}
        order by mobility_entity_id
      `.execute(database)
    : { rows: [] };
  const aliasMatches = await sql<{ entityId: string }>`
    select distinct canonical_entity_id as "entityId"
    from meta.entity_alias
    where source_dataset_version_id=${spatialDatasetVersionId}::uuid
      and operator_key=${operatorKey}
      and normalized_alias=${normalizeAlias(stop.stop_name)}
    order by canonical_entity_id
  `.execute(database);
  const matches =
    sourceMatches.rows.length > 0 ? sourceMatches.rows : aliasMatches.rows;
  if (matches.length > 1)
    throw new Error(`${stop.stop_id}: ambiguous canonical station identity`);
  return (
    matches[0]?.entityId ??
    stableUuid(
      'phase4b-routing-station-mobility',
      `${routingSnapshotId}:${stop.stop_id}`,
    )
  );
}

async function insertMobilityEntity(
  database: Kysely<FoundationDatabase>,
  entityId: string,
  entityType: 'STATION' | 'ROUTE',
): Promise<number> {
  const inserted = await sql`
    insert into twin.mobility_entity
      (id, entity_type, creation_dataset_version_id)
    values (
      ${entityId}::uuid, ${entityType},
      ${controlledRoutingDatasetVersionId}::uuid
    )
    on conflict (id) do nothing
  `.execute(database);
  return Number(inserted.numAffectedRows ?? 0);
}

async function insertReference(
  database: Kysely<FoundationDatabase>,
  operatorKey: string,
  sourceEntityId: string,
  entityType: 'STATION' | 'ROUTE',
  entityId: string,
): Promise<number> {
  const inserted = await sql`
    insert into meta.source_entity_reference
      (id, source_key, operator_key, source_dataset_version_id,
       external_reference, reference_type, canonical_entity_id,
       provenance_ref)
    values (
      ${stableUuid('phase4b-routing-reference', `${routingSnapshotId}:${entityType}:${sourceEntityId}`)}::uuid,
      ${sourceKey}, ${operatorKey},
      ${controlledRoutingDatasetVersionId}::uuid, ${sourceEntityId},
      'OPERATOR_REFERENCE', ${entityId}::uuid,
      ${`data/manifests/PHASE-4B-A-ROUTER-INPUT.json#canonical-${entityType.toLowerCase()}`}
    )
    on conflict do nothing
  `.execute(database);
  return Number(inserted.numAffectedRows ?? 0);
}
