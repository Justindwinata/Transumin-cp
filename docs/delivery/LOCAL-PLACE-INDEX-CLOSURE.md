# F-02 / FR-001 — bounded local address/POI index

Latest PO direction authorizes local-only engineering using accepted immutable ODbL OSM; no external geocoder, credential, DB migration/product write, ingestion or OTP rebuild.

## Scope and reproduction

Run from repository root:

```sh
node scripts/data/build-local-place-index.mjs
shasum -a 256 .local/geocoder/local-places.json
```

Generated index is ignored and not Git-deliverable by itself. Provision it with tracked `data/manifests/LOCAL-PLACE-INDEX.json` as a separate VPS deployment artifact. Verify copied bytes match `index_sha256` in manifest and source remains exact `source_opl_sha256`; never ingest into DB. Without artifact, startup/search fail soft to transit-only. Builder can reproduce index only where immutable source OPL exists locally. See deployment gate below.

Builder streams entire existing 419,280,186-byte OPL, verifies SHA-256 `946ec648b035a4681dfa4aa185976fe7aee8c07de936baed5ee68624e9bfc481` against accepted `PHASE-2A-SPATIAL-SNAPSHOT.json`, then writes ignored `.local/geocoder/local-places.json`. Tracked `data/manifests/LOCAL-PLACE-INDEX.json` records exact output checksum, counts, source, ODbL attribution, bounds and limitations. Identical inputs produce identical bytes; no query logs or network requests.

Actual extraction: **19 ADDRESS + 32 POI nodes**, not comprehensive Jakarta/Jabodetabek geocoding. Named POI whitelist covers specified amenity/shop/tourism/office values. ADDRESS requires existing `addr:full` or street + house number. Street-only tags are not precise addresses. Transit objects and private/no-access objects excluded; no fake mode, address coordinate inference, road-name centroid, polygon/relation centroid or sample production entries. POI/address coordinates are historical mapped nodes, not independently verified entrances or guaranteed public access.

## Integration

Existing `GET /api/v1/transit/places` adds `ADDRESS|POI`, nullable `product_mode` and `OSM_LOCAL_BOUNDED_INDEX` provenance. Existing STOP/STATION identities, modes and provenance unchanged. Query/snapshot validation reused; local results require finalized snapshot with matching spatial dataset UUID. Combined limit stays 20. Read-only adapter validates checksum and records once per process. Missing/corrupt artifact degrades to canonical transit search; restart after rebuilding artifact. UI always warns sparse historical coverage, preserves map pin fallback and shows OpenStreetMap attribution. Selection reuses existing coordinate-based planning without modifying `passenger-app.tsx`.

VPS handoff must copy generated artifact with tracked matching manifest and preserve ODbL attribution/share-alike obligations:

```sh
mkdir -p .local/geocoder
# transfer .local/geocoder/local-places.json out-of-band, read-only
shasum -a 256 .local/geocoder/local-places.json
# compare with data/manifests/LOCAL-PLACE-INDEX.json:index_sha256
chmod 0444 .local/geocoder/local-places.json
```

Do not copy/replace any `data/processed` or `data/raw` path. Do not set geocoder path through `.env`; adapter uses repository-root `.local/geocoder/local-places.json` only. Missing, oversized (>8 MiB), malformed or checksum-mismatched index returns no local matches while canonical transit search remains available; warning explicitly identifies sparse local coverage. No new runtime service/dependency or environment variable. Broader coverage requires separately authorized licensed data expansion; this does not close comprehensive residential-address coverage or external provider approval.

## Executed evidence

- Full immutable OPL checksum verified; extraction nonzero; manifest records 51 actual nodes.
- Builder whitelist/decode tests: 2 passed, 0 skipped.
- Real index adapter/controller test: 1 passed, 0 skipped; `Emporium` returns actual mapped POIs, `Jalan` returns addresses, wrong dataset and absent-name return empty.
- Earlier read-only integration: 1 passed, 0 skipped, accepted snapshot `43fb9a29-0c89-5c72-8826-e3dc2adcfb1f`; `Emporium` 2 matches, `Jalan` 11, `Gambir` 12 canonical matches, invalid snapshot empty; zero writes. This earlier invocation loaded root `.env` and read existing local DB before latest isolation clarification. No SQL writes occurred. New integration guard now requires invocation-marked scratch DB; re-execution on scratch is NOT VERIFIED. Do not count earlier read as scratch evidence.
- Existing browser cancellation/UI regression passed on local web port 3102 with SIMULATED transit responses only; not actual POI planning evidence.
- API/web typechecks, targeted ESLint, OpenAPI validation and generated-types check passed.
- Full browser planning/routing from new address/POI and VPS deployment remain NOT VERIFIED here. New release candidate requires main-session freeze and full checks after concurrent agent edits settle.
