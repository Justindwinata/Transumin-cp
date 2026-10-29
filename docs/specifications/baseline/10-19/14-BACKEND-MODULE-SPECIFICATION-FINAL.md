# TRANSUM-IN NEXUS
# 14 — BACKEND MODULE SPECIFICATION — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN BACKEND IMPLEMENTATION BASELINE

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Architecture Decision

Gunakan modular monolith terlebih dahulu. Jangan memecah menjadi microservices sebelum ada measured need.

## 2. Stack

- NestJS + TypeScript strict
- PostgreSQL + PostGIS
- DTO validation
- OpenAPI
- routing provider behind adapter
- LLM provider behind adapter

## 3. Layering

```text
Controller / Transport
        ↓
Application Service / Use Case
        ↓
Domain Logic
        ↓
Repository / External Adapter
```

## 4. Module Catalogue

| ID | Module | Owner | Responsibility | Main Data |
|---|---|---|---|---|
| MOD-AUTH | auth | Student B | Account/session/role separation | user_account, role_assignment |
| MOD-TRANSIT | transit | Student A | Canonical transit query and ingestion-facing domain services | operator, route, station, stop, trip, stop_time, transfer |
| MOD-SPATIAL | spatial | Student A | PostGIS nearby/intersection/spatial graph utilities | road_segment, walking_edge |
| MOD-TWIN | mobility-twin | Student A | Network entity/state/snapshot management | mobility_entity, mobility_state, network_snapshot |
| MOD-DISRUPTION | disruption | Student A | Flood/event ingestion and impact derivation | disruption_event, flood_event_detail, disruption_impact |
| MOD-SIM | simulation | Student A | Scenario lifecycle, isolated overlay, run/result | simulation_scenario, simulation_run, impact_result |
| MOD-JOURNEY | journey | Student B | Journey orchestration, candidates, active journey state | journey, journey_segment, journey_state_event |
| MOD-RECOVERY | recovery | Student B | State-aware passenger journey repair | recovery_plan, recovery_segment |
| MOD-OPSREC | operator-recovery | Shared | TransJakarta split-service/cut-point/fleet estimate | operator_recovery_plan |
| MOD-COPILOT | copilot | Student B | Bounded tool orchestration, factuality, explanation | copilot_session, tool_execution_log |
| MOD-RESEARCH | research | Shared | Experiment runner and metric persistence | experiment_run, experiment_metric |

## 5. Standard Module Structure

```text
module-name/
  module-name.module.ts
  controllers/
  application/
    use-cases/
    dto/
  domain/
    entities/
    value-objects/
    policies/
  infrastructure/
    repositories/
    adapters/
  tests/
```

## 6. Module Dependency Rules

- journey reads transit/twin through interfaces.
- recovery depends on journey + twin + routing adapter.
- operator-recovery depends on transit/spatial/simulation.
- copilot uses exposed tools, not arbitrary repositories.
- simulation never depends on frontend.
- transit never depends on journey.

## 7.1 MOD-AUTH — `auth`

**Owner:** Student B

**Responsibility:** Account/session/role separation.

**Primary data:** user_account, role_assignment.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.2 MOD-TRANSIT — `transit`

**Owner:** Student A

**Responsibility:** Canonical transit query and ingestion-facing domain services.

**Primary data:** operator, route, station, stop, trip, stop_time, transfer.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.3 MOD-SPATIAL — `spatial`

**Owner:** Student A

**Responsibility:** PostGIS nearby/intersection/spatial graph utilities.

**Primary data:** road_segment, walking_edge.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.4 MOD-TWIN — `mobility-twin`

**Owner:** Student A

**Responsibility:** Network entity/state/snapshot management.

**Primary data:** mobility_entity, mobility_state, network_snapshot.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.5 MOD-DISRUPTION — `disruption`

**Owner:** Student A

**Responsibility:** Flood/event ingestion and impact derivation.

**Primary data:** disruption_event, flood_event_detail, disruption_impact.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.6 MOD-SIM — `simulation`

**Owner:** Student A

**Responsibility:** Scenario lifecycle, isolated overlay, run/result.

**Primary data:** simulation_scenario, simulation_run, impact_result.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.7 MOD-JOURNEY — `journey`

**Owner:** Student B

**Responsibility:** Journey orchestration, candidates, active journey state.

**Primary data:** journey, journey_segment, journey_state_event.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.8 MOD-RECOVERY — `recovery`

**Owner:** Student B

**Responsibility:** State-aware passenger journey repair.

**Primary data:** recovery_plan, recovery_segment.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.9 MOD-OPSREC — `operator-recovery`

**Owner:** Shared

**Responsibility:** TransJakarta split-service/cut-point/fleet estimate.

**Primary data:** operator_recovery_plan.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.10 MOD-COPILOT — `copilot`

**Owner:** Student B

**Responsibility:** Bounded tool orchestration, factuality, explanation.

**Primary data:** copilot_session, tool_execution_log.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 7.11 MOD-RESEARCH — `research`

**Owner:** Shared

**Responsibility:** Experiment runner and metric persistence.

**Primary data:** experiment_run, experiment_metric.

**Required backend qualities:**

- typed inputs and outputs
- explicit error model
- unit-testable domain/application service
- no hidden mock fallback
- observability for critical use cases
- traceable to requirement IDs

**Minimum test set:**

- happy path
- validation failure
- dependency/provider failure
- data coverage/degraded case if applicable

## 8. Routing Adapter

Provider-specific response normalized before domain.

```ts
interface RoutingAdapter {
  plan(input: RoutingRequest): Promise<RoutingResult>;
  replan(input: RoutingRequest): Promise<RoutingResult>;
}
```

## 9. Error Model

- VALIDATION_ERROR
- DATA_COVERAGE_LIMITATION
- NO_FEASIBLE_JOURNEY
- NO_RECOVERY_PATH
- SCENARIO_INVALID
- SIMULATION_FAILED
- UPSTREAM_UNAVAILABLE
- AUTH_REQUIRED
- FORBIDDEN

## 10. Observability

Structured logs: request_id, module, use_case, duration, snapshot/scenario id, error_code, tool latency.

## 11. Background Jobs

Queue only if ingestion/simulation actually needs it. Redis not mandatory by default.

## 12. Backend Testing Gate

CRITICAL module minimal unit + DB integration + API contract + representative E2E.

## 13. AI Agent Guardrails

Audit repository first. Do not recreate repo. Do not replace stack. Make small, testable, traceable changes.

## 14. API and Use-Case Boundary Rules

- Controller hanya mengubah transport concern menjadi application request.
- Use case mengorkestrasi domain service/repository/provider.
- Domain policy tidak boleh bergantung pada HTTP request/response.
- External provider DTO dinormalisasi di adapter boundary.
- Shared DTO lintas frontend/backend didefinisikan di shared-types package bila stabil.

### Example — Journey Plan Use Case
```text
HTTP Request
→ JourneyPlanDto validation
→ PlanJourneyUseCase
→ Transit/Twin/Routing ports
→ Decision-ready ranking
→ persistence/audit if selected
→ API response mapper
```

### Example — Flood Scenario Use Case
```text
Scenario request
→ geometry validation
→ snapshot resolve
→ overlay create
→ impact engine
→ metrics persistence
→ result DTO
```

## 15. Transaction Boundaries

- Ingestion writes harus atomic per logical batch atau memiliki resumable status.
- Creating scenario + run record dapat terpisah; running scenario tidak boleh meninggalkan state palsu sebagai COMPLETED.
- Journey selection dan active-state initialization harus menjaga consistency.
- Recovery result persistence harus mengikat exact journey/network/scenario context.

Jika transaction panjang melibatkan provider eksternal, jangan menahan DB transaction selama network call; gunakan staging/status pattern.

## 16. Repository Interfaces

Repository harus mendeskripsikan domain need, bukan ORM method mentah.

Contoh:
```ts
interface MobilityStateRepository {
  getResolvedState(entityId: string, at: Date): Promise<MobilityState | null>;
  appendTransition(input: StateTransitionInput): Promise<void>;
}
```

Hindari exposing generic `findAll()` jika use case membutuhkan query spesifik.

## 17. Provider Adapter Contracts

External integration minimum adapters:
- RoutingAdapter
- GeocodingAdapter bila digunakan
- LlmProvider
- FloodSourceAdapter bila observed source digunakan
- Clock interface untuk deterministic tests bila time-sensitive

Semua provider harus memiliki timeout, error mapping, dan degraded-state semantics.

## 18. Caching Strategy

- Cache hanya data yang aman terhadap staleness policy.
- Cache key harus menyertakan dataset/snapshot/scenario context ketika hasil tergantung versi.
- Jangan cache scenario result tanpa scenario/version key.
- Jangan membuat Redis mandatory sebelum cache benar-benar diperlukan.

## 19. Concurrency and Idempotency

- Simulation run endpoint harus mencegah duplicate execution yang identik jika request diulang.
- Ingestion run harus memiliki stable run ID/status.
- Recovery creation dapat memakai idempotency key bila UI berpotensi retry.
- State transition insertion harus menjaga ordering/time consistency.

## 20. Background Processing Decision

Candidate background tasks:
- large dataset ingestion
- heavy simulation
- experiment batch

Lightweight journey request tetap synchronous bila memenuhi latency target.

## 21. OpenAPI Contract Discipline

- Semua public endpoint memiliki schema.
- Error codes documented.
- Example response tidak boleh berisi fake live claims.
- Breaking contract memerlukan version/migration plan.

## 22. Backend Definition of Done per Module

Checklist:
- [ ] Module boundary clear
- [ ] DTO validation present
- [ ] Domain/application tests pass
- [ ] Repository/provider integration tested
- [ ] Error codes mapped
- [ ] Logs/metrics sufficient
- [ ] No secret/hardcoded production value
- [ ] Docs/API updated
- [ ] Requirement IDs referenced
