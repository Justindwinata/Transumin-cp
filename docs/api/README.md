# API Documentation

Phase 0.2 freezes the narrative contract in `API-CONTRACT-V1.md` and the machine-readable contract in `openapi-v1.yaml`. They define versioned resources, identifiers, envelopes, errors, evidence, scenario/run separation, idempotency, and pagination.

Phase 1A implements only `GET /api/v1/data-sources` and `GET /api/v1/data-sources/{sourceId}/versions`. Their schemas are explicit and generate the shared TypeScript contract. Other product endpoints and authentication provider/transport remain deferred.

Administrative field review (ADR-010, FR-003/005/009/014): `GET /admin/passenger-reports`, `POST /admin/passenger-reports/{id}/restrict` and `POST /admin/passenger-reports/{id}/close` require an authenticated ADMIN and a separately configured review API process. The passenger API keeps this capability disabled. The review actor is derived from the server principal. Evidence reference remains private; public route responses expose no supporting reference. A bounded 5–60 minute ADMIN_FIELD_REVIEW decision is distinct from an operator confirmation and from the existing controlled SIMULATED path. See `docs/adr/ADR-010-ADMIN-TEMPORARY-FIELD-RESTRICTIONS.md` and `docs/delivery/PASSENGER-NAVIGATION-ADMIN-20261020.md` for policy, verification and remaining limits.
