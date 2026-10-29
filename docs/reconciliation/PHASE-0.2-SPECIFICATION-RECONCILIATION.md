# Phase 0.2 Specification Reconciliation

**Status:** CANONICAL IMPLEMENTATION CONTRACT

**Reviewed sources:** context Files 00–09, baseline Files 10–19, Phase 0.0 audit, Phase 0.1 governance, and the Phase 0.2 Product Owner instruction.

## 1. Purpose and authority

This document closes implementation ambiguity without modifying the 20 source specifications. Authority is: latest Product Owner instruction → Phase 0.2 contracts/approved ADRs → baseline 10–19 → context 00–09 → documented assumptions. Canonical implementation IDs are File 10 `FR-001`–`FR-014`; File 01 identifiers are cited only as `LEGACY-FR-*`.

## 2. Conflict disposition

Each row contains the required conflict ID, old definition, canonical definition/decision, rationale, impact, and status.

| ID | Old definition | New/canonical definition and authoritative decision | Rationale | Future impact | Status |
|---|---|---|---|---|---|
| CONFLICT-001 | File 00 calls itself the single source of truth | Use the Phase 0.2 authority hierarchy; 00–09 are context | Later contracts must supersede history without deleting it | All implementation planning | CLOSED |
| CONFLICT-002 | File 01 reuses FR-001–FR-007 | File 10 owns FR-001–FR-014; old IDs become `LEGACY-FR-*` | Prevents test, issue, and branch collisions | Traceability and delivery | CLOSED |
| CONFLICT-003 | Singular/unversioned `/journey/plan`, `/recovery/generate`, `/simulation/run` | Use `/api/v1` resource contracts in API Contract V1 | Stable versioned resources are testable | Controllers and clients | CLOSED |
| CONFLICT-004 | Availability and evidence share one enum | Separate `AvailabilityState` from `EvidenceType` | A simulated result can still have an availability state | DB, API, UI labels | CLOSED |
| CONFLICT-005 | GTFS stop time uses SQL `TIME` | Store service-day-relative `arrival_seconds`/`departure_seconds`; timezone context Asia/Jakarta | GTFS permits values beyond 24:00 | Transit schema and routing | CLOSED |
| CONFLICT-006 | Old database has 19 tables | File 12 plus Database Contract V1 defines the conceptual baseline | New domains require explicit lifecycle and lineage | Future migrations | CLOSED |
| CONFLICT-007 | One JSON-heavy `simulation_result` | Separate scenario, run, override, and impact result | Definition and execution have different identities | Simulation persistence/API | CLOSED |
| CONFLICT-008 | Eight old modules | Freeze 11 File 14 `MOD-*` modules | Ownership and dependencies are explicit | Backend folders and tests | CLOSED |
| CONFLICT-009 | Diagram implies services/API gateway | One NestJS modular monolith; external providers behind adapters | No measured need for distributed infrastructure | Runtime topology | CLOSED |
| CONFLICT-010 | Seven old UI pages | APP-001–APP-010 are canonical surfaces | Covers scenario, operator recovery, and evidence | Routes and E2E tests | CLOSED |
| CONFLICT-011 | Testing occurs near project end | Every milestone has a verification gate | PASS requires executed evidence | CI and milestone planning | CLOSED |
| CONFLICT-012 | Operator recovery is optional/absent | FR-007/MOD-OPSREC is a core shared feature | It is part of the research/product contribution | API, DB, APP-009 | CLOSED |
| CONFLICT-013 | Spatial intersection implies affected/blocked | Intersection creates a candidate direct impact; blockage requires explicit rule/evidence | Geometry alone does not prove impassability | Disruption semantics | CLOSED |
| CONFLICT-014 | Example transport sources are marked high-confidence | All source availability remains `NOT VERIFIED` until registry/license/checksum evidence exists | Avoids unsupported dataset claims | Data phase | DEFERRED |
| CONFLICT-015 | Journey module builds its own transit graph/router | `RoutingPort` isolates a routing provider; no full router is built from scratch by default | Preserves scope and provider replaceability | Journey module | CLOSED |
| CONFLICT-016 | Top-level `simulation/` application | Simulation is MOD-SIM plus research scenarios; no separate application | Preserves modular monolith | Repository layout | CLOSED |
| CONFLICT-017 | JWT/register assumed | Superseded by explicit Product Owner FR-014 decision (2026-10-19): local credentials, scrypt, server-side revocable 12-hour sessions, HttpOnly SameSite Strict `tnx_session` cookie with Bearer fallback; bootstrap admin through controlled service/CLI, Admin-only create provisioning; no public registration | Local identity boundary authorized without external provider or JWT dependencies | Auth implementation | RESOLVED BY PO DECISION |
| CONFLICT-018 | `api.transumin.com` is presented as active | OpenAPI declares no production server | Deployment does not exist | Deployment/docs | CLOSED |
| CONFLICT-019 | FR-005 and FR-008 use incompatible simulation creation | Scenario definition and simulation run are separate resources | One lifecycle supports replay and async execution | API and DB | CLOSED |
| CONFLICT-020 | `/simulations/{id}/impact` mixes scenario/run IDs | `/simulation-runs/{runId}/impact`; IDs are never interchangeable | Eliminates ambiguous lookup | API and traceability | CLOSED |
| CONFLICT-021 | `reference_table/reference_id` is weak polymorphism | `twin.mobility_entity` supplies stable identity with explicit one-to-one/unique FKs from state-bearing records | Restores relational integrity | DB identity and state | CLOSED |
| CONFLICT-022 | `route.geometry_id` has no target | Route/trip geometry resolves through `transit_shape`; trips reference shapes and segments derive/reference shape geometry | Removes undefined FK | Transit schema | CLOSED |
| CONFLICT-023 | Walking edges use opaque node refs | `spatial.network_node` plus FK `from_node_id`/`to_node_id`; external node IDs remain metadata | Enables referential and spatial validation | Walking network | CLOSED |
| CONFLICT-024 | Scenario execution can appear to mutate base state | Effective state = immutable snapshot + run-specific overrides | Reproducible what-if execution cannot rewrite truth | Twin/simulation | CLOSED |
| CONFLICT-025 | Operator recovery result is primarily JSONB | Normalize plans, service segments, candidates, and bridge options; JSONB only for extensions | Core metrics require queryable research evidence | MOD-OPSREC and DB | CLOSED |
| CONFLICT-026 | Student A/B integration is informal | Six typed domain ports plus evidence/provenance contracts are frozen | Allows independent, testable implementations and honest fallbacks | Module boundaries | CLOSED |
| CONFLICT-027 | Map layer meaning/z-order/accessibility is implicit | Map Data Semantics freezes semantic layers and non-map equivalents without visual styling | Prevents UI from inventing evidence meaning | APP-001–APP-009 | CLOSED |
| CONFLICT-028 | Response/error shapes vary across old API examples | Use `{data,meta}` success and machine-readable `{error}` failure envelopes | Stable clients and observability | All API endpoints | CLOSED |
| CONFLICT-029 | Expensive commands lack duplicate-request semantics | `Idempotency-Key` is required for run, recovery, and operator-analysis creation | Avoids duplicate computation/resources | API persistence | CLOSED |
| CONFLICT-030 | List pagination is unspecified | Cursor pagination uses `limit`, `cursor`, and `next_cursor`, maximum 100 | Stable bounded list behavior without performance claims | List endpoints | CLOSED |

## 3. Deferred decision register

| Decision | Why deferred | Required before |
|---|---|---|
| External authentication provider/transport and self-registration | Product Owner authorized local credential sessions; external provider remains unnecessary; no public registration | Future external identity requirement |
| LLM provider/model/prompt version | Copilot is provider-neutral behind bounded tools | Copilot implementation/evaluation |
| Routing engine/version | Contract is frozen behind `RoutingPort` | Routing integration |
| Framework and dependency versions | Phase 0.3 owns toolchain selection | Phase 0.3 commit |
| Queue technology | Contract is async-capable; initial execution may be in-process | Measured background-processing need |
| Deployment host | No deployment exists | Deployment phase |
| Final study area and verified datasets | Source/license/coverage evidence is absent | Data acquisition/research freeze |
| Recovery scoring weights | Must be frozen with baseline methodology | Final experiment freeze |
| UI visual tokens | File 13/File 08 and Taste governance constrain later design | Design-system implementation |

## 4. Compatibility and implementation impact

Old paths and identifiers are documentation context, not aliases that implementations must expose. Future code may migrate stored development data only through authorized migrations; none exists now. Canonical UUIDs, time, evidence, error, pagination, and idempotency semantics apply consistently across API and database contracts. No microservices, Kafka, Redis, GraphQL, CQRS framework, Neo4j, Kubernetes, data lake, or service mesh is introduced.

All non-deferred conflicts required for Phase 0.3 scaffolding are closed. Deferred choices are provider/configuration decisions behind frozen boundaries and do not contradict the API or database contract.
