# ADR-004 — Student A/B Integration Ports

**Status:** ACCEPTED

Student A intelligence is consumed through typed `TransitNetworkPort`, `MobilityStatePort`, `DisruptionImpactPort`, and `ScenarioExecutionPort`; routing is isolated by `RoutingPort`, with shared evidence/provenance values. Student B orchestration depends on those interfaces rather than Student A storage internals. Validated fallback adapters implement the same contracts and label every value `SIMULATED`, `SAMPLE`, or `ESTIMATED`; hidden mocks are forbidden.
