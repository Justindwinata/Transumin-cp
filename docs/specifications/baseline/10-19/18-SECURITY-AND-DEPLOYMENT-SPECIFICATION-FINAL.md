# TRANSUM-IN NEXUS
# 18 — SECURITY & DEPLOYMENT SPECIFICATION — FINAL ENGINEERING EDITION

**Academic Theme:** TRANSUM-IN: AN ADAPTIVE MULTIMODAL URBAN MOBILITY DECISION SUPPORT SYSTEM FOR FLOOD DISRUPTION ANALYSIS AND JOURNEY RECOVERY

**Status:** FROZEN SECURITY/DEPLOYMENT BASELINE

**Audience:** Product Owner, Student A, Student B, AI Coding Agent, Reviewer, Capstone Supervisor

---

## 1. Scope

Security proportional untuk capstone/portfolio tetapi tetap professional.

## 2. Environments

- local development
- test/CI
- demo/staging
- production/public demo if used

## 3. Secret Management

- `.env` not committed
- `.env.example` placeholders only
- service-role/admin secrets never in frontend
- leaked secret rotated

## 4. Authentication

Operator/research mutation protected. Passenger auth minimal.

## 5. Authorization

Server-side enforcement. UI hiding is not security.

## 6. Input Validation

- coordinate range
- geometry type/size
- scenario duration
- enum/status
- pagination
- strings
- uploaded dataset/archive
- copilot context IDs

## 7. Geospatial Abuse Controls

Limit polygon vertices/area/query complexity.

## 8. API Security

- HTTPS public deployment
- restrictive CORS
- rate limits on auth/copilot/simulation
- request size limits
- no production stack traces

## 9. LLM Security

- tool allowlist
- tool args validated
- prompt injection cannot gain tool authority
- secrets excluded from context
- audit tool metadata

## 10. Privacy

Minimize precise user location retention. Research collection requires explicit methodology/consent if applicable.

## 11. Dataset Security

Archives/files validated; prevent path traversal; raw external data treated as untrusted input.

## 12. DB Security

- least privilege
- controlled migration role
- backup before destructive migration
- DB port not exposed publicly unless secured

## 13. Deployment Architecture

```text
Browser/PWA
   ↓ HTTPS
Web Frontend
   ↓
NestJS API
   ↓
PostgreSQL + PostGIS

API → Routing Engine
API → Optional LLM Provider
```

## 14. Local Development

Document one-command path for required infrastructure where possible.

## 15. Routing Engine Deployment

Keep adapter stable; provider can move local/cloud without rewriting journey domain.

## 16. Observability

- structured logs
- correlation id
- liveness/readiness
- provider health
- simulation timing

## 17. Health Endpoints

Liveness != readiness. Do not leak secrets.

## 18. Backup/Restore

- migrations
- reproducible ingestion
- experiment artifacts
- backup before major DB change

## 19. CI Gate

install → lint → typecheck → unit → integration → build

## 20. Public Demo Gate

- no secrets
- no fake production data
- CORS correct
- protected routes tested
- heavy endpoints rate-limited
- simulated state clearly marked

## 21. Failure Strategy

Routing down → degraded/no-route.
LLM down → deterministic explanation.
Flood source down → stale-marked or simulation-only.
DB down → readiness false.

## 22. Threat Checklist

### T-001 — Secret leakage

**Mitigation:** env/secret scan, frontend bundle audit.

### T-002 — Unauthorized scenario mutation

**Mitigation:** authz test.

### T-003 — Expensive geometry DoS

**Mitigation:** geometry size/complexity limit.

### T-004 — Prompt injection to tools

**Mitigation:** tool allowlist + arg validation.

### T-005 — Malicious archive upload

**Mitigation:** safe extraction validation.

### T-006 — SQL injection

**Mitigation:** parameterized ORM/query builder.

### T-007 — XSS from external labels

**Mitigation:** escaping/sanitization.

### T-008 — Sensitive location retention

**Mitigation:** minimize/expire storage.

## 23. Security Definition of Done

Secret audit clean, protected endpoints tested, risks documented, public demo does not expose sensitive infrastructure.

## 24. Security Control Matrix

| Area | Control | Verification |
|---|---|---|
| Secrets | environment/secret store | repo + bundle audit |
| Auth | server-side session/token validation | protected endpoint test |
| Authz | role checks | forbidden test |
| Input | DTO/schema validation | negative tests |
| Geo | complexity/range limits | abusive geometry tests |
| DB | parameterized queries/least privilege | integration review |
| LLM | tool allowlist | injection test |
| Upload | safe path/archive validation | malicious fixture |

## 25. Deployment Configuration Contract

Required config categories:
- APP_ENV
- DATABASE_URL or discrete DB fields
- routing provider URL/config
- LLM provider config if enabled
- public base URL
- logging level

Optional provider secrets must not be required for deterministic-template fallback.

## 26. Docker/Container Rules

- Pin meaningful major/minor versions.
- Healthchecks for DB/API.
- Avoid baking secrets into images.
- Use non-root runtime where feasible.
- Persistent DB volume documented.
- Architecture must support Apple Silicon development where used.

## 27. Database Exposure Rules

Local dev may expose DB to localhost.
Public deployment should keep DB private to network unless a secured external requirement exists.

## 28. Logging and Retention

Log operational metadata, not passwords/tokens.
Precise passenger location logs should be minimized.
Tool execution logs may retain request digest rather than full sensitive context.

## 29. Dependency Security

- lockfile committed
- dependency audit reviewed before public demo
- avoid abandoned/unnecessary packages
- do not auto-upgrade major framework during final capstone week without need

## 30. Recovery / Rollback

Deployment must have:
- previous known-good build or source commit
- DB backup before destructive migrations
- documented rollback/redeploy command

## 31. Public Demo Privacy Notice

If location permission is requested, UI should explain its use for active journey.
Do not collect more personal data than product needs.

## 32. Deployment Definition of Done

- [ ] clean build
- [ ] migrations apply
- [ ] readiness healthy
- [ ] routes load
- [ ] map works
- [ ] scenario works
- [ ] fallback works
- [ ] no secrets exposed
- [ ] simulated data labelled
