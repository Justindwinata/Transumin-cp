-- ADR-010: separate loopback admin-review process role only.
-- Apply passenger-runtime-grants.sql to this separate role first for shared
-- authenticated product reads/writes. Never apply these additions to the
-- passenger/API role. No DELETE, raw ingestion, schema CREATE, ownership,
-- elevated role flags or memberships. Product rollout still requires approval.
BEGIN;
GRANT SELECT ON report.passenger_report_review, report.passenger_report_verification,
  disruption.operational_incident_entity TO :"runtime_role";
GRANT INSERT ON report.passenger_report_review, report.passenger_report_verification,
  disruption.operational_incident, disruption.operational_incident_entity,
  disruption.operational_incident_journal, twin.operational_observation,
  twin.mobility_state, twin.mobility_state_history TO :"runtime_role";
GRANT UPDATE (verification_status) ON report.passenger_report TO :"runtime_role";
GRANT UPDATE (id) ON report.passenger_report TO :"runtime_role";
GRANT UPDATE (journey_id) ON journey.active_journey TO :"runtime_role";
-- Lifecycle revision serialization uses SELECT FOR UPDATE; PostgreSQL needs
-- UPDATE privilege on one column even though this lock does not modify it.
GRANT UPDATE (id) ON disruption.operational_incident_journal TO :"runtime_role";
GRANT UPDATE (lifecycle_status, effective_to, updated_at) ON disruption.operational_incident TO :"runtime_role";
GRANT UPDATE (operational_state, evidence_type, freshness_status, observation_id,
 source_id, observed_at, expires_at, confidence_status, confidence, provenance_ref,
 state_as_of, projection_version, updated_at, state_fingerprint) ON twin.mobility_state TO :"runtime_role";
COMMIT;
