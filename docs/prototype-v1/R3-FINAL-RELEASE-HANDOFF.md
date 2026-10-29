# R3 — final release handoff

Classification: `PROTOTYPE_V1_PARTIAL` (unchanged; core workflow real and verified, external-data capabilities remain blocked).

## Release checkpoint

- Branch: `prototype-v1`
- R2 base: `04376a0978a4decc7f0e14c48bf95d6ab1e9e284`
- R3-1 (harnesses): `2e758dd83e4c34f8c78b6f03374a0e7738f4f2da`
- R3-2 (ledgers + durable evidence index): tip of `prototype-v1` after this commit; confirm with `git ls-remote origin prototype-v1`.
- Remote: `https://github.com/Justindwinata/TRANSUMIN-NEXUS.git` (PRIVATE; verified `gh repo view` → `PRIVATE`).

Deploy surface unchanged: web `127.0.0.1:3000`, API `127.0.0.1:3001`, OTP `127.0.0.1:8080`, PostgreSQL/PostGIS `127.0.0.1:5435` (`transum_in_nexus_product`); snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`, service date `2026-10-02`, graph `ad9fdd3e…331574`.

## Gate summary (executed on current tree)

| Gate                                        | Result                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm check`                                | PASS 0 (101 API + 12 web tests, contracts 11, OpenAPI, api types, format, API+web builds)   |
| `pnpm security:scan`                        | PASS 0 (344 tracked + 13 client; private `.next` cache matches excluded/ignored)            |
| M5 / M6 / M7 / GPS / S01 browser suites     | PASS 0 (22/22, 13/13, 20/20, PASS, 9/9)                                                     |
| V20/S14 exact 20-step workflow              | PASS 0 (20/20), evidence `docs/prototype-v1/R3-RELEASE-EVIDENCE.md` + r3-workflow artifact  |
| S09 negative scenario                       | exit 1, status `NOT_VERIFIED` (genuine walk+6A OTP fallback; 5 incidents verified+resolved) |
| Multi-OD (11 corridors) / Tier A (21 cases) | PASS 0 each                                                                                 |

Detail: `docs/prototype-v1/R3-RELEASE-EVIDENCE.md`, glossed in `docs/prototype-v1/PRODUCT-V1-DELIVERY-BOARD.md` and `PROTOTYPE-V1-CAPABILITY-AND-COVERAGE.md`.

## Publication provenance review

Nine restored data-contract blobs (6 schemas + 3 manifests in `data/manifests`) audited: exact historical-match against `de36772`, JSON-parseable, four secret-pattern classes zero hits, only public operator URLs, no absolute/private paths, no internal restricted IDs. All publishable product contracts; retained. Full audit table: `docs/prototype-v1/release-evidence-index.md`.

## Remaining blockers (honest)

- `BLOCKED_BY_DATA`: named Kemang POI (V01/S01), walk validation (V15/S11), external provider (V16/S12).
- `NOT_VERIFIED`: S09 engine `NO_PATH` + app `NO_VALID_ALTERNATIVE`; V17/S05 generalization.
- `BLOCKED_BY_ENVIRONMENT`: Tier B full snapshot.
- Rating/coverage caveats: OTP candidate-count variance documented; a denial branch was not falsified.
- Required external decisions for the remaining gaps are itemized in blockers tables in both ledgers.

## Reproduce

```sh
pnpm check
pnpm security:scan
env PASSENGER_NETWORK_SNAPSHOT_ID=43fb9a29-0c89-5c72-8826-e3dc2adcfb1f pnpm acceptance:v1:multi-od
node apps/web/scripts/passenger-r1-full-workflow.mjs
node apps/web/scripts/passenger-s09-no-path-r1-acceptance.mjs   # expected exit 1 NOT_VERIFIED
node apps/web/scripts/passenger-report-m5-acceptance.mjs
node apps/web/scripts/passenger-recovery-m6-acceptance.mjs
node apps/web/scripts/passenger-integrated-m7-acceptance.mjs
node apps/web/scripts/passenger-gps-browser-acceptance.mjs
env PASSENGER_NETWORK_SNAPSHOT_ID=43fb9a29-0c89-5c72-8826-e3dc2adcfb1f node apps/web/scripts/passenger-s01-r1-acceptance.mjs
```
