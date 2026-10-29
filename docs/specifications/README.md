# Specification Authority Index

**Academic theme:** TRANSUM-IN: An Adaptive Multimodal Urban Mobility Decision Support System for Flood Disruption Analysis and Journey Recovery.

The Product Owner has final authority over product scope, phase authorization, architecture decisions, and conflict resolution. An AI agent assists with engineering and research work; it is not the Product Owner.

## Authority order

1. latest explicit Product Owner instruction;
2. Phase 0.2 canonical implementation contracts and approved ADRs;
3. authoritative hardened baseline in `baseline/10-19`;
4. supporting context in `context/00-09` where not superseded;
5. explicit AI-agent assumptions, documented as assumptions.

For frontend-specific decisions, the refined order is: latest Product Owner instruction → File 13 → File 08 → project rules in `AGENTS.md` → `design-taste-frontend` → explicitly authorized optional skills.

## `context/00-09`

Files 00–09 retain useful product history, early architecture, dataset strategy, ownership detail, repository rules, API concepts, UI/UX guidance, and roadmap context. They are not called obsolete or discarded. They inform intent where Files 10–19 are silent, but they must not override a newer baseline definition.

## `baseline/10-19`

Files 10–19 are the frozen, hardened baseline for functional requirements, business rules, database/ERD direction, frontend, backend, agent operations, testing/evaluation, demo, security/deployment, and research positioning. Implementation and traceability work must start from these files.

## Conflict handling

Known cross-document and internal conflicts remain recorded in the Phase 0.0 audit. Phase 0.1 organized and preserved the source documents without editing their technical content. Phase 0.2 decisions are published under `docs/reconciliation`, `docs/architecture`, `docs/database`, `docs/api`, `docs/traceability`, and `docs/adr`; these contracts resolve implementation ambiguity without rewriting history. An AI agent must never choose an older or more convenient definition when a later canonical contract supersedes it.
