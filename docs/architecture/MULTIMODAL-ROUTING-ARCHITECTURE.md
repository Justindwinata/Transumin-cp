# Multimodal Routing Architecture

**Status:** RUN 4B-B verified; Phase 4 is ready for Product Owner audit.

## Decision gate

Phase 4A-R established controlled, local, non-redistributed research representations for KRL, MRT Jakarta, LRT Jakarta, and LRT Jabodebek. RUN 4B-A may therefore load those representations into a local router while retaining their source, applicability, timing precision, and rights restrictions. They are derived research inputs, never described as official operator GTFS or open data.

## Preferred router candidate

OpenTripPlanner **2.10.0** is the verified router foundation. The official release is versioned, uses GTFS plus OSM inputs, exposes a provider boundary through its GraphQL API, and is licensed under LGPL-3.0-or-later. Its runtime, input feeds, OSM input, configuration, and graph identity are pinned in RUN 4B-A manifests. Restricted feeds and `graph.obj` remain local/ignored.

The integrated graph now serves the canonical Journey API through `JourneyRoutingPort`, canonical identity resolution, Mobility Twin validation, and bounded retry. Real HTTP acceptance covers every target transit mode in cross-mode journeys while preserving the same Phase-2 OSM input for OTP street routing.

Rejected alternatives at this gate:

- a bespoke full transit router duplicates mature RAPTOR/street-routing behavior and creates unnecessary research risk;
- hard-coded representative routes cannot establish coverage or reproducibility;
- topology-only shortest paths invent timed rail service;
- a third-party hosted planner would obscure input identity and state validation.

## Typed boundary

The implemented `JourneyRoutingPort` remains provider-independent:

```text
planJourney(request) -> JourneyAlternative[]
routerHealth() -> RouterHealth
routingSnapshot() -> RoutingSnapshotMetadata
```

Each alternative contains typed legs, canonical mode, boarding/alighting entity, departure/arrival, distance, timing precision (`EXACT_SCHEDULE | FREQUENCY_DERIVED | ESTIMATED`), route/service references, and provenance. Provider DTOs never leave the adapter.

`JourneyPlannerService` owns normalization-independent orchestration: deterministic alternative ranking, canonical identity validation, Mobility Twin state evaluation, bounded retry, and the `INITIAL_PLAN | FULL_REPLAN` strategy. FULL REPLAN is the Phase-4 research baseline; partial repair is deferred.

## Identity bridge

Router entities resolve by deterministic feed namespace through the invariant `OTP source entity -> canonical transit entity -> twin.mobility_entity`. TransJakarta and Mikrotrans use exact source references to their canonical stops/routes. Rail uses exact references in the versioned controlled-routing dataset: preparation reuses a Phase-2 station mobility identity only when its operator-scoped OSM reference or exact normalized alias is unique, then materializes a canonical `transit.station`; otherwise it creates both a deterministic canonical station and its state-bearing Twin identity. Rail routes likewise materialize as canonical `transit.route` records with state-bearing Twin identities. Runtime resolution never creates fallback identities. Ambiguous, absent, or non-state-bearing mappings fail with `IDENTITY_UNRESOLVED`. Generic OTP `BUS`, `RAIL`, `SUBWAY`, and `TRAM` never become final product identity.

Service/trip references remain schedule provenance rather than state-bearing Twin classes, and segment/edge identities are not emitted by the current OTP journey contract. They are therefore not silently passed through operational validation; enabling either class for blocking requires an explicit canonical mapping first.

## State compatibility

The orchestration layer validates every returned candidate against `MobilityStatePort` before exposing it:

- `UNAVAILABLE` blocks the candidate and triggers bounded alternative search;
- `UNKNOWN` remains baseline-traversable and is reported as operational certainty unknown;
- `DEGRADED` and `DISRUPTED` remain usable only under an explicit configured policy and never gain invented delay;
- expired blocking evidence is non-authoritative;
- scenario overrides remain separate from base state.

## Reproducible input identity

A router build manifest binds:

- the immutable TransJakarta GTFS checksum;
- controlled rail source snapshots and derived-feed checksums with local research restrictions;
- the Phase 2A OSM/spatial snapshot;
- derivation/parser versions;
- OTP release/JRE digests and configuration hashes;
- service-date coverage and rights status.

Raw restricted inputs, derived restricted feeds, and `graph.obj` stay outside Git. The repository may track only manifests/checksums when operator permission requires local-only handling.

## Failure behavior

`POST /api/v1/journeys/plan` is implemented. Typed failures include `NO_ROUTE`, `NO_VALID_ROUTE_AFTER_STATE_VALIDATION`, `ORIGIN_UNRESOLVED`, `DESTINATION_UNRESOLVED`, `ROUTER_UNAVAILABLE`, `INVALID_TIME`, `DATASET_NOT_READY`, and `IDENTITY_UNRESOLVED`; provider failures never become heuristic routes. A fresh `UNAVAILABLE` identity rejects a candidate and supplies its route identities to one bounded OTP retry. `UNKNOWN` and expired evidence do not block. If no validated alternative remains, the API returns the typed no-valid-route error.
