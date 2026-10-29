-- FUTURE ROLLOUT TEMPLATE ONLY. Never execute as part of development/rehearsal.
-- Run with psql -X -v ON_ERROR_STOP=1 -v runtime_role=<existing_role> -v database_name=<current_database>.
-- Connect to the target database as its authorized owner; verify target identity first.
-- Provision role and credentials out-of-band (secret manager/DBA); no role creation,
-- password, or credential rotation here. Runtime role must remain separate from
-- migration/owner identity. Reassess explicit table allowlist after migrations.
-- NOT DEPLOYMENT-VERIFIED: owner must audit existing/PUBLIC privileges, function
-- EXECUTE/SECURITY DEFINER exposure, schema ownership and runtime startup writers
-- before approval. Additive grants do not remove pre-existing grants. No blanket
-- default privileges, sequence grants (UUID identities), DELETE, or ingestion DML.
-- Database/schema CREATE revokes affect other users of this target: approve first.
-- Rollback requires recorded pre-change ACLs; do not restore PUBLIC CREATE blindly.
-- Passenger review/verification writes deliberately excluded: controlled review disabled.
-- Runtime SQL reviewed: transit-place-search.service.ts, OTP routing adapter,
-- routing identity bridge, active-journey/recovery repositories, passenger-report
-- service, and migrations through 202610130002 (including invoker trigger writes).

\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \echo 'runtime_role required'
  \quit
\endif
\if :{?database_name}
\else
  \echo 'database_name required'
  \quit
\endif

BEGIN;

-- psql does not interpolate inside dollar-quoted bodies.
SELECT set_config('passenger_grants.runtime_role', :'runtime_role', true),
       set_config('passenger_grants.database_name', :'database_name', true);
DO $guard$
DECLARE
  target_role text := current_setting('passenger_grants.runtime_role');
  target_database text := current_setting('passenger_grants.database_name');
  role_flags record;
  database_owner name;
BEGIN
  IF target_database <> current_database() THEN
    RAISE EXCEPTION 'database_name must match current_database()';
  END IF;
  SELECT pg_get_userbyid(datdba) INTO database_owner
    FROM pg_database WHERE datname = target_database;
  IF database_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'current user must own database_name';
  END IF;
  IF target_role IS NULL OR target_role = '' OR target_role = 'public'
     OR target_role !~ '^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$' THEN
    RAISE EXCEPTION 'invalid runtime_role name';
  END IF;
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    INTO role_flags FROM pg_roles WHERE rolname = target_role;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime role must already exist'; END IF;
  IF role_flags.rolsuper OR role_flags.rolcreatedb OR role_flags.rolcreaterole
     OR role_flags.rolreplication OR role_flags.rolbypassrls THEN
    RAISE EXCEPTION 'runtime role has prohibited elevated flags';
  END IF;
  IF target_role = current_user OR EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = target_role
  ) THEN
    RAISE EXCEPTION 'runtime role must be separate and have no role memberships';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database WHERE datname = target_database
      AND pg_get_userbyid(datdba) = target_role
    UNION ALL
    SELECT 1 FROM pg_namespace WHERE pg_get_userbyid(nspowner) = target_role
    UNION ALL
    SELECT 1 FROM pg_class WHERE pg_get_userbyid(relowner) = target_role
  ) THEN
    RAISE EXCEPTION 'runtime role must not own target database objects';
  END IF;
END
$guard$;

-- Scoped to connected database only; no global/default-privilege changes.
REVOKE CREATE ON DATABASE :"database_name" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO :"runtime_role";

-- Read-only access for passenger lookups and journey/recovery joins.
GRANT USAGE ON SCHEMA public, meta, transit, spatial, twin, disruption,
  simulation, journey, report, recovery, copilot, auth TO :"runtime_role";
GRANT SELECT ON
  meta.dataset_source, meta.dataset_version, meta.source_entity_reference,
  meta.entity_alias,
  transit.route, transit.station, transit.stop, transit.stop_time, transit.trip,
  transit.transit_segment,
  spatial.rail_topology_station, spatial.rail_topology_edge, spatial.walking_edge,
  simulation.scenario, simulation.scenario_action, simulation.run,
  simulation.impact_result, simulation.state_override,
  disruption.event, disruption.impact_analysis, disruption.entity_impact,
  twin.mobility_state, twin.mobility_state_history, twin.network_snapshot,
  twin.network_snapshot_state, twin.operational_observation,
  disruption.operational_incident, disruption.operational_incident_journal,
  disruption.source_health
TO :"runtime_role";
GRANT SELECT ON
  journey.activation_receipt,
  journey.journey_plan,
  journey.journey_leg,
  journey.journey_dependency,
  journey.active_journey,
  journey.journey_progress,
  journey.journey_impact,
  journey.journey_impact_dependency,
  journey.targeted_alert,
  journey.journey_state_event,
  journey.active_journey_dependency,
  journey.current_impact_dependency,
  recovery.recovery_plan,
  recovery.recovery_segment,
  recovery.recovery_acceptance,
  report.passenger_report,
  copilot.session, copilot.message, copilot.tool_audit,
  twin.mobility_entity,
  auth.user_account, auth.role_assignment, auth.session
TO :"runtime_role";

-- Product runtime writes only; research ingestion and controlled-review tables excluded.
GRANT SELECT ON auth.login_attempt TO :"runtime_role";
GRANT INSERT ON auth.login_attempt, auth.session, auth.user_account, auth.role_assignment TO :"runtime_role";
GRANT UPDATE (revoked_at) ON auth.session TO :"runtime_role";
GRANT UPDATE (success) ON auth.login_attempt TO :"runtime_role";

GRANT INSERT ON journey.activation_receipt, journey.journey_plan, journey.journey_leg,
  journey.journey_dependency, journey.active_journey, journey.journey_progress,
  journey.journey_state_event, journey.journey_impact,
  journey.journey_impact_dependency, journey.targeted_alert,
  journey.active_journey_dependency, journey.current_impact_dependency,
  recovery.recovery_plan, recovery.recovery_segment, recovery.recovery_acceptance,
  report.passenger_report,
  copilot.session, copilot.message, copilot.tool_audit
TO :"runtime_role";
GRANT INSERT ON copilot.session, copilot.message, copilot.tool_audit TO :"runtime_role";
GRANT UPDATE ON copilot.session TO :"runtime_role";
GRANT UPDATE ON journey.active_journey, journey.journey_progress,
  journey.journey_impact, journey.targeted_alert
TO :"runtime_role";

-- SELECT ... FOR UPDATE in acceptance serialization requires UPDATE privilege
-- on at least one column, even when no row is changed. Identity-only grants
-- avoid granting mutation of immutable proposal/acceptance payloads.
GRANT UPDATE (id) ON recovery.recovery_plan TO :"runtime_role";
GRANT UPDATE (recovery_id) ON recovery.recovery_acceptance TO :"runtime_role";

COMMIT;
