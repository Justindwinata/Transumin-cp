# ADR-007 — Logical Transit Segments and Trip Traversals

**Status:** ACCEPTED

## Context

The verified TransJakarta snapshot produced 25,727 trip-scoped segment rows but only 17,727 distinct `(route, direction, from stop, to stop)` edges. The 8,000 repeated traversals would force future Mobility Twin state to be duplicated across timetable templates. At the same time, collapsing all rows would lose per-trip sequence and exact source-shape geometry.

## Decision

`transit.transit_segment` is the stable state-bearing logical edge, unique within a dataset version by route, direction, and endpoint stops. It owns one `twin.mobility_entity`. `transit.trip_segment_traversal` associates each trip sequence with that logical edge and retains the exact trip/shape-derived geometry. A trip can therefore preserve timetable and pattern fidelity without multiplying network state.

`transit.trip_frequency` preserves GTFS `frequencies.txt` windows and `exact_times`; the system does not eagerly materialize tens of thousands of departure rows.

## Consequences

- Mobility state can attach to 17,727 stable edges rather than 25,727 scheduled traversals.
- Trip-specific geometry and ordered traversal remain reproducible.
- Logical identity is operator/version scoped through its route and dataset version; identical external IDs from different providers cannot collide.
- Cross-operator stop matching and interchange inference remain explicitly deferred to Phase 2.
- Phase 1B rows are rebuilt from the immutable checksum under pipeline `PHASE_1C_V2`; the prior successful ingestion audit is retained and linked by `replaces_ingestion_run_id`.

## Alternatives rejected

- Keeping trip-scoped entities duplicates future state.
- Collapsing geometry/patterns into one route edge loses source fidelity.
- Inferring shared segments across operators exceeds Phase 1 evidence and scope.
