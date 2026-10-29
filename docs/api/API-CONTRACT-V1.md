# API Contract V1

**Base path:** `/api/v1`

**Authority:** Phase 0.2 canonical contract

**Runtime status:** PARTIAL — provenance, network state/snapshots, operational SSE, disruption impact, scenario/run, Journey planning, Active Journey, targeted alert, and passenger recovery resources are implemented in the controlled research environment. Operator recovery and Copilot resources remain contract-only.

## Global semantics

Internal resource IDs are UUIDs and are never substituted with external/source IDs. JSON property names use `snake_case`. Timestamps are ISO-8601 with timezone. Success is `{ "data": ..., "meta": { "request_id": "...", "warnings": [], "provenance": ... } }`; provenance may be a compact reference. Failure is `{ "error": { "code", "message", "details", "request_id" } }` and never includes a raw stack trace.

Operational state (`AVAILABLE`, `DEGRADED`, `DISRUPTED`, `UNAVAILABLE`, `RECOVERING`, `UNKNOWN`) and evidence (`SCHEDULED`, `OBSERVED`, `LIVE`, `FORECAST`, `SIMULATED`, `ESTIMATED`) are separate. `LIVE` is reserved for verified official machine evidence. Expired evidence cannot remain effective; absent fresh evidence resolves to `UNKNOWN`. List resources use cursor pagination with `limit` default 25, maximum 100, optional `cursor`, and response `next_cursor`; single-purpose result arrays need not paginate.

`Idempotency-Key` is required for `POST /scenarios/{scenarioId}/runs`, `POST /recoveries`, and `POST /operator-recovery/analyses`. A repeated key with the same authenticated/caller scope and canonical payload returns the existing resource; a different payload returns `CONFLICT`.

Canonical error codes are `VALIDATION_ERROR`, `DATA_COVERAGE_LIMITATION`, `NO_FEASIBLE_JOURNEY`, `NO_RECOVERY_PATH`, `SCENARIO_INVALID`, `SIMULATION_FAILED`, `UPSTREAM_UNAVAILABLE`, `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, and `INTERNAL_ERROR`.

## Canonical resources

| Method and path | Semantics |
|---|---|
| `GET /transit/operators` | Read operator coverage for a dataset version; absence remains explicit |
| `GET /network/state` | Read effective network state for snapshot and optional run overlay |
| `GET /network/entities/{entityId}` | Inspect stable mobility identity, state, and provenance |
| `GET /network/snapshots/{snapshotId}` | Inspect immutable snapshot/reproducibility context |
| `POST /disruption-events` | Register validated flood/disruption event evidence; protected operation |
| `GET /disruption-events/{eventId}/impact` | Read direct/propagated impact for explicit snapshot/run context |
| `POST /scenarios` | Create stored what-if definition |
| `GET /scenarios/{scenarioId}` | Read scenario and actions |
| `PATCH /scenarios/{scenarioId}` | Update mutable draft metadata/actions with validation |
| `POST /scenarios/{scenarioId}/runs` | Create async-capable run against explicit snapshot/config |
| `GET /simulation-runs/{runId}` | Read `PENDING|RUNNING|COMPLETED|FAILED|CANCELLED` run |
| `GET /simulation-runs/{runId}/impact` | Read structured run impact; never accepts scenario ID |
| `GET /operational-events/stream` | SSE stream of safe operational summaries with heartbeat and bounded `Last-Event-ID` replay |
| `POST /journeys/plan` | Return structured candidate journeys for snapshot/run context |
| `GET /journeys/{journeyId}` | Inspect a persisted candidate/selected journey |
| `POST /journeys/{journeyId}/activate` | Activate a feasible journey |
| `PATCH /journeys/{journeyId}/progress` | Record logical progress without inventing location evidence |
| `GET /journeys/{journeyId}/status` | Read effective journey status/network context |
| `POST /recoveries` | Create state-aware repair from original journey/current state/context |
| `GET /recoveries/{recoveryId}` | Read repair and before/after metrics |
| `POST /operator-recovery/analyses` | Create route split-service analysis |
| `GET /operator-recovery/analyses/{analysisId}` | Read services, gap, candidates, fleet estimate, assumptions, validation |
| `POST /copilot/messages` | Execute bounded passenger domain-tool interaction and grounded explanation |\n| `POST /copilot/research/messages` | Authenticated RESEARCHER_OPERATOR/ADMIN bounded research interaction; owner derives from principal |\n| `GET /copilot/research/sessions/{sessionId}` | Authenticated principal-owned research audit read; expired/foreign sessions return not found |
| `GET /data-sources` | Cursor-list source verification/coverage status |
| `GET /data-sources/{sourceId}/versions` | Cursor-list manifested source versions |
| `POST /experiments/replays` | Create controlled replay using frozen snapshot/scenario/config |
| `GET /experiments/{experimentId}` | Read manifested experiment status and result references |

Journey candidates expose stable journey ID, snapshot/run context, ordered segments, duration, transfers, walking distance, evidence, and reproducibility reference. Recovery exposes preserved/changed counts, additional duration/transfers, repaired segments, and context. Operator analysis requires route, blocked section or run, snapshot, and explicit headway/turnaround/bridge assumptions; core results are structured.

Recovery also exposes original future prefix, invalidated span, repaired connector, and rejoined original suffix references. `rejoin_status`/`rejoin_reason` explain whether a valid future suffix was retained. `metrics.state_aware` and `metrics.full_replan` report comparable SEMPRO components and separate method latency; the legacy `total_computation_ms` is total comparison orchestration time, not either method's latency.

## Authentication boundary

Roles are Passenger, Researcher/Operator, and Admin. Journey read/use operations are scoped to their owner; scenario mutation, simulation execution, operator analyses, experiment actions, and administrative ingestion require role authorization. Authentication provider, token/cookie transport, and registration policy are DEFERRED. Authorization remains server-side.

The operator incident-console domain path remains internal and captures actor/operator identity, affected entities/modes, incident type/state, reason, start, expiry, and source lineage. Phase 3 protects disruption/scenario mutations with a deny-by-default bearer token supplied through `INTERNAL_RESEARCH_TOKEN`; this temporary research boundary is not a replacement for the deferred identity provider and role authorization. Server-to-client operational summaries use SSE; WebSocket still requires a separately justified bidirectional need.

FR-010 Copilot research contexts use `scenario:<uuid>` and `impact:<simulation-run-uuid>`. These read-only tools require server-resolved `RESEARCHER_OPERATOR` or `ADMIN`; caller-supplied role headers never authorize access. Scenario definitions and simulation impact outputs remain `SIMULATED`; they never imply live network state.

## Async and compatibility

Clients must poll or later consume an approved status mechanism and cannot assume run completion in the create response. Initial execution may be in-process, but the contract remains queue-compatible. `/simulations/run`, `/simulation/run`, and `/operator-recovery/analyze` are not canonical aliases. No `/v2` or unversioned duplicates are authorized.
