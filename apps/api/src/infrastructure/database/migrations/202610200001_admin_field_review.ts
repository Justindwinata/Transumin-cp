import { sql, type Kysely } from 'kysely';

/** ADR-010: additive trust policy; never rewrites or deletes historical evidence. */
export async function up<DB>(db: Kysely<DB>): Promise<void> {
  await sql`alter table twin.operational_observation drop constraint operational_observation_authority_check,
    add constraint operational_observation_authority_check check (source_authority in ('OFFICIAL_MACHINE','OFFICIAL_OPERATOR_CONFIRMED','OFFICIAL_PUBLIC_UPDATE','VERIFIED_GOVERNMENT_OR_DISRUPTION','CROWDSOURCED_OBSERVATION','FORECAST','SIMULATION','ADMIN_FIELD_REVIEW')),
    drop constraint operational_observation_channel_check,
    add constraint operational_observation_channel_check check (source_channel in ('MACHINE_FEED','OPERATOR_CONFIRMED','PUBLIC_INFORMATION','ENVIRONMENTAL_OBSERVATION','CROWDSOURCED','FORECAST_MODEL','CONTROLLED_SIMULATION','AI_EXTRACTED_CANDIDATE','ADMIN_REVIEW'))`.execute(
    db,
  );
  await sql`alter table twin.operational_observation add constraint operational_observation_admin_review_check check (
    (source_authority <> 'ADMIN_FIELD_REVIEW' and source_channel <> 'ADMIN_REVIEW') or (
      source_authority='ADMIN_FIELD_REVIEW' and source_channel='ADMIN_REVIEW' and evidence_type='OBSERVED'
      and impact_basis='DIRECT_OPERATIONAL_REPORT' and confidence is null
      and observed_at >= received_at - interval '30 minutes'
      and expires_at >= received_at + interval '5 minutes' and expires_at <= received_at + interval '60 minutes'
    ))`.execute(db);
  await sql`alter table disruption.operational_incident drop constraint operational_incident_source_class_check,
    add constraint operational_incident_source_class_check check (source_class in ('SIMULATED','MANUAL_VERIFIED','GTFS_RT','AUTHORIZED_OPERATOR_API','ADMIN_FIELD_REVIEW')),
    add constraint operational_incident_admin_field_check check ((source_class <> 'ADMIN_FIELD_REVIEW' and source_authority <> 'ADMIN_FIELD_REVIEW' and source_channel <> 'ADMIN_REVIEW') or (
      source_class='ADMIN_FIELD_REVIEW' and source_authority='ADMIN_FIELD_REVIEW' and source_channel='ADMIN_REVIEW' and evidence_type='OBSERVED'
      and effective_from=received_at and observed_at >= received_at - interval '30 minutes'
      and expires_at >= effective_from + interval '5 minutes' and expires_at <= effective_from + interval '60 minutes'))`.execute(
    db,
  );
  await sql`alter table report.passenger_report drop constraint passenger_report_status_check,
    add constraint passenger_report_status_check check (verification_status in ('REPORTED_UNVERIFIED','CONTROLLED_VERIFIED','ADMIN_RESTRICTED'))`.execute(
    db,
  );
  await sql`alter table report.passenger_report_review
    add column review_authority text not null default 'CONTROLLED_SIMULATION',
    add column actor_user_id uuid references auth.user_account(id) on delete restrict,
    add column supporting_reference text,
    add constraint passenger_review_authority_check check (
      (review_authority='CONTROLLED_SIMULATION' and actor_user_id is null and supporting_reference is null)
      or (review_authority='ADMIN_FIELD_REVIEW' and actor_user_id is not null and supporting_reference is not null and char_length(btrim(supporting_reference)) between 1 and 1000)
    )`.execute(db);
}
export async function down<DB>(db: Kysely<DB>): Promise<void> {
  // Refuse before changing schema if downgrade would erase new authority/audit.
  await sql`do $body$ begin
    if exists(select 1 from report.passenger_report_review where review_authority='ADMIN_FIELD_REVIEW')
      or exists(select 1 from disruption.operational_incident where source_class='ADMIN_FIELD_REVIEW')
      or exists(select 1 from twin.operational_observation where source_authority='ADMIN_FIELD_REVIEW' or source_channel='ADMIN_REVIEW')
      or exists(select 1 from report.passenger_report where verification_status='ADMIN_RESTRICTED')
    then raise exception 'ADMIN_FIELD_REVIEW_DOWNGRADE_REQUIRES_FORWARD_RECOVERY'; end if;
  end $body$`.execute(db);
  await sql`alter table report.passenger_report_review drop constraint passenger_review_authority_check,
    drop column supporting_reference, drop column actor_user_id, drop column review_authority`.execute(
    db,
  );
  await sql`alter table report.passenger_report drop constraint passenger_report_status_check,
    add constraint passenger_report_status_check check (verification_status in ('REPORTED_UNVERIFIED','CONTROLLED_VERIFIED'))`.execute(
    db,
  );
  await sql`alter table disruption.operational_incident drop constraint operational_incident_admin_field_check,
    drop constraint operational_incident_source_class_check,
    add constraint operational_incident_source_class_check check (source_class in ('SIMULATED','MANUAL_VERIFIED','GTFS_RT','AUTHORIZED_OPERATOR_API'))`.execute(
    db,
  );
  await sql`alter table twin.operational_observation drop constraint operational_observation_admin_review_check`.execute(
    db,
  );
  await sql`alter table twin.operational_observation drop constraint operational_observation_authority_check,
    add constraint operational_observation_authority_check check (source_authority in ('OFFICIAL_MACHINE','OFFICIAL_OPERATOR_CONFIRMED','OFFICIAL_PUBLIC_UPDATE','VERIFIED_GOVERNMENT_OR_DISRUPTION','CROWDSOURCED_OBSERVATION','FORECAST','SIMULATION')),
    drop constraint operational_observation_channel_check,
    add constraint operational_observation_channel_check check (source_channel in ('MACHINE_FEED','OPERATOR_CONFIRMED','PUBLIC_INFORMATION','ENVIRONMENTAL_OBSERVATION','CROWDSOURCED','FORECAST_MODEL','CONTROLLED_SIMULATION','AI_EXTRACTED_CANDIDATE'))`.execute(
    db,
  );
}
