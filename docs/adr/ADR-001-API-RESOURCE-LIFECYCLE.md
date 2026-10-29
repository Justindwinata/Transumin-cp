# ADR-001 — API Resource Lifecycle

**Status:** ACCEPTED

A `Scenario` is a stored what-if definition; a `SimulationRun` is one execution against an immutable network snapshot and configuration. Use `/api/v1/scenarios` and `/api/v1/simulation-runs`; create a run with `POST /scenarios/{scenarioId}/runs`. Runs are async-capable with `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, or `CANCELLED`. This separation prevents scenario/run/impact ID confusion and supports replay, idempotency, and a future queue without requiring one now.
