import { sql, type Kysely } from 'kysely';

/**
 * Phase 1C data-driven hardening.
 *
 * TransJakarta frequencies define the actual headway-based service and must be
 * canonicalized. The 25,727 trip-scoped segment rows collapse to 17,727 stable
 * route/direction/endpoint edges, so state identity moves to a logical segment
 * while exact trip geometry remains on a traversal association.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table meta.ingestion_run
      add column pipeline_version text not null default 'PHASE_1B_V1',
      add column replaces_ingestion_run_id uuid,
      add constraint ingestion_run_pipeline_version_not_blank
        check (btrim(pipeline_version) <> ''),
      add constraint ingestion_run_replaces_fk
        foreign key (replaces_ingestion_run_id)
        references meta.ingestion_run (id) on delete restrict,
      add constraint ingestion_run_not_self_replacing
        check (replaces_ingestion_run_id is null or replaces_ingestion_run_id <> id)
  `.execute(database);

  await sql`
    create table transit.trip_frequency (
      id uuid primary key,
      dataset_version_id uuid not null,
      trip_id uuid not null,
      start_seconds integer not null,
      end_seconds integer not null,
      headway_seconds integer not null,
      exact_times boolean not null,
      constraint trip_frequency_dataset_version_fk foreign key (dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint trip_frequency_trip_fk foreign key (trip_id, dataset_version_id)
        references transit.trip (id, dataset_version_id) on delete restrict,
      constraint trip_frequency_window_check check (
        start_seconds >= 0 and end_seconds > start_seconds
      ),
      constraint trip_frequency_headway_check check (headway_seconds > 0),
      constraint trip_frequency_identity_unique unique (
        dataset_version_id, trip_id, start_seconds, end_seconds
      )
    )
  `.execute(database);

  await sql`
    create index trip_frequency_trip_start_idx
      on transit.trip_frequency (trip_id, start_seconds)
  `.execute(database);

  await sql`alter table transit.transit_segment rename to trip_segment_traversal`.execute(
    database,
  );
  for (const [before, after] of [
    ['transit_segment_pkey', 'trip_segment_traversal_pkey'],
    [
      'transit_segment_mobility_entity_id_key',
      'trip_segment_traversal_mobility_entity_id_key',
    ],
    [
      'transit_segment_trip_order_unique',
      'trip_segment_traversal_trip_order_unique',
    ],
    [
      'transit_segment_dataset_version_fk',
      'trip_segment_traversal_dataset_version_fk',
    ],
    ['transit_segment_route_fk', 'trip_segment_traversal_route_fk'],
    ['transit_segment_from_stop_fk', 'trip_segment_traversal_from_stop_fk'],
    ['transit_segment_to_stop_fk', 'trip_segment_traversal_to_stop_fk'],
    ['transit_segment_shape_fk', 'trip_segment_traversal_shape_fk'],
    ['transit_segment_trip_fk', 'trip_segment_traversal_trip_fk'],
    [
      'transit_segment_mobility_entity_fk',
      'trip_segment_traversal_mobility_entity_fk',
    ],
    [
      'transit_segment_endpoints_differ',
      'trip_segment_traversal_endpoints_differ',
    ],
    [
      'transit_segment_direction_check',
      'trip_segment_traversal_direction_check',
    ],
    ['transit_segment_sequence_check', 'trip_segment_traversal_sequence_check'],
    ['transit_segment_geom_valid', 'trip_segment_traversal_geom_valid'],
  ] as const) {
    await sql
      .raw(
        `alter table transit.trip_segment_traversal rename constraint ${before} to ${after}`,
      )
      .execute(database);
  }
  await sql`
    alter index transit.transit_segment_geom_gist
      rename to trip_segment_traversal_geom_gist
  `.execute(database);
  await sql`
    alter index transit.transit_segment_trip_sequence_idx
      rename to trip_segment_traversal_trip_sequence_idx
  `.execute(database);
  await sql`
    drop trigger transit_segment_mobility_entity_type_trigger
      on transit.trip_segment_traversal
  `.execute(database);

  await sql`
    create table transit.transit_segment (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      dataset_version_id uuid not null,
      route_id uuid not null,
      from_stop_id uuid not null,
      to_stop_id uuid not null,
      direction_id smallint not null,
      geom geometry(LineString, 4326) not null,
      constraint transit_segment_id_version_unique unique (id, dataset_version_id),
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
      constraint transit_segment_identity_unique unique (
        dataset_version_id, route_id, direction_id, from_stop_id, to_stop_id
      ),
      constraint transit_segment_endpoints_differ check (from_stop_id <> to_stop_id),
      constraint transit_segment_direction_check check (direction_id in (0, 1)),
      constraint transit_segment_geom_valid check (
        not ST_IsEmpty(geom) and ST_IsValid(geom)
      )
    )
  `.execute(database);
  await sql`
    create index transit_segment_geom_gist
      on transit.transit_segment using gist (geom)
  `.execute(database);
  await sql`
    create trigger transit_segment_mobility_entity_type_trigger
      before insert or update of mobility_entity_id on transit.transit_segment
      for each row execute function twin.assert_mobility_entity_type('TRANSIT_SEGMENT')
  `.execute(database);

  await sql`
    alter table transit.trip_segment_traversal
      add column transit_segment_id uuid
  `.execute(database);
  await sql`
    insert into transit.transit_segment (
      id, mobility_entity_id, dataset_version_id, route_id,
      from_stop_id, to_stop_id, direction_id, geom
    )
    select distinct on (
      dataset_version_id, route_id, direction_id, from_stop_id, to_stop_id
    )
      id, mobility_entity_id, dataset_version_id, route_id,
      from_stop_id, to_stop_id, direction_id, geom
    from transit.trip_segment_traversal
    order by
      dataset_version_id, route_id, direction_id, from_stop_id, to_stop_id,
      trip_id, segment_sequence, id
  `.execute(database);
  await sql`
    update transit.trip_segment_traversal traversal
    set transit_segment_id = segment.id
    from transit.transit_segment segment
    where segment.dataset_version_id = traversal.dataset_version_id
      and segment.route_id = traversal.route_id
      and segment.direction_id = traversal.direction_id
      and segment.from_stop_id = traversal.from_stop_id
      and segment.to_stop_id = traversal.to_stop_id
  `.execute(database);
  await sql`
    alter table transit.trip_segment_traversal
      alter column transit_segment_id set not null,
      add constraint trip_segment_traversal_segment_fk
        foreign key (transit_segment_id, dataset_version_id)
        references transit.transit_segment (id, dataset_version_id) on delete restrict
  `.execute(database);
  await sql`
    create index trip_segment_traversal_segment_idx
      on transit.trip_segment_traversal (transit_segment_id, trip_id, segment_sequence)
  `.execute(database);

  await sql`
    alter table transit.trip_segment_traversal
      drop constraint trip_segment_traversal_mobility_entity_fk,
      drop constraint trip_segment_traversal_mobility_entity_id_key,
      drop column mobility_entity_id
  `.execute(database);
  await sql`
    delete from twin.mobility_entity entity
    where entity.entity_type = 'TRANSIT_SEGMENT'
      and not exists (
        select 1 from transit.transit_segment segment
        where segment.mobility_entity_id = entity.id
      )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    create temporary table phase1c_rollback_segment_identity
    on commit drop
    as select id as traversal_id, gen_random_uuid() as mobility_entity_id
    from transit.trip_segment_traversal
  `.execute(database);
  await sql`
    alter table transit.trip_segment_traversal
      add column mobility_entity_id uuid
  `.execute(database);
  await sql`
    insert into twin.mobility_entity (
      id, entity_type, creation_dataset_version_id
    )
    select mapping.mobility_entity_id, 'TRANSIT_SEGMENT', traversal.dataset_version_id
    from phase1c_rollback_segment_identity mapping
    join transit.trip_segment_traversal traversal
      on traversal.id = mapping.traversal_id
  `.execute(database);
  await sql`
    update transit.trip_segment_traversal traversal
    set mobility_entity_id = mapping.mobility_entity_id
    from phase1c_rollback_segment_identity mapping
    where traversal.id = mapping.traversal_id
  `.execute(database);
  await sql`
    alter table transit.trip_segment_traversal
      alter column mobility_entity_id set not null,
      add constraint trip_segment_traversal_mobility_entity_id_key
        unique (mobility_entity_id),
      add constraint trip_segment_traversal_mobility_entity_fk
        foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict
  `.execute(database);

  await sql`
    create temporary table phase1c_logical_mobility_ids
    on commit drop
    as select mobility_entity_id from transit.transit_segment
  `.execute(database);
  await sql`
    drop trigger transit_segment_mobility_entity_type_trigger
      on transit.transit_segment
  `.execute(database);
  await sql`drop table transit.transit_segment restrict`.execute(database);
  await sql`
    delete from twin.mobility_entity entity
    using phase1c_logical_mobility_ids logical
    where entity.id = logical.mobility_entity_id
  `.execute(database);

  await sql`drop index transit.trip_segment_traversal_segment_idx`.execute(
    database,
  );
  await sql`
    alter table transit.trip_segment_traversal
      drop constraint trip_segment_traversal_segment_fk,
      drop column transit_segment_id
  `.execute(database);

  await sql`drop table transit.trip_frequency restrict`.execute(database);

  for (const [before, after] of [
    ['trip_segment_traversal_pkey', 'transit_segment_pkey'],
    [
      'trip_segment_traversal_mobility_entity_id_key',
      'transit_segment_mobility_entity_id_key',
    ],
    [
      'trip_segment_traversal_trip_order_unique',
      'transit_segment_trip_order_unique',
    ],
    [
      'trip_segment_traversal_dataset_version_fk',
      'transit_segment_dataset_version_fk',
    ],
    ['trip_segment_traversal_route_fk', 'transit_segment_route_fk'],
    ['trip_segment_traversal_from_stop_fk', 'transit_segment_from_stop_fk'],
    ['trip_segment_traversal_to_stop_fk', 'transit_segment_to_stop_fk'],
    ['trip_segment_traversal_shape_fk', 'transit_segment_shape_fk'],
    ['trip_segment_traversal_trip_fk', 'transit_segment_trip_fk'],
    [
      'trip_segment_traversal_mobility_entity_fk',
      'transit_segment_mobility_entity_fk',
    ],
    [
      'trip_segment_traversal_endpoints_differ',
      'transit_segment_endpoints_differ',
    ],
    [
      'trip_segment_traversal_direction_check',
      'transit_segment_direction_check',
    ],
    ['trip_segment_traversal_sequence_check', 'transit_segment_sequence_check'],
    ['trip_segment_traversal_geom_valid', 'transit_segment_geom_valid'],
  ] as const) {
    await sql
      .raw(
        `alter table transit.trip_segment_traversal rename constraint ${before} to ${after}`,
      )
      .execute(database);
  }
  await sql`
    alter index transit.trip_segment_traversal_geom_gist
      rename to transit_segment_geom_gist
  `.execute(database);
  await sql`
    alter index transit.trip_segment_traversal_trip_sequence_idx
      rename to transit_segment_trip_sequence_idx
  `.execute(database);
  await sql`alter table transit.trip_segment_traversal rename to transit_segment`.execute(
    database,
  );
  await sql`
    create trigger transit_segment_mobility_entity_type_trigger
      before insert or update of mobility_entity_id on transit.transit_segment
      for each row execute function twin.assert_mobility_entity_type('TRANSIT_SEGMENT')
  `.execute(database);

  await sql`
    alter table meta.ingestion_run
      drop constraint ingestion_run_not_self_replacing,
      drop constraint ingestion_run_replaces_fk,
      drop constraint ingestion_run_pipeline_version_not_blank,
      drop column replaces_ingestion_run_id,
      drop column pipeline_version
  `.execute(database);
}
