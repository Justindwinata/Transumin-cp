import { sql, type Kysely } from 'kysely';

/**
 * Phase 2B stores source observations append-only, projects one current state
 * per mobility entity, and freezes sparse effective state into immutable
 * network snapshots. A missing snapshot-state row is explicitly UNKNOWN.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    create table twin.operational_observation (
      id uuid primary key,
      incident_id uuid not null,
      mobility_entity_id uuid,
      source_id uuid not null,
      source_classification text not null,
      affected_entity_refs jsonb not null default '[]'::jsonb,
      affected_modes jsonb not null default '[]'::jsonb,
      incident_type text not null,
      operational_state text not null,
      evidence_type text not null,
      source_authority text not null,
      source_channel text not null,
      impact_basis text not null,
      observed_at timestamptz not null,
      received_at timestamptz not null,
      updated_at timestamptz not null,
      expires_at timestamptz not null,
      reason text not null,
      confidence_status text not null,
      confidence double precision,
      raw_reference text not null,
      lineage_reference text not null,
      retrieved_at timestamptz not null,
      source_attributes jsonb not null default '{}'::jsonb,
      supersedes_observation_id uuid,
      dedupe_key text not null unique,
      constraint operational_observation_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint operational_observation_supersedes_fk foreign key (supersedes_observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint operational_observation_state_check check (
        operational_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint operational_observation_evidence_check check (
        evidence_type in ('SCHEDULED','OBSERVED','LIVE','FORECAST','SIMULATED','ESTIMATED')
      ),
      constraint operational_observation_incident_check check (
        incident_type in ('FLOOD','STATION_CLOSURE','STOP_CLOSURE','SERVICE_SUSPENSION','SERVICE_TRUNCATION','ROUTE_DIVERSION','INFRASTRUCTURE_FAILURE','WEATHER_DISRUPTION','MANUAL_OPERATOR_INCIDENT','OTHER')
      ),
      constraint operational_observation_authority_check check (
        source_authority in ('OFFICIAL_MACHINE','OFFICIAL_OPERATOR_CONFIRMED','OFFICIAL_PUBLIC_UPDATE','VERIFIED_GOVERNMENT_OR_DISRUPTION','CROWDSOURCED_OBSERVATION','FORECAST','SIMULATION')
      ),
      constraint operational_observation_channel_check check (
        source_channel in ('MACHINE_FEED','OPERATOR_CONFIRMED','PUBLIC_INFORMATION','ENVIRONMENTAL_OBSERVATION','CROWDSOURCED','FORECAST_MODEL','CONTROLLED_SIMULATION','AI_EXTRACTED_CANDIDATE')
      ),
      constraint operational_observation_basis_check check (
        impact_basis in ('DIRECT_OPERATIONAL_REPORT','OPERATOR_CONFIRMED','ENVIRONMENTAL_INDICATOR','FORECAST_INDICATOR','CONTROLLED_SIMULATION')
      ),
      constraint operational_observation_classification_check check (
        source_classification in ('VERIFIED_PUBLIC_API','VERIFIED_PUBLIC_FEED','VERIFIED_PUBLIC_INFORMATION','PARTNERSHIP_REQUIRED','AUTOMATION_RESTRICTED','NOT_AVAILABLE','UNKNOWN')
      ),
      constraint operational_observation_confidence_status_check check (
        confidence_status in ('CONFIRMED','SOURCE_REPORTED','EXTRACTED_CANDIDATE','UNVERIFIED','SIMULATED')
      ),
      constraint operational_observation_temporal_check check (
        observed_at <= received_at and received_at <= updated_at and observed_at < expires_at
      ),
      constraint operational_observation_confidence_check check (
        confidence is null or (confidence >= 0 and confidence <= 1)
      ),
      constraint operational_observation_json_check check (
        jsonb_typeof(affected_entity_refs) = 'array' and
        jsonb_typeof(affected_modes) = 'array' and
        jsonb_typeof(source_attributes) = 'object'
      ),
      constraint operational_observation_live_check check (
        evidence_type <> 'LIVE' or (
          source_authority = 'OFFICIAL_MACHINE' and
          source_channel = 'MACHINE_FEED' and
          source_classification in ('VERIFIED_PUBLIC_API','VERIFIED_PUBLIC_FEED')
        )
      ),
      constraint operational_observation_environment_check check (
        operational_state <> 'UNAVAILABLE' or
        impact_basis not in ('ENVIRONMENTAL_INDICATOR','FORECAST_INDICATOR')
      ),
      constraint operational_observation_reference_check check (
        btrim(raw_reference) <> '' and btrim(lineage_reference) <> '' and btrim(reason) <> ''
      )
    )
  `.execute(database);
  await sql`
    create index operational_observation_entity_time_idx
      on twin.operational_observation (mobility_entity_id, observed_at desc, received_at desc)
  `.execute(database);
  await sql`
    create index operational_observation_expiry_idx
      on twin.operational_observation (mobility_entity_id, expires_at)
  `.execute(database);
  await sql`
    create index operational_observation_source_idx
      on twin.operational_observation (source_id, received_at desc)
  `.execute(database);
  await sql`
    create function twin.prevent_operational_observation_mutation()
    returns trigger language plpgsql as $function$
    begin
      raise exception 'OPERATIONAL_OBSERVATION_APPEND_ONLY';
    end;
    $function$
  `.execute(database);
  await sql`
    create trigger operational_observation_append_only
      before update or delete on twin.operational_observation
      for each row execute function twin.prevent_operational_observation_mutation()
  `.execute(database);

  await sql`
    create table twin.mobility_state (
      id uuid primary key,
      mobility_entity_id uuid not null unique,
      operational_state text not null,
      evidence_type text,
      freshness_status text not null,
      observation_id uuid,
      source_id uuid,
      observed_at timestamptz,
      expires_at timestamptz,
      confidence_status text,
      confidence double precision,
      provenance_ref text,
      state_as_of timestamptz not null,
      projection_version text not null,
      updated_at timestamptz not null default now(),
      state_fingerprint text not null,
      constraint mobility_state_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint mobility_state_observation_fk foreign key (observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint mobility_state_state_check check (
        operational_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint mobility_state_evidence_check check (
        evidence_type is null or evidence_type in ('SCHEDULED','OBSERVED','LIVE','FORECAST','SIMULATED','ESTIMATED')
      ),
      constraint mobility_state_freshness_check check (
        freshness_status in ('FRESH','AGING','STALE','EXPIRED','UNKNOWN','NOT_YET_VALID')
      ),
      constraint mobility_state_confidence_check check (
        confidence is null or (confidence >= 0 and confidence <= 1)
      ),
      constraint mobility_state_unknown_check check (
        operational_state <> 'UNKNOWN' or observation_id is null or evidence_type is not null
      )
    )
  `.execute(database);
  await sql`
    create index mobility_state_state_idx
      on twin.mobility_state (operational_state, freshness_status)
  `.execute(database);

  await sql`
    create table twin.mobility_state_history (
      id uuid primary key,
      mobility_entity_id uuid not null,
      previous_state text,
      new_state text not null,
      effective_at timestamptz not null,
      triggering_observation_id uuid,
      evidence_type text,
      freshness_status text not null,
      source_id uuid,
      provenance_ref text,
      reason text not null,
      projection_version text not null,
      transition_fingerprint text not null unique,
      created_at timestamptz not null default now(),
      constraint mobility_state_history_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint mobility_state_history_observation_fk foreign key (triggering_observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint mobility_state_history_state_check check (
        new_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN') and
        (previous_state is null or previous_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN'))
      ),
      constraint mobility_state_history_freshness_check check (
        freshness_status in ('FRESH','AGING','STALE','EXPIRED','UNKNOWN','NOT_YET_VALID')
      ),
      constraint mobility_state_history_change_check check (previous_state is null or previous_state <> new_state),
      constraint mobility_state_history_reason_check check (btrim(reason) <> '')
    )
  `.execute(database);
  await sql`
    create index mobility_state_history_entity_time_idx
      on twin.mobility_state_history (mobility_entity_id, effective_at desc)
  `.execute(database);

  await sql`
    create table twin.network_snapshot (
      id uuid primary key,
      transit_dataset_version_id uuid not null,
      spatial_dataset_version_id uuid not null,
      processing_version text not null,
      state_cutoff_at timestamptz not null,
      configuration_json jsonb not null default '{}'::jsonb,
      manifest_ref text not null,
      content_hash text not null unique,
      status text not null default 'DRAFT',
      created_at timestamptz not null default now(),
      finalized_at timestamptz,
      constraint network_snapshot_transit_fk foreign key (transit_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint network_snapshot_spatial_fk foreign key (spatial_dataset_version_id)
        references meta.dataset_version (id) on delete restrict,
      constraint network_snapshot_status_check check (status in ('DRAFT','FINALIZED')),
      constraint network_snapshot_configuration_check check (jsonb_typeof(configuration_json) = 'object'),
      constraint network_snapshot_manifest_check check (btrim(manifest_ref) <> ''),
      constraint network_snapshot_finalized_check check (
        (status = 'DRAFT' and finalized_at is null) or (status = 'FINALIZED' and finalized_at is not null)
      )
    )
  `.execute(database);
  await sql`
    create function twin.prevent_finalized_snapshot_mutation()
    returns trigger language plpgsql as $function$
    begin
      if old.status = 'FINALIZED' then
        raise exception 'FINALIZED_NETWORK_SNAPSHOT_IMMUTABLE';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`
    create trigger network_snapshot_immutable_update
      before update or delete on twin.network_snapshot
      for each row execute function twin.prevent_finalized_snapshot_mutation()
  `.execute(database);

  await sql`
    create table twin.network_snapshot_state (
      id uuid primary key,
      snapshot_id uuid not null,
      mobility_entity_id uuid not null,
      operational_state text not null,
      evidence_type text,
      freshness_status text not null,
      observation_id uuid,
      source_id uuid,
      observed_at timestamptz,
      expires_at timestamptz,
      confidence_status text,
      confidence double precision,
      provenance_ref text,
      state_as_of timestamptz not null,
      state_fingerprint text not null,
      constraint network_snapshot_state_snapshot_fk foreign key (snapshot_id)
        references twin.network_snapshot (id) on delete restrict,
      constraint network_snapshot_state_entity_fk foreign key (mobility_entity_id)
        references twin.mobility_entity (id) on delete restrict,
      constraint network_snapshot_state_observation_fk foreign key (observation_id)
        references twin.operational_observation (id) on delete restrict,
      constraint network_snapshot_state_unique unique (snapshot_id, mobility_entity_id),
      constraint network_snapshot_state_state_check check (
        operational_state in ('AVAILABLE','DEGRADED','DISRUPTED','UNAVAILABLE','RECOVERING','UNKNOWN')
      ),
      constraint network_snapshot_state_freshness_check check (
        freshness_status in ('FRESH','AGING','STALE','EXPIRED','UNKNOWN','NOT_YET_VALID')
      ),
      constraint network_snapshot_state_confidence_check check (
        confidence is null or (confidence >= 0 and confidence <= 1)
      )
    )
  `.execute(database);
  await sql`
    create index network_snapshot_state_entity_idx
      on twin.network_snapshot_state (mobility_entity_id, snapshot_id)
  `.execute(database);
  await sql`
    create function twin.prevent_finalized_snapshot_state_mutation()
    returns trigger language plpgsql as $function$
    begin
      if exists (
        select 1 from twin.network_snapshot
        where id = case when tg_op = 'DELETE' then old.snapshot_id else new.snapshot_id end
          and status = 'FINALIZED'
      ) then
        raise exception 'FINALIZED_NETWORK_SNAPSHOT_STATE_IMMUTABLE';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $function$
  `.execute(database);
  await sql`
    create trigger network_snapshot_state_immutable_update
      before insert or update or delete on twin.network_snapshot_state
      for each row execute function twin.prevent_finalized_snapshot_state_mutation()
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists network_snapshot_state_immutable_update on twin.network_snapshot_state`.execute(
    database,
  );
  await sql`drop function if exists twin.prevent_finalized_snapshot_state_mutation()`.execute(
    database,
  );
  await sql`drop table if exists twin.network_snapshot_state`.execute(database);
  await sql`drop trigger if exists network_snapshot_immutable_update on twin.network_snapshot`.execute(
    database,
  );
  await sql`drop function if exists twin.prevent_finalized_snapshot_mutation()`.execute(
    database,
  );
  await sql`drop table if exists twin.network_snapshot`.execute(database);
  await sql`drop table if exists twin.mobility_state_history`.execute(database);
  await sql`drop index if exists twin.mobility_state_state_idx`.execute(
    database,
  );
  await sql`drop table if exists twin.mobility_state`.execute(database);
  await sql`drop index if exists twin.operational_observation_entity_time_idx`.execute(
    database,
  );
  await sql`drop index if exists twin.operational_observation_expiry_idx`.execute(
    database,
  );
  await sql`drop index if exists twin.operational_observation_source_idx`.execute(
    database,
  );
  await sql`drop trigger if exists operational_observation_append_only on twin.operational_observation`.execute(
    database,
  );
  await sql`drop function if exists twin.prevent_operational_observation_mutation()`.execute(
    database,
  );
  await sql`drop table if exists twin.operational_observation`.execute(
    database,
  );
}
