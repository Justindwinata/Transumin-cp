# ADR-006: Database Infrastructure

**Status:** ACCEPTED

**Date:** 2026-09-28

**Phase:** 0.4 Database Infrastructure and Phase-0 Finalization

## Context

The canonical database baseline requires PostgreSQL, PostGIS, version-controlled migrations, ten logical schemas, localhost-only development exposure, and separate liveness/readiness semantics. Phase 0.4 is infrastructure-only: domain tables, repositories, ingestion, routing, and product behavior remain deferred.

The maintained `postgis/postgis` image documents only `amd64` support. Native Apple Silicon development therefore cannot rely on that image without emulation. The official PostgreSQL `17.11-bookworm` image manifest supports both `linux/amd64` and `linux/arm64/v8`.

## Decision

- Build `transum-in-nexus/postgis:17.11-3.6` locally from the pinned multi-architecture `postgres:17.11-bookworm` manifest digest `sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652`.
- Install the exact PostgreSQL 17 PostGIS packages `3.6.4+dfsg-2.pgdg12+1` in that image.
- Run one Compose service named `postgres`, bind it only to `127.0.0.1:5433`, persist data in the named `transum-in-nexus-postgres-data` volume, and require the password through environment configuration.
- Use `kysely@0.29.6` with `pg@8.23.0`. Query construction stays parameterized, while provider and persistence details remain inside API infrastructure.
- Store Kysely migration metadata in the `meta` schema. The runner creates that metadata schema before discovery, and the first migration enables PostGIS and creates only `meta`, `transit`, `spatial`, `twin`, `disruption`, `simulation`, `journey`, `research`, `auth`, and `ai`.
- Keep `GET /health/live` process-only. `GET /health/ready` performs a real database query and PostGIS geometry operation, returns `200` only when both are usable, and returns a sanitized `503` otherwise.
- Keep `pnpm check` deterministic without a database. Database-backed verification runs separately through `pnpm check:integration`.

## Migration recovery and reset

The initial migration contains no domain data and uses idempotent extension/schema creation. Its down path drops non-metadata schemas and PostGIS with `RESTRICT`, so rollback refuses to delete future dependent objects. The `meta` schema remains because Kysely uses it to record the rollback. For a fully clean local recovery, `pnpm db:reset` removes only this Compose project's containers, network, and named volume, recreates the database, and reapplies migrations. That command is destructive to local project database data and is not a production recovery strategy.

## Alternatives considered

- `postgis/postgis:17-3.5` was rejected for local use because the publisher documents `amd64` only.
- An experimental or unrelated third-party multi-architecture PostGIS image was rejected to reduce supply-chain ambiguity.
- Prisma and TypeORM were not introduced. Kysely plus `pg` provides explicit SQL/migration control with a smaller abstraction surface for the geospatial and research-oriented schema.
- Automatic PostGIS enablement in an image init script was rejected because extension state belongs to version-controlled migrations.

## Consequences

The same Dockerfile builds natively on Apple Silicon and x86-64 CI hosts. Rebuilding depends on the Debian/PGDG repositories retaining the pinned package version. Database startup now requires an explicit local password, no credential is committed, and application startup does not establish a connection until readiness or another database operation executes. Domain persistence remains intentionally absent.

## Evidence sources

- PostgreSQL official image manifest and architecture list: <https://github.com/docker-library/official-images/blob/master/library/postgres>
- PostgreSQL official image documentation: <https://github.com/docker-library/docs/blob/master/postgres/README.md>
- PostGIS image architecture statement: <https://hub.docker.com/r/postgis/postgis/>
- Kysely migrations documentation: <https://kysely.dev/docs/migrations>
