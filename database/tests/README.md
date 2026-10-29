# Database Tests

Database-backed tests live beside the API infrastructure and transit module. `pnpm check:integration` verifies migration idempotence, PostgreSQL/PostGIS readiness, provenance constraints, version-scoped transit topology, stable typed identities, GTFS times beyond 24 hours, GiST indexes, geometry SRID, and read-only provenance APIs.
