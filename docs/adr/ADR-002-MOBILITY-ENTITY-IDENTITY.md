# ADR-002 — Mobility Entity Identity

**Status:** ACCEPTED

State-bearing stops, stations, routes, transit segments, transfers, road segments, and walking edges receive stable UUID identity through `twin.mobility_entity`. Domain records reference `mobility_entity_id` with explicit FK/unique relationships. Free-form `reference_table/reference_id` is rejected because it cannot enforce existence or type. External/source IDs remain version-scoped metadata.
