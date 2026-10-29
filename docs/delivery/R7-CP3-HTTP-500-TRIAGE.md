# R7 P0 — CP3 HTTP 500 bounded triage

Date: 15 October 2026. Root cause: `NOT_VERIFIED`. Successful later R6 CP3 acceptance remains valid for its own invocation, not proof historical failure harmless.

## Retained evidence

- Failed log: `.release-evidence/R6/cp3-recovery.log`; `500 !== 201` after controlled report review and before `alert.owner_targeted=true`.
- Failed scratch: `tnx_cp2_ad05ec51619f49c2a382716768d7babd`; read-only identity check confirms OID `645078`, owner and ownership marker verified against harness identity; role value omitted from this document. No cleanup or mutation performed.
- Successful log: `.release-evidence/R6/cp3-recovery-rerun.log`; real OTP alternative, completed history preservation, map/timeline/navigation parity, lost-response reconciliation, completion/reload, owned scratch `DROP_SUCCESS`.

## Endpoint attribution

Source at R6 HEAD `60a1d704f21536d3e0fda9bbac39e88250acbd82`, `apps/web/scripts/passenger-cp3-recovery-navigation-acceptance.mjs`: after line 369 review assertion, exact strict equality against 201 occurs at line 401 for **second browser context planning**, `POST /api/passenger/journeys/plan` (upstream `POST /api/v1/journeys/plan`). Second-context activation uses a boolean assertion permitting 200/201, so would not emit `500 !== 201`.

This is source-order attribution, not captured request telemetry. Historical log supplies no response body, request/correlation ID, API stack, SQLSTATE, transaction trace, or request timestamps. Harness captured API output into memory without exporting exception details; these cannot be reconstructed honestly.

## Durable state observed read-only

Existing product PostgreSQL container restarted without recreation; no migration/reset or graph build. After Docker restart, read-only SQL inspected failed scratch:

| Record                                          | Observed                               |
| ----------------------------------------------- | -------------------------------------- |
| journey plans / active journeys / progress rows | 1 / 1 / 1                              |
| plan + active journey ID                        | `7378ddef-6b2c-4ec0-bc24-4f9a26a7f4d3` |
| lifecycle / revision / completed legs           | ACTIVE / 2 / 1                         |
| passenger reports / verifications / impacts     | 1 / 1 / 1                              |
| recovery plans / acceptances                    | 0 / 0                                  |
| plan persisted at                               | `2026-10-14 15:10:51.026+00`           |

First context clearly committed its activation, progress, report and controlled review before failure. No second active journey or recovery acceptance persisted. Planning itself is read-only routing; absence of a second activation row does not explain its HTTP error. No assertion that every possible side effect was absent.

Current connection state after Docker restart cannot establish connection/transaction state during historical failure. Container restart loses original sessions. Setup passed readiness and first workflow; scratch teardown correctly refused drop on failure. Startup race, fixture issue, connection error, routing failure and product defect remain unproven alternatives.

## Bounded isolated reproduction attempt (2026-10-15)

New source diagnostics (stage plus `METHOD /route-template: expected X, received Y`, no cookies/bodies/coordinates) were active for every isolated rerun below. No HTTP 500 recurred:

- `.release-evidence/r7-isolated-CP3-sequential-20261015-exec01.log` — CP3 R1→R2, exit 0, second-context planning succeeded twice, 12 sequential stages, `ASSERT sequential.durable_lineage … exact=true`, scratch `DROP_SUCCESS`.
- `.release-evidence/r7-isolated-CP2-20261015-exec01.log` — CP2 with signed-session expiry, exit 0.
- Two earlier isolated CP2/CP3 invocations on the same day also exit 0 (`r7-cp2-20261016-exec03.log`, plus one additional CP2 invocation).

Intermittent failure not reproduced in four isolated invocations with the strengthened diagnostics. Root cause stays `ROOT_CAUSE_NOT_VERIFIED`; residual risk unchanged. Historical failure log and failed scratch `tnx_cp2_ad05ec51619f49c2a382716768d7babd` preserved. A passing rerun is explicitly **not** treated as proof the historical issue is fixed.

## Disposition and next evidence

Bounded triage complete; no speculative product fix or repeated rerun loop. Preserve failed scratch and logs. R7 strengthens harness endpoint/stage diagnostics without exporting cookies, credentials, residential coordinates, raw request/response bodies or SQL parameters. A later fresh CP3 run can validate current behavior only; root cause stays `NOT_VERIFIED` unless decisive exception or reproducer appears.
