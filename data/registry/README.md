# Source Registry

Canonical source records belong here only after source, access, license, and coverage evidence has been verified. Phase 1B registers the first real source, `transjakarta-gtfs.json`; tests insert temporary records labelled `TEST_FIXTURE` and remove only those fixtures afterward.

Every future source record must validate against `source-record.schema.json`. A registry record describes the source itself. Retrieval-specific checksum and validity facts belong in a dataset manifest, not in the source record.
