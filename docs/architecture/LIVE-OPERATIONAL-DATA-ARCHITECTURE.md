# Live Operational Data Architecture

**Status:** Phase 1D frozen contract. This is an ingestion and decision foundation, not a claim that every mode has a public live feed.

## Boundary and flow

`MOD-OPDATA operational-data` owns source capability metadata, source adapters, normalized operational observations, deterministic validation, freshness, authority comparison, conflict resolution, operator-confirmed input, and the AI-01 extraction contract. It does not own Mobility Twin history, network-state projection, journey impact, recovery, or alerts.

```text
official machine feed / official publication / operator console / controlled simulation
  -> source-specific adapter or reviewed extraction
  -> OperationalObservation + provenance
  -> deterministic contract validation
  -> freshness and expiry evaluation
  -> authority-aware conflict resolution
  -> future Mobility Twin projection (Phase 2B)
  -> affected network entities
  -> affected active journeys
  -> recovery
  -> user alert over SSE
```

All provider details stay behind `OperationalSourceAdapter`. A network adapter is allowed only for an officially documented, technically accessible source whose automation and academic/product use are permitted. A passenger-app feature is capability evidence, not proof of a public API. Undocumented/private mobile endpoints must not be discovered or used.

## Canonical semantics

Evidence and condition are separate dimensions:

- `OperationalEvidenceType = SCHEDULED | OBSERVED | LIVE | FORECAST | SIMULATED | ESTIMATED`.
- `OperationalState = AVAILABLE | DEGRADED | DISRUPTED | UNAVAILABLE | RECOVERING | UNKNOWN`.

`LIVE` requires an official machine source classified `VERIFIED_PUBLIC_API` or `VERIFIED_PUBLIC_FEED`. Operator-console submissions are `OBSERVED` with `OFFICIAL_OPERATOR_CONFIRMED` authority. Environmental observations and forecasts can indicate exposure but cannot declare a station, stop, route, or service `UNAVAILABLE`. Controlled inputs always remain `SIMULATED`.

Every observation carries `source`, `observed_at`, `received_at`, `updated_at`, `expires_at`, evidence type, operational state, confidence status, a resolvable provenance reference, and a raw reference. `OperationalIncidentCandidate` adds `VALIDATED | REQUIRES_REVIEW | REJECTED`. Supported incident types are `FLOOD`, `STATION_CLOSURE`, `STOP_CLOSURE`, `SERVICE_SUSPENSION`, `SERVICE_TRUNCATION`, `ROUTE_DIVERSION`, `INFRASTRUCTURE_FAILURE`, `WEATHER_DISRUPTION`, `MANUAL_OPERATOR_INCIDENT`, and `OTHER`.

## Freshness and TTL

An observation is `NOT_YET_VALID` before `observed_at`, `FRESH` from `observed_at` inclusive to `expires_at` exclusive, and `EXPIRED` at or after `expires_at`. If no valid fresh evidence remains, effective state is `UNKNOWN`; the system never extends a stale state by omission.

TTL comes from an official source contract or from a source-specific, versioned adapter policy. Phase 1D freezes one evidence-backed default: PetaBencana CAP flood-area observations expire after six hours. Other sources must supply an explicit expiry during ingestion; no undocumented operator update frequency is invented. A stale record may be received and retained for audit even when its source-defined expiry precedes retrieval.

## Authority and conflict resolution

The descending source order is:

1. official machine feed or operator API;
2. official operator-confirmed input;
3. official public operator update;
4. verified government or disruption source;
5. crowdsourced observation;
6. forecast;
7. controlled simulation.

Resolution first removes not-yet-valid and expired evidence, then selects the highest authority. Within one authority it uses the newest `observed_at`, then `received_at`, then observation ID for a deterministic tie-break. Lower-authority evidence cannot override stronger fresh evidence merely because its state is more severe. Superseded and expired observation IDs remain explicit in the result.

## Fallbacks and operator confirmation

Every operational path normalizes to the same incident contract:

1. official machine feed;
2. official public service information, optionally converted by AI-01 into a reviewable candidate;
3. authenticated operator incident console;
4. controlled historical or simulation input.

The future protected operator endpoint/use case accepts source/operator identity, authenticated actor identity, affected entities and modes, incident type, state, reason, start time, and expected end/expiry. The domain use case exists in Phase 1D, but no public controller is exposed until authentication, authorization, audit retention, and idempotency are specified. This is `OPERATOR_CONFIRMED`, never crowdsourcing.

## AI contracts

AI-01, Official Incident Information Extraction, may copy facts from an official source into `incident_type`, affected entities/mode, state, start/end, reason, exact source claims, unsupported fields, and confidence. Each populated field requires an exact source span. Unsupported or ungrounded fields invalidate the candidate; deterministic schema validation and later entity resolution remain mandatory. No provider call is included in Phase 1D.

AI-02, Grounded Agentic Mobility Copilot, will later use bounded tools to explain network state, evidence, journey impact, recovery, and operator recovery. It is not a routing engine, detector, state authority, or substitute for provenance.

## Delivery contract and release gates

SSE is the preferred baseline for server-to-client operational updates because the primary flow is unidirectional and event-driven. WebSocket is optional only if a later bidirectional requirement justifies it.

- **MULTIMODAL:** every claimed mode has a real routing representation.
- **OPERATIONAL:** every operational claim has source, timestamps, freshness, state/evidence, and provenance.
- **FRESHNESS:** expired states cannot remain effective.
- **ALERT:** a disruption can be related to affected active journeys.
- **RECOVERY:** routing excludes `UNAVAILABLE` entities.
- **AI:** AI extracts or explains grounded facts and cannot create operational truth.
- **NO-FAKE-LIVE:** scheduled, observed, forecast, estimated, and simulated evidence is never labeled live.

## Phase 3 runtime realization

Phase 3 implements `LiveOperationalGateway` as validate → deterministic resolve → append-only persist → effective-state project → safe event publication. Source polling is configurable, non-overlapping, timeout/retry/backoff-aware, and records health independently of evidence expiry. The PetaBencana adapter supports the documented TopoJSON flood-area response; automated tests use a recorded/minimized fixture, while network availability is checked only by the explicit `data:petabencana:probe` command.

SSE is available at `GET /api/v1/operational-events/stream`, with event IDs, typed summaries, heartbeat, clean unsubscribe, and bounded `Last-Event-ID` replay. It does not stream raw provider payloads and does not claim journey-specific alerts. Controlled mutation routes use a deny-by-default internal bearer boundary configured only through `INTERNAL_RESEARCH_TOKEN`; this is an interim protection, not the deferred product identity/role system.

Flood geometry creates `DIRECT_EXPOSURE` records, never closure. Scenario state is computed as immutable base snapshot plus run-specific `SIMULATED` overrides. `UNKNOWN` means missing fresh confirmation and remains traversable; `UNAVAILABLE` is the explicit blocking condition. Phase 3 does not implement active journeys, user targeting, recovery, operator recovery, or frontend UI.
