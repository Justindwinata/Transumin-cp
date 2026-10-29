# Domain Ports and Boundaries

## Ownership boundary

Student A owns transit/spatial ingestion, canonical network, mobility state, disruption impact, and scenario execution. Student B owns product orchestration, journey and recovery experiences, operator/research integration, copilot, and delivery. Shared work crosses only stable ports; persistence models are not integration APIs.

## Shared value contracts

All IDs are UUID strings. `EvidenceType = SCHEDULED | OBSERVED | LIVE | FORECAST | SIMULATED | ESTIMATED`; `OperationalState = AVAILABLE | DEGRADED | DISRUPTED | UNAVAILABLE | RECOVERING | UNKNOWN`. `ProvenanceRef` contains `sourceId`, optional `datasetVersionId`, `observedAt`, `retrievedAt`, `evidenceType`, and a resolvable lineage reference. Timestamps are ISO-8601 with timezone. Confidence never upgrades evidence type.

## Conceptual ports

```text
TransitNetworkPort
  getSnapshot(snapshotId) -> NetworkSnapshot
  getEntity(entityId, snapshotId) -> MobilityEntityView
  listConnectedSegments(entityId, snapshotId) -> TransitSegmentView[]

MobilityStatePort
  persistObservation(observation, entityId?) -> PersistObservationResult
  projectState(s)(entityId(s), asOf) -> EffectiveMobilityState[]
  getCurrentState(entityId) / getStates(entityIds) -> EffectiveMobilityState[]
  getStateHistory(entityId, interval) -> MobilityStateRecord[]
  replayState(s)(entityId(s), asOf) -> EffectiveMobilityState[]
  createSnapshot(input) / getSnapshot(snapshotId) -> NetworkSnapshot

DisruptionImpactPort
  evaluateEvent(eventId, snapshotId, ruleSetVersion) -> ImpactEvaluation
  getImpact(runId) -> ImpactResult

ScenarioExecutionPort
  createRun(scenarioId, snapshotId, config, idempotencyKey) -> SimulationRun
  getRun(runId) -> SimulationRun
  cancelRun(runId) -> SimulationRun

RoutingPort
  plan(request, effectiveNetworkContext) -> CandidateJourney[]
  validate(journey, effectiveNetworkContext) -> RouteValidation
```

Every result carries evidence and provenance references. Absence is explicit, not an empty success. Port errors use stable domain codes and never leak provider errors or stack traces.

## Backend modules and dependency direction

| Module                         | Owns                                                                                                                            | May depend on                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| MOD-AUTH `auth`                | identity, roles, authorization boundary                                                                                         | shared infrastructure only                                                                   |
| MOD-TRANSIT `transit`          | canonical transit entities/dataset versions                                                                                     | spatial, shared infrastructure                                                               |
| MOD-OPDATA `operational-data`  | operational source registry/adapters, observation validation, freshness, authority/conflict, incident candidates                | transit identity ports and shared infrastructure; not Mobility Twin persistence              |
| MOD-SPATIAL `spatial`          | geometries, network nodes/edges                                                                                                 | shared infrastructure                                                                        |
| MOD-TWIN `mobility-twin`       | mobility entity registry, snapshots, state                                                                                      | transit, spatial                                                                             |
| MOD-DISRUPTION `disruption`    | events, direct/propagated impact rules                                                                                          | mobility-twin, spatial                                                                       |
| MOD-SIM `simulation`           | scenarios, actions, runs, overrides                                                                                             | mobility-twin, disruption                                                                    |
| MOD-JOURNEY `journey`          | planning, immutable selected-plan activation, controlled progress, canonical dependency indexing, state-change impact targeting | transit/mobility ports, `JourneyRoutingPort`, `MobilityStatePort`, scoped operational events |
| MOD-RECOVERY `recovery`        | state-aware passenger repair                                                                                                    | journey, mobility/disruption ports, RoutingPort                                              |
| MOD-OPSREC `operator-recovery` | split-service analysis                                                                                                          | transit, mobility/disruption/scenario ports                                                  |
| MOD-COPILOT `copilot`          | bounded tools and grounded explanation                                                                                          | application use cases, never repositories directly                                           |
| MOD-RESEARCH `research`        | experiment orchestration/read models                                                                                            | public module use cases and immutable results                                                |

Dependencies point from orchestration to capabilities, never `transit → journey`, `simulation → frontend`, or domain → provider DTO. Cross-module writes occur through application use cases. Cycles must be removed by shared value types or ports, not service locators.

## GTFS ingestion boundary

Phase 1 keeps acquisition outside application startup and implements this boundary:

```text
verified registry + immutable manifest
  -> safe ZIP reader (no extraction)
  -> generic GTFS parser and deterministic validator
  -> source-preserving normalized records
  -> one canonical database transaction
  -> post-ingest count/geometry verification
```

Official-source and license evidence is resolved before a source can be marked `VERIFIED`. TransJakarta-specific URLs, attribution, and the pinned snapshot remain in registry/manifest records; parsing, validation, normalization, and transactional persistence are reusable GTFS capabilities within MOD-TRANSIT. A failed canonical write rolls back all transit and mobility rows while retaining a `FAILED` ingestion audit. A previously successful source checksum under the same pipeline returns `ALREADY_IMPORTED` without creating another run or duplicate records. A newer pipeline may transactionally rebuild only that immutable dataset version while retaining and linking the previous successful run.

`transit_segment` is a logical route/direction/endpoint edge and owns the state-bearing mobility identity. `trip_segment_traversal` preserves each trip's deterministic sequence and exact shape-derived geometry, so multiple stop patterns remain faithful without duplicating Mobility Twin state. `trip_frequency` preserves GTFS frequency windows without fabricating individual departure records. Transfer endpoints preserve GTFS location semantics by referencing exactly one stop or station on each side. All segment geometry is scheduled topology evidence, not live vehicle movement or pedestrian routing truth.

Phase 1 source adapters are activated only after authority, access, and reuse gates pass. Audited official HTML/PDF sources with unknown automation or redistribution rights remain registry evidence rather than canonical rows. Cross-operator station/interchange resolution remains outside MOD-TRANSIT until Phase 2.

## Live operational-data boundary

Phase 1D freezes the `OperationalSourceAdapter -> OperationalObservation -> validation -> freshness -> conflict resolution` boundary documented in `LIVE-OPERATIONAL-DATA-ARCHITECTURE.md`. A transport condition and its evidence type are independent. Every observation has explicit source, observation/receipt/update/expiry timestamps, confidence status, provenance, and raw lineage. Expired evidence yields `UNKNOWN` when no fresh evidence remains. Only verified official machine APIs/feeds may emit `LIVE`; official public text and operator-confirmed inputs emit reviewable/observed evidence, and environmental or forecast inputs cannot declare transport closure.

`MOD-OPDATA` produces validated normalized evidence and remains source/adaptor-owned. Phase 2B `MOD-TWIN` implements `MobilityStatePort`: immutable observations, effective-state projection, current state, transition history, temporal replay, and immutable base snapshots. RUN 5A implements operational evidence -> Mobility Twin transition -> indexed future Active Journey dependencies -> persistent owner/journey-scoped alert. RUN 5B adds `RecoveryService`, which derives an anchor only from controlled progress, preserves completed history and a currently valid original prefix, routes the damaged suffix through `JourneyRoutingPort`, and compares it with `FULL_REPLAN` from the same anchor/time/snapshot without mutating the selected plan. The operator-console use case remains behind an authentication/authorization boundary. AI-01 extracts source-grounded candidates; AI-02 later explains bounded tool results. Neither AI capability is a state authority.

Rail rows in `spatial.rail_topology_edge` are OSM geometric way fragments only. They may supply stable identity/spatial context but are not station adjacency, service edges, canonical transit segments, schedules, frequencies, or live status. `TOPOLOGY_ONLY` cannot be upgraded by the Twin without separate authorized operational evidence.

## Fallback contract

A fallback adapter must implement the identical port, deterministic fixture/configuration, coverage limits, and provenance. It labels outputs `SIMULATED`, `SAMPLE`, or `ESTIMATED`; it cannot emit `LIVE` or silently replace unavailable Student A intelligence. Contract tests run against both primary and fallback adapters.
