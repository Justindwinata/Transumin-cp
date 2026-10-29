import { sql, type Kysely } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table meta.dataset_source (
      id uuid primary key,
      source_key text not null unique,
      name text not null,
      provider text not null,
      source_type text not null,
      canonical_url text,
      license_name text,
      license_url text,
      access_method text,
      access_notes text,
      coverage_notes text,
      redistribution_rule text,
      verification_status text not null default 'NOT_VERIFIED',
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint dataset_source_source_key_not_blank check (btrim(source_key) <> ''),
      constraint dataset_source_name_not_blank check (btrim(name) <> ''),
      constraint dataset_source_provider_not_blank check (btrim(provider) <> ''),
      constraint dataset_source_type_not_blank check (btrim(source_type) <> ''),
      constraint dataset_source_verification_status_check check (
        verification_status in ('NOT_VERIFIED', 'VERIFIED', 'REJECTED')
      )
    )
  `.execute(database);

  await sql`
    create table meta.dataset_version (
      id uuid primary key,
      source_id uuid not null,
      version_label text not null,
      checksum_sha256 text not null,
      retrieved_at timestamptz not null,
      effective_from timestamptz,
      effective_to timestamptz,
      raw_path_ref text not null,
      manifest_path text not null,
      validation_status text not null default 'PENDING',
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      constraint dataset_version_source_fk foreign key (source_id)
        references meta.dataset_source (id) on delete restrict,
      constraint dataset_version_source_label_unique unique (source_id, version_label),
      constraint dataset_version_version_label_not_blank check (btrim(version_label) <> ''),
      constraint dataset_version_checksum_sha256_check check (
        checksum_sha256 ~ '^[0-9a-f]{64}$'
      ),
      constraint dataset_version_raw_path_not_blank check (btrim(raw_path_ref) <> ''),
      constraint dataset_version_manifest_path_not_blank check (btrim(manifest_path) <> ''),
      constraint dataset_version_validation_status_check check (
        validation_status in ('PENDING', 'VALID', 'WARNING', 'INVALID')
      ),
      constraint dataset_version_effective_interval_check check (
        effective_to is null or effective_from is null or effective_to >= effective_from
      ),
      constraint dataset_version_metadata_object_check check (
        jsonb_typeof(metadata_json) = 'object'
      )
    )
  `.execute(database);

  await sql`
    create index dataset_version_source_retrieved_idx
      on meta.dataset_version (source_id, retrieved_at desc, id)
  `.execute(database);

  await sql`
    create table meta.ingestion_run (
      id uuid primary key,
      dataset_version_id uuid not null,
      started_at timestamptz not null,
      completed_at timestamptz,
      status text not null,
      records_read bigint not null default 0,
      records_written bigint not null default 0,
      records_rejected bigint not null default 0,
      error_summary text,
      constraint ingestion_run_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint ingestion_run_status_check check (
        status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')
      ),
      constraint ingestion_run_record_counts_check check (
        records_read >= 0
        and records_written >= 0
        and records_rejected >= 0
        and records_written + records_rejected <= records_read
      ),
      constraint ingestion_run_written_count_check check (records_written <= records_read),
      constraint ingestion_run_rejected_count_check check (records_rejected <= records_read),
      constraint ingestion_run_completed_at_check check (
        (status in ('PENDING', 'RUNNING') and completed_at is null)
        or
        (status in ('SUCCEEDED', 'FAILED') and completed_at is not null and completed_at >= started_at)
      )
    )
  `.execute(database);

  await sql`
    create index ingestion_run_dataset_started_idx
      on meta.ingestion_run (dataset_version_id, started_at desc)
  `.execute(database);

  await sql`
    create table twin.mobility_entity (
      id uuid primary key,
      entity_type text not null,
      creation_dataset_version_id uuid not null,
      created_at timestamptz not null default now(),
      retired_at timestamptz,
      constraint mobility_entity_dataset_version_fk foreign key (creation_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint mobility_entity_type_check check (
        entity_type in (
          'STOP', 'STATION', 'ROUTE', 'TRANSIT_SEGMENT', 'TRANSFER',
          'ROAD_SEGMENT', 'WALKING_EDGE'
        )
      ),
      constraint mobility_entity_retired_at_check check (
        retired_at is null or retired_at >= created_at
      )
    )
  `.execute(database);

  await sql`
    create index mobility_entity_type_idx on twin.mobility_entity (entity_type)
  `.execute(database);

  await sql`
    create table transit.operator (
      id uuid primary key,
      dataset_version_id uuid not null,
      external_id text not null,
      code text not null,
      name text not null,
      mode_group text not null,
      active boolean not null default true,
      constraint operator_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint operator_external_id_not_blank check (btrim(external_id) <> ''),
      constraint operator_code_not_blank check (btrim(code) <> ''),
      constraint operator_name_not_blank check (btrim(name) <> ''),
      constraint operator_mode_group_not_blank check (btrim(mode_group) <> ''),
      constraint operator_external_id_version_unique unique (dataset_version_id, external_id),
      constraint operator_code_version_unique unique (dataset_version_id, code),
      constraint operator_id_version_unique unique (id, dataset_version_id)
    )
  `.execute(database);

  await sql`
    create table transit.station (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      external_id text not null,
      name text not null,
      station_type text not null,
      parent_station_id uuid,
      geom geometry(Point, 4326) not null,
      constraint station_mobility_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint station_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint station_external_id_version_unique unique (dataset_version_id, external_id),
      constraint station_id_version_unique unique (id, dataset_version_id),
      constraint station_parent_fk foreign key (parent_station_id, dataset_version_id)
        references transit.station (id, dataset_version_id) on delete restrict,
      constraint station_external_id_not_blank check (btrim(external_id) <> ''),
      constraint station_name_not_blank check (btrim(name) <> ''),
      constraint station_type_not_blank check (btrim(station_type) <> ''),
      constraint station_parent_not_self check (parent_station_id is null or parent_station_id <> id),
      constraint station_geom_valid check (not ST_IsEmpty(geom) and ST_IsValid(geom))
    )
  `.execute(database);

  await sql`create index station_geom_gist on transit.station using gist (geom)`.execute(
    database,
  );

  await sql`
    create table transit.stop (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      station_id uuid,
      external_id text not null,
      name text not null,
      geom geometry(Point, 4326) not null,
      constraint stop_mobility_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint stop_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint stop_station_fk foreign key (station_id, dataset_version_id)
        references transit.station (id, dataset_version_id) on delete restrict,
      constraint stop_external_id_version_unique unique (dataset_version_id, external_id),
      constraint stop_id_version_unique unique (id, dataset_version_id),
      constraint stop_external_id_not_blank check (btrim(external_id) <> ''),
      constraint stop_name_not_blank check (btrim(name) <> ''),
      constraint stop_geom_valid check (not ST_IsEmpty(geom) and ST_IsValid(geom))
    )
  `.execute(database);

  await sql`create index stop_geom_gist on transit.stop using gist (geom)`.execute(
    database,
  );

  await sql`
    create table transit.route (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      operator_id uuid not null,
      external_id text not null,
      short_name text,
      long_name text,
      mode text not null,
      active boolean not null default true,
      constraint route_mobility_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint route_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint route_operator_fk foreign key (operator_id, dataset_version_id)
        references transit.operator (id, dataset_version_id) on delete restrict,
      constraint route_external_id_version_unique unique (dataset_version_id, external_id),
      constraint route_id_version_unique unique (id, dataset_version_id),
      constraint route_external_id_not_blank check (btrim(external_id) <> ''),
      constraint route_mode_not_blank check (btrim(mode) <> ''),
      constraint route_name_present check (
        nullif(btrim(short_name), '') is not null or nullif(btrim(long_name), '') is not null
      )
    )
  `.execute(database);

  await sql`create index route_operator_idx on transit.route (operator_id)`.execute(
    database,
  );

  await sql`
    create table transit.service_calendar (
      id uuid primary key,
      dataset_version_id uuid not null,
      operator_id uuid not null,
      service_code text not null,
      start_date date not null,
      end_date date not null,
      monday boolean not null,
      tuesday boolean not null,
      wednesday boolean not null,
      thursday boolean not null,
      friday boolean not null,
      saturday boolean not null,
      sunday boolean not null,
      constraint service_calendar_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint service_calendar_operator_fk foreign key (operator_id, dataset_version_id)
        references transit.operator (id, dataset_version_id) on delete restrict,
      constraint service_calendar_code_version_unique unique (dataset_version_id, service_code),
      constraint service_calendar_id_version_unique unique (id, dataset_version_id),
      constraint service_calendar_code_not_blank check (btrim(service_code) <> ''),
      constraint service_calendar_date_range_check check (end_date >= start_date)
    )
  `.execute(database);

  await sql`
    create table transit.transit_shape (
      id uuid primary key,
      dataset_version_id uuid not null,
      external_id text not null,
      geom geometry(LineString, 4326) not null,
      constraint transit_shape_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint transit_shape_external_id_version_unique unique (dataset_version_id, external_id),
      constraint transit_shape_id_version_unique unique (id, dataset_version_id),
      constraint transit_shape_external_id_not_blank check (btrim(external_id) <> ''),
      constraint transit_shape_geom_valid check (not ST_IsEmpty(geom) and ST_IsValid(geom))
    )
  `.execute(database);

  await sql`
    create index transit_shape_geom_gist on transit.transit_shape using gist (geom)
  `.execute(database);

  await sql`
    create table transit.trip (
      id uuid primary key,
      dataset_version_id uuid not null,
      route_id uuid not null,
      service_calendar_id uuid not null,
      transit_shape_id uuid,
      external_id text not null,
      direction_id smallint,
      headsign text,
      constraint trip_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint trip_route_fk foreign key (route_id, dataset_version_id)
        references transit.route (id, dataset_version_id) on delete restrict,
      constraint trip_service_calendar_fk foreign key (service_calendar_id, dataset_version_id)
        references transit.service_calendar (id, dataset_version_id) on delete restrict,
      constraint trip_transit_shape_fk foreign key (transit_shape_id, dataset_version_id)
        references transit.transit_shape (id, dataset_version_id) on delete restrict,
      constraint trip_external_id_version_unique unique (dataset_version_id, external_id),
      constraint trip_id_version_unique unique (id, dataset_version_id),
      constraint trip_external_id_not_blank check (btrim(external_id) <> ''),
      constraint trip_direction_id_check check (direction_id is null or direction_id in (0, 1))
    )
  `.execute(database);

  await sql`create index trip_route_idx on transit.trip (route_id)`.execute(
    database,
  );
  await sql`
    create index trip_service_calendar_idx on transit.trip (service_calendar_id)
  `.execute(database);

  await sql`
    create table transit.stop_time (
      id uuid primary key,
      dataset_version_id uuid not null,
      trip_id uuid not null,
      stop_id uuid not null,
      stop_sequence integer not null,
      arrival_seconds integer not null,
      departure_seconds integer not null,
      pickup_type smallint,
      dropoff_type smallint,
      constraint stop_time_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint stop_time_trip_fk foreign key (trip_id, dataset_version_id)
        references transit.trip (id, dataset_version_id) on delete restrict,
      constraint stop_time_stop_fk foreign key (stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      constraint stop_time_trip_sequence_unique unique (trip_id, stop_sequence),
      constraint stop_time_sequence_check check (stop_sequence >= 0),
      constraint stop_time_arrival_check check (arrival_seconds >= 0),
      constraint stop_time_departure_check check (departure_seconds >= arrival_seconds),
      constraint stop_time_pickup_type_check check (pickup_type is null or pickup_type between 0 and 3),
      constraint stop_time_dropoff_type_check check (dropoff_type is null or dropoff_type between 0 and 3)
    )
  `.execute(database);

  await sql`
    create index stop_time_trip_sequence_idx on transit.stop_time (trip_id, stop_sequence)
  `.execute(database);

  await sql`
    create table transit.transfer (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      from_stop_id uuid not null,
      to_stop_id uuid not null,
      transfer_type text not null,
      min_transfer_seconds integer,
      walking_distance_m numeric,
      geom geometry(LineString, 4326),
      validation_status text not null default 'NOT_VALIDATED',
      constraint transfer_mobility_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint transfer_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint transfer_from_stop_fk foreign key (from_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      constraint transfer_to_stop_fk foreign key (to_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      constraint transfer_endpoints_type_unique unique (
        dataset_version_id, from_stop_id, to_stop_id, transfer_type
      ),
      constraint transfer_endpoints_differ check (from_stop_id <> to_stop_id),
      constraint transfer_type_not_blank check (btrim(transfer_type) <> ''),
      constraint transfer_min_seconds_check check (
        min_transfer_seconds is null or min_transfer_seconds >= 0
      ),
      constraint transfer_walking_distance_check check (
        walking_distance_m is null or walking_distance_m >= 0
      ),
      constraint transfer_validation_status_check check (
        validation_status in ('NOT_VALIDATED', 'VALIDATED', 'REJECTED')
      ),
      constraint transfer_geom_valid check (
        geom is null or (not ST_IsEmpty(geom) and ST_IsValid(geom))
      )
    )
  `.execute(database);

  await sql`create index transfer_geom_gist on transit.transfer using gist (geom)`.execute(
    database,
  );

  await sql`
    create table transit.transit_segment (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      route_id uuid not null,
      from_stop_id uuid not null,
      to_stop_id uuid not null,
      transit_shape_id uuid,
      direction_id smallint not null,
      segment_sequence integer not null,
      geom geometry(LineString, 4326) not null,
      constraint transit_segment_mobility_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint transit_segment_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint transit_segment_route_fk foreign key (route_id, dataset_version_id)
        references transit.route (id, dataset_version_id) on delete restrict,
      constraint transit_segment_from_stop_fk foreign key (from_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      constraint transit_segment_to_stop_fk foreign key (to_stop_id, dataset_version_id)
        references transit.stop (id, dataset_version_id) on delete restrict,
      constraint transit_segment_shape_fk foreign key (transit_shape_id, dataset_version_id)
        references transit.transit_shape (id, dataset_version_id) on delete restrict,
      constraint transit_segment_order_unique unique (
        dataset_version_id, route_id, direction_id, segment_sequence
      ),
      constraint transit_segment_endpoints_differ check (from_stop_id <> to_stop_id),
      constraint transit_segment_direction_check check (direction_id in (0, 1)),
      constraint transit_segment_sequence_check check (segment_sequence >= 0),
      constraint transit_segment_geom_valid check (
        not ST_IsEmpty(geom) and ST_IsValid(geom)
      )
    )
  `.execute(database);

  await sql`
    create index transit_segment_geom_gist on transit.transit_segment using gist (geom)
  `.execute(database);

  await sql`
    create function twin.assert_mobility_entity_type()
    returns trigger
    language plpgsql
    as $function$
    begin
      if not exists (
        select 1
        from twin.mobility_entity
        where id = new.mobility_entity_id
          and entity_type = TG_ARGV[0]
      ) then
        raise exception using
          errcode = '23514',
          message = format(
            'mobility_entity_id %s must have entity_type %s',
            new.mobility_entity_id,
            TG_ARGV[0]
          );
      end if;
      return new;
    end
    $function$
  `.execute(database);

  for (const [tableName, entityType] of [
    ['station', 'STATION'],
    ['stop', 'STOP'],
    ['route', 'ROUTE'],
    ['transfer', 'TRANSFER'],
    ['transit_segment', 'TRANSIT_SEGMENT'],
  ] as const) {
    await sql
      .raw(
        `create trigger ${tableName}_mobility_entity_type_trigger ` +
          `before insert or update of mobility_entity_id on transit.${tableName} ` +
          `for each row execute function twin.assert_mobility_entity_type('${entityType}')`,
      )
      .execute(database);
  }
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of [
    'transit_segment',
    'transfer',
    'route',
    'stop',
    'station',
  ] as const) {
    await sql
      .raw(
        `drop trigger if exists ${tableName}_mobility_entity_type_trigger on transit.${tableName}`,
      )
      .execute(database);
  }

  await sql`drop function if exists twin.assert_mobility_entity_type()`.execute(
    database,
  );
  await sql`drop table if exists transit.transit_segment restrict`.execute(
    database,
  );
  await sql`drop table if exists transit.transfer restrict`.execute(database);
  await sql`drop table if exists transit.stop_time restrict`.execute(database);
  await sql`drop table if exists transit.trip restrict`.execute(database);
  await sql`drop table if exists transit.transit_shape restrict`.execute(
    database,
  );
  await sql`drop table if exists transit.service_calendar restrict`.execute(
    database,
  );
  await sql`drop table if exists transit.route restrict`.execute(database);
  await sql`drop table if exists transit.stop restrict`.execute(database);
  await sql`drop table if exists transit.station restrict`.execute(database);
  await sql`drop table if exists transit.operator restrict`.execute(database);
  await sql`drop table if exists twin.mobility_entity restrict`.execute(
    database,
  );
  await sql`drop table if exists meta.ingestion_run restrict`.execute(database);
  await sql`drop table if exists meta.dataset_version restrict`.execute(
    database,
  );
  await sql`drop table if exists meta.dataset_source restrict`.execute(
    database,
  );
}
