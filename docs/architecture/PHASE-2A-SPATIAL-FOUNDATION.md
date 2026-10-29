# Phase 2A Spatial Foundation

Phase 2A freezes a bounded, reproducible spatial dependency for later routing, Mobility Twin mapping, and disruption-to-entity resolution.

## Identity and provenance

The Geofabrik Java PBF is retained as the immutable source snapshot. The tracked manifest records its SHA-256, the strict Jabodetabek envelope, the processed OPL checksum, the exact `osmium-tool` image, and the Phase-1 transit snapshot dependency. Raw and processed spatial binaries are ignored by Git.

The envelope is the union of the Phase-1 TransJakarta GTFS extent and verified KRL terminal coordinates, expanded by a 5 km geodesic buffer: `106.205898,-6.649546,107.217352,-5.994144`.

## Walking graph

Only OSM ways with a deterministic pedestrian-passability decision enter the graph. Explicit `access=no/private` and `foot=no/private` are rejected; `foot:conditional` and `access:conditional` remain `CONDITIONAL`; motorways and other non-pedestrian highway classes are excluded. OSM does not provide sidewalk quality, safety, or wheelchair claims here, so those fields remain unknown.

The graph contracts degree-2 geometry nodes while retaining junctions, endpoints, crossings, entrances, and transit access nodes. Each directed edge keeps its source way, source tags, geometry, length, direction, and dataset version. `spatial.walking_edge.from_node_id` and `to_node_id` are real composite foreign keys to `spatial.network_node`.

## Endpoint and interchange semantics

Resolution priority is verified entrance/access node, nearest compatible pedestrian node, and finally a conservative 300 m station-centroid fallback. No match outside the configured threshold is forced; unresolved rows remain explicit. Geodesic candidates use a single 1 km ceiling. A candidate is connected only when the bounded directed walking graph returns a path within the 3 km path ceiling; proximity alone is not an interchange.

## Operational identity

`meta.source_entity_reference` stores exact source/operator-scoped references. `meta.entity_alias` stores documented names without a global uniqueness constraint; duplicate normalized names therefore return ambiguity rather than silently merging operators. Exact source IDs always outrank aliases. Fuzzy or AI matching is deliberately outside the source-of-truth boundary.

## Rail topology

OSM rail ways and station nodes are classified only when operator/network tags provide evidence for KRL, MRT Jakarta, LRT Jakarta, or LRT Jabodebek. Official publication URLs are stored on station rows for corroboration. These rows are `TOPOLOGY_ONLY`: they do not imply GTFS schedules, headways, live status, or redistributable official operator data. The current LRT Jakarta OSM topology contains eleven stations and includes Manggarai, consistent with the dated official expansion publication.
