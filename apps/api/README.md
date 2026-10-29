# API Application

NestJS modular-monolith API with `HealthModule` and Phase 1A `TransitModule`. `GET /health/live` reports process liveness, `GET /health/ready` checks PostgreSQL/PostGIS, and the read-only `/api/v1/data-sources` resources expose stored provenance without inventing registry entries.

MOD-TRANSIT keeps application repository ports independent of Kysely. The infrastructure adapter owns parameterized SQL, while controllers map domain records to the canonical `{data,meta}` and `{error}` envelopes.

Run from the repository root with `pnpm dev:api`; the default port is `3001`.
