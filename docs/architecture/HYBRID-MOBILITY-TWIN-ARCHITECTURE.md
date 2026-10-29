# Hybrid Operational Mobility Twin Architecture

## Scope

Phase 2B implements storage-independent operational state, history, replay, and immutable base snapshots. It does not implement disruption propagation, scenario execution, routing, journey impact, alerts, recovery, polling, AI providers, or product UI.

## Deterministic flow

```text
validated OperationalObservation
  -> append-only observation store
  -> entity-scoped freshness and temporal applicability
  -> authority/conflict resolution
  -> effective current-state read model
  -> condition-change history record
  -> immutable base network snapshot
```

The operational condition is one of `AVAILABLE`, `DEGRADED`, `DISRUPTED`, `UNAVAILABLE`, `RECOVERING`, or `UNKNOWN`. Evidence remains independently typed as `SCHEDULED`, `OBSERVED`, `LIVE`, `FORECAST`, `SIMULATED`, or `ESTIMATED`. `SIMULATED` is never an operational condition and never becomes `LIVE`.

## Projection rules

Only observations whose `observed_at` and `received_at` are at or before the projection cutoff and whose `expires_at` is later than the cutoff can be effective. Within that set, source authority follows the frozen Phase 1D priority. Equal-authority evidence is ordered by observation time, receipt time, then stable observation ID. No qualifying evidence produces `UNKNOWN`.

Freshness (`FRESH`, `AGING`, `STALE`, `EXPIRED`, `NOT_YET_VALID`, `UNKNOWN`) is metadata, not condition. Expired evidence is retained historically but cannot remain authoritative current state. Environmental/forecast evidence is rejected when it independently asserts `UNAVAILABLE`.

## Persistence and transactions

`twin.operational_observation` is append-only and deduplicated by canonical SHA-256 identity. `twin.mobility_state` is the efficient current-state read model. `twin.mobility_state_history` records only condition transitions and provides the durable `mobility_state.changed` audit semantics. Entity-scoped advisory locks and a single database transaction protect projection/upsert/history against concurrent replay.

`MobilityStatePort` exposes observation persistence, current single/batch lookup, history, replay, snapshot creation, and snapshot retrieval without exposing Kysely rows. The canonical read API implements network state, entity state, and snapshot metadata resources.

## Immutable base snapshot

`twin.network_snapshot` binds transit and spatial dataset versions, cutoff, processing version, canonical configuration, manifest reference, and SHA-256 content identity. `twin.network_snapshot_state` stores sparse effective states; missing rows mean `UNKNOWN`. Database triggers prevent any mutation of finalized metadata or membership.

Snapshot generation sorts entity IDs and canonicalizes configuration object keys. Given identical dataset versions, evidence cutoff, projection version, configuration, and observation history, it returns the same snapshot UUID and content hash. Base snapshots exclude ADR-003 scenario overrides.

## Downstream boundary

Phase 3 may consume the read port and auditable transition records. It must not bypass projection rules, infer transport closure from flood/weather evidence alone, attach scheduled/live claims to topology-only rail, or mutate finalized base snapshots.
