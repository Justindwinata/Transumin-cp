# ADR-005: Development Toolchain

**Status:** ACCEPTED

**Date:** 2026-09-28

**Phase:** 0.3 Development Toolchain and Application Scaffolding

## Context

Phase 0.3 converts the frozen contract repository into an executable monorepo without implementing product or research features. The selected toolchain must be stable, compatible with the locked Node 22 baseline, reproducible through one pnpm lockfile, and small enough for two student-owned workstreams to understand and maintain.

Package metadata was queried from the npm stable release channel on 2026-09-28. Official compatibility documentation was also reviewed for [Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16), [NestJS 12](https://docs.nestjs.com/migration-guide), [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [typescript-eslint dependency support](https://typescript-eslint.io/users/dependency-versions/), and [Redocly CLI](https://redocly.com/docs/cli).

## Decision

### Runtime and workspace

| Concern   | Exact version or choice | Rationale                                                                                                         |
| --------- | ----------------------: | ----------------------------------------------------------------------------------------------------------------- |
| Node.js   |                 22.23.2 | Existing project baseline; satisfies Next.js 16, NestJS 12 runtime, ESLint 10, and Redocly CLI requirements.      |
| pnpm      |                 11.25.0 | Existing project baseline; one root lockfile and native workspace orchestration.                                  |
| Workspace |  `apps/*`, `packages/*` | Includes executable and shared-code packages only; data and research artifacts remain outside package resolution. |

### Application framework

| Package                             | Exact version | Rationale                                                                                                                                                                                                  |
| ----------------------------------- | ------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                             |        16.3.6 | Stable App Router release; supports Node 20.9+ and React 19.                                                                                                                                               |
| React / React DOM                   |        19.3.0 | Stable matched pair; satisfies Next.js peer requirements.                                                                                                                                                  |
| NestJS common/core/platform-express |        12.1.0 | Stable matched Nest major; Node 22.23.2 exceeds the documented 22.12 runtime floor.                                                                                                                        |
| TypeScript                          |         5.9.3 | Newest stable TypeScript 5 release; TypeScript 7.0.2 is intentionally not selected because `typescript-eslint` 8.70.1 supports TypeScript below 6.1 and `openapi-typescript` 7.13.0 declares TypeScript 5. |
| Tailwind CSS / PostCSS adapter      |         4.3.3 | Stable CSS-first Tailwind release with the official `@tailwindcss/postcss` integration.                                                                                                                    |

### Quality tools

| Concern                 | Exact version or approach                                                                                                           | Rationale                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                    | ESLint 10.11.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.70.1, `@next/eslint-plugin-next` 16.3.6, `eslint-config-prettier` 10.1.8 | Current stable ESLint with direct official Next rules and TypeScript rules in one root flat configuration. The direct Next plugin avoids pulling legacy React/import lint plugins whose peer ranges stop at ESLint 9. |
| Format                  | Prettier 3.9.9                                                                                                                      | One formatter for active source, configuration, and newly authored documents; frozen specifications and generated types are excluded.                                                                                 |
| API test                | Node 22 built-in test runner through `tsx` 4.23.15                                                                                  | Provides a real liveness-controller unit test without introducing a large test stack.                                                                                                                                 |
| Frontend test           | Lint, strict typecheck, build, and runtime smoke                                                                                    | No component test library is justified for the single static foundation page.                                                                                                                                         |
| OpenAPI validation      | Redocly CLI 2.54.3 with the `spec` ruleset                                                                                          | Maintained OpenAPI 3.1 semantic and structural validation with no runtime dependency.                                                                                                                                 |
| OpenAPI type generation | `openapi-typescript` 7.13.0                                                                                                         | Maintained zero-runtime type generation from the canonical OpenAPI document.                                                                                                                                          |

The base TypeScript configuration enables strict checking, unchecked-index protection, case consistency, and override checking. `skipLibCheck` is enabled only for third-party declaration-file compatibility and compile-time cost; repository source remains fully typechecked. Browser and Node compiler options live in their respective package configurations.

The API uses ESM with NodeNext resolution because NestJS 12 packages are ESM-only. The global product prefix is reserved as `/api/v1`, while the technical liveness endpoint is explicitly excluded.

## Alternatives considered

- TypeScript 7.0.2 was rejected because the selected lint and OpenAPI generation tools do not declare compatible support.
- Jest, Vitest, and frontend component-test libraries were deferred because they add dependencies without a Phase 0.3 use case.
- Turborepo and Nx were not introduced. pnpm recursive and filtered execution already covers this three-package workspace, so an additional task graph and cache layer would be premature.
- A shared runtime-config package was not created because there is no shared runtime configuration behavior yet.

## Consequences

- Local commands and CI use one package manager and one lockfile.
- Framework and quality-tool upgrades are deliberate changes to this ADR and the lockfile, not floating installs.
- Product modules, database clients, state libraries, map libraries, auth providers, routing providers, and LLM SDKs remain absent until an authorized feature requires them.
- GitHub Actions is configured locally, but remote execution cannot be verified until a remote exists and the workflow runs.
- pnpm permits install scripts only for the exact transitive native tooling packages `esbuild` and `unrs-resolver`; all other dependency build scripts remain blocked by default.
