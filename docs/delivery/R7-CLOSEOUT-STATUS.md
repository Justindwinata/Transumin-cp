# R7 execution status — engineering checkpoint

Date: 15 October 2026 (host WIB; earlier R7 log filenames used a `20261016` label — filenames only, not execution date). Classification: `PROTOTYPE_V1_PARTIAL`. R7 source is not yet committed, pushed or packaged. R6 HEAD remains `60a1d704f21536d3e0fda9bbac39e88250acbd82`; private remote verified before R7 changes.

## Executed evidence

- API readiness `PASS`: database up, PostGIS 3.6.4 available. Existing PostgreSQL container started without recreation; OTP 2.10.0 existing graph started, health `PASS`.
- Passenger walkthrough `PASS`: 20/20, `.release-evidence/r7-r1-full-workflow.log`. Real OTP, controlled SIMULATED review, recovery, completion/reload. Automated, not human UAT. This early run preceded final R7 source changes.
- GPS browser software and LEVEL 1 external handoff `PASS` on early R7 runtime. Handoff means official HTTPS sites and deliberate destination copy, not booking or trip-prefill integration.
- Web units after navigation fix: 46/46 `PASS`; API and web typechecks exit 0. Diagnostic/second-target unit checks: 5/5 `PASS`. PlaceSearch regression `PASS` with visibly SIMULATED responses, no geocoder/coverage proof.
- CP2 including signed-session expiration `PASS`: `.release-evidence/r7-cp2-cookie-decoded.log`, owned scratch `tnx_cp2_79b3124926904ce4b61133d20075af15`, `DROP_SUCCESS`. Expired mutation and refresh rejected; local navigation safe; authoritative journey unchanged; no owner replacement.
- Earlier CP2 failed at test helper HMAC verification: `.release-evidence/r7-cp2.log`; helper had not decoded percent-encoded cookie. Fixed `decodeURIComponent` before splitting. Scratch `tnx_cp2_ad2c6a51159c44cc9a3516bbe360fe06` retained. This was not evidence of port contention or a product authentication defect.
- CP3 first R7 invocation `NOT_VERIFIED`: `.release-evidence/r7-cp3.log`, failed after progress before predecessor map assertion; scratch `tnx_cp2_69fdfd69058b4072b46042b9ce5aa988` retained. Added bounded wait for exact map digest, not weakened parity assertion. Exact original cause not proven.
- CP3 with sequential extension `NOT_VERIFIED`: `.release-evidence/r7-cp3-sequential.log`. R1 report/review/recovery/acceptance, lost-response reconciliation, exact map/timeline/navigation parity, 3-to-4 legs and reload assertions passed. Sequential extension failed without sufficient diagnostic detail; completion not reached. Scratch `tnx_cp2_2258b7bc382b44568bc3c7d2bc328e51` retained. Do not mark whole CP3 or browser R2 PASS.
- Historical CP3 HTTP 500 root cause `NOT_VERIFIED`; see [bounded triage](./R7-CP3-HTTP-500-TRIAGE.md). Read-only inspection preserved failed scratch.
- R6 archive SHA-256 recalculated: `661c297b1e78f79c8a59339176aef0d40336b817beacd2977b50d8bb26bf57bd`, `.release-evidence/source-release/transum-in-nexus-source-60a1d704f215.zip`. ZIP has 473 entries including directories (R6 manifest reports 376 tracked files). Lockfile, source migrations and `.env.example` present; no real `.env`, node_modules or `.next`. Fresh extraction/install/build still `NOT_RUN`.
- Early `pnpm security:scan` `PASS`: 379 inspected source files, 13 client files. Ignored private `.next` cache matches excluded from source release. Final scan still required.

## Final R7 checkpoint evidence (2026-10-16)

- Sequential R1→R2 browser recovery `PASS` (exit 0), `.release-evidence/r7-sequential-20261016-exec03.log`. Real OTP; controlled `SIMULATED` review; R1 accepted; current replacement route reported and reviewed; second genuine OTP proposal; R2 accepted; completion and reload. Owned scratch `tnx_cp2_7155827bef2c46e98ffaafeef92b333d` `DROP_SUCCESS`.
- Durable lineage `PASS`: database assertion `sequential.durable_lineage base=R1 predecessor=R1 pointer=R2 exact=true` — R2 `recovery_plan.comparison_json.baseRecoveryId` equals the R2 acceptance `predecessorRecoveryId`, that predecessor acceptance exists for the same active journey, and `journey.active_journey.accepted_recovery_id` points to R2. Public browser DTO still omits `predecessorRecoveryId`; the browser-level subset stays `NOT_VERIFIED` and no private field was added to the DTO.
- Demonstrated product defect fixed: passenger report submission and controlled review resolved targets and modes only from the immutable original plan, so a report against a replacement-itinerary entity failed after R1 acceptance. Both now read the accepted generation, serialized with the recovery pointer row lock. Original plan rows remain untouched.
- Tier A isolated `PASS` (exit 0), `.release-evidence/r7-lightweight-20261015-exec01.log`; scratch `tnx_lightweight_2e10004a91a14a9e81bcf539c2051591` dropped. Includes the new accepted-generation report regression with `SIMULATED`-labelled fixtures.
- Isolated CP2 plus signed-session expiration `PASS` (exit 0), `.release-evidence/r7-cp2-20261016-exec03.log`; scratch `tnx_cp2_f434f55e6f174390acd47b1e8da4769a` `DROP_SUCCESS`.
- Standard integration `PASS` (exit 0): 9 specs, 31 tests, `.release-evidence/r7-integration-20261016-exec01.log`.
- `pnpm check` `PASS` (exit 0) including production build, `.release-evidence/r7-check-20261016-exec01.log`. `pnpm security:scan` `PASS` on 385 tracked files; ignored private `.next` cache matches remain out of scope of the source release.
- Unchanged earlier R7 passes remain valid for the runtime source they exercised: R1 walkthrough 20/20, GPS software, LEVEL 1 handoff, PlaceSearch regression (`SIMULATED`), malformed navigation fallback, web 46/46, API 109/109.

## Scratch isolation repair (2026-10-15)

Real source fix, not documentation-only.

- `apps/api/src/journey/cp2-isolated-browser.cli.ts` now accepts `--suite=CP2|CP3|V20|S14|M5|M6|M7|GPS` (comma list, `--recovery` kept) and runs the selected mutable browser suites **serially** inside one invocation-owned scratch database (`tnx_cp2_<uuid>`, marker/OID/owner guarded, `source_read_only`) on owned API 3303 / web 3302.
- Scratch seed extended with the snapshot's transit and rail corpus (`transit.operator`, `transit.service_calendar`, `transit.transit_shape`, `transit.route`, `transit.station`, `transit.stop`, `transit.trip`, `transit.stop_time`, `spatial.rail_topology_station`, filtered by the snapshot's dataset versions) so typed place search and journey identity resolve inside the scratch instead of falling back to the shared runtime.
- Owned web runtime now uses the default Next dev bundler rather than `--webpack`. The webpack dev build was why typed place search produced no options and the first isolated M5 reruns failed; the product API and data were already correct.
- `M5`, `M6`, `M7`, `V20` and `GPS` suites call `assertCp2Runtime()` before any request, so they fail closed when launched against the shared product runtime 3000/3001. Direct `node apps/web/scripts/passenger-report-m5-acceptance.mjs` exits 1 with `Run pnpm data:cp2:isolated-browser; runtime identity missing` and issues no request.
- Entry points route through the isolated CLI: `pnpm data:browser:isolated` (all six suites), `test:browser:m5:reports`, `test:browser:m7:integrated`. Guard regression `apps/web/scripts/cp2-runtime-guard.test.mjs` (3 tests) is part of `pnpm test`; it accepts the invocation-derived identity and refuses the shared product identity and a scratch-like name with mismatching OID/marker.

### Isolated rerun results (2026-10-15, every invocation exit 0)

| suite | log | result | scratch | cleanup |
| --- | --- | --- | --- | --- |
| M5 | `r7-isolated-M5-20261015-exec07.log` | 22/22 PASS | `tnx_cp2_a858c709c9fe407a828257b9f7995d9e` | `DROP_SUCCESS` |
| M6 | `r7-isolated-M6-20261015-exec01.log` | 13/13 PASS | `tnx_cp2_5e69bc51fb134f938ed0eb8895c522ee` | `DROP_SUCCESS` |
| M7 | `r7-isolated-M7-20261015-exec01.log` | 20/20 PASS | `tnx_cp2_d59a320ef4474e4aae9eb8a07e0cad4a` | `DROP_SUCCESS` |
| GPS | `r7-isolated-GPS-20261015-exec01.log` | PASS | `tnx_cp2_1514bedf21b345ad84a14bbefa337af1` | `DROP_SUCCESS` |
| V20/S14 | `r7-isolated-V20-20261015-exec01.log` | 21/21 PASS | `tnx_cp2_23c5795d4b0344988ef4e77565ce268f` | `DROP_SUCCESS` |
| CP2 (+ signed-session expiry) | `r7-isolated-CP2-20261015-exec01.log` | PASS, expiry block all true | `tnx_cp2_f3382dc8cfc1417cbc5cb7dde5b4fb47` | `DROP_SUCCESS` |
| CP3 sequential R1→R2 | `r7-isolated-CP3-sequential-20261015-exec01.log` | 12 stages, `ASSERT sequential.durable_lineage base=R1 predecessor=R1 pointer=R2 exact=true` | `tnx_cp2_31b32ca3d7834007a27a7ecbc8e2a07c` | `DROP_SUCCESS` |

Shared product DB unchanged across the whole isolated batch: read-only counts before and after are identical — `.release-evidence/r7-shared-baseline-20261015.txt` vs `r7-shared-post-isolation-20261015.txt` (`plan=322 active=322 report=203 incident=153 recovery_plan=76 recovery_accept=56 impact=3255 alert=3255 state_event=4042`). Proof that the reruns executed against the scratch target, not the product surface.

Repair-iteration scratches were retained fail-closed as required: `tnx_cp2_d49becebb1df462686828487d795a9b4`, `tnx_cp2_4a5f194ad3924cb7ad3c77e1e03dcb66`, `tnx_cp2_9efd120b0db0454e862fd9acc604a3d6`, `tnx_cp2_38d529c99b404d1cb0ff2f81be8744f4`, `tnx_cp2_d9e1a10a52784d9fbf5512cb9829b62f`. No database was dropped without its marker/OID/owner check.

Shared-runtime closure extension (same day): the remaining mutating harnesses that defaulted to the shared runtime also refuse now — `passenger-smoke.mjs`, `passenger-s01-r1-acceptance.mjs`, `passenger-s09-no-path-r1-acceptance.mjs` exit 1 with `runtime identity missing` and zero requests (`.release-evidence/r7-guard-negative-20261015-exec02.log`). `passenger-browser-acceptance.mjs` keeps its own `DATABASE_URL` acceptance-DB guard. Mobile layout smoke `r6-mobile-layout-smoke.mjs` is read-only and runs without a guard: `.release-evidence/r7-mobile-20261015-exec01.log` exit 0, 390×844, zero console errors, zero failed requests, no horizontal overflow. `passenger-smoke.mjs` also gained the same-origin `origin` header its proxy mutations require, and its activation/progress contract was refreshed to the current canonical API — classification `TEST_HARNESS_DEFECT`, closed the same day:

- `exec01` `403 Request origin is required` (proxy cross-site guard; harness sent no `Origin`).
- `exec02`/`exec03` `400` on `POST journeys/:id/activate` — harness sent no `Idempotency-Key` (required by `active-journey.controller.ts` `Valid Idempotency-Key is required.`).
- `exec04` `400` on `PATCH journeys/:id/progress` — `Transit progress requires alighting confirmation for the completed leg.` (product guard correct; harness skipped boarding/alighting).
- `exec05` **PASS** on owned scratch: `alternatives 3`, `segments 5`, `dependencies 23`, `completed 1`, original segments unchanged, 2 distinct HttpOnly signed sessions minted, cross-owner read `403/404`, invalid `journey_id` activate still `400 Path journeyId must match selected_journey`. `{"tier":"ISOLATED_SCRATCH_SMOKE","database":"tnx_cp2_32a9bb2296d041c5b2a41aceb2cd108b","oid":787699,"source_read_only":true}` → `DROP_SUCCESS`. Retained fail-closed scratches from the defect iterations: `tnx_cp2_459487a4…`, `tnx_cp2_243144df…`, `tnx_cp2_1be9ce0a…`. S01/S09 are guarded but not wired into the isolated suite map.

Shared product DB application-level exposure check `NO_DEFECT_DEMONSTRATED`: `listAlerts` is owner-scoped and journey-filtered, recovery proposals filter `expires_at > now()`, state transitions resolve stale rows, and the UI renders every alert with `SIMULATED` → "Controlled simulation" plus `freshness_status expired`; the nine open expired rows all predate 2026-10-15. Disposition record: [R7-SHARED-DB-DISPOSITION.md](./R7-SHARED-DB-DISPOSITION.md).

## Mutating suites

Tier A, CP2 and CP3 invocations used invocation-owned scratch databases with ownership identity and fail-closed cleanup. **Historical execution deviation (2026-10-15):** the earlier standalone V20/S14, M5/M6/M7 and GPS browser reruns used the product runtime at 3000/3001 and created journey/report state there. Impact inventory: [R7-SHARED-DB-IMPACT.md](./R7-SHARED-DB-IMPACT.md). The isolation defect is now fixed and every affected suite has been re-verified on owned scratch with the shared product DB provably unchanged (see above). The records left by the deviation are **not** deleted or hidden: they stay in the product DB and need a Product Owner retain/quarantine/remediation decision before release clearance. Controlled incidents were closed through supported endpoints only; no SQL cleanup or deletion was performed. Preserved failed scratches: `tnx_cp2_ad05ec51619f49c2a382716768d7babd` (historical HTTP 500), `tnx_cp2_ad2c6a51159c44cc9a3516bbe360fe06` (helper cookie decoding), `tnx_cp2_69fdfd69058b4072b46042b9ce5aa988`, `tnx_cp2_0f54c153c0b1497998f249153d90bdbc`, `tnx_cp2_0c27c4327d224a0198d980efaaa3db25` (pre-fix verify 400) plus the repair-iteration scratches listed above. Earlier successful `tnx_cp2_79b3124926904ce4b61133d20075af15` reported `DROP_SUCCESS`.

## Bounded build reliability check — 2026-10-15 continuation

- Next 16.3.6, React/react-dom 19.3.0; `pnpm --filter @transum-in/web why react react-dom` resolves one version each (`r7-build-dependencies-20261015-exec01.log`). No duplicate React demonstrated; no custom global error boundary found.
- Historical `r7-check-20261015-exec08.log` contains a non-standard `NODE_ENV` warning followed by `/_global-error` null `useContext`; passing exec09 lacks that warning. This is a correlation, not verified causation.
- Two serial `pnpm --filter @transum-in/web build` runs passed (`r7-build-20261015-exec11.log`, exec12); subsequent `pnpm check` exit 0 (`r7-check-20261015-exec11.log`). Default web dev stopped before final check; isolated acceptance uses separate `.next-cp2-acceptance-dev` output. No cache deletion, dependency change, or prerender bypass.
- Classification remains `KNOWN_INTERMITTENT_RISK / ROOT_CAUSE_NOT_VERIFIED`; no source fix claimed. Release requires explicit residual-risk acceptance.
- Combined scratch identity reconciled from raw `r7-full-integration-20261015-exec02.log`: name strips hyphens from UUID `e30664df-4b58-419a-94fd-dbdf2df0f3bf`; marker retains them. OID 802266, owner matched the invocation's configured role, `DROP_SUCCESS`. Earlier copied `4194` was `REPORT_TRANSCRIPTION_ERROR`, not demonstrated guard defect.

## Remaining work, not external blockers

Standard integration, Tier A, CP2, sequential CP3 and production build passed on this R7 checkpoint. Standalone browser/corridor reruns were re-executed on owned scratch on 15 October and all exit 0: V20/S14 21/21, M5 22/22, M6 13/13, M7 20/20, GPS PASS, CP2 with signed-session expiry PASS, CP3 sequential R1→R2 PASS with durable lineage. The earlier shared-runtime reruns of the same suites are superseded for isolation purposes but their product-DB records remain and are inventoried separately. Remaining delivery work: complete source review, update delivery board/evidence index/capability matrix, and private incremental commit/push after Product Owner release clearance. This checkpoint is not R7 FINAL or full Prototype V1 acceptance.

## External/human boundaries

Physical GPS and human Product Owner acceptance `NOT_VERIFIED`; [UAT](./R7-PASSENGER-UAT.md). Typed residential search `BLOCKED_BY_AUTHORIZATION`; named POI/independent pedestrian reference `BLOCKED_BY_DATA`. No provider approved or activated; [concrete decisions](./R7-EXTERNAL-SERVICE-DECISIONS.md). Tier B `BLOCKED_BY_ENVIRONMENT`. Live S09 negative routing remains `NOT_VERIFIED`; preserve legitimate OTP fallback.
