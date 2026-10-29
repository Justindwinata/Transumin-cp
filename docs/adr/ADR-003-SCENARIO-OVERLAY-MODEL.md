# ADR-003 — Scenario Overlay Model

**Status:** ACCEPTED

Scenario execution never mutates base `twin.mobility_state`. A run binds one scenario and one immutable `network_snapshot`; `simulation_state_override` stores run-specific changes, and effective state is base snapshot plus deterministic overrides. Impact results reference the run and derivation/engine version. This preserves replay, comparison, provenance, and concurrent scenarios.
