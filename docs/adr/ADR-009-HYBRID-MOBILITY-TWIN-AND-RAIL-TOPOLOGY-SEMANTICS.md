# ADR-009: Hybrid Mobility Twin projection and rail-topology semantics

## Status

Accepted for Phase 2B.

## Decision

Operational observations are immutable evidence. A deterministic projector selects only temporally applicable, unexpired observations using the Phase 1D authority order. The selected operational condition and evidence type remain separate. With no fresh evidence, the effective condition is `UNKNOWN`; absence never implies `AVAILABLE`.

Current state is a replaceable read model, while meaningful condition changes are append-only history records. A finalized network snapshot binds the Phase-1 transit version, Phase-2A spatial version, observation cutoff, projection configuration, sparse effective states, and a canonical content hash. Missing snapshot membership means `UNKNOWN`. Scenario overlays are excluded and cannot mutate base state.

The Phase-2A rail edge counts—KRL 25, MRT Jakarta 23, LRT Jakarta 101, and LRT Jabodebek 82—count OSM way fragments carrying operator/network evidence. They are `OSM_GEOMETRIC_WAY` topology records represented by `spatial.rail_topology_edge` and state-bearing `RAIL_TOPOLOGY_EDGE` identities. They are not station adjacency, scheduled service edges, `transit.transit_segment` rows, trips, frequencies, or proof of current service. Their corresponding station counts are 86, 13, 11, and 18.

## Consequences

Replay at time T filters on both observation and receipt time, so later-received evidence cannot rewrite what was knowable at T. Snapshot hashes canonicalize object keys, making configuration property order irrelevant. Finalized snapshot metadata and membership reject update/delete/late insert operations. Replayed observations and unchanged projections cannot duplicate transitions.

Topology-only rail remains usable for identity and spatial lookup without acquiring invented schedules, availability, or live status. Phase 3 may consume durable state-change records but must preserve these evidence and capability boundaries.

The 237,888 walking nodes of degree one are retained. A bounded audit identified 245 near the strict envelope boundary, 819 tagged interior terminals/access nodes, and 236,824 untagged interior endpoints. With zero duplicate edges, zero zero-length edges, zero unintended self-loops, and zero invalid geometry/SRID, no graph-construction repair is justified. Degree one remains an auditable topology condition, not an automatic defect.

## Rejected alternatives

Defaulting missing evidence to `AVAILABLE`, overwriting observations, letting environmental evidence independently close transport entities, mutable finalized snapshots, applying scenario state to the base Twin, and treating OSM rail geometry as scheduled connectivity were rejected because they create false operational claims or destroy reproducibility.
