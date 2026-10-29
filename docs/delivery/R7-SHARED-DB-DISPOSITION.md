# R7 shared product DB — disposition record for Product Owner decision

Date: 2026-10-15 (host WIB). Classification of every statement below: read-only inspection unless quoted as executed evidence.

## Current state

- Product DB `transum_in_nexus_product` (oid `16384`, volume `transum-in-nexus-product-postgres-data`).
- Full inventory with per-table counts: [R7-SHARED-DB-IMPACT.md](./R7-SHARED-DB-IMPACT.md). Isolation repair + verified reruns: [R7-CLOSEOUT-STATUS.md](./R7-CLOSEOUT-STATUS.md).
- Baseline vs post-isolation counts are identical (`.release-evidence/r7-shared-baseline-20261015.txt` → `r7-shared-post-isolation-20261015.txt` → final check `plan=322 active=322 report=203 incident=153 recovery_plan=76 recovery_accept=56 impact=3255 alert=3255 state_event=4042`): the isolated rerun batch mutated **nothing** in the product DB.
- Maintenance-safe retention: failed scratch DBs `tnx_cp2_d49beceb…`, `4a5f194a…`, `9efd120b…`, `38d529c9…`, `d9e1a10a…` (repair iterations) plus historical `ad05ec…` (HTTP 500), `ad2c6a…` (cookie), `69fdfd…`, `0f54c1…`, `0c27c4…` and two pre-existing `tnx_acceptance_*` snapshots are preserved; nothing was dropped without marker/OID/owner proof.
- Smoke contract refreshed 2026-10-15: harness defect fixed (`Origin` header, `Idempotency-Key`, boarding→alighting→progress order). `exec05`: SMOKE **PASS** on owned scratch (`tnx_cp2_32a9bb22…`, `DROP_SUCCESS`) — real OTP + signed sessions + cross-owner denial + invalid-payload rejection all verified. Defect iterations retained fail-closed: `tnx_cp2_459487a4…`, `tnx_cp2_243144df…`, `tnx_cp2_1be9ce0a…`. No product-code change; product guards behaved correctly throughout.

## Application-level exposure check (B1) — executed read-only 2026-10-15

Question: can leftover expired `SIMULATED` impacts/alerts surface in ordinary passenger flows?
Findings (code inspection + live DB counts):

- Open rows: `journey_impact` open `9` (6 `AFFECTED` + 3 `RECOVERING`, all `evidence_type=SIMULATED`, all `detected_at=2026-10-13`, **all already expired**), `targeted_alert` open `9` (same window, `3` distinct owners). `open_impacts_from_20261015` = **0** — the R7 deviation window left nothing open. `operational_incident`: `153 RESOLVED SIMULATED`, none open.
- Cross-owner leakage: `listAlerts` (`apps/api/src/journey/infrastructure/kysely-active-journey.repository.ts:671`) runs `assertOwner(journeyId, ownerRef)` first; alert rows are filtered by `journey_id`. Owner B cannot read or see owner A's alert.
- Expired-visibility semantics: recovery proposal queries filter `and (i.expires_at is null or i.expires_at > now())` (`kysely-recovery.repository.ts:61,80,333`), so expired impacts cannot drive recovery proposals.
- Live state transitions resolve stale rows: `processTransition` (`kysely-active-journey.repository.ts:682-700`) sets `resolved_at` on impacts and alerts when effective state becomes `AVAILABLE`/`UNKNOWN`/`EXPIRED`.
- UI honesty: `passenger-app.tsx:2251-2275` renders every alert with `evidenceLabel(evidence_type)` (`SIMULATED` → "Controlled simulation") plus `freshness_status` ("expired") — nothing is presented as verified or live.
- Past active-session expiry hardening (`2026-10-13` session TTL, signed cookie) protects the same Active Journey read path; the browser corridor for a fully expired mid-journey session is `NOT_VERIFIED` on device today.

Verdict: **NO_DEFECT_DEMONSTRATED** in the ordinary flow (owner-scoped, expiry-filtered for recovery, honestly labeled in UI). No product code change made for this; a broader "hide every SIMULATED event" change would break controlled prototype acceptance and is not justified by this evidence.

## Decision options (PO chooses; no destructive option is executed by the agent)

1. **Retain as-is (default, RECOMMENDED).** All 9 open expired rows stay; they are owner-scoped, already expired, and truthfully labeled. Evidence preserved. Risk: three owners' journey pages show nine stale "Controlled simulation / expired" cards until those journeys are retried (acceptance risk on a private prototype).
2. **Non-destructive quarantine.** No technical hook exists today for "hidden." Would require a product change (e.g., `resolved_at` backfill or `quarantined` flag + filtering), which mutates records. Only with explicit approval and a migration + scratch-tested regression.
3. **Targeted remediation.** Explicit-close or delete by exact verified ownership. Deletes are irreversible and violate the no-cleanup constraint unless the PO authorizes precisely named rows; the agent will not perform this without per-row provenance proof and written approval.

## Explicit pending decisions

- Disposition choice 1/2/3 above.
- Release clearance acknowledging: HTTP 500 `ROOT_CAUSE_NOT_VERIFIED`, typed residential geocoder `BLOCKED_BY_AUTHORIZATION`, named POI / pedestrian validity / provider booking `BLOCKED_BY_DATA`/`AUTHORIZATION`, Tier B `BLOCKED_BY_ENVIRONMENT`, physical GPS + human UAT `NOT_VERIFIED` + browser DTO-lineage subset `NOT_VERIFIED` (superseded for gate purposes by DB-level durable lineage).
