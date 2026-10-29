import { sql, type Kysely } from 'kysely';

/**
 * Phase 1B data-driven reconciliation.
 *
 * The official TransJakarta feed contains multiple stop patterns for the same
 * route/direction, so a segment must be scoped to a trip rather than only to a
 * route/direction ordinal. The feed also carries route metadata that must not
 * be discarded during canonical ingestion.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table meta.dataset_version
      add constraint dataset_version_source_checksum_unique
        unique (source_id, checksum_sha256)
  `.execute(database);

  await sql`
    alter table transit.route
      add column description text,
      add column source_url text,
      add column color text,
      add column text_color text,
      add column sort_order integer,
      add column gtfs_route_type integer,
      add constraint route_color_check check (
        color is null or color ~ '^[0-9A-Fa-f]{6}$'
      ),
      add constraint route_text_color_check check (
        text_color is null or text_color ~ '^[0-9A-Fa-f]{6}$'
      ),
      add constraint route_sort_order_check check (
        sort_order is null or sort_order >= 0
      ),
      add constraint route_gtfs_type_check check (
        gtfs_route_type is null or gtfs_route_type >= 0
      )
  `.execute(database);

  await sql`
    alter table transit.transit_segment
      drop constraint transit_segment_order_unique,
      add column trip_id uuid not null,
      add constraint transit_segment_trip_fk
        foreign key (trip_id, dataset_version_id)
        references transit.trip (id, dataset_version_id) on delete restrict,
      add constraint transit_segment_trip_order_unique
        unique (dataset_version_id, trip_id, segment_sequence)
  `.execute(database);

  await sql`
    create index transit_segment_trip_sequence_idx
      on transit.transit_segment (trip_id, segment_sequence)
  `.execute(database);

  await sql`
    alter table transit.transfer
      drop constraint transfer_endpoints_type_unique,
      drop constraint transfer_endpoints_differ,
      drop constraint transfer_from_stop_fk,
      drop constraint transfer_to_stop_fk,
      alter column from_stop_id drop not null,
      alter column to_stop_id drop not null,
      add column from_station_id uuid,
      add column to_station_id uuid,
      add constraint transfer_from_stop_fk
        foreign key (from_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      add constraint transfer_to_stop_fk
        foreign key (to_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      add constraint transfer_from_station_fk
        foreign key (from_station_id, dataset_version_id)
        references transit.station (id, dataset_version_id) on delete restrict,
      add constraint transfer_to_station_fk
        foreign key (to_station_id, dataset_version_id)
        references transit.station (id, dataset_version_id) on delete restrict,
      add constraint transfer_from_location_xor check (
        (from_stop_id is not null)::integer +
        (from_station_id is not null)::integer = 1
      ),
      add constraint transfer_to_location_xor check (
        (to_stop_id is not null)::integer +
        (to_station_id is not null)::integer = 1
      ),
      add constraint transfer_endpoints_differ check (
        from_stop_id is distinct from to_stop_id
        or from_station_id is distinct from to_station_id
      ),
      add constraint transfer_endpoints_type_unique
        unique nulls not distinct (
          dataset_version_id,
          from_stop_id,
          from_station_id,
          to_stop_id,
          to_station_id,
          transfer_type
        )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table transit.transfer
      drop constraint transfer_endpoints_type_unique,
      drop constraint transfer_endpoints_differ,
      drop constraint transfer_from_location_xor,
      drop constraint transfer_to_location_xor,
      drop constraint transfer_from_station_fk,
      drop constraint transfer_to_station_fk,
      drop constraint transfer_from_stop_fk,
      drop constraint transfer_to_stop_fk,
      drop column from_station_id,
      drop column to_station_id,
      alter column from_stop_id set not null,
      alter column to_stop_id set not null,
      add constraint transfer_from_stop_fk
        foreign key (from_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      add constraint transfer_to_stop_fk
        foreign key (to_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      add constraint transfer_endpoints_differ check (from_stop_id <> to_stop_id),
      add constraint transfer_endpoints_type_unique unique (
        dataset_version_id, from_stop_id, to_stop_id, transfer_type
      )
  `.execute(database);

  await sql`drop index if exists transit.transit_segment_trip_sequence_idx`.execute(
    database,
  );

  await sql`
    alter table transit.transit_segment
      drop constraint transit_segment_trip_order_unique,
      drop constraint transit_segment_trip_fk,
      drop column trip_id,
      add constraint transit_segment_order_unique
        unique (dataset_version_id, route_id, direction_id, segment_sequence)
  `.execute(database);

  await sql`
    alter table transit.route
      drop constraint route_gtfs_type_check,
      drop constraint route_sort_order_check,
      drop constraint route_text_color_check,
      drop constraint route_color_check,
      drop column gtfs_route_type,
      drop column sort_order,
      drop column text_color,
      drop column color,
      drop column source_url,
      drop column description
  `.execute(database);

  await sql`
    alter table meta.dataset_version
      drop constraint dataset_version_source_checksum_unique
  `.execute(database);
}
