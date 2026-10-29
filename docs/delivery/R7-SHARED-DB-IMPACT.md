# R7 Shared DB Impact Inventory

Generated 2026-10-15 (host WIB). All DB queries executed READ ONLY. No SQL mutating statements were run. No rows changed. Database `transum_in_nexus_product` (`pg_database.oid` 16384) confirmed. Live concurrency noted: an unrelated harness-exploring agent session is active; time-window counts below are therefore reported per-referent, not only per clock window.

## Referent logs

- `.release-evidence/r7-v20-20261016-exec01.log` (stat 2026-10-15 11:51 WIB; filename date is 20261016 label)
- `.release-evidence/r7-m5-20261016-exec01.log`
- `.release-evidence/r7-m6-20261016-exec01.log`
- `.release-evidence/r7-m7-20261016-exec01.log`
- `.release-evidence/r7-gps-20261016-exec01.log`

All logs `status=PASS`. Log filenames use previous-day/rule date labels; host mtimes show actual execution on 2026-10-15. The `[case] ui-report-reporting-unverified-target-anchor` line in the V20 log references UUID `eff4490b-dc6d-41bf-8e03-3d2c8839eb79`; the `[case] activate-unique-uuid-anchored` line anchors active journey `d4af33bc-d94f-488b-ad50-30526496cdab`, matching the user-supplied key IDs.

## V20 journey d4af33bc-d94f-488b-ad50-30526496cdab

### Lifecycle
- `journey.active_journey`: `lifecycle_status=COMPLETED`, `activated_at=2026-10-02 01:29+00`, `completed_at=2026-10-02 03:14+00`, `recovery_accepted_at=2026-10-15 04:51:38.607+00`.
- `journey.journey_state_event` : 8 rows (ACTIVATED, BOARDED, ALIGHTED, PROGRESS_UPDATED ×3, COMPLETED, IMPACT_DETECTED 2026-10-15 04:51:37, RECOVERY_ACCEPTED 2026-10-15 04:51:38).
- `journey.journey_plan.id = d4af33bc…`, `network_snapshot_id=43fb9a29-0c89-5c72-882e-e3dc2adcfb1f (FINALIZED)`, `mobility_projection_version=PHASE_2B_V1`, `service_date=2026-10-02`.
- Owner role recorded only as `passenger:<opaque>` — masked in this report; owner cookie identities not read.

### Provenance per record (per-table row counts)
| table | rows | evidence_type | provenance |
|---|---|---|---|
| journey.journey_leg | 4 |  | |
| journey.journey_progress | 1 |  | `CONTROLLED_MANUAL` method |
| journey.journey_dependency | 16 |  | |
| journey.active_journey_dependency | 0 (post-completion cleared) |  | |
| journey.activation_receipt | 1 |  | |
| journey.journey_impact | 1 (`5c483086-9e4d-55d6-b9bd-f6698d5cd30c`) | SIMULATED | FRESH, simulated lifecycle resolved 04:51:40 |
| journey.journey_impact_dependency | 1 |  | |
| journey.targeted_alert | 1 (`f32f27ee-9fc0-5336-a826-c53663c1eacc`) | BLOCKING | resolved 04:51:40 |
| report.passenger_report | 1 (`eff4490b-dc6d-41bf-8e03-3d2c8839eb79`) | PASSENGER_SELF_REPORT, `verification_status=CONTROLLED_VERIFIED` | target entity `b96c53d4-07dc-5d1e-8d27-a6fadbdc8937` (ROUTE/KRL) |
| report.passenger_report_review | 1 (linked incident `84354aa5-7730-5a35-8813-c2adb0d351d2`) | SIMULATED, `sourceChannel=CONTROLLED_SIMULATION`, `sourceAuthority=SIMULATION` | |
| report.passenger_report_verification | 1 (`decision=VERIFIED`) | | reviewer alias retained in `passenger_report_review.reviewer_ref` |
| recovery.recovery_plan | 1 (`d13f0544-7252-5d6d-bf5d-2e71b0e64c63`), `status=COMPLETED`, `method=STATE_AWARE_REPAIR` | | |
| recovery.recovery_segment | 5 rows (1 COMPLETED, 2 INVALIDATED, 1 REPAIRED_REPLACED, 1 STILL_VALID) | | |
| recovery.recovery_acceptance | 1, `accepted_progress_revision=4` | | |

### Collection/detection window end
All journeys, reports, recoveries, incidents, reviews, verifications, alerts tied to `d4af33bc…` were produced in the 2026-10-15 04:51:37–04:51:40 UTC window. No later activity beyond the `recovery_accepted_at` 04:51:38.607 stamp.

### M6 journey d4cc28f5-68d9-4e7d-b636-483a46d28e9c
- `lifecycle_status=ACTIVE` (not COMPLETED).
- `journey.journey_state_event` = 7 rows ending in RECOVERY_ACCEPTED 2026-10-15 04:52:18.
- Per-table row counts: journey_leg=5, journey_dependency=23, active_journey_dependency=12 (still published), journey_impact=1, targeted_alert=1, activation_receipt=1, recovery_plan=1, recovery_segment=7 rows (2 COMPLETED, 2 INVALIDATED, 2 REPAIRED_REPLACED, 1 STILL_VALID), recovery_acceptance=1, passenger_report=1 (`c5e886d5-cab7-44fb-b150-b4c56629c960`, CONTROLLED_VERIFIED), report_review=1 (incident `0194f280-124c-59b9-95ea-99087fa3f1b2`), report_verification=1.
- All R7-window M6 changes within 2026-10-15 04:52:13–04:52:19 UTC.

## M5, M7, GPS

### M5 `8ef7f74b-2f24-4aea-b454-6d2791b0001e` (and independent-context `d233e0f7-a9e6-45c6-8b4b-632f7953eca3`)
- Journey `8ef7f74b…` lifecycle `ACTIVE`, journey_leg=3, journey_dependency=32, journey_impact=1, targeted_alert=1, passenger_report=2 (`7e45c77c…` CONTROLLED_VERIFIED and `c6bac67e-2558-49f7-a640-26c2512fbb70` REPORTED_UNVERIFIED), recovery_plan=0, recovery_acceptance=0.
- Independent journey `d233e0f7…` lifecycle `ACTIVE`, journey_leg=4, journey_dependency=20, journey_impact=0, targeted_alert=0, passenger_report=0 (isolation verified; no foreign alerts).
- `disruption.operational_incident 873b4aaa-0477-50d7-a47c-277fa0bc0779`: lifecycle RESOLVED, `source_class=SIMULATED`, `evidence_type=SIMULATED`, `operational_state=DISRUPTED`, expires 04:52:02 + 1h, updated 04:52:03.
- `journey.journey_impact` target `0e828e09-5a76-50f9-a2c6-55314f7c9321` (entity_type STOP, twin state UNKNOWN since 04:52:03).

### M7 `4fe1b7b9-2c8a-4b1c-97b0-5e2253682b6a` (+ second context `caf5bf64-cb0e-4ada-996c-0758597e5cfa`)
- M7 primary: lifecycle COMPLETED, journey_leg=5, journey_dependency=23, journey_impact=1, targeted_alert=1, passenger_report=1, recovery_plan=1, recovery_acceptance=1, journey_state_event=14.
- M7 secondary `caf5bf64…`: lifecycle COMPLETED, journey_leg=4, journey_dependency=16, journey_impact=1, targeted_alert=1, recovery_plan=1, recovery_acceptance=1.
- M7-driven incident `98c09a8c-6e9d-5031-aec5-d54c30d62149`: lifecycle RESOLVED, evidence_type SIMULATED, 2 journal revisions (VERIFIED_ACTIVE, RESOLVED).

### GPS
- No passenger_report, no recovery, no disruption.operational_incident rows attributable. Log itself confirms `location_network_requests=0`, `location_persistence=false`, `chromium_permission=denied`, `gps_default=OFF`. Provenance: `SIMULATED` unsupported-geolocation branch only, no real-world positional data written.

## Shared-twin / cross-user impact

### Fan-out across user journeys
- `journey.journey_impact` is written per journey × disrupted entity. Verified fan-out in the 2026-10-15 04:50–04:54 UTC window:
  - `0e828e09-…` (M5 target, entity_type STOP): 155 journey_impact rows for 155 distinct journeys across 153 distinct owner roles — cross-user cascade.
  - `337bd30c-…` (M6 target ROUTE): 12 rows, 7 distinct journeys across 7 owners.
  - `b96c53d4-…` (V20 target ROUTE): 5 rows, 5 distinct journeys across 5 owners.
- These journeys depend on the same shared network entities under the single finalized snapshot `43fb9a29…` (318 of 322 journey_plan rows reference it; 4 use `bb73a8c4…`). No per-user data partitioning at the shared-twin level.

### Shared twin state visibility
- `twin.mobility_state` for `b96c53d4…` and `337bd30c…` each currently `UNKNOWN` after resolve; provenance `PHASE_2B_V1`; `twin.mobility_state_history` shows prior SIMULATED-driven `UNAVAILABLE` transitions per R7 verify plus older non-R7 SIMULATED flips (2026-10-14 15:10 and earlier, distinct runs `375a06fa…`, `d86aa986…`, `6d707096…`).
- `twin.network_snapshot_state`: 0 rows on snapshot `43fb9a29…` for these entities — snapshot state rows not written per incident; changes surface only in the live `twin.mobility_state`.

### Open (unresolved) items, DB-wide
open journey_impact=9; open targeted_alert=9; orphan report (active_journey_id NULL) = 1 (`92000000-0000-4000-8000-000000000004`, provenance UNKNOWN, predates R7 by 3 days); open lifecycle_status `ACTIVE` journeys=280, COMPLETED=42 (from `journey.active_journey` 322 rows).

### Provenance labeling
Every R7-recorded evidence row in `journey.journey_impact`, `disruption.operational_incident`, `disruption.operational_incident_entity`, `disruption.operational_incident_journal`, `report.passenger_report_review`, `report.passenger_report_verification`, `twin.mobility_state_history` explicitly carries `evidence_type=SIMULATED` and a `provenance_ref` of form `controlled-review:<reviewer>:passenger-report:<report_id>`; no row is mislabeled as observed/realtime.

## Volumes and migrations

- Docker volume `transum-in-nexus-product-postgres-data` exists (matches `.env` `POSTGRES_VOLUME_NAME`). Concurrent volumes `transum-in-nexus-postgres-data` and `transumin-foundation_transumin_postgres_data` belong to unrelated stacks; not touched.
- `meta.kysely_migration` count = 17, current DB reflects migrations through `202610130002_active_journey_current_itinerary`.
- Product DB size 1985 MB.
- PostGIS extension tables present in `public` schema; product tables live in non-public schemas (`meta`, `transit`, `spatial`, `twin`, `disruption`, `simulation`, `journey`, `research`, `auth`, `ai`, `recovery`, `report`).
- There is no standalone `database/migrations/*.sql` boundary file yet — `database/README.md` acknowledges the gap and defers to a future phase; migrations live under `meta.kysely_migration` only.

## Data loss / integrity claim

No claim that pre-existing data was lost is made. The user's constraint is honored: no baseline snapshot or row checksum is available in-repo for validation, so data-loss absence is not asserted, only `NOT VERIFIED`. Counts above are live-row counts, not end-to-end row-history lineage; no provenance sweep claims to have read every audit trail field.

## PO disposition required

The user-specific instruction is explicit here — **release has not been dispositioned yet by the Product Owner** and this report does not approve retain/quarantine/remediation. Items outside the named V20/M6/M5/M7/GPS referents (for example the 155-journey fan-out on `0e828e09…`, the owner-masked recovery/acceptance lineage, the orphan report `92000000…`, and the `journey.journey_plan` owner_ref disclosure surface) are flagged for PO review and would need `retain`, `quarantine`, or `remediation` approval to close. This file is an impact inventory only; it is not a release decision, not a test result summary, and not a substitute for `docs/delivery/R7-CLOSEOUT-STATUS.md`.

## Boundaries
- No harness state touched.
- No data deletion, migration, or cleanup performed.
- No code edits.
- `.env` read privately; secret values not printed here.
- All queries ran in a read-only transaction window against `transum_in_nexus_product` on `oid 16384`.
