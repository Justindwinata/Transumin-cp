# R7 DATABASE FINAL SIGNOFF — empty snapshot membership

Scope: read-only signoff on existing empty membership finding in
`.release-evidence/r7-closure-db-readonly.log` (snapshot_id group-by -> 0 rows).
Repo root `/Users/justindwinata/Developer/TRANSUMIN-NEXUS-PRODUCT`.
New evidence: `.release-evidence/r7-membership-final-20261016.log`
(all blocks `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`; secrets omitted).
Changed owned files: this doc + evidence log only. No shared writes/DDL/reset,
no credential rotation. Reused prior closure evidence; no mutable test rerun.

## Canonical lineage traced

- DATABASE-CONTRACT-V1 row `twin.network_snapshot_state`: sparse membership;
  absence means `UNKNOWN`. Finalized membership rejects insert/update/delete.
- HYBRID-MOBILITY-TWIN-ARCHITECTURE: snapshot binds dataset versions + cutoff +
  processing version + canonical config + manifest + SHA-256 identity;
  `twin.network_snapshot_state` sparse rows; missing rows = `UNKNOWN`;
  finalized metadata/membership immutable via triggers.
- Migration `202610010001_hybrid_mobility_twin.ts`: creates
  `twin.network_snapshot_state` with
  `network_snapshot_state_unique (snapshot_id, mobility_entity_id)`,
  `...snapshot_fk` / `...entity_fk` / `...observation_fk` (all RESTRICT),
  plus finalized-state immutability trigger (FINALIZED raises
  `FINALIZED_NETWORK_SNAPSHOT_STATE_IMMUTABLE`).
- Writer `kysely-mobility-state.repository.ts createSnapshot()`: gathers only
  observations qualifying at cutoff (observed+received <= cutoff and
  expires > cutoff), projects effective states, hashes sorted states into
  content, inserts snapshot DRAFT -> membership rows -> FINALIZED.
  Reader `loadSnapshot()`: LEFT JOIN count serves as materialized-state count.
- Downstream reader `disruption-intelligence.service.ts`: LEFT JOINs
  `twin.network_snapshot_state` (base state optional); absence handled as unknown.
- Reports/passenger lineage separate: migration `202610120002`
  adds independent `journey.activation_receipt` (owner+idempotency key);
  `202610120003` adds `report.passenger_report` outside operational evidence.
  "OTP" in this repo = OpenTripPlanner routing engine (`RoutingPort` adapter),
  not one-time-password nor API key store. No OTP/API-secret table found;
  activation/receipt lineage unaffected by snapshot membership.

## Verified snapshot + version joins (evidence log)

- Snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f` FINALIZED,
  cutoff `2026-09-30 14:18:00+00`, finalized `2026-10-12 09:44:22`,
  processing `PHASE_2B_V1`, manifest
  `data/manifests/PHASE-2-BASE-NETWORK-SNAPSHOT.json`, content
  `b9b44f9d04d236d86bec0ad1b97447e35c53b64a0bfdfeb379881279056ac6f7`.
- Dataset joins intact: transit `transjakarta-official-gtfs-static`
  `retrieved-2026-09-29T030831Z-63b4fb14d9af` status WARNING;
  spatial `geofabrik-java-openstreetmap`
  `geofabrik-java-20260929-jabodetabek-ffb2269b1b9c` status VALID;
  checksums/retrieved_at present.
- Journey lineage: 318 plans link `network_snapshot_id` to snapshot;
  single group `service_date 2026-10-02`, `Asia/Jakarta`,
  `routing_snapshot_id phase4b-a-router-input-20261002-v2`;
  `network_snapshot_hash = content_hash` matches for all 318 (`hashes_match t`).
- Version-service-date link therefore verified at plan level, not state level.

## Empty membership root cause (executed evidence, not claim)

- `twin.network_snapshot_state GROUP BY snapshot_id`: 0 rows (both snapshots).
  LEFT JOIN materialized count for `43fb...`: 0.
- Observation window: 164 rows, earliest `observed_at 2026-10-02 01:04`,
  earliest `received_at 2026-10-12 09:50`. Cutoff `2026-09-30 14:18` precedes
  every observation. Qualifying-at-cutoff count: 0.
- Projection rules require qualifying evidence; no qualifying evidence -> no
  authored rows -> sparse-membership semantics say UNKNOWN.
- Membership therefore OPTIONAL by contract: empty set is legal base truth
  (all-UNKNOWN). It is not proof of data loss; writer only persists qualifying
  projections, immutability trigger blocks later backfill into FINALIZED row.
- It remains REQUIRED-as-evidence for any claim needing preserved sparse
  states: empty join cannot demonstrate sparse-state preservation.

## Affected / unaffected capabilities

- Unaffected: dataset-version provenance joins; 318 journey-plan lineage +
  hash consistency; service-date/timezone/routing-input grouping;
  journey/recovery/activation/report tables and FK lineage;
  historical impact store (3255 impacts, all expired, 3246 resolved, retained);
  current-dependency hygiene (0 rows, 0 expired/resolved joins).
- Affected/limited: sparse-state preservation proof absent; snapshot used as
  base-state identity, not as materialized per-entity state source;
  downstream readers fall back to UNKNOWN base unless live/current state
  supplies condition.
- Second snapshot `bb73a8c4...` (FINALIZED `2026-10-13`, placeholder zero hash
  `bbbb...`) also has 0 membership rows; same optional-membership reading.

## NOT VALID + historical classifications

- Only NOT VALID constraint: `disruption.event`
  `disruption_event_hazard_evidence_check` (`convalidated f`);
  full CHECK text captured in evidence log. `disruption.event` holds 0 rows,
  so hazard behavior unexercised; no existing-row violation possible.
  Deployment risk: any row insert violating CHECK fails; flood-type rows need
  observed/expires interval + classification + UNKNOWN state. Historical rows
  cannot be trusted as validated until constraint validated.
- Historical expiry: `journey_impact` 3255 total / 3255 expired / 3246
  resolved = retained history, not live state. `current_impact_dependency`
  0 rows and 0 expired/resolved joins = no stale live dependency.
  Counts do not prove historical dependency preservation.
- Historical status: RETAIN_PENDING_PO_DECISION. No deletion/repair/validation
  executed in this read-only task.

## Classification (honest)

- STRUCTURE_READY: PASS for executed catalog/FK/immutability-definition scope.
- SNAPSHOT_COMPATIBLE: CONDITIONAL PASS — metadata + dataset + plan lineage
  verified; membership empty limits sparse-state proof.
- TRANSACTIONAL_INTEGRITY_VERIFIED: PASS only for executed read-only joins;
  not full lineage review.
- APPLICATION_INTEGRATION_VERIFIED: reused prior Stage G/R7 evidence only;
  no mutable test executed here.
- HISTORICAL_STATE_ACCEPTANCE_PENDING: PENDING — impacts stored, dependency
  preservation unproven.
- OPERATIONAL_DATABASE_READY: CONDITIONAL — checked invariants clean; not
  unconditional while hazard constraint NOT VALID, `disruption.event` empty,
  membership empty.

## Limitations

- Read-only: no writes/DDL/validation/repair/cleanup/mutable tests.
- Prior closure log reused for schema/migration/geometry/FK breadth; this task
  re-verified only scoped joins above.
- No secrets recorded; credentials untouched.
- Second snapshot placeholder hash not investigated beyond membership count.
- No row-by-row immutable lineage review; FK checks bounded to executed paths.

## Read-only proposed validation plan (UNEXECUTED, PO decision required)

1. PO authorizes disposable DB copy (never shared/prod DB).
2. On copy only: ingest or stage at least one observation qualifying before
   snapshot cutoff, create DRAFT snapshot via canonical writer, verify
   membership rows + content hash + FINALIZED immutability trigger rejection.
3. On copy only: insert controlled hazard/non-hazard `disruption.event` rows,
   validate NOT VALID constraint with `VALIDATE CONSTRAINT`, record result.
4. On copy only: exercise current-dependency insert/read expiry guard and
   owner-scope path from `kysely-active-journey.repository.ts`.
5. Report PASS only with executed copy evidence; keep shared DB read-only.
