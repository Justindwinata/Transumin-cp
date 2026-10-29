# Prototype V1 release evidence index

Status: sanitized publication index. No raw/protected data, credentials, or temporary logs archived.

## R7 scratch-isolation checkpoint (2026-10-15, branch `prototype-v1`, uncommitted)

- Shared-runtime deviation repaired: standalone mutable suites (V20/S14, M5, M6, M7, GPS) now run only through the invocation-owned scratch CLI (`pnpm data:browser:isolated` / `--suite=`); `assertCp2Runtime()` fail-closed guard added to each suite plus 3-test guard regression inside `pnpm test` (`apps/web/scripts/cp2-runtime-guard.test.mjs`).
- Isolated reruns all exit 0: M5 22/22 (`r7-isolated-M5-20261015-exec07.log`), M6 13/13, M7 20/20, GPS PASS, V20/S14 21/21, CP2 with signed-session expiry PASS, CP3 sequential R1→R2 with durable lineage (`ASSERT sequential.durable_lineage … exact=true`, `r7-isolated-CP3-sequential-20261015-exec01.log`). Every scratch `DROP_SUCCESS`.
- Shared product DB provably unmodified by the reruns: read-only counts identical before/after (`.release-evidence/r7-shared-baseline-20261015.txt` → `r7-shared-post-isolation-20261015.txt`). Records from the pre-fix deviation remain in the product DB pending Product Owner retain/quarantine/remediation decision (`docs/delivery/R7-SHARED-DB-IMPACT.md`).
- Release-holding gate: publish later sections only after Product Owner clearance; commit is not published.

## R7 integrated continuation — 2026-10-15

- Base HEAD remains `60a1d704f21536d3e0fda9bbac39e88250acbd82`; 35 intentional staged paths, no release authorization/commit/push/archive. Execution-source tree before this documentation update: `4c9915990223fba186aa6acb85e7fbbe77f4a09f`.
- Fresh combined acceptance: `pnpm --filter @transum-in/api exec tsx src/journey/cp2-isolated-browser.cli.ts --suite=SMOKE,CP2,CP3,V20,M5,M6,M7,GPS`, exit 0 (`.release-evidence/r7-full-integration-20261015-exec02.log`), owned scratch `tnx_cp2_e30664df4b58419a94fddbdf2df0f3bf`, OID 802266, `DROP_SUCCESS`. Earlier failed combined exec01 remains failed evidence and retained.
- Dedicated `R7_SEQUENTIAL_RECOVERY=1 pnpm data:cp3:recovery`: exec02 failed after stage 11; scratch `tnx_cp2_bbbfdde8fe6d4f1796da21099ba55e0a` retained. Harness read MapLibre immediately after reload. Added fingerprint readiness wait, without changing assertions/product code. Exec03 exit 0, stages 1–12, completion/reload and `sequential.durable_lineage ... exact=true`; scratch `tnx_cp2_e0fc6136b6704d31ae00f0537ee9e77a`, OID 799361, `DROP_SUCCESS`. Public DTO predecessor field remains NOT_VERIFIED; DB lineage proved separately.
- `node --test apps/web/scripts/passenger-sequential-recovery-check.test.mjs`: 4/4. `pnpm --filter @transum-in/api data:lightweight-acceptance`: 12/12 exit 0 (`r7-tierA-20261015-exec05.log`). Unfiltered root shorthand failed script resolution and is not PASS. `pnpm check:integration`: exit 0 (`r7-integration-20261015-exec05.log`). CP2 isolated default: exit 0 (`r7-cp2-expiry-20261015-exec02.log`).
- `pnpm check` exec08 failed Next prerender `/_global-error` / null `useContext`; exec09 passed with no source fix. Preserve intermittent build failure, root cause NOT_VERIFIED. `pnpm security:scan` exec08 exit 0. Raw logs remain local/ignored.
- MODES strengthened browser acceptance `PASS` (exit 0), `.release-evidence/r7-modes-20261015-exec02.log`; owned scratch `tnx_cp2_8fcd9a93e7844daab19d95b88bd370f7`, OID 856241, `DROP_SUCCESS`. Four serial real UI journeys on snapshot `43fb9a29`: Mikrotrans (B05729P→B05694P, route `2:tnx:mikro:route:JAK.01`), MRT Jakarta (Lebak Bulus→Fatmawati, `3:tnx:mrt:route:MRT_JAKARTA`), LRT Jakarta (Kelapa Gading→Velodrome, `1:tnx:lrtj:route:LRT_JAKARTA`), LRT Jabodebek (Harjamukti→Ciracas, `4:tnx:lrtjb:route:LRT_JABODEBEK`). Per mode asserted: EXACT_SOURCE_REFERENCE STOP/STATION/ROUTE bindings, selected/active/persisted plan deep-equal, `plan_journey_id` identity, MapLibre `data-route-source-fingerprint` equality at selection/reload/completion, marker/point parity, domain-sequenced rejections (`Alighting requires boarding…`, `Transit progress requires alighting…`, both HTTP 400), cross-owner mutation 403, report `REPORTED_UNVERIFIED` against the segment's actual ROUTE dependency, completion visible after reload. Still single-segment ODs only: no interchange proven, no independent field validity, no broader route coverage. MODES-only exec03 repeated PASS after the combined-run timeout (`tnx_cp2_206deb0878b344a2ae1fc389d50b2ea7`, OID 862104, `DROP_SUCCESS`); combined final suite exec01 failure scratch is retained. Root cause proven as pre-hydration combobox fill; `choose()` gained an enabled-`Find journeys` readiness trial-click gate (`passenger-modes-place-readiness.test.mjs` guards gate order fail-closed). Combined exec03 with the fix passed all 9 suites (`r7-final-integrated-20261015-exec03.log`, `tnx_cp2_e8c129415c404126a8e8eb89a0696083`, OID 901172, `DROP_SUCCESS`). KRL added to MODES harness: Bogor `6:tnx:krl:stop:BOO` → Cilebut `6:tnx:krl:stop:CLT`, route `Boo-Mri` trip `1017`, `EXACT_SOURCE_REFERENCE`, fingerprint equality, boarding/alighting, report `REPORTED_UNVERIFIED`, reload (`r7-modes-krl-20261015-exec04.log`, scratch `tnx_cp2_3d3638a5daee4d4b95fbd0e5c0f457f0`, OID 931904, `DROP_SUCCESS`). Combined exec04 passed 9/9 with 5-mode MODES (`r7-final-integrated-20261015-exec04.log`, scratch `tnx_cp2_84d8123026ca4f6a884e8fd86983daed`, OID 934786, `DROP_SUCCESS`). Product hydration made truthful in `place-search.tsx`: combobox disabled with `Stop and station search is loading…` until `mounted && snapshotId`; combined exec05 passed 9/9 with the product UI fix (`r7-final-integrated-20261015-exec05.log`, scratch `tnx_cp2_38f9f1902a6f4097bb86d75c6abe9600`, OID 937770, `DROP_SUCCESS`). Fresh current-tree V20 `PASS` 21/21 (`r7-v20-current-20261015-exec01.log`, scratch `tnx_cp2_45ffc47d634d43b4a85ec439912f930e`, OID 892734): Kelapa Gading→Gambir LRT→walk→KRL→walk 4-seg `transfer_count 1`, R1 `SUFFIX_REPLANNED` accepted with fingerprint `bc36485fdb…`, completion + reload.
- Shared product DB SELECT-only post-check unchanged: plan 322, active 322, report 203, incident 153, recovery_plan 76, recovery_accept 56, impact 3255, alert 3255, state_event 4042; nine expired open impacts retained (`r7-db-post-final-20261015-exec01.log`). Disposition RETAIN_PENDING_PO_DECISION.

## R7 P0 acceptance continuation — logs labeled 20261016

- Execution-source staged tree: `0e7677a709affa7f9d724b113aa66e74ba5100c8`; base HEAD unchanged at `60a1d704f21536d3e0fda9bbac39e88250acbd82`. No commit, push, source archive or deployment authorized. Log filename date is an execution label, not independently verified wall-clock evidence.
- Endpoint/negative browser suite: `.release-evidence/r7-endpoint-negative-20261016-exec05.log`, exit 0, 10 cases; scratch `tnx_cp2_3aee7a8bbc7840a380aa5744c6f2e6bf`, OID `952362`, `DROP_SUCCESS`. SAMPLE autocomplete, SIMULATED browser geolocation, and FAULT_INJECTION config/planning errors are not provider/physical-GPS/genuine-outage evidence. Earlier exec01–04 failed harness assumptions/timing and remain failed evidence with retained scratches. Switching pin to coordinates stops pin selection but intentionally retains visual pin context; coordinate authority is not pin deletion.
- Full mobile journey: `.release-evidence/r7-mobile-v20-20261016-exec02.log`, exit 0; V20 workflow at 360/390 touch and 1280 desktop, including preferences, map/timeline, activation, progress, report, controlled SIMULATED review, genuine OTP recovery, completion/reload. Scratch `tnx_cp2_6a04e9b356844b3cae6353f83a7c32dd`, OID `958152`, `DROP_SUCCESS`. Exec01 exposed a 20px report select; `globals.css` now applies existing 48px form-control treatment to journey-detail inputs/selects/textareas. Failed scratch retained.
- Production restart: `.release-evidence/r7-production-restart-20261016-exec04.log`, exit 0; fresh isolated Next production build/start behind loopback HTTPS, Secure+HttpOnly session cookie, owned web/API restart, unchanged authoritative progress revision 4, continued revision 5, activation replay same active journey. Scratch `tnx_cp2_3dc2735025394ba48ce1ecd54037a3f0`, OID `969805`, `DROP_SUCCESS`. Runner's final `ISOLATED_SCRATCH_CP2` label is generic; no CP2 suite execution is implied by this restart invocation. Uses browser-context HTTP requests for mutations, not full UI continuation/completion; those broader restart cases remain NOT_VERIFIED. Exec01–03 retained failures: transit confirmation omitted, signal-exit assertion incorrect, replay path used active rather than selected-plan ID; product guards were not weakened.
- Final executed gates on execution-source tree: `r7-final-check-20261016-exec01.log` (`pnpm check`, exit 0); `r7-final-security-20261016-exec01.log` (exit 0; ignored private cache matches must never be uploaded); `r7-final-integration-20261016-exec01.log` (9 specs, 32 passed, 0 failed, exit 0). Passing production builds do not resolve historical intermittent build root cause.
- Post-acceptance SELECT-only product counts unchanged: journey_plan 322, active_journey 322, recovery_plan 76, recovery_acceptance 56. No new combined all-suite run after these harness additions. Standalone WALK/TransJakarta, physical GPS/human UAT, genuine S09 negative routing, broader restart UI/completion, and release authorization remain outstanding. Prototype V1 overall PASS is not claimed.

## Milestone C closure — 2026-10-17

- Staged tree `5fc0cdff1be017945b06ea059152cd6ecb3a0df7`; base HEAD `60a1d704f21536d3e0fda9bbac39e88250acbd82`.
- TIMEOUT `.release-evidence/c-timeout-exec02.log` PASS, suite `TIMEOUT` on `5fc0cdff`, checkpoints 8/8 with per-case 180s and suite 540s deadlines, elapsed `181002ms`, exact rows/fingerprints/pending lifecycle/replay guards, scratch `tnx_cp2_2a62af848277450c90373caa92a1a4d9` OID `1174011` `DROP_SUCCESS`.
- REPORTING_RATE_LIMIT `.release-evidence/c-rate-exec06.log` PASS, same tree, 390/1280 core windows `retry 599 / near 15`, boundary concurrent and identity, scratch `tnx_cp2_d57b23bc971e4eb8baa79912bf09a1dd` OID `1201885` `DROP_SUCCESS`.
- Gates PASS: `pnpm check:integration` 9/32, API `110/110`, web `63/63`, `pnpm lint/typecheck/openapi:validate/api:types:check/data:contracts:check`, security scan PASS (`400` tracked/`13` client). Failed/hung prior evidence retained.

## R7 final engineering closure — 2026-10-16

- Exact frozen staged tree after final harness fixes and database sign-off: `e2c2a605496cee41ba46b57fb4c39221eda4a001`; base HEAD/remote remain R6 `60a1d704f21536d3e0fda9bbac39e88250acbd82`; 44 intended staged paths, no unstaged source, `graphify-out/` remains untracked/excluded. No commit, push, archive, or deployment authorized.
- Current-source gates PASS: `pnpm check` exit 0 (`r7-check-20261016-exec03.log`); `pnpm security:scan` exit 0 (`r7-security-20261016-exec02.log`); `pnpm check:integration` exit 0, 9 specs / 32 passed / 0 failed (`r7-final-integration-20261016-exec02.log`).
- Full production UI restart PASS: `r7-production-ui-restart-20261016-exec05.log`, 20/20 V20 browser steps plus owned Web restart, API stop returning safe journey-proxy 503, API restart, Secure+HttpOnly session continuity, authoritative progress/segments/snapshot/graph and MapLibre fingerprint parity, idempotent activation replay, controlled SIMULATED report/recovery, completion and reload. Scratch `tnx_cp2_7ad7ca07a1fb4a2a9e6b9973dbaf62e4`, OID `1007899`, `DROP_SUCCESS`.
- Final serial combined regression PASS: V20, MOBILE, NEG, M5, M6, M7, GPS, SMOKE, CP2 and CP3 on scratch `tnx_cp2_f2a885a09a424f0fb8f5ea8d18952399`, OID `1041621`, `DROP_SUCCESS` (`r7-final-regression-20261016-exec02.log`). Initial exec01 stopped at M7 because the harness opened a React-controlled details element rather than explicitly selecting coordinate authority; failed scratch retained. Minimal harness fix selected `Coordinates` in both endpoint method groups; focused M7 then passed 20/20 on scratch `tnx_cp2_f13b13e56f0140f4937b89ca75031594`, OID `1038710`, `DROP_SUCCESS`.
- MODES PASS separately for five authentic historic corridors (MIKROTRANS, MRT_JAKARTA, LRT_JAKARTA, LRT_JABODEBEK and KRL), scratch `tnx_cp2_a6adbf337adf447ab73a8d8d577e0f9a`, OID `1044629`, `DROP_SUCCESS` (`r7-modes-20261016-exec02.log`). WALK is proven as routed legs and TransJakarta is proven in CP2/CP3 recovery itineraries; FR-001 does not require standalone WALK-only or TransJakarta-direct end-to-end suites, so no synthetic expansion was added.
- Dedicated sequential R1→R2 PASS with durable DB lineage exact, original plan/completed prefix immutable, accepted pointer R2 and reload completion; scratch `tnx_cp2_18271b1df5dc4bb68a0db0f94917da7f`, OID `1047519`, `DROP_SUCCESS` (`r7-sequential-20261016-exec02.log`). Public browser DTO `predecessorRecoveryId` remains `NOT_VERIFIED` and is not inferred from DB proof.
- Database read-only sign-off: `docs/delivery/R7-DATABASE-FINAL-SIGNOFF.md` and `.release-evidence/r7-membership-final-20261016.log`. Empty snapshot membership is a legal all-UNKNOWN sparse base because all 164 observations are after cutoff; plan/version/hash lineage is intact for 318 plans, but preservation through materialized membership remains a coverage gap. Hazard constraint remains `NOT VALID`; historical shared state remains `RETAIN_PENDING_PO_DECISION`; operational readiness remains conditional.
- Credential incident scope check found the active DB password only in ignored local `.env`: zero exact matches in tracked/staged source, nonignored untracked files, Graphify output, release evidence, or Git history. No secret value is recorded here. Rotation was not authorized; status `CREDENTIAL_ROTATION_PENDING`, therefore private publication remains NO-GO pending PO remediation or explicit risk disposition.

## R6 realization checkpoint (2026-10-14, branch `prototype-v1`)

- Tested code SHA: `c921fb895154c712de0dbd52c526b6741187e1db` (R6 code + tests + harness + docs delta; no application behavior change). Preflight R6 SHA: `b46de42` (docs-only). Push without force; repo verified PRIVATE.
- Source package (local, git-ignored `.release-evidence/source-release/`): `transum-in-nexus-source-c921fb895154.zip`, 949,529 bytes, 376 tracked files, allowlist match, exact-value secret scan PASS, SHA-256 `1f117c315da05b6d47f570172bc6c0d90056e86b04ae2626757db62c352512c2`. Source-only: no `.env`, caches, data, logs, or runtime state.
- Executed R6 evidence (local logs, not archived): fresh 20/20 R1 walkthrough; mobile 390×844 smoke (no overflow/errors/failed requests); Tier A 12/12; standard integration 9/31; multi-OD 11 corridors; G2/GPS/F04/M5/M6-fixed/M7/handoff; CP2 + CP3-rerun `DROP_SUCCESS`; `pnpm check` exit 0; `pnpm security:scan` PASS. One CP3 run failed HTTP 500 at second-context activation; scratch retained, root cause `NOT_VERIFIED`. Earlier failed-run scratch DBs follow the same fail-closed retention rule and are never auto-dropped.
- Remaining `NOT_VERIFIED`: physical GPS, browser R2 corridor, browser expired-session path, S09 live `NO_PATH`/`NO_VALID_ALTERNATIVE`. Blockers unchanged: typed address auth, named POI data, pedestrian validation, provider integration, Tier B environment.

## R5 G0–G5 checkpoint (2026-10-14, branch `prototype-v1`)

- Tested G5 code SHA: `31772e2ddc0ba7815e20a4bc9babab56cd14c922`. Documentation/release checkpoint SHA: `b46de42306960d8b6876243833089f6eb3b67d7a` (four documents only; identical executable code). Preflight R6 local = remote `refs/heads/prototype-v1`. Historical tests are not relabeled as executed at the documentation SHA. Repository stays PRIVATE; no force-push or history rewrite.
- Commits this checkpoint: `06fa181` (G1 lineage/guards), `a40c19b` (G1/G2 hardening + F-03 proof), `31772e2` (G4 LEVEL 1 + G5 integrated rerun). Working tree clean after push; `apps/web/next-env.d.ts` reverted whenever the dev harness drifted it.
- Executed gates, all exit 0 unless noted: isolated CP3 recovery browser (G1-D stale races + generation parity, scratch `DROP_SUCCESS`); Tier A 12/12 (`data:lightweight-acceptance`, `DROP_SUCCESS`); 9-suite standard integration 9/9, 31 tests; web unit 40/40; session/guards 11/11; G2 preference proof; R4 handoff/F-01/F-02/F-04/F-05, GPS lifecycle, r1 20/20, M7 20/20; `pnpm check` (lint/typecheck/unit/contracts/OpenAPI/types/format/builds); `pnpm security:scan` PASS (369 tracked, 13 client; ignored `.next` dev-cache private matches excluded, never uploaded).
- Honest boundaries retained: full G1 edge matrix `NOT_VERIFIED`; typed address `BLOCKED_BY_AUTHORIZATION`; provider integration `BLOCKED_BY_DATA`/auth; Tier B snapshot `BLOCKED_BY_ENVIRONMENT`; named Kemang POI `BLOCKED_BY_DATA`; GPS hardware `NOT_VERIFIED`; S09 `NOT_VERIFIED` (exit 1, genuine OTP fallback).
- Durable Bahasa Indonesia report: `docs/prototype-v1/LAPORAN-RILIS-PROTOTYPE-V1.md`. Local raw logs remain git-ignored under `.release-evidence/` (`G1/`, `G2/`, `R4/`, `CP3/`); they are references, not archived artifacts.

## Review record

- Review timestamp: `2026-10-13T14:22:15+07:00` (local `WIB`; wall-clock command output)
- Current product repository: `https://github.com/Justindwinata/TRANSUMIN-NEXUS.git`
- Publication-review base commit: `04376a0978a4decc7f0e14c48bf95d6ab1e9e284`; R3 release commits listed in final handoff
- Historical source repository: `/Users/justindwinata/Developer/TRANSUMIN-NEXUS`
- Historical source branch: `prototype-v1-generalized-journey`
- Historical source commit: `de3677273292398ffeb8af7bf681480bdc3379a2`
- Authorization basis: R2 Product Owner explicitly authorized restoring canonical product schema/data contract files. Restoration excludes raw/protected data.
- Exact-match result: `9/9` files matched historical blobs byte-for-byte.

## Exact nine sanitized blobs

Six schema files:

| Path                                                                   | SHA-256                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `data/manifests/dataset-manifest.schema.json`                          | `2b9eb1bcee4cd146a8149b1add0ee0e501ed6ec5feabe4cbbe31fd3838792c4f` |
| `data/manifests/operational-data-source-capability-matrix.schema.json` | `f091b71cc2bbd8e0106d175f5e0f1546703aeabd9a0a79365b8378a0f03c5f96` |
| `data/manifests/phase1-canonical-transit-snapshot.schema.json`         | `52b062f6aceb2624fff5c12149e88f3a7b5e45fc4a2a2550c8c0b98ad92243b5` |
| `data/manifests/phase1-operator-coverage.schema.json`                  | `53b251b62e2b6d7cf28ff7f4af04a6625ca982de900b2282db560bd9596c4f6b` |
| `data/manifests/phase2-base-network-snapshot.schema.json`              | `3a5cd6d5d92b480336687e7110eee05bee29c3c19d46dcd8b1d02c0d528b015e` |
| `data/manifests/phase2a-spatial-snapshot.schema.json`                  | `7d412c2ccbaeb42a0d0d012bf2850c9ca6b1ab7694ee9e5e44fd352280f5f3f5` |

Three data-manifest records:

| Path                                                                                | SHA-256                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `data/manifests/OPERATIONAL-DATA-SOURCE-CAPABILITY-MATRIX.json`                     | `55196ce88aafa6966d2635ea95040964648a002f3477c6b6e13064396dedb34e` |
| `data/manifests/PHASE-1-OPERATOR-COVERAGE.json`                                     | `9a164c15fcedc4944c49a28f3fd8e12c3d6937a8e8743f83e615d99090ad5737` |
| `data/manifests/transjakarta-gtfs-63b4fb14d9af-mobilitydata-validator-summary.json` | `752f03bf736a681e111a05277d84bba9f7a1413caeade9ba00aa06f38490e651` |

Other tracked manifests remain outside this nine-blob publication review. Raw GTFS/OSM, OTP graph, JAR, JRE, and generated feeds remain Git-ignored and are not archived here.

## Evidence manifest

| Check                                                          | Exact command                                                                                                                                     |                           Exit |                                                                                 Count/result |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------: | -------------------------------------------------------------------------------------------: |
| Current revision                                               | `git rev-parse HEAD`                                                                                                                              |                              0 |                                                   `04376a0978a4decc7f0e14c48bf95d6ab1e9e284` |
| Historical revision lookup                                     | `git -C /Users/justindwinata/Developer/TRANSUMIN-NEXUS show -s --format=fuller de3677273292398ffeb8af7bf681480bdc3379a2`                          |                              0 |                                          1 commit; branch `prototype-v1-generalized-journey` |
| Historical blob comparison + JSON parse + secret-pattern audit | read-only Python audit comparing nine paths with `git show`, parsing JSON, and checking private-key/token/credential-url/assigned-secret patterns |                              0 |                         9 files; 9 JSON parsed; 9 exact matches; all four pattern counts `0` |
| Product contract validation                                    | `pnpm data:contracts:check`                                                                                                                       |                              0 |                                                           11 validated records (R2 evidence) |
| DB migration inventory                                         | `find apps/api/src/infrastructure/database/migrations -name '*.ts'`                                                                               |                              0 |                                                                   17 migration files present |
| DB migration execution documented                              | `pnpm db:up` → `pnpm db:migrate` → `pnpm db:status` sourced from ignored `.env`                                                                   |   0 (verified in this session) | 17 ordered migrations; `db:status` confirmed all `applied`; bootstrap runbook text stated 12 |
| API readiness URL                                              | `curl http://127.0.0.1:3001/health/ready`                                                                                                         | 200 (verified in this session) |               Verified live response keys: `dependencies,service,status` at review timestamp |
| Web proxy URL                                                  | `GET http://127.0.0.1:3000/api/passenger/config`                                                                                                  | 200 (verified in this session) |                                       Verified live response key: `data` at review timestamp |
| OTP URL                                                        | `POST http://127.0.0.1:8080/otp/gtfs/v1` with GraphQL `{__typename}`                                                                              | 200 (verified in this session) |                               Verified GraphQL response contained `data` at review timestamp |

Temporary acceptance and audit logs are evidence references only. They are **NOT ARCHIVED** by this index. No log hash is presented as durable artifact hash.

### Local persistent verification records (git-ignored, `.release-evidence/R3/`)

Sanitized durable record for R3 acceptance lives in `docs/prototype-v1/R3-RELEASE-EVIDENCE.md` (committed). Local ignored copies keep sanitized artifacts at `.release-evidence/R3/`:

- `final.json` (workflow artifact): `a202e43f948d2006fedff4f1cf912f655e0fdb1d69bc126e37180cd7ef34ca44`
- `r3-check.log`: `9384dca5c7810618ef481128122cb70413c3d521b42864afe4d859451702f168`
- `r3-security.log`: `91e4f7c03fdc68683a78c2f9e8061634146092d02edfba2638ad26bf0cb05d59`
- `r3-m5.log`: `fe6464ba7258c31bd4b565e3b9a9a0fff2298c1069fe0bee724dbaef687fc778`
- `r3-m6.log`: `39e607481565adfc285f562189d2b7179ee7f8dc1205e2da46be0481af98a1f8`
- `r3-m7.log`: `d9fdf03b8fb67fb340ed57f1a5e34a6d07ed989632080d928ea96acb7cb0c9be`
- `r3-gps.log`: `31ba0149783c87a433d3950af532536fb976688b3385beba631a8347cb8d3efe`
- `r3-s01.log`: `081cb1dd32dbfb9d68a3fc9ca8144770f5059d595bd311c12a7427398e91eeee`

Remote logs `r3-workflow.log` and `r3-s09-rerun.log` remain temporary and are not archived; their SHA-256 values are carried in `R3-RELEASE-EVIDENCE.md` only.

## Runtime identity

- Database migrations at current commit: 17 ordered migration files live under `apps/api/src/infrastructure/database/migrations/`; `pnpm db:status` confirms every migration `applied` against the isolated product database on 2026-10-13 (`14:22 WIB`). Runbook text previously stated 12 migrations and is now updated within this same review. Isolated product volume/port guidance (`transum-in-nexus-product-postgres-data`, `127.0.0.1:5435`) remains unchanged.
- Network snapshot: `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`
- OTP graph SHA-256: `ad9fdd3ea0308dcf033f51b43e027dd3ffa10166ef130f9512e3a9e643331574`
- Router-input manifest SHA-256: `1f493716d20ad5ffa2e3628ece67f2511235f2abfacef4cd7b2b2af9f73dfb77`
- OTP runtime manifest records OTP `2.10.0`, but runtime binaries and graph are local Git-ignored inputs, not durable publication artifacts.
- Database uses isolated product volume/port guidance: `transum-in-nexus-product-postgres-data`, `127.0.0.1:5435`; protected legacy volume is out of scope. Sourced `.env` was loaded but never printed or committed.

## Safety boundary

This index records hashes and provenance for sanitized tracked contract files only. It does not authorize ingest, expose credentials, restore protected volumes, or represent raw/protected data as published. R3 capability and delivery ledgers were updated separately from this publication review using executed acceptance evidence.
