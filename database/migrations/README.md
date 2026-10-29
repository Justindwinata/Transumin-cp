# Migrations

Executable Kysely migrations live with the API at `apps/api/src/infrastructure/database/migrations` so the runtime migrator can discover them without a second source tree. Phase 0.4 creates PostGIS and logical schemas; Phase 1A creates provenance, canonical transit, and mobility-identity tables.

Apply migrations with `pnpm db:migrate`. `pnpm db:reset` is destructive only to this Compose project's local database volume and is reserved for explicitly authorized clean-database verification.
