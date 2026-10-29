# TRANSUM-IN NEXUS Agent Operating Rules

This file summarizes repository-level operating rules. It does not replace `docs/specifications/baseline/10-19/15-AI-AGENT-IMPLEMENTATION-PLAYBOOK-FINAL.md`; agents must read that playbook and the relevant specifications before implementation.

## Authority and reading order

The Product Owner has final authority. Apply this order when sources differ:

1. latest explicit Product Owner instruction;
2. Phase 0.2 canonical implementation contracts and accepted ADRs;
3. frozen baseline specifications 10–19;
4. context specifications 00–09 where they are not superseded;
5. explicit, documented AI-agent assumptions.

Read 00–19 according to the task's scope, then apply the canonical contracts in `docs/reconciliation`, `docs/architecture`, `docs/database`, `docs/api`, `docs/traceability`, and `docs/adr`. Files 10–19 remain the hardened baseline beneath that authority layer. Never select an older definition merely because it is easier to implement; deferred decisions must remain explicit.

For frontend craft, the order is: latest Product Owner instruction → File 13 → File 08 → this file → `design-taste-frontend` → explicitly authorized optional skills.

## Six product principles

Every milestone must preserve realistic buildability, sufficient capstone depth, high product value, coverage of multiple real problems, a defensible research contribution, and feasible datasets with source and license evidence. A visually complete screen does not compensate for a failure in data feasibility, reproducibility, or domain correctness.

## Ownership

Student A owns Mobility Intelligence: transit/spatial integration, GIS/network representation, mobility state, flood impact, and scenario/replay research. Student B is Product Owner and owns product/system architecture, frontend and backend product integration, journey orchestration, state-aware journey recovery, grounded copilot behavior, deployment direction, and final delivery. Operator-recovery and research-runner concerns are shared through explicit contracts. Agents must not erase, merge, or take over the students' distinct research ownership.

## Phase gates and evidence

Work only inside the currently authorized phase and implement one coherent milestone at a time. Before changing anything, inspect current files, tests, migrations, contracts, and user work. A `PASS` requires executed evidence appropriate to the milestone; if verification cannot run, report `NOT VERIFIED`, not an assumed pass. Never hide failures, delete validation to make checks green, or claim tests/build/runtime behavior that was not executed.

## Data, mock, and realtime integrity

Never fabricate official data, sources, licenses, KPIs, experiment results, screenshots, schedules, or live positions. Synthetic fixtures and fallback adapters are allowed only when visibly labeled `SIMULATED` or `SAMPLE`. Scheduled, observed, forecast, simulated, estimated, and live evidence must remain distinguishable. Do not describe data as realtime unless its source and freshness prove that claim.

Raw sources are immutable; processed data, configuration, prompts/models, scenario sets, baselines, seeds, checksums, commit references, and results must be versioned or manifested sufficiently for reproduction. Never tune against a final test set after inspecting its results, and never delete unfavorable experiment output.

## Architecture, database, and security

Do not replace the approved modular-monolith architecture or core technology without Product Owner authorization and an explicit impact analysis. Provider-specific details stay behind adapters. LLM output cannot become routing, network-state, or operational truth.

Database changes require migrations, clean/current-database verification, constraints, rollback or recovery analysis, and PostGIS-specific tests. Never execute a destructive migration or provision/modify a database without authorization. Never print or commit secrets; validate inputs, constrain geospatial complexity, and preserve least privilege.

## UI/UX and Taste Skill governance

Frontend work must be map-first where the user flow requires it, decision-first, progressively disclosed, evidence-aware, calm during disruption, passenger mobile-first, and operator desktop-first. Implement loading, success, empty, degraded, error, offline, responsive, accessible, and non-map information states. Avoid generic AI-slop: fake dashboards, decorative maps, unsupported metrics, excessive gradients/glass effects, arbitrary motion, and placeholder production copy.

The approved default craft skill is `.agents/skills/design-taste-frontend`. Other installed visual/style skills remain dormant unless the Product Owner explicitly authorizes one. Do not blend styles automatically, change the locked skill version casually, let a skill override product scope or evidence semantics, or let tooling inject fake facts.

## Execution protocol

For each task: restate the bounded objective and requirement IDs; inspect evidence; plan the smallest safe change; implement by reusing established patterns; verify with targeted tests plus relevant typecheck/lint/integration/build checks; then report changed files, evidence, limitations, risks, and the next authorized step. Stop for destructive migration, scope expansion, license uncertainty, security architecture changes, or research-methodology changes.
