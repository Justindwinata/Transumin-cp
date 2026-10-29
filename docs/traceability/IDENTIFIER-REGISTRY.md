# Identifier Registry

Identifiers are immutable once published. Never reuse a retired identifier for a different concept. Legacy File 01 requirements are cited as `LEGACY-FR-nnn`; they cannot enter implementation namespaces.

| Namespace | Owner/purpose | Allocation rule |
|---|---|---|
| `FR-` | Product Owner; canonical functional requirements | `FR-001`–`FR-014` reserved by File 10 |
| `BR-` | Domain owner; executable business rules | Existing domain prefix plus sequence, e.g. `BR-REC-001` |
| `APP-` | Student B; frontend surfaces | `APP-001`–`APP-010` reserved by File 13 |
| `MOD-` | Product architecture; backend modules | Existing mnemonic IDs from File 14 |
| `ADR-` | Product Owner/architecture review | Zero-padded monotonic sequence; never renumber |
| `TEST-` | Module/test owner; unit/integration contracts | Stable descriptive ID; existing `UT-*` may be referenced as legacy test IDs |
| `E2E-` | Student B integration; cross-surface flows | Zero-padded sequence; existing E2E-01–04 reserved |
| `EXP-` | Student A/B research owner | Student scope plus sequence, e.g. `EXP-A1`, `EXP-B1` |
| `RISK-` | Product Owner; risk register | Zero-padded monotonic sequence |
| `CONFLICT-` | Reconciliation owner | Zero-padded monotonic sequence; status retained after closure |

Runtime entity identifiers are UUIDs. External IDs remain scoped by `source_id` and dataset version and never substitute for internal primary keys.
