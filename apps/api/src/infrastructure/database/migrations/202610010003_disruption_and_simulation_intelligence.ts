import { sql, type Kysely } from 'kysely';

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table disruption.event (
      id uuid primary key,
      incident_type text not null,
      source_observation_id uuid,
      source_id uuid not null,
      evidence_type text not null,
      operational_state text not null,
      effective_from timestamptz not null,
      effective_to timestamptz,
      received_at timestamptz not null,
      geometry geometry(Geometry, 4326),
      reason text not null,
      provenance_ref text not null,
      raw_reference text not null,
      dedupe_key text not null unique,
      created_at timestamptz not null default now(),
      constraint disruption_event_observation_fk foreign key (source_observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint disruption_event_incident_check check (
        incident_type in ('FLOOD','STATION_CLOSURE','STOP_CLOSURE','SERVICE_SUSPENSION','SERVICE_TRUNCATION','ROUTE_DIVERSION','INFRASTRUCTURE_FAILURE','WEATHER_DISRUPTION','MANUAL_OPERATOR_INCIDENT','OTHER')
      ),
      constraint disruption_event_evidence_check check (
        evidence_type in ('SCHEDULED','OBSERVED','LIVE','FORECAST','SIMULATED','ESTIMATED')
      ),
      constraint disruption_event_state_check check (
        operational_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint disruption_event_temporal_check check (
        effective_to is null or effective_to > effective_from
      ),
      constraint disruption_event_geometry_check check (
        geometry is null or (not ST_IsEmpty(geometry) and ST_IsValid(geometry) and ST_SRID(geometry) = 4326)
      ),
      constraint disruption_event_flood_geometry_check check (
        incident_type <> 'FLOOD' or geometry is not null
      ),
      constraint disruption_event_environment_check check (
        not (incident_type in ('FLOOD','WEATHER_DISRUPTION') and operational_state = 'UNAVAILABLE')
      ),
      constraint disruption_event_reference_check check (
        btrim(reason) <> '' and btrim(provenance_ref) <> '' and btrim(raw_reference) <> ''
      )
    )
  `.execute(database);
  await sql`create index disruption_event_time_idx on disruption.event (effective_from desc, effective_to)`.execute(
    database,
  );
  await sql`create index disruption_event_geometry_gist on disruption.event using gist (geometry)`.execute(
    database,
  );

  await sql`
    create table disruption.impact_analysis (
      id uuid primary key,
      disruption_event_id uuid not null,
      network_snapshot_id uuid not null,
      status text not null,
      rule_version text not null,
      direct_exposed_count integer not null default 0,
      confirmed_unavailable_count integer not null default 0,
      components_before integer not null default 0,
      components_after integer not null default 0,
      connectivity_loss integer not null default 0,
      isolated_entity_count integer not null default 0,
      affected_route_count integer not null default 0,
      affected_segment_count integer not null default 0,
      unresolved_entity_count integer not null default 0,
      runtime_ms double precision not null default 0,
      provenance_ref text not null,
      fingerprint text not null,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      constraint impact_analysis_event_fk foreign key (disruption_event_id)
        references disruption.event (id) on delete restrict,
      constraint impact_analysis_snapshot_fk foreign key (network_snapshot_id)
        references twin.network_snapshot (id) on delete restrict,
      constraint impact_analysis_unique unique (disruption_event_id, network_snapshot_id, rule_version),
      constraint impact_analysis_status_check check (status in ('PENDING','RUNNING','COMPLETED','FAILED')),
      constraint impact_analysis_counts_check check (
        direct_exposed_count >= 0 and confirmed_unavailable_count >= 0 and
        components_before >= 0 and components_after >= 0 and connectivity_loss >= 0 and
        isolated_entity_count >= 0 and affected_route_count >= 0 and
        affected_segment_count >= 0 and unresolved_entity_count >= 0 and runtime_ms >= 0
      ),
      constraint impact_analysis_reference_check check (
        btrim(rule_version) <> '' and btrim(provenance_ref) <> '' and btrim(fingerprint) <> ''
      )
    )
  `.execute(database);

  await sql`
    create table disruption.entity_impact (
      id uuid primary key,
      impact_analysis_id uuid not null,
      mobility_entity_id uuid not null,
      impact_kind text not null,
      spatial_relation text not null,
      resulting_state text,
      evidence_type text not null,
      distance_m double precision,
      provenance_ref text not null,
      constraint entity_impact_analysis_fk foreign key (impact_analysis_id)
        references disruption.impact_analysis (id) on delete restrict,
      constraint entity_impact_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint entity_impact_unique unique (impact_analysis_id, mobility_entity_id, impact_kind),
      constraint entity_impact_kind_check check (
        impact_kind in ('DIRECT_EXPOSURE','POTENTIAL_NETWORK_IMPACT','CONFIRMED_OPERATIONAL_IMPACT')
      ),
      constraint entity_impact_relation_check check (spatial_relation in ('INTERSECTS','WITHIN_DISTANCE','EXPLICIT')),
      constraint entity_impact_state_check check (
        resulting_state is null or resulting_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint entity_impact_evidence_check check (
        evidence_type in ('OBSERVED','LIVE','FORECAST','SIMULATED','ESTIMATED','SCHEDULED')
      ),
      constraint entity_impact_exposure_not_closure check (
        impact_kind <> 'DIRECT_EXPOSURE' or resulting_state is null
      ),
      constraint entity_impact_distance_check check (distance_m is null or distance_m >= 0),
      constraint entity_impact_provenance_check check (btrim(provenance_ref) <> '')
    )
  `.execute(database);
  await sql`create index entity_impact_entity_idx on disruption.entity_impact (mobility_entity_id, impact_analysis_id)`.execute(
    database,
  );

  await sql`
    create table simulation.scenario (
      id uuid primary key,
      name text not null,
      description text not null default '',
      version integer not null default 1,
      status text not null default 'DRAFT',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint scenario_name_check check (btrim(name) <> ''),
      constraint scenario_version_check check (version >= 1),
      constraint scenario_status_check check (status in ('DRAFT','READY','ARCHIVED'))
    )
  `.execute(database);

  await sql`
    create table simulation.scenario_action (
      id uuid primary key,
      scenario_id uuid not null,
      sequence integer not null,
      mobility_entity_id uuid not null,
      action_type text not null,
      availability text,
      reason text not null,
      parameters_json jsonb not null default '{}'::jsonb,
      constraint scenario_action_scenario_fk foreign key (scenario_id)
        references simulation.scenario (id) on delete restrict,
      constraint scenario_action_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint scenario_action_unique unique (scenario_id, sequence),
      constraint scenario_action_sequence_check check (sequence >= 0),
      constraint scenario_action_type_check check (
        action_type in ('SET_AVAILABILITY','BLOCK_ENTITY','DEGRADE_ENTITY','RESTORE_ENTITY')
      ),
      constraint scenario_action_availability_check check (
        availability is null or availability in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint scenario_action_consistency_check check (
        (action_type = 'SET_AVAILABILITY' and availability is not null)
        or (action_type <> 'SET_AVAILABILITY' and availability is null)
      ),
      constraint scenario_action_reason_check check (btrim(reason) <> ''),
      constraint scenario_action_parameters_check check (jsonb_typeof(parameters_json) = 'object')
    )
  `.execute(database);

  await sql`
    create table simulation.run (
      id uuid primary key,
      scenario_id uuid not null,
      network_snapshot_id uuid not null,
      status text not null,
      idempotency_key text not null,
      request_hash text not null,
      configuration_json jsonb not null,
      engine_version text not null,
      provenance_ref text not null,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      completed_at timestamptz,
      failure_code text,
      runtime_ms double precision,
      constraint simulation_run_scenario_fk foreign key (scenario_id)
        references simulation.scenario (id) on delete restrict,
      constraint simulation_run_snapshot_fk foreign key (network_snapshot_id)
        references twin.network_snapshot (id) on delete restrict,
      constraint simulation_run_idempotency_unique unique (scenario_id, idempotency_key),
      constraint simulation_run_status_check check (status in ('PENDING','RUNNING','COMPLETED','FAILED')),
      constraint simulation_run_json_check check (jsonb_typeof(configuration_json) = 'object'),
      constraint simulation_run_reference_check check (
        btrim(idempotency_key) <> '' and btrim(request_hash) <> '' and
        btrim(engine_version) <> '' and btrim(provenance_ref) <> ''
      ),
      constraint simulation_run_runtime_check check (runtime_ms is null or runtime_ms >= 0),
      constraint simulation_run_terminal_check check (
        (status = 'COMPLETED' and completed_at is not null and failure_code is null)
        or (status = 'FAILED' and completed_at is not null and failure_code is not null)
        or status in ('PENDING','RUNNING')
      )
    )
  `.execute(database);
  await sql`create index simulation_run_snapshot_idx on simulation.run (network_snapshot_id, created_at desc)`.execute(
    database,
  );

  await sql`
    create table simulation.state_override (
      id uuid primary key,
      simulation_run_id uuid not null,
      mobility_entity_id uuid not null,
      base_state text not null,
      override_state text not null,
      evidence_type text not null default 'SIMULATED',
      action_id uuid not null,
      reason text not null,
      constraint state_override_run_fk foreign key (simulation_run_id)
        references simulation.run (id) on delete restrict,
      constraint state_override_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint state_override_action_fk foreign key (action_id)
        references simulation.scenario_action (id) on delete restrict,
      constraint state_override_unique unique (simulation_run_id, mobility_entity_id),
      constraint state_override_base_check check (
        base_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint state_override_state_check check (
        override_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint state_override_simulated_check check (evidence_type = 'SIMULATED'),
      constraint state_override_reason_check check (btrim(reason) <> '')
    )
  `.execute(database);

  await sql`
    create table simulation.impact_result (
      id uuid primary key,
      simulation_run_id uuid not null unique,
      directly_affected_count integer not null,
      overridden_entity_count integer not null,
      components_before integer not null,
      components_after integer not null,
      connectivity_loss integer not null,
      isolated_entity_count integer not null,
      affected_route_count integer not null,
      affected_segment_count integer not null,
      unresolved_entity_count integer not null,
      result_hash text not null,
      provenance_ref text not null,
      engine_version text not null,
      runtime_ms double precision not null,
      created_at timestamptz not null default now(),
      constraint simulation_impact_run_fk foreign key (simulation_run_id)
        references simulation.run (id) on delete restrict,
      constraint simulation_impact_counts_check check (
        directly_affected_count >= 0 and overridden_entity_count >= 0 and
        components_before >= 0 and components_after >= 0 and connectivity_loss >= 0 and
        isolated_entity_count >= 0 and affected_route_count >= 0 and
        affected_segment_count >= 0 and unresolved_entity_count >= 0 and runtime_ms >= 0
      ),
      constraint simulation_impact_reference_check check (
        btrim(result_hash) <> '' and btrim(provenance_ref) <> '' and btrim(engine_version) <> ''
      )
    )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists simulation.impact_result`.execute(database);
  await sql`drop table if exists simulation.state_override`.execute(database);
  await sql`drop table if exists simulation.run`.execute(database);
  await sql`drop table if exists simulation.scenario_action`.execute(database);
  await sql`drop table if exists simulation.scenario`.execute(database);
  await sql`drop table if exists disruption.entity_impact`.execute(database);
  await sql`drop table if exists disruption.impact_analysis`.execute(database);
  await sql`drop table if exists disruption.event`.execute(database);
}
