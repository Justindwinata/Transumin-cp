import { sql, type Kysely } from 'kysely';

/**
 * FR-003 / FR-004 / FR-012 Phase 2A spatial foundation.
 *
 * The migration keeps OSM topology version-scoped, gives walking/rail edges
 * state-bearing identity, records explicit endpoint resolution, and scopes all
 * operational references and aliases to their source/operator context.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table twin.mobility_entity
      drop constraint mobility_entity_type_check,
      add constraint mobility_entity_type_check check (
        entity_type in (
          'STOP', 'STATION', 'ROUTE', 'TRANSIT_SEGMENT', 'TRANSFER',
          'ROAD_SEGMENT', 'WALKING_EDGE', 'RAIL_TOPOLOGY_EDGE'
        )
      )
  `.execute(database);

  await sql`
    create table spatial.network_node (
      id uuid primary key,
      dataset_version_id uuid not null,
      external_id text not null,
      node_kind text not null,
      geom geometry(Point, 4326) not null,
      source_tags jsonb not null default '{}'::jsonb,
      constraint network_node_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint network_node_id_version_unique unique (id, dataset_version_id),
      constraint network_node_external_version_unique unique (dataset_version_id, external_id),
      constraint network_node_external_not_blank check (btrim(external_id) <> ''),
      constraint network_node_kind_check check (
        node_kind in ('PEDESTRIAN', 'CROSSING', 'ENTRANCE', 'TRANSIT_ACCESS')
      ),
      constraint network_node_tags_object check (jsonb_typeof(source_tags) = 'object'),
      constraint network_node_geom_valid check (
        not ST_IsEmpty(geom) and ST_IsValid(geom) and ST_SRID(geom) = 4326
      )
    )
  `.execute(database);
  await sql`
    create index network_node_geom_gist
      on spatial.network_node using gist (geom)
  `.execute(database);

  await sql`
    create table spatial.walking_edge (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      from_node_id uuid not null,
      to_node_id uuid not null,
      source_way_id text not null,
      segment_sequence integer not null,
      direction text not null,
      length_m double precision not null,
      access_classification text not null,
      highway_class text not null,
      bridge boolean,
      tunnel boolean,
      geom geometry(LineString, 4326) not null,
      source_tags jsonb not null default '{}'::jsonb,
      constraint walking_edge_mobility_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint walking_edge_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint walking_edge_from_node_fk foreign key (from_node_id, dataset_version_id)
        references spatial.network_node (id, dataset_version_id) on delete restrict,
      constraint walking_edge_to_node_fk foreign key (to_node_id, dataset_version_id)
        references spatial.network_node (id, dataset_version_id) on delete restrict,
      constraint walking_edge_identity_unique unique (
        dataset_version_id, source_way_id, segment_sequence, direction
      ),
      constraint walking_edge_endpoints_differ check (from_node_id <> to_node_id),
      constraint walking_edge_source_way_not_blank check (btrim(source_way_id) <> ''),
      constraint walking_edge_sequence_check check (segment_sequence >= 0),
      constraint walking_edge_direction_check check (direction in ('FORWARD', 'REVERSE')),
      constraint walking_edge_length_check check (length_m > 0),
      constraint walking_edge_access_check check (
        access_classification in ('ALLOWED', 'CONDITIONAL', 'UNKNOWN')
      ),
      constraint walking_edge_highway_not_blank check (btrim(highway_class) <> ''),
      constraint walking_edge_tags_object check (jsonb_typeof(source_tags) = 'object'),
      constraint walking_edge_geom_valid check (
        not ST_IsEmpty(geom) and ST_IsValid(geom) and ST_SRID(geom) = 4326
      )
    )
  `.execute(database);
  await sql`
    create index walking_edge_from_idx
      on spatial.walking_edge (from_node_id, dataset_version_id)
  `.execute(database);
  await sql`
    create index walking_edge_to_idx
      on spatial.walking_edge (to_node_id, dataset_version_id)
  `.execute(database);
  await sql`
    create index walking_edge_geom_gist
      on spatial.walking_edge using gist (geom)
  `.execute(database);
  await sql`
    create trigger walking_edge_mobility_entity_type_trigger
      before insert or update of mobility_entity_id on spatial.walking_edge
      for each row execute function twin.assert_mobility_entity_type('WALKING_EDGE')
  `.execute(database);

  await sql`
    create table spatial.rail_topology_station (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      operator_key text not null,
      external_id text not null,
      name text not null,
      geom geometry(Point, 4326) not null,
      official_corroboration_url text not null,
      evidence_type text not null default 'TOPOLOGY_ONLY',
      constraint rail_topology_station_mobility_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint rail_topology_station_dataset_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint rail_topology_station_identity_unique unique (
        dataset_version_id, operator_key, external_id
      ),
      constraint rail_topology_station_operator_not_blank check (btrim(operator_key) <> ''),
      constraint rail_topology_station_external_not_blank check (btrim(external_id) <> ''),
      constraint rail_topology_station_name_not_blank check (btrim(name) <> ''),
      constraint rail_topology_station_corroboration_not_blank check (
        btrim(official_corroboration_url) <> ''
      ),
      constraint rail_topology_station_evidence_check check (evidence_type = 'TOPOLOGY_ONLY'),
      constraint rail_topology_station_geom_valid check (
        not ST_IsEmpty(geom) and ST_IsValid(geom) and ST_SRID(geom) = 4326
      )
    )
  `.execute(database);
  await sql`
    create index rail_topology_station_geom_gist
      on spatial.rail_topology_station using gist (geom)
  `.execute(database);
  await sql`
    create trigger rail_topology_station_mobility_entity_type_trigger
      before insert or update of mobility_entity_id on spatial.rail_topology_station
      for each row execute function twin.assert_mobility_entity_type('STATION')
  `.execute(database);

  await sql`
    create table spatial.rail_topology_edge (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      operator_key text not null,
      external_way_id text not null,
      rail_class text not null,
      geom geometry(LineString, 4326) not null,
      evidence_type text not null default 'TOPOLOGY_ONLY',
      source_tags jsonb not null default '{}'::jsonb,
      constraint rail_topology_edge_mobility_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint rail_topology_edge_dataset_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint rail_topology_edge_identity_unique unique (
        dataset_version_id, operator_key, external_way_id
      ),
      constraint rail_topology_edge_operator_not_blank check (btrim(operator_key) <> ''),
      constraint rail_topology_edge_external_not_blank check (btrim(external_way_id) <> ''),
      constraint rail_topology_edge_class_check check (
        rail_class in ('RAIL', 'SUBWAY', 'LIGHT_RAIL')
      ),
      constraint rail_topology_edge_evidence_check check (evidence_type = 'TOPOLOGY_ONLY'),
      constraint rail_topology_edge_tags_object check (jsonb_typeof(source_tags) = 'object'),
      constraint rail_topology_edge_geom_valid check (
        not ST_IsEmpty(geom) and ST_IsValid(geom) and ST_SRID(geom) = 4326
      )
    )
  `.execute(database);
  await sql`
    create index rail_topology_edge_geom_gist
      on spatial.rail_topology_edge using gist (geom)
  `.execute(database);
  await sql`
    create trigger rail_topology_edge_mobility_entity_type_trigger
      before insert or update of mobility_entity_id on spatial.rail_topology_edge
      for each row execute function twin.assert_mobility_entity_type('RAIL_TOPOLOGY_EDGE')
  `.execute(database);

  await sql`
    create table spatial.transit_endpoint_resolution (
      id uuid primary key,
      transit_entity_id uuid not null,
      transit_dataset_version_id uuid not null,
      spatial_dataset_version_id uuid not null,
      network_node_id uuid,
      resolution_method text not null,
      resolution_status text not null,
      distance_m double precision,
      provenance_ref text not null,
      constraint transit_endpoint_entity_fk foreign key (transit_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint transit_endpoint_transit_dataset_fk foreign key (transit_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint transit_endpoint_spatial_dataset_fk foreign key (spatial_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint transit_endpoint_node_fk foreign key (network_node_id, spatial_dataset_version_id)
        references spatial.network_node (id, dataset_version_id) on delete restrict,
      constraint transit_endpoint_identity_unique unique (
        transit_entity_id, spatial_dataset_version_id
      ),
      constraint transit_endpoint_method_check check (
        resolution_method in (
          'VERIFIED_ENTRANCE', 'NEAREST_PEDESTRIAN_NODE',
          'TRANSIT_LOCATION', 'STATION_CENTROID', 'NONE'
        )
      ),
      constraint transit_endpoint_status_check check (
        resolution_status in ('RESOLVED', 'FALLBACK', 'UNRESOLVED')
      ),
      constraint transit_endpoint_distance_check check (distance_m is null or distance_m >= 0),
      constraint transit_endpoint_consistency_check check (
        (resolution_status = 'UNRESOLVED' and network_node_id is null and distance_m is null and resolution_method = 'NONE')
        or
        (resolution_status <> 'UNRESOLVED' and network_node_id is not null and distance_m is not null and resolution_method <> 'NONE')
      ),
      constraint transit_endpoint_provenance_not_blank check (btrim(provenance_ref) <> '')
    )
  `.execute(database);
  await sql`
    create index transit_endpoint_node_idx
      on spatial.transit_endpoint_resolution (network_node_id, spatial_dataset_version_id)
  `.execute(database);

  await sql`
    create table meta.source_entity_reference (
      id uuid primary key,
      source_key text not null,
      operator_key text not null,
      source_dataset_version_id uuid not null,
      external_reference text not null,
      reference_type text not null,
      canonical_entity_id uuid not null,
      valid_from timestamptz,
      valid_to timestamptz,
      provenance_ref text not null,
      constraint source_entity_reference_dataset_fk foreign key (source_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint source_entity_reference_entity_fk foreign key (canonical_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint source_entity_reference_unique unique (
        source_key, operator_key, source_dataset_version_id,
        external_reference, reference_type, canonical_entity_id
      ),
      constraint source_entity_reference_source_not_blank check (btrim(source_key) <> ''),
      constraint source_entity_reference_operator_not_blank check (btrim(operator_key) <> ''),
      constraint source_entity_reference_external_not_blank check (btrim(external_reference) <> ''),
      constraint source_entity_reference_type_check check (
        reference_type in ('OFFICIAL_ID', 'OPERATOR_REFERENCE', 'ROUTE_CODE', 'OSM_ID')
      ),
      constraint source_entity_reference_validity_check check (
        valid_to is null or valid_from is null or valid_to >= valid_from
      ),
      constraint source_entity_reference_provenance_not_blank check (btrim(provenance_ref) <> '')
    )
  `.execute(database);
  await sql`
    create index source_entity_reference_lookup_idx
      on meta.source_entity_reference (
        source_key, operator_key, external_reference, reference_type
      )
  `.execute(database);

  await sql`
    create table meta.entity_alias (
      id uuid primary key,
      source_key text not null,
      operator_key text not null,
      source_dataset_version_id uuid not null,
      alias text not null,
      normalized_alias text not null,
      canonical_entity_id uuid not null,
      alias_type text not null,
      provenance_ref text not null,
      constraint entity_alias_dataset_fk foreign key (source_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint entity_alias_entity_fk foreign key (canonical_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint entity_alias_identity_unique unique (
        source_key, operator_key, source_dataset_version_id,
        normalized_alias, canonical_entity_id, alias_type
      ),
      constraint entity_alias_source_not_blank check (btrim(source_key) <> ''),
      constraint entity_alias_operator_not_blank check (btrim(operator_key) <> ''),
      constraint entity_alias_not_blank check (btrim(alias) <> '' and btrim(normalized_alias) <> ''),
      constraint entity_alias_type_check check (
        alias_type in ('CANONICAL_NAME', 'DOCUMENTED_ALIAS', 'NORMALIZED_EXACT')
      ),
      constraint entity_alias_provenance_not_blank check (btrim(provenance_ref) <> '')
    )
  `.execute(database);
  await sql`
    create index entity_alias_lookup_idx
      on meta.entity_alias (source_key, operator_key, normalized_alias)
  `.execute(database);

  await sql`
    create table spatial.interchange_candidate (
      id uuid primary key,
      spatial_dataset_version_id uuid not null,
      transit_snapshot_id text not null,
      from_entity_id uuid not null,
      to_entity_id uuid not null,
      from_resolution_id uuid,
      to_resolution_id uuid,
      geodesic_distance_m double precision not null,
      network_distance_m double precision,
      path_status text not null,
      provenance_ref text not null,
      constraint interchange_candidate_spatial_dataset_fk foreign key (spatial_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint interchange_candidate_from_entity_fk foreign key (from_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint interchange_candidate_to_entity_fk foreign key (to_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint interchange_candidate_from_resolution_fk foreign key (from_resolution_id)
        references spatial.transit_endpoint_resolution (id) on delete restrict,
      constraint interchange_candidate_to_resolution_fk foreign key (to_resolution_id)
        references spatial.transit_endpoint_resolution (id) on delete restrict,
      constraint interchange_candidate_identity_unique unique (
        spatial_dataset_version_id, transit_snapshot_id, from_entity_id, to_entity_id
      ),
      constraint interchange_candidate_entity_order check (from_entity_id < to_entity_id),
      constraint interchange_candidate_geodesic_check check (geodesic_distance_m >= 0),
      constraint interchange_candidate_network_check check (
        network_distance_m is null or network_distance_m >= 0
      ),
      constraint interchange_candidate_path_status_check check (
        path_status in ('CONNECTED', 'DISCONNECTED', 'UNRESOLVED')
      ),
      constraint interchange_candidate_path_consistency check (
        (path_status = 'CONNECTED' and network_distance_m is not null)
        or (path_status <> 'CONNECTED' and network_distance_m is null)
      ),
      constraint interchange_candidate_snapshot_not_blank check (btrim(transit_snapshot_id) <> ''),
      constraint interchange_candidate_provenance_not_blank check (btrim(provenance_ref) <> '')
    )
  `.execute(database);
  await sql`
    create index interchange_candidate_entities_idx
      on spatial.interchange_candidate (from_entity_id, to_entity_id)
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists spatial.interchange_candidate restrict`.execute(
    database,
  );
  await sql`drop table if exists meta.entity_alias restrict`.execute(database);
  await sql`drop table if exists meta.source_entity_reference restrict`.execute(
    database,
  );
  await sql`drop table if exists spatial.transit_endpoint_resolution restrict`.execute(
    database,
  );
  await sql`drop trigger if exists rail_topology_edge_mobility_entity_type_trigger on spatial.rail_topology_edge`.execute(
    database,
  );
  await sql`drop table if exists spatial.rail_topology_edge restrict`.execute(
    database,
  );
  await sql`drop trigger if exists rail_topology_station_mobility_entity_type_trigger on spatial.rail_topology_station`.execute(
    database,
  );
  await sql`drop table if exists spatial.rail_topology_station restrict`.execute(
    database,
  );
  await sql`drop trigger if exists walking_edge_mobility_entity_type_trigger on spatial.walking_edge`.execute(
    database,
  );
  await sql`drop table if exists spatial.walking_edge restrict`.execute(
    database,
  );
  await sql`drop table if exists spatial.network_node restrict`.execute(
    database,
  );
  await sql`
    alter table twin.mobility_entity
      drop constraint mobility_entity_type_check,
      add constraint mobility_entity_type_check check (
        entity_type in (
          'STOP', 'STATION', 'ROUTE', 'TRANSIT_SEGMENT', 'TRANSFER',
          'ROAD_SEGMENT', 'WALKING_EDGE'
        )
      )
  `.execute(database);
}
