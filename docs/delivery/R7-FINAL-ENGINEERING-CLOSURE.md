# R7 Final Engineering Closure

Date: 2026-10-16. State: **ENGINEERING ACCEPTANCE EVIDENCED; PRIVATE RELEASE NO-GO**.

## Frozen source candidate

- Branch: `prototype-v1`.
- Base HEAD and remote: `60a1d704f21536d3e0fda9bbac39e88250acbd82` (R6).
- Candidate index tree: `e2c2a605496cee41ba46b57fb4c39221eda4a001` (44 staged intended paths at last recomputation).
- No unstaged source at freeze. `graphify-out/` untracked and excluded. Release evidence and `.env` ignored and excluded.
- No R7 commit, push, source ZIP or deployment. Do not call R6 HEAD R7.

## Security incident

- Scope check: active local PostgreSQL credential found in ignored `.env`; exact-value search reported no matches in tracked files, staged blobs, nonignored untracked files, `graphify-out/`, `.release-evidence/`, or reachable Git commit history.
- No value is recorded in this report. Prior tool output is the reported exposure channel; persistence/capture outside this private session has not been independently established.
- Credential remains active. Rotation not executed because explicit authorization and safe operator process are absent. Status: `CREDENTIAL_ROTATION_PENDING`.
- Before private publication: authorized rotation, update approved local/deployment secret storage, verify new API→PostgreSQL readiness and reject old credential without printing either value; or PO explicitly documents risk disposition. Security scan is not remediation.
- No secret-bearing diagnostic output was used during this scope check. Do not commit `.env`, logs, caches, generated runtime files, databases, protected datasets, screenshots, or `graphify-out/`.

## Current-source test evidence

All browser mutation suites used serial invocation-owned scratch with owner/marker/OID/runtime guards. Product DB stayed read-only.

| Command / suite | Result | Evidence / scratch |
|---|---|---|
| `pnpm check:integration` | PASS, 9 specs / 32 tests / 0 failed | `.release-evidence/r7-final-integration-20261016-exec02.log` |
| `pnpm check` | PASS, exit 0 | `.release-evidence/r7-check-20261016-exec03.log` |
| `pnpm security:scan` | PASS, exit 0; private cache matches ignored and forbidden in packages | `.release-evidence/r7-security-20261016-exec02.log` |
| Production UI restart acceptance | PASS; V20 20/20 + restart assertions | `r7-production-ui-restart-20261016-exec05.log`; scratch `tnx_cp2_7ad7ca07a1fb4a2a9e6b9973dbaf62e4`, OID `1007899`, marker `tnx_cp2:7ad7ca07-a1fb-4a2a-9e6b-9973dbaf62e4`, `DROP_SUCCESS` |
| Combined serial browser regression: V20, MOBILE, NEG, M5, M6, M7, GPS, SMOKE, CP2, CP3 | PASS | `r7-final-regression-20261016-exec02.log`; scratch `tnx_cp2_f2a885a09a424f0fb8f5ea8d18952399`, OID `1041621`, marker `tnx_cp2:f2a885a0-9a42-4f0f-b8f5-ea8d18952399`, `DROP_SUCCESS` |
| MODES | PASS, 5 corridors: MIKROTRANS, MRT_JAKARTA, LRT_JAKARTA, LRT_JABODEBEK, KRL | `r7-modes-20261016-exec02.log`; scratch `tnx_cp2_a6adbf337adf447ab73a8d8d577e0f9a`, OID `1044629`, `DROP_SUCCESS` |
| Sequential R1→R2 recovery | PASS durable lineage exact; public DTO `predecessorRecoveryId` remains NOT_VERIFIED | `r7-sequential-20261016-exec02.log`; scratch `tnx_cp2_18271b1df5dc4bb68a0db0f94917da7f`, OID `1047519`, `DROP_SUCCESS` |
| Focused M7 after harness correction | PASS, 20/20 | `r7-final-regression-m7-20261016-exec02.log`; scratch `tnx_cp2_f13b13e56f0140f4937b89ca75031594`, OID `1038710`, `DROP_SUCCESS` |

Initial final-combined exec01 failed at M7 because test clicked a React-controlled details summary instead of selecting coordinate input mode, so no plan request fired. Minimal harness-only correction selected Coordinates for both endpoints. The failed scratch remains retained. Fixed M7 and the complete combined run then passed. No product security/domain guard was weakened.

Restart browser journey: Kelapa Gading → Gambir; scheduled historical service date 2026-10-02, Asia/Jakarta; snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`. Browser checked Secure+HttpOnly session, Web restart and reload, API outage (journey proxy HTTP 503), API restart and reload, authoritative progress/segments/graph/snapshot, MapLibre fingerprint parity, same-journey activation replay, report and visibly `SIMULATED` controlled review/recovery, COMPLETE and reload persistence. Historical/scheduled data, not live service. Synthetic test geolocation remains SIMULATED.

Earlier accepted NEG exec05, MOBILE exec02 and production restart exec04 remain valid within their scope; later regression confirms relevant coverage. Tests are not relabeled as one combined run except exec02 above.

## Database sign-off

See `R7-DATABASE-FINAL-SIGNOFF.md` and read-only evidence `.release-evidence/r7-membership-final-20261016.log`.

- PostgreSQL 17.11 / PostGIS 3.6; 17 migrations; snapshot FINALIZED.
- Snapshot membership 0 rows is a legal sparse all-UNKNOWN base: all 164 relevant observations were recorded after cutoff. It is not evidence that sparse-state preservation was exercised. `SNAPSHOT_COMPATIBLE` remains CONDITIONAL PASS.
- 318 plan rows join requested snapshot, service date, routing manifest and matching content/hash identity.
- Transactional/application integrity PASS only for executed checks and browser scenarios.
- `disruption.event.disruption_event_hazard_evidence_check` remains `convalidated=false`; scratch proves invalid FLOOD rejection and validation behavior, not product constraint readiness. No shared DDL executed. Copy-DB validation plan awaits PO authorization.
- Historical impacts/alerts remain `RETAIN_PENDING_PO_DECISION`; no cleanup or quarantine performed. Operational readiness CONDITIONAL.
- Product table counts before/after acceptance unchanged: journey_plan 322, active_journey 322, recovery_plan 76, recovery_acceptance 56. Counts supplement, not replace, isolated-runtime evidence.

## Feature acceptance matrix

| Feature / canonical scope | Status | Verified behavior | Unresolved / owner action |
|---|---|---|---|
| F-01 GPS & Active Journey; FR-009, FR-014 | PASS software subset; physical NOT_VERIFIED | SIMULATED browser GPS; manual progress, boarding/alighting, ownership, signed-session expiry, reload, restart continuation | Real phone, approved secure origin, tester permission/accuracy/stale/denied/camera/manual progression sign-off |
| F-02 Address & POI; FR-001 input scope | PARTIAL | Stop/station autocomplete, map pin, coordinates, current-location input | Residential geocoder requires PO/provider/privacy authorization; POI requires licensed versioned data |
| F-03 Preferences; FR-002 | PASS on tested corridors | FASTEST, LEAST_WALKING, FEWEST_TRANSFERS, BALANCED | No CHEAPEST claim without authoritative fare data |
| F-04 Navigation; FR-001 / FR-009 | PASS limited scope | OTP-derived maneuvers, geometry association, schematic fallback, GPS denial fallback | Independent pedestrian safety/validity remains BLOCKED_BY_DATA; no fabricated turn claims |
| F-05 Reporting & Recovery; FR-005/006/013 | PASS executed subset | REPORTED_UNVERIFIED, controlled SIMULATED review, targeted alert, atomic accepted recovery, R1/R2 durable DB lineage, original plan/prefix preservation, reload | Genuine S09 OTP `NO_PATH` / application `NO_VALID_ALTERNATIVE` NOT_VERIFIED; public DTO predecessorRecoveryId NOT_VERIFIED |
| F-06 Provider handoff | PASS authorized handoff subset | Official Gojek/Grab/Bluebird HTTPS destinations and explicit destination copy | No booking, live fare, ETA, driver availability or provider API integration |

Mode evidence is limited to tested historical corridors. WALK was observed as itinerary legs; TransJakarta was observed in tested recovery itinerary; dedicated standalone WALK-only and TransJakarta-direct suites are not mandated by FR-001 multimodal wording and are not claimed. No universal network coverage is claimed.

## Residual risks and external gates

- Historical CP3 HTTP 500 root cause: `ROOT_CAUSE_NOT_VERIFIED`; PO risk disposition needed for release.
- Intermittent Next prerender `/_global-error` `useContext` root cause: `ROOT_CAUSE_NOT_VERIFIED`; PO risk disposition needed for release. Passing current builds do not prove historical cause fixed.
- Historical shared DB records: PO disposition required; retain as-is meanwhile.
- Credential rotation/incident disposition: PO/operator authorization required.
- Typed residential geocoder, named POI data/license, physical GPS/human UAT and genuine S09 negative route remain external/data-dependent.
- Product constraint validation, production deployment, monitoring, backup/restore, privacy/retention, capacity and operations require distinct authorization/evidence.

## Release decision and reproducible local run

**Technical candidate:** GO for reviewed private-source candidate only after source/evidence refresh for this report addition and credential incident remediation/disposition. **Publication:** NO-GO until required Product Owner approvals; none inferred from this engineering instruction.

Required approvals: historical shared-DB disposition; HTTP 500 residual acceptance; intermittent build residual acceptance; credential incident remediation/explicit disposition; private commit/push/source package authorization. Public deployment is a separate gate and remains unauthorized.

Source candidate must be rehashed after this document is staged. No commit, push or source ZIP was created.

Local runbook: PostgreSQL `docker compose up -d postgres`; reuse existing OTP graph with `pnpm otp:start` and `pnpm otp:health`; API `pnpm --filter @transum-in/api dev`; Web `pnpm --filter @transum-in/web dev`; readiness `http://127.0.0.1:3001/health/ready` and browser `http://127.0.0.1:3000`. Do not run `pnpm db:reset`, rebuild OTP, ingest data, or expose a public tunnel. Run `pnpm check`, `pnpm security:scan`, `pnpm check:integration`; mutable browser suites only through `pnpm --filter @transum-in/api exec tsx src/journey/cp2-isolated-browser.cli.ts --suite=...` with owned-scratch protections. Do not include `.env`, `.release-evidence/`, caches, `data/`, database files, screenshots or `graphify-out/` in distribution.
