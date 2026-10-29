# SCX-0 — Supervisor Scope Extension Reconciliation

**Decision state:** APPROVED FOR RECONCILIATION; NOT IMPLEMENTED. **Feature scope after this extension:** FROZEN, except correctness, security, deployment, research evaluation, or a later explicit supervisor change request. **Audit baseline:** accepted Passenger MVP commit `98a62772045c4ede3662a437756e936f277fee5f`; SCX-0 is prepared in a separate worktree. The unfinished PROD-P1 authentication work is not part of this baseline and is untouched.

This document proposes requirements, boundaries, and an execution order. It does not authorize an implementation run, production use, a new numbered phase, provider integration, or a change to the accepted Phase-4/5 research method. Product Owner instructions prevail over older roadmap numbering. Student A retains spatial/Twin/hazard intelligence ownership; Student B retains journey/recovery/product ownership, with typed ports between them ([ADR-004](../adr/ADR-004-STUDENT-A-B-INTEGRATION-PORTS.md)).

## Frozen contracts and evidence boundary

Phase 4 and Phase 5 are accepted PASS; Passenger MVP v0.1 is accepted PASS by Product Owner decision. The selected plan is immutable. Completed travel is never replanned. State-Aware Recovery, feasible middle-span repair and suffix rejoin, same-anchor/same-state FULL REPLAN, itinerary fingerprint, PLR/PCC/ATT/Added Transfers/Recovery Success/DEA, and method-specific latency accounting remain unchanged ([Phase-4 audit](../audits/PHASE-4-MULTIMODAL-JOURNEY-INTELLIGENCE-AUDIT.md), [Phase-5 audit](../audits/RUN-5B-STATE-AWARE-JOURNEY-RECOVERY-AUDIT.md), [comparison evidence](../../data/manifests/RUN-5B-RECOVERY-COMPARISON-EVIDENCE.json)). The extension must wrap these methods with a defensible anchor and additional candidate sources, not rewrite their definitions. Whether future mid-leg cases belong in the same research population requires a separately frozen evaluation stratum; historical Phase-5 results must not be relabeled.

`UNKNOWN != UNAVAILABLE`; expired evidence is not current; `SIMULATED != LIVE`; flood geometry/exposure is not operator-confirmed closure. Operational condition, evidence type, incident lifecycle, and spatial hazard exposure are four separate dimensions. A candidate, stale publication, weather forecast, or provider app feature is never proof of a current closure or a public API ([operational architecture](../architecture/LIVE-OPERATIONAL-DATA-ARCHITECTURE.md), [map semantics](../architecture/MAP-DATA-SEMANTICS.md), [ADR-003](../adr/ADR-003-SCENARIO-OVERLAY-MODEL.md)).

## Current capability map at accepted baseline

`PARTIAL` means a narrower capability exists but not the approved extension end-to-end. None of these classifications incorporates the unaccepted PROD-P1 worktree.

| Capability | Status | Evidence and precise gap |
| --- | --- | --- |
| Active Journey | IMPLEMENTED | Immutable selected plan, separate active instance/lifecycle, dependencies, owner-scoped persistence; browser-local owner is not production authentication ([P1 audit](../audits/PRODUCT-P1-PASSENGER-MVP-AUDIT.md)). |
| Controlled progress | IMPLEMENTED | `completedLegCount`, `currentLegSequence`, timestamp and revision; explicitly `CONTROLLED_MANUAL`, not GPS ([active journey domain](../../apps/api/src/journey/domain/active-journey.ts)). |
| Mid-leg interruption | MISSING | Recovery anchor is the first uncompleted leg boundary; no verified position within a leg. |
| Current position/location | MISSING | No location-consent, timestamp, accuracy, map-match, or user-confirmed current-position contract. |
| Operational state/freshness | IMPLEMENTED | Append-only observations, Twin projection, priority, expiry and `UNKNOWN` behavior ([Phase-2B audit](../audits/PHASE-2B-HYBRID-MOBILITY-TWIN-AND-NETWORK-SNAPSHOT-AUDIT.md)). |
| Affected active journey | IMPLEMENTED | Future-only canonical dependency fan-out; completed-only disruptions suppressed ([RUN-5A audit](../audits/RUN-5A-ACTIVE-JOURNEY-AND-TARGETED-ALERT-AUDIT.md)). |
| Targeted SSE | IMPLEMENTED | Owner/journey-scoped stream with reconnect in Passenger MVP; owner identity remains browser-local at this accepted baseline. |
| State-Aware Recovery | IMPLEMENTED | Boundary-anchored repair, prefix preservation, feasible suffix rejoin, blocked-entity validation and separate FULL REPLAN. Mid-leg anchoring is missing. |
| Walking routing | IMPLEMENTED | OTP uses the Phase-2-bound OSM pedestrian graph; no validated hazard-aware path exclusion. |
| Incident persistence | PARTIAL | `disruption.event` and Twin observation/history persist; no unified verified incident lifecycle/retraction model or active-incident query policy. |
| Flood/hazard data | PARTIAL | PetaBencana observation and PostGIS direct exposure exist; the retrieved example was already expired and generated no closure ([Phase-3 audit](../audits/PHASE-3-LIVE-DISRUPTION-FLOOD-AND-SCENARIO-INTELLIGENCE-AUDIT.md)). General hazard lifecycle and walking avoidance are absent. |
| Future-journey restriction | PARTIAL | Journey Planner rejects current `UNAVAILABLE` canonical identities and boundedly re-queries; it does not yet consume a separate lifecycle-aware incident view or hazard-walking policy. |
| Recovery Anchor Candidate | MISSING | Existing `RecoveryProposal.recoveryAnchor` is a single verified leg boundary, not a ranked/validated mid-leg candidate set. |
| Cross-modal public-transit repair | PARTIAL | The current multimodal OTP planner may choose different transit modes; no explicit public-transit-first tier policy or on-demand tier. |
| Mobility provider adapter | MISSING / EXTERNAL DEPENDENCY | No repository-backed Gojek, Grab, or Bluebird capability/rights evidence or adapter. |
| External mobility/navigation handoff | MISSING / EXTERNAL DEPENDENCY | No verified provider launch/prefill/book capability or Google Maps URL handoff contract/test. |

## Data and routing resource matrix

Technical routeability is **not** production-rights clearance. Values below are the recorded snapshot, not a fresh external license or timetable audit. The [Phase-4 capability matrix](../../data/manifests/PHASE-4-ROUTING-CAPABILITY-MATRIX.json), [Phase-4A-R rights audit](../audits/PHASE-4A-R-ROUTING-DATA-RIGHTS-RESOLUTION.md), [router input](../../data/manifests/PHASE-4B-A-ROUTER-INPUT.json), [Phase-1 manifest](../../data/manifests/PHASE-1-CANONICAL-TRANSIT-SNAPSHOT.json), and [Phase-2A spatial manifest](../../data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json) are the evidence sources.

| Mode | Source / snapshot and license | Coverage and technical identity/routing | Production/redistribution rights and limitation |
| --- | --- | --- | --- |
| TransJakarta | Official PT Transportasi Jakarta GTFS, retrieved 2026-09-29, raw SHA-256 `63b4fb14…`, Phase-1 snapshot `phase1-transit-20260929-63b4fb14d9af-v2`; CC BY 4.0 recorded. | 142 non-Mikrotrans routes in the Phase-4 split; OTP routeable; exact scoped STOP/ROUTE → canonical → Twin bindings verified. Source frequency windows are not exact departures. | Manifest records redistribution permitted with attribution; attribution and deployment compliance still required. Static GTFS is not a live service-status feed. |
| Mikrotrans | **Same** official TransJakarta GTFS and license, not a second source; 98 source-classified routes. | OTP routeable, STOP/ROUTE canonical identities verified; source frequency timing. | Same CC BY 4.0 attribution position; no separate JakLingko operational/API permission implied. |
| KRL | Official KAI Commuter GAPEKA/PDF, effective 2025-12-13; controlled local derivative/input SHA-256 `cdefb74b…`; no open license recorded. | OTP routeable under evidenced research calendar; 83 routing stops/62 routes; STATION/ROUTE → Twin bridge verified; `EXACT_SCHEDULE` only for this source window. | Local noncommercial research handling; automation, redistribution and commercial rights **UNKNOWN**. Official PDF is not an official GTFS. The older URL in the capability matrix is not the final GAPEKA provenance; use the later 4A-R audit and 4B-A manifest. |
| MRT Jakarta | Official public operating pattern; controlled input SHA-256 `bc7913a9…`; no open redistribution license recorded. | 13 stations/1 route, OTP routeable, canonical STATION/ROUTE identities; `FREQUENCY_DERIVED`. | Local research only; redistribution unknown; commercial use requires permission according to recorded official disclaimer. Not exact departure/ETA. |
| LRT Jakarta | Official 2026-09-25 limited-operation publication after Kelapa Gading–Manggarai extension; controlled input SHA-256 `ee06a380…`; rights not open. | Current 11-station topology, 1 route, OTP routeable, canonical STATION/ROUTE identities; Matraman/Proklamasi pass-through; `FREQUENCY_DERIVED`. | Local research only; operator-site automation restricted, redistribution unknown. Late six-station pattern is limited service, not the whole current line. |
| LRT Jabodebek | Official public displayed timetable; controlled input SHA-256 `13cb641b…`; no open redistribution license recorded. | 18 stations, two branches represented in routing input, OTP routeable, canonical STATION/ROUTE identities; `FREQUENCY_DERIVED`, not exact train pairing. | Local research only; redistribution/commercial rights unknown. |
| OSM / WALK | Geofabrik Java OSM extract; bounded Phase-2A PBF SHA-256 `ffb2269b…`, snapshot `phase2a-spatial-20260929-ffb2269b1b9c-v1`; ODbL 1.0, © OpenStreetMap contributors. | 947,974 network nodes/2,315,442 directed walking edges; OTP uses **the same** PBF derivative; 8,188 endpoint resolutions and 8 unresolved; graph identity and pedestrian paths verified. | ODbL use requires attribution and applicable share-alike/database-compliance review before distribution/deployment. No sourced sidewalk safety, flood-passability, or wheelchair guarantee. |

All six transit modes and WALK have real single-mode routeability on the pinned 2026-10-02 `Asia/Jakarta` research graph, and cross-mode routes were accepted in Phase 4. Graph binaries and restricted derivatives remain local/Git-ignored. A new live deployment, data refresh, or provider handoff must pass new rights/freshness checks; this matrix does not grant permission.

## Extension requirement register

Stable extension IDs are `SCX-FR-001`–`SCX-FR-015`, separate from frozen baseline `FR-001`–`FR-014`. **All are APPROVED FOR RECONCILIATION / NOT IMPLEMENTED** as extension-level acceptance claims, even where the current platform supplies a partial primitive. Tests below are proposed acceptance, not executed evidence.

| ID | Requirement and proposed acceptance invariant |
| --- | --- |
| SCX-FR-001 | Mid-leg interruption records a bounded, timestamped position/progress claim without marking a whole uncompleted leg as completed. |
| SCX-FR-002 | Recovery starts from a user-confirmed or otherwise verified current progress/location anchor; no teleport, rewind, or invented continuous vehicle position. |
| SCX-FR-003 | HazardEvent ingests flood geometry/time/source/freshness separately from operational state. |
| SCX-FR-004 | Hazard/exposure never independently sets transit `UNAVAILABLE`; only explicit authorized operational evidence/rule can block. |
| SCX-FR-005 | OperationalIncident has auditable active/resolved/expired/retracted lifecycle, evidence and affected canonical entities. |
| SCX-FR-006 | A verified active operational restriction reaches only relevant ACTIVE journeys, with progress-aware deduped targeting. |
| SCX-FR-007 | New plans observe the same currently effective restriction; resolved/expired incidents cease to block. |
| SCX-FR-008 | RecoveryAnchorCandidate records method, location, time, graph/snapshot binding, uncertainty and confirmation status; no unsupported safety label. |
| SCX-FR-009 | Walking recovery evaluates source-backed hazard exposure and only excludes edges under an explicit validated policy; unresolved safety remains unknown. |
| SCX-FR-010 | Tier 1 preserves/repairs existing transit structure; Tier 2 tests alternative public transit/walk before optional on-demand Tier 3, with typed infeasibility. |
| SCX-FR-011 | Cross-modal fallback may combine routed walking and an on-demand handoff only when transit options fail or an explicit policy says unsuitable. |
| SCX-FR-012 | ProviderCapability is versioned by provider, platform, region, evidence, validity, terms and each capability flag; unknown fails closed. |
| SCX-FR-013 | ExternalMobilityHandoff returns only verified launch/prefill fields; booking remains external unless explicitly authorized and integrated. |
| SCX-FR-014 | No provider fare, ETA, vehicle class, availability, booking, or deep-link parameter is fabricated. Missing data is `UNKNOWN`/omitted. |
| SCX-FR-015 | Google Maps navigation URL is a separate, documented navigation fallback after its current official URL behavior is verified; it is not a ride booking or hazard-safe route assertion. |

## Proposed minimal domain/interface contracts (design only)

Reuse `OperationalObservation`, `disruption.event`, `disruption.entity_impact`, `twin.mobility_entity/state/history`, `JourneyRoutingPort`, `ActiveJourney`, and `RecoveryProposal`. A new table/type is justified only after RND-X1 proves an existing record cannot preserve the semantics. All IDs remain source-/snapshot-scoped per [ADR-002](../adr/ADR-002-MOBILITY-ENTITY-IDENTITY.md); all times are timezone-qualified.

| Contract | Minimal proposed fields and boundary |
| --- | --- |
| `HazardEvent` | Existing disruption-event identity; hazard kind, source event ID, geometry/SRID, observed/received/expires, evidence type, source/rights/provenance, severity **only when supplied**. Environmental evidence, never transit operational state. |
| `OperationalIncident` | Incident ID; type; source observation IDs and authority; evidence type; affected canonical entity IDs and modes; stated condition; effective interval; provenance; independent lifecycle/revision. May reference supporting `HazardEvent`, but that reference cannot infer closure. |
| `IncidentLifecycle` | Append-only proposed transitions `CANDIDATE → ACTIVE → RESOLVED`, plus `EXPIRED` and `RETRACTED` where justified. `CANDIDATE` is non-authoritative; `ACTIVE` requires explicit transport-operational verification (or labeled controlled simulation), valid time and scope. Resolution/retraction is auditable and triggers state reprojection; freshness expiry is not silently extended. Exact DB representation remains an EXT-X1 decision. |
| `AffectedOperationalEntity` | Existing canonical/Twin `mobilityEntityId`, entity class, impact kind (`EXPOSURE`, `POTENTIAL`, `CONFIRMED_OPERATIONAL`), incident/observation IDs, effective state only for confirmed operational impact, rule/provenance/version. No name-only merge. |
| `RecoveryAnchorCandidate` | Active journey/progress revision; coordinate or canonical access node; method (`USER_CONFIRMED`, `VERIFIED_ACCESS_POINT`, `LAST_KNOWN_BOUNDARY` as applicable); observed time, accuracy/uncertainty, graph/snapshot, source/provenance, confirmation status, snap/path result and rejection reason. `RECOMMENDED` is not `SAFE`; unsupported mid-leg precision must be rejected or downgraded to an explicitly labeled last-known boundary. |
| `MobilityFallbackOption` | Tier, method (`TRANSIT_REPAIR`, `ALTERNATIVE_TRANSIT`, `ON_DEMAND_HANDOFF`, `NAVIGATION_ONLY`), routed access path, pickup/destination candidate, feasibility reason, separate duration/walk/transfers/hazard exposure, price/ETA availability and certainty, evidence/snapshot; `UNKNOWN` values remain null. No weighted magic score or `CHEAPEST` without comparable fares. |
| `ProviderCapability` | Provider/platform/region/version, evidence URL, checked-at/valid-until, terms status; `appLaunch`, `pickupPrefill`, `destinationPrefill`, `liveEta`, `livePrice`, `fixedPrice`, `vehicleClasses`, `directBooking` each `VERIFIED_TRUE`, `VERIFIED_FALSE`, or `UNKNOWN` (with evidence). Unknown cannot enable behavior. Gojek, Grab, Bluebird start as **unverified registry candidates**, not adapters. |
| `ExternalMobilityHandoff` | Option/provider/capability-version IDs; externally validated URL/action only when permitted, pickup and destination labels/coordinates with uncertainty, fields actually prefilled, unfilled fields for copy/manual entry, created/expiry, provenance and disclaimer. It cannot assert a booking, driver, ETA, fare, or passenger safety. A generic app/site launch is distinct from destination prefill and direct booking. |

The provider adapter is a read-only capability/launch boundary until documented rights exist. It does not call private APIs, inspect undocumented mobile traffic, or handle passenger payment. The minimum graceful state when every private API is absent is: show a **candidate** pickup and destination; allow copying both; offer only an independently verified generic provider launch, or the separately verified Maps navigation fallback; omit live price/ETA and booking controls. Labels `FASTEST`, `MINIMUM WALK`, and `PRICE CERTAINTY` require comparable, source-backed fields for the actual options. No `CHEAPEST` claim follows from missing fares.

## Golden supervisor acceptance scenario — proposed, not executed

**Fixture/context freeze:** use one versioned OTP graph + Phase-2 OSM snapshot, one service date/time in `Asia/Jakarta`, one finalized Twin snapshot, a real Gambir/Central Jakarta → Pejaten/South Jakarta OD that OTP actually returns, and source-backed canonical stop/route bindings. Before freezing a test journey, discover and record a genuine TransJakarta plus onward transit/Mikrotrans candidate; if the graph cannot produce it, mark this scenario blocked and select a documented nearby equivalent rather than hard-code a journey. Record the route/input hashes, original fingerprint, selected active instance, and controlled progress revision.

1. Passenger selects that real public-transit journey; immutable original plan and owner scope persist.
2. Controlled, explicitly `SIMULATED` progress reaches a **verified Kuningan-area location/leg position**. The future mid-leg contract must store how the position was obtained; if it cannot be verified, the system uses the last known boundary with an explicit limitation, not a fabricated Kuningan position.
3. Ingest two distinct records: a `SIMULATED` flood hazard geometry/exposure and a separate `SIMULATED` operator-style operational restriction with its own verified-for-test source, incident ID, active interval, canonical affected entity and expiry. Hazard alone does not close anything.
4. The current future dependency becomes `UNAVAILABLE` only through the operational record. Indexed targeting identifies this active journey but not unrelated journeys; completed legs remain history. A new Gambir → Pejaten planning request uses the same effective current Twin state and avoids the blocked identity or returns an explicit typed no-valid-route/warning under the documented policy.
5. Resolve candidate pedestrian access/pickup anchors against the snapshot, recording snap distance, topology, uncertainty and invalid candidates. Attempt Tier 1 preserve/repair/rejoin, then Tier 2 alternative transit/walking under identical state. Every accepted route is checked for canonical identities, closure, and explicit hazard-walking policy.
6. If no viable public-transit continuation exists (or a documented explicit suitability rule rejects it), return Tier 3 routed walking access plus on-demand *handoff candidate*. Emit Gojek/Grab/Bluebird-specific launch or prefill only for capabilities verified by RND-X1. Otherwise expose copy/manual steps or a verified Maps **navigation** URL. Fare, live ETA, vehicle class and booking remain unknown unless sourced.
7. Persist deterministic input/result fingerprints, incident/hazard lineage, anchor reasons, tier decisions, blocked avoidance, original-vs-proposed structure and timing components. Compare Phase-5 methods only within a frozen same-anchor/same-state research stratum; do not overwrite existing SEMPRO metrics/results.

**Controls:** (A) hazard with no verified operational closure yields exposure information but no transit `UNAVAILABLE`; (B) `UNKNOWN` is traversable; (C) expired incident cannot block; (D) resolved/retracted incident removes its restriction through auditable reprojection; (E) unavailable provider capability omits price/ETA/deep link/booking; (F) no valid route produces a typed failure and clear passenger outcome, never a fabricated path. Add owner isolation, stale position, impossible snap, duplicate incident, and rejoin infeasibility as negative cases before an implementation PASS.

## Implementation impact map — no work authorized here

| Area | Disposition | Likely bounded change / invariant |
| --- | --- | --- |
| Phase-4/5 algorithm and SEMPRO metric definitions | DO NOT TOUCH | Reuse existing normalizer, journey identity, progress/history, repair and FULL REPLAN. Extend inputs/results around them only after an explicit research-method review. |
| Domain/application ports | EXTEND | Hazard/incident lifecycle and anchor/fallback contracts across Student A/B typed boundaries. |
| Observation/disruption repositories and DB | EXTEND | Append-only lifecycle/links and indexed current restrictions only if the existing schema cannot encode them; migration and rollback design later. |
| OTP/routing adapter | EXTEND | Test mid-leg origin and hazard-edge avoidance capability; do not assume OTP supports arbitrary dynamic walk-edge exclusions. |
| PostGIS/spatial | REUSE + EXTEND | Existing SRID 4326 graph/intersection/endpoint resolution; add validated hazard-aware path/candidate query only after rules are established. |
| Twin operational projection | REUSE + EXTEND | Source priority/expiry unchanged; lifecycle resolution must reproject, not delete evidence. |
| Active Journey/impact/SSE | REUSE + EXTEND | Preserve historical plan, future-only targeting and owner isolation; add location/incident references and scoped status update. |
| Recovery application | EXTEND | Anchor candidate validation and tier orchestration around frozen method; never silently substitute an on-demand suggestion for a successful transit repair. |
| Provider adapter/capability registry | NEW | Only capability-verified launch/prefill modules; no undocumented API or inferred booking. |
| Web passenger experience | EXTEND | Explicit current-position consent/confirmation, hazard vs closure, tier/unknown data, accessible handoff; no fake LIVE. |
| Tests/browser E2E/research evidence | EXTEND | Controlled negative/positive matrix, rights/freshness checks, real OTP golden path, owner isolation, reproducible manifests and separate mid-leg stratum. |
| Deployment/security | DO NOT TOUCH NOW | Future authentication, precise-location privacy/retention, secrets, API rights, rate limits and legal review are hard gates before public exposure. |

## RND-X1 questions and pass/fallback evidence

Every question is a feasibility gate, not a presumption that a vendor API exists. Record retrieval date, official source/terms, geographic/temporal applicability and repeatable test artifact.

| Question | Evidence needed | Pass criterion | Fallback if not proven |
| --- | --- | --- | --- |
| How are mid-leg recovery anchors generated? | Controlled progress samples, canonical leg geometry/access nodes, bounded snap metrics. | Repeatable candidate with provenance, uncertainty and no teleport/rewind. | Last verified boundary explicitly labeled; no mid-leg claim. |
| Can current position be trusted? | Consent method, timestamp, accuracy, user confirmation, privacy design. | Fresh, scoped, revocable position with conservative invalid/stale behavior. | Manual canonical place/leg-boundary selection. |
| How is hazard geometry intersected? | PetaBencana/BPBD geometry schema, SRID, validity, PostGIS edge cases. | Reproducible intersection/exposure with boundary/empty/invalid tests. | Exposure UNKNOWN; no closure. |
| Can walking avoid hazard exposure? | Source severity semantics, explicit passability policy, OTP/walk-edge exclusion experiment. | Routed path truly excludes policy-blocked edges and remains snapshot-bound. | Warn about exposure/unknown; do not call path safe. |
| Are PetaBencana/BPBD adapters permitted? | Official API/terms, credentials, rate/freshness, academic/redistribution rights. | Documented accessible mechanism and rights for the intended use. | Recorded fixture/controlled simulation labeled, no LIVE claim. |
| What verifies an operational incident? | Official/operator source contract, actor authority, scope, correction/retraction rules. | Audit-ready source-to-entity proof, active interval and deterministic resolution. | Candidate/review-only; cannot block transit. |
| What can Gojek/Grab/Bluebird links do? | Current official developer/deep-link docs, platform/region tests, terms. | Exact verified launch/prefill fields and failure behavior for each platform. | Copy pickup/destination; omit unverified provider action. |
| Are private provider APIs available for ETA/fare/booking? | Written partner/API terms, credentials, sample contract, data rights. | Explicit authorized access and reproducible schema/freshness tests. | No live ETA/fare/booking; generic handoff only if verified. |
| What navigation URL is supported? | Current official Google Maps URL documentation, device/browser tests, URL encoding/privacy. | Verified route/destination navigation handoff, no false hazard-safe assertion. | Plain coordinates/address copy. |
| Does OTP meet recovery performance needs? | Same-graph/snapshot/time bounded mid-leg and cross-modal query observations. | Reproducible timings and safe timeout/degraded behavior, no invented SLA. | Typed no-path/unavailable; preserve original progress. |
| Can PostGIS store/query the extension safely? | Geometry counts, indexes, retention and bounded benchmark, migration/backup plan. | Deterministic query and capacity evidence under a defined dataset. | Limit envelope/retention and defer public-scale claims. |

## Human/external gates and recommended execution

An AI coding agent cannot grant operator/JLI API access, BPBD credentials, ride-hailing partnership/private API rights, rail-data redistribution permission, production secrets/cloud billing, DNS ownership, or legal/privacy approval for precise location. Written approvals, platform-specific terms and source attribution must precede public integration. Unknown rights remain unknown; `NO_EXPLICIT_RESTRICTION_FOUND` is not an open license.

Proposed dependency order, **not authorization**:

1. `RND-X1` — freeze source, rights, provider and routing/location feasibility; reject unverified capabilities.
2. `EXT-X1` — separate HazardEvent and operational incident lifecycle/projection, with future-plan and active-journey restrictions.
3. `EXT-X2` — mid-leg progress evidence, candidate anchor and recovery input wrapper; frozen Phase-5 algorithm/metrics remain intact.
4. `EXT-X3` — hazard-aware walking policy, PostGIS/OTP path verification and graceful unknown behavior.
5. `EXT-X4` — public-transit-first tier orchestration and capability-gated on-demand/navigation handoff.
6. `EXT-X5` — real OTP + controlled SIMULATED golden browser E2E, negative controls, owner isolation and reproducible evidence; then **FEATURE FREEZE**.
7. `AI-X1` only if separately authorized: grounded explanation of already validated structured facts, never incident/routing authority.
8. `EXP-B1` research pilot after an explicit benchmark/stratum freeze; main quantitative evaluation is still not complete.
9. `PROD-P1` authentication WIP resumes **only** on separate Product Owner authorization; `PROD-P2+` security/deployment/operations remain closed. **Security dependency:** externally exposed precise location, owned incident/alert streams, or provider handoff must wait for authenticated server-side ownership and privacy review. Therefore `EXT-X2`–`EXT-X5` may run only as controlled research until PROD-P1 is accepted, or the Product Owner may authorize PROD-P1 earlier without changing the feature dependency order.

This is an extension namespace, not a numbered Phase 6. No implementation, provider claim, production readiness or new research result is asserted by this document.
