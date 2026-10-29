# TRANSUM-IN NEXUS
# 15 — AI AGENT IMPLEMENTATION PLAYBOOK — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** MANDATORY OPERATING MANUAL

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Role

AI Agent bertindak sebagai Senior Software Engineer + Research Engineering Assistant. Agent bukan Product Owner.

## 2. Mandatory Read Order

Baca 00–19 sesuai relevansi sebelum implementasi.

## 3. Current-State Audit

Inspect tree, package config, git status, migrations, environment examples, tests, existing implementation, docs-vs-code conflict.

Mandatory audit checklist:

- repository root and nested apps/packages
- lockfile/package manager
- TypeScript strict settings
- Docker/compose
- DB connectivity/PostGIS
- implemented modules
- current tests and failures
- TODO/placeholder/mock markers
- uncommitted changes

## 4. Planning Output

Objective, requirement IDs, affected files, DB/API/UI impact, tests, risks, non-goals.

Use template:

```text
Milestone:
Requirements covered:
Existing implementation reused:
Files to change:
DB impact:
API impact:
UI impact:
Tests:
Risks:
Non-goals:
```

## 5. Change Size

Satu coherent milestone/use-case per iteration. Jangan generate seluruh aplikasi sekaligus.

## 6. Source-of-Truth Order

Latest explicit Product Owner instruction > latest frozen spec > verified implementation > older docs > assumptions.

## 7. Data Rules

No fabricated data, preserve raw, version processed, mark synthetic fixtures, track source/license.

## 8. Database Rules

Migration only, no JSON-everything, no destructive change without plan, PostGIS queries tested.

## 9. Backend Rules

Strict TS, DTO validation, domain logic outside controller, providers behind adapters.

## 10. Frontend Rules

Real workflow first, map-primary, no fake live, no AI-slop, all states implemented.

## 11. Copilot Rules

Bounded tools, validator, deterministic fallback, no autonomous operational authority.

## 12. Testing Workflow

Run existing relevant tests before; after change run unit/typecheck/lint/integration/E2E/build as appropriate.

## 13. Bug Fix Protocol

Reproduce → isolate → root cause → regression test → minimal fix → rerun → report.

## 14. Architecture Change

Do not switch core technology without approval. Provide alternatives and migration/research impact.

## 15. Documentation Update

Contract changes update docs in same milestone.

## 16. Ownership

Student A agent stays in A scope. Student B owns product integration.

## 17. Student B Independence

Core application must run with validated fallback/sample/simulated intelligence adapter.

## 18. Security

Never print secrets, never commit .env, validate inputs, sanitize uploads.

## 19. Research Discipline

Do not tune against final test set after seeing results; version baselines/config.

## 20. UI Review

Inspect screenshots if tooling available; check hierarchy, overflow, responsiveness, semantic labels.

## 21. Stop Conditions

Stop for destructive migration, scope expansion, license uncertainty, security architecture change, research methodology change.

## 22. Milestone Completion Report

```text
Milestone:
Requirements covered:
Files changed:
Database migrations:
APIs added/changed:
Tests executed:
Build/runtime evidence:
Known limitations:
Risks:
Next authorized step:
```

## 23. PASS vs NOT VERIFIED

PASS requires code + tests + runtime/build evidence. If environment prevents verification, status NOT VERIFIED.

## 24. Prohibited Behaviours

- claiming tests passed without running them
- creating fake screenshots/results
- hiding failing test
- deleting validation to make test green
- silently changing architecture
- overwriting user work
- claiming realtime for simulated data
- inventing dataset source
- merging Student A/B research ownership

## 25. Final Operating Principle

Speed is secondary. Correctness, traceability, reproducibility, and defensibility are primary.

## 26. Detailed Execution Protocol

Setiap task AI Agent mengikuti urutan berikut:

### Step 1 — Restate Objective
- Tulis objective dalam 1–3 kalimat.
- Sebut requirement ID.
- Sebut apa yang tidak akan dikerjakan.

### Step 2 — Inspect Evidence
- Baca file existing yang relevan.
- Cari implementasi sebelum membuat file baru.
- Cek tests existing.
- Cek migration/API contract.

### Step 3 — Plan Minimal Safe Change
- Pilih smallest coherent change.
- Identifikasi rollback path.
- Identifikasi dependency Student A/B.

### Step 4 — Implement
- Reuse existing patterns.
- Hindari duplicate abstraction.
- Jaga strict typing.

### Step 5 — Verify
- Run targeted tests.
- Run typecheck/lint.
- Run integration/build jika boundary tersentuh.

### Step 6 — Report
- Evidence bukan klaim.
- Jika ada yang tidak bisa diverifikasi, tulis NOT VERIFIED.

## 27. Repository Audit Template

```text
Repository:
Branch:
Git status:
Package manager:
Node/runtime:
Frontend framework/version:
Backend framework/version:
DB/PostGIS:
Implemented modules:
Relevant tests:
Relevant docs:
Known mocks/placeholders:
Conflicts with specification:
Recommended next action:
```

Agent wajib mengisi berdasarkan repository aktual, bukan memory/prediction.

## 28. Task Sizing Rules

Small task:
- satu bug/refactor/local endpoint
- ≤ few files logically

Medium task:
- satu use case lengkap
- may include migration/API/UI/test

Large task:
- milestone multi-module
- harus dipecah menjadi submilestones sebelum coding

Jika task besar, jangan 'one-shot' seluruh project.

## 29. Data Acquisition Protocol

1. Identifikasi official/source URL atau provided artifact.
2. Catat license/access restriction.
3. Simpan raw snapshot immutable.
4. Compute checksum.
5. Parse ke staging/canonical model.
6. Run validation report.
7. Reject/quarantine bad records.
8. Persist dataset version.
9. Document known gaps.

Agent tidak boleh menggunakan scraping sebagai default jika official/open dataset tersedia.

## 30. Mock and Fixture Policy

Allowed:
- unit-test fixtures
- synthetic scenario
- demo fallback yang dilabeli SIMULATED/SAMPLE

Forbidden:
- mock dianggap production truth
- fake KPI
- fake realtime location
- fake operator schedule
- generated 'official' data tanpa source

## 31. Migration Workflow

Before migration:
- inspect current schema/migrations
- decide forward and rollback/recovery
- assess data loss risk

After migration:
- apply from clean DB
- apply from current DB
- run integration tests
- verify indexes/constraints

## 32. API Change Workflow

1. Check existing contract.
2. Decide additive vs breaking.
3. Update shared types.
4. Add validation.
5. Add contract/integration test.
6. Update docs/examples.

Breaking change tidak boleh diam-diam.

## 33. Frontend Implementation Workflow

1. Derive page from user flow.
2. Connect typed API.
3. Implement loading/error/empty/degraded state.
4. Implement responsive layout.
5. Inspect visual result.
6. Remove placeholders.
7. Add targeted component/E2E test.

## 34. Geospatial Implementation Workflow

- Confirm CRS/SRID.
- Use PostGIS functions correctly.
- Verify meter-vs-degree semantics.
- Add spatial index.
- Test edge cases: boundary touch, empty geometry, invalid geometry.
- Document scenario rule translating intersection to blockage.

## 35. Routing Implementation Workflow

- Routing provider behind adapter.
- Normalize provider output.
- Validate transfers.
- Apply network-state constraints.
- Produce traceable candidate metrics.
- Do not post-process with LLM.

## 36. Journey Recovery Implementation Workflow

1. Freeze current completed state.
2. Determine first broken future segment.
3. Build repair origin/context.
4. Query feasible alternatives.
5. Score preservation vs cost.
6. Return structured before/after metrics.
7. Persist experiment fields.

## 37. Operator Recovery Implementation Workflow

1. Resolve affected route geometry.
2. Determine blocked contiguous segment(s).
3. Identify upstream/downstream reachable subroutes.
4. Generate candidate cut/restart points.
5. Mark validation requirement.
6. Apply configured bridge resource if any.
7. Estimate fleet from explicit headway/cycle assumptions.
8. Return limitations.

## 38. Copilot Implementation Workflow

1. Identify user intent.
2. Select allowed tool.
3. Validate tool arguments.
4. Execute tool.
5. Convert output to grounded context.
6. Generate answer.
7. Validate atomic facts.
8. Fallback if invalid.
9. Audit tool call.

## 39. Experiment Implementation Workflow

- Define baseline/proposed config.
- Freeze test cases.
- Persist run manifest.
- Execute both methods.
- Store raw metrics.
- Compute summaries after raw results saved.
- Never delete unfavorable result.

## 40. Review Checklist Before Claiming Completion

- [ ] Requirement satisfied, not merely UI visible
- [ ] No hidden mock
- [ ] Tests actually executed
- [ ] Error/degraded case considered
- [ ] Source/evidence semantics preserved
- [ ] No ownership violation
- [ ] No architecture change without approval
- [ ] Docs updated
- [ ] Known limitations listed

## 41. Response Style to Product Owner

Agent reports concise but evidence-rich:

```text
Status: PASS / PARTIAL / NOT VERIFIED / BLOCKED
What changed:
Evidence:
Tests:
Known limitations:
Next recommended milestone:
```

Do not use vague 'looks good' or 'should work'.

## 42. Forbidden Completion Claims

Do not say:
- production-ready, unless deployment/security gates passed
- real-time, unless source is real-time
- validated, unless validation evidence exists
- accurate, without defined metric
- optimized, without baseline comparison
- PASS, without required verification
