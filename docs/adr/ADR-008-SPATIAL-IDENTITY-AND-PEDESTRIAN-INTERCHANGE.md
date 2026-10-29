# ADR-008: Versioned spatial identity and pedestrian interchange

## Status

Accepted for Phase 2A.

## Decision

Use version-scoped PostGIS network nodes and directed walking edges. Contract degree-2 geometry nodes but retain source-way identity and full contracted geometry. Keep transit stations separate across operators. Resolve operational references with exact scoped source IDs first, then documented aliases; ambiguous names remain unresolved.

Use geodesic distance only to generate candidates. Persist pedestrian path status and network distance separately, and require actual endpoint connectivity for a connected interchange.

## Consequences

Walking edges have state-bearing mobility identities per direction, preserving future directional closures without duplicating every transit trip. A new OSM or transit snapshot creates a new dataset version and never overwrites an older graph. Cross-operator station identity is not merged; interchange relationships are separate derived rows.

## Rejected alternatives

Global name merging, arbitrary forced snaps, and treating OSM as official operator GTFS were rejected because they destroy provenance or create false operational claims.
