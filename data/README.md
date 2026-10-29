# Data Workspace

`registry`, `manifests`, and `licenses` hold source identity, retrieval/version metadata, checksums, attribution, access restrictions, redistribution rules, and deterministic quality evidence. `fixtures` holds only small, clearly labeled test or sample data. These records remain version-controlled.

`raw`, `staging`, and `processed` are local working areas for large or transformed datasets and are ignored by Git. Raw snapshots are immutable by retrieval date and SHA-256 identity; processed outputs require versioned manifests and reproducible transformations.

Phase 1B pins the first real source at `registry/transjakarta-gtfs.json`. The authoritative raw TransJakarta ZIP is intentionally ignored, while its tracked manifest identifies the exact local path, byte size, checksum, retrieval time, official origin, license, validation status, and quality report. Root commands provide the supported lifecycle:

```text
pnpm data:transjakarta:fetch
pnpm data:transjakarta:validate
pnpm data:transjakarta:ingest
pnpm data:transjakarta:verify
```

`fetch` never hides a network request inside application startup and never overwrites different bytes at an existing immutable snapshot path. A newly fetched checksum must be reviewed and pinned in a tracked manifest before canonical ingestion.
