// DO NOT EDIT MANUALLY. Generated from docs/api/openapi-v1.yaml.
export interface paths {
    "/api/v1/transit/operators": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listTransitOperators"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/network/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getNetworkState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/network/entities/{entityId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getNetworkEntity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/network/snapshots/{snapshotId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getNetworkSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/disruption-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createDisruptionEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/disruption-events/{eventId}/impact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getDisruptionEventImpact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios/{scenarioId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        get: operations["getScenario"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateScenario"];
        trace?: never;
    };
    "/api/v1/scenarios/{scenarioId}/runs": {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createSimulationRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/simulation-runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        get: operations["getSimulationRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/simulation-runs/{runId}/impact": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        get: operations["getSimulationRunImpact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/operational-events/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Server-Sent Events stream of safe operational summaries. Supports Last-Event-ID replay within the bounded process buffer and emits heartbeats. */
        get: operations["streamOperationalEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/planning-health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Point-in-time OTP GraphQL reachability, not route feasibility or live-data freshness. Independent of database-only /health/ready. Read-only; no owner data or credentials returned. Passenger proxy requires its signed session and service identity. No automatic polling; client may explicitly recheck. OTP probe bounded at 30 seconds; proxy 30 seconds and client 35 seconds remain unchanged. */
        get: operations["getPlanningHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["planJourneys"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        get: operations["getJourney"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/activate": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
                /** @description Logical activation idempotency key; retries with the same key and equivalent plan replay one server-generated instance. */
                "Idempotency-Key": components["parameters"]["ActivationIdempotencyKey"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Creates a new owner-scoped active journey instance. The Idempotency-Key identifies one logical activation; retries with the same key and equivalent plan return the same instance, while a different plan body under the same key is a 409 conflict. */
        post: operations["activateJourney"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/boarding/{legSequence}": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
                legSequence: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Explicit passenger boarding confirmation for the current non-walking leg. Confirmation must never be derived from device GPS. */
        post: operations["confirmLegBoarding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/alighting/{legSequence}": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
                legSequence: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Explicit passenger alighting confirmation after boarding for the same non-walking leg. Confirmation must never be derived from device GPS. */
        post: operations["confirmLegAlighting"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/progress": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateJourneyProgress"];
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/status": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        get: operations["getJourneyStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/alerts": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        get: operations["listJourneyAlerts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/journeys/{journeyId}/alerts/stream": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        /** @description Owner- and journey-scoped Server-Sent Events stream. Targeted alerts are excluded from the public operational stream. */
        get: operations["streamJourneyAlerts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/recoveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/recoveries/{recoveryId}": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                recoveryId: components["parameters"]["RecoveryId"];
            };
            cookie?: never;
        };
        get: operations["getRecovery"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/recoveries/{recoveryId}/accept": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                recoveryId: components["parameters"]["RecoveryId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["acceptRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/operator-recovery/analyses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createOperatorRecoveryAnalysis"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/operator-recovery/analyses/{analysisId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                analysisId: components["parameters"]["AnalysisId"];
            };
            cookie?: never;
        };
        get: operations["getOperatorRecoveryAnalysis"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/copilot/research/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Authenticated RESEARCHER_OPERATOR or ADMIN only. Owner derives from principal user ID; request owner headers/body ignored. */
        post: operations["createResearchCopilotMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/copilot/research/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getResearchCopilotSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/copilot/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createCopilotMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/copilot/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getCopilotSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/passenger-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Owner-scoped refresh list of journey-associated passenger reports. Supply idempotency_key to reconcile a single previously submitted attempt without listing the journey. */
        get: operations["listPassengerReportsByJourney"];
        put?: never;
        /** @description Owner-scoped passenger report submission. Reports are unverified evidence until controlled review. */
        post: operations["createPassengerReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/passenger-reports/{reportId}": {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                reportId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        get: operations["getPassengerReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/passenger-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description ADMIN-only latest 100 reports with private review references and current expiry/lifecycle. Authenticated server principal; never passenger service credentials. */
        get: operations["listAdminPassengerReports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/passenger-reports/{reportId}/restrict": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description ADR-010 ADMIN field review, not official operator evidence. Requires current documented observation and public reason; private evidence reference never enters public incident provenance. Identical claim replays; conflicting evidence fails. */
        post: operations["restrictAdminPassengerReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/passenger-reports/{reportId}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description ADMIN can resolve/retract only ADMIN_FIELD_REVIEW incidents; actor and public reason are journaled. History is retained. */
        post: operations["closeAdminPassengerReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/controlled/passenger-reports/{reportId}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Trusted operator-controlled verification of one passenger report into verified SIMULATED incident evidence. Production remains fail-closed. */
        post: operations["verifyControlledPassengerReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/controlled/passenger-reports/{reportId}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** @description Dev/test-only terminal of a controlled SIMULATED passenger review (Resolved = condition cleared, Retracted = assertion withdrawn). Keeps acceptance repeatable without permanently blocking planning. */
        post: operations["closeControlledPassengerReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/data-sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listDataSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transit/places": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Snapshot-scoped canonical stops/stations plus checksum-verified sparse local OSM address/POI nodes from matching spatial dataset. Not comprehensive geocoding; missing/corrupt local index preserves transit search. */
        get: operations["searchTransitPlaces"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/data-sources/{sourceId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listDataSourceVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/replays": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createExperimentReplay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/experiments/{experimentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getExperiment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Format: uuid */
        Uuid: string;
        /** @enum {string} */
        EvidenceType: "SCHEDULED" | "OBSERVED" | "LIVE" | "FORECAST" | "SIMULATED" | "ESTIMATED";
        /** @enum {string|null} */
        NullableEvidenceType: "SCHEDULED" | "OBSERVED" | "LIVE" | "FORECAST" | "SIMULATED" | "ESTIMATED" | null;
        /** @enum {string} */
        AvailabilityState: "AVAILABLE" | "DEGRADED" | "DISRUPTED" | "UNAVAILABLE" | "RECOVERING" | "UNKNOWN";
        /** @enum {string} */
        FreshnessStatus: "FRESH" | "AGING" | "STALE" | "EXPIRED" | "UNKNOWN" | "NOT_YET_VALID";
        /** @enum {string} */
        RunStatus: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
        ProvenanceSummary: {
            evidence_type: components["schemas"]["EvidenceType"];
            reference_ids: string[];
            /** Format: date-time */
            observed_at?: string | null;
            limitations?: string[];
        };
        Meta: {
            request_id: string;
            warnings: string[];
            provenance?: components["schemas"]["ProvenanceSummary"];
            next_cursor?: string | null;
        };
        CollectionEnvelope: {
            data: {
                [key: string]: unknown;
            }[];
            meta: components["schemas"]["Meta"];
        };
        TransitPlace: {
            place_id: components["schemas"]["Uuid"];
            external_id: string;
            name: string;
            /** @enum {string} */
            kind: "STOP" | "STATION" | "ADDRESS" | "POI";
            /**
             * @description Null only for ADDRESS/POI; canonical STOP/STATION retain transit mode.
             * @enum {string|null}
             */
            product_mode: "TRANSJAKARTA" | "MIKROTRANS" | "KRL" | "MRT_JAKARTA" | "LRT_JAKARTA" | "LRT_JABODEBEK" | null;
            latitude: number;
            longitude: number;
            dataset_version_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            provenance: "OFFICIAL_TRANSJAKARTA_GTFS" | "OSM_OFFICIAL_CORROBORATED_TOPOLOGY" | "OSM_LOCAL_BOUNDED_INDEX";
        };
        TransitPlaceCollectionEnvelope: {
            data: components["schemas"]["TransitPlace"][];
            meta: components["schemas"]["Meta"];
        };
        DataSource: {
            source_id: components["schemas"]["Uuid"];
            source_key: string;
            name: string;
            provider: string;
            source_type: string;
            /** Format: uri */
            canonical_url: string | null;
            license_name: string | null;
            /** Format: uri */
            license_url: string | null;
            access_method: string | null;
            access_notes: string | null;
            coverage_notes: string | null;
            redistribution_rule: string | null;
            /** @enum {string} */
            verification_status: "NOT_VERIFIED" | "VERIFIED" | "REJECTED";
            active: boolean;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        DatasetVersion: {
            dataset_version_id: components["schemas"]["Uuid"];
            source_id: components["schemas"]["Uuid"];
            version_label: string;
            checksum_sha256: string;
            /** Format: date-time */
            retrieved_at: string;
            /** Format: date-time */
            effective_from: string | null;
            /** Format: date-time */
            effective_to: string | null;
            raw_path_ref: string;
            manifest_path: string;
            /** @enum {string} */
            validation_status: "PENDING" | "VALID" | "WARNING" | "INVALID";
        };
        DataSourceCollectionEnvelope: {
            data: components["schemas"]["DataSource"][];
            meta: components["schemas"]["Meta"];
        };
        DatasetVersionCollectionEnvelope: {
            data: components["schemas"]["DatasetVersion"][];
            meta: components["schemas"]["Meta"];
        };
        NetworkEntity: {
            mobility_entity_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            entity_type: "STOP" | "STATION" | "ROUTE" | "TRANSIT_SEGMENT" | "TRANSFER" | "ROAD_SEGMENT" | "WALKING_EDGE" | "RAIL_TOPOLOGY_EDGE";
            availability: components["schemas"]["AvailabilityState"];
            evidence_type: components["schemas"]["NullableEvidenceType"];
            freshness_status: components["schemas"]["FreshnessStatus"];
            /** Format: date-time */
            observed_at: string | null;
            /** Format: date-time */
            expires_at: string | null;
            provenance_ref: string | null;
        };
        NetworkStateItem: {
            mobility_entity_id: components["schemas"]["Uuid"];
            availability: components["schemas"]["AvailabilityState"];
            evidence_type: components["schemas"]["NullableEvidenceType"];
            freshness_status: components["schemas"]["FreshnessStatus"];
            /** Format: date-time */
            observed_at: string | null;
            /** Format: date-time */
            expires_at: string | null;
            provenance_ref: string | null;
        };
        NetworkEntityEnvelope: {
            data: components["schemas"]["NetworkEntity"];
            meta: components["schemas"]["Meta"];
        };
        NetworkStateEnvelope: {
            data: {
                network_snapshot_id: components["schemas"]["Uuid"];
                simulation_run_id?: components["schemas"]["Uuid"];
                entities: components["schemas"]["NetworkStateItem"][];
            };
            meta: components["schemas"]["Meta"];
        };
        NetworkSnapshotEnvelope: {
            data: {
                network_snapshot_id: components["schemas"]["Uuid"];
                /** Format: date-time */
                captured_at: string;
                /** Format: date-time */
                state_cutoff_at: string;
                fingerprint: string;
                dataset_version_ids: components["schemas"]["Uuid"][];
                processing_version: string;
                /** @enum {string} */
                status: "DRAFT" | "FINALIZED";
                materialized_state_count: number;
            };
            meta: components["schemas"]["Meta"];
        };
        DisruptionEventRequest: {
            /** @enum {string} */
            event_type: "FLOOD";
            /** @description Validated GeoJSON geometry */
            geometry: Record<string, never>;
            /** Format: date-time */
            effective_from: string;
            /** Format: date-time */
            effective_to?: string | null;
            evidence_type: components["schemas"]["EvidenceType"];
            provenance: components["schemas"]["ProvenanceSummary"];
        };
        DisruptionEventEnvelope: {
            data: components["schemas"]["DisruptionEventRequest"] & {
                event_id: components["schemas"]["Uuid"];
            };
            meta: components["schemas"]["Meta"];
        };
        ExperimentReplayRequest: {
            network_snapshot_id: components["schemas"]["Uuid"];
            scenario_id: components["schemas"]["Uuid"];
            baseline_configuration: {
                [key: string]: unknown;
            };
            proposed_configuration: {
                [key: string]: unknown;
            };
            manifest_checksum: string;
        };
        ExperimentEnvelope: {
            data: {
                experiment_id: components["schemas"]["Uuid"];
                status: components["schemas"]["RunStatus"];
                manifest_checksum: string;
                result_references?: string[];
            };
            meta: components["schemas"]["Meta"];
        };
        ScenarioAction: {
            mobility_entity_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            action_type: "SET_AVAILABILITY" | "BLOCK_ENTITY" | "DEGRADE_ENTITY" | "RESTORE_ENTITY";
            availability?: components["schemas"]["AvailabilityState"];
            reason: string;
            parameters?: {
                [key: string]: unknown;
            };
        };
        ScenarioCreateRequest: {
            name: string;
            description?: string;
            actions: components["schemas"]["ScenarioAction"][];
        };
        ScenarioPatchRequest: {
            name?: string;
            description?: string;
            actions?: components["schemas"]["ScenarioAction"][];
        };
        Scenario: components["schemas"]["ScenarioCreateRequest"] & {
            scenario_id: components["schemas"]["Uuid"];
            version: number;
            /** @enum {string} */
            status: "DRAFT" | "READY" | "ARCHIVED";
        };
        ScenarioEnvelope: {
            data: components["schemas"]["Scenario"];
            meta: components["schemas"]["Meta"];
        };
        SimulationRunCreateRequest: {
            network_snapshot_id: components["schemas"]["Uuid"];
            configuration: {
                [key: string]: unknown;
            };
        };
        SimulationRun: {
            simulation_run_id: components["schemas"]["Uuid"];
            scenario_id: components["schemas"]["Uuid"];
            network_snapshot_id: components["schemas"]["Uuid"];
            status: components["schemas"]["RunStatus"];
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            completed_at?: string | null;
            failure_code?: string | null;
        };
        SimulationRunEnvelope: {
            data: components["schemas"]["SimulationRun"];
            meta: components["schemas"]["Meta"];
        };
        ImpactResult: {
            impact_id: components["schemas"]["Uuid"];
            simulation_run_id?: components["schemas"]["Uuid"] | null;
            affected_entities: {
                mobility_entity_id: components["schemas"]["Uuid"];
                availability: components["schemas"]["AvailabilityState"];
                direct?: boolean;
                rule_reference?: string;
            }[];
            metrics?: {
                directly_exposed: number;
                confirmed_unavailable: number;
                components_before: number;
                components_after: number;
                connectivity_loss: number;
                isolated_entities: number;
                affected_routes: number;
                affected_segments: number;
                unresolved_entities: number;
                runtime_ms: number;
            };
            provenance: components["schemas"]["ProvenanceSummary"];
        };
        ImpactEnvelope: {
            data: components["schemas"]["ImpactResult"];
            meta: components["schemas"]["Meta"];
        };
        GeoPoint: {
            latitude: number;
            longitude: number;
        };
        JourneyPlanRequest: {
            origin: components["schemas"]["GeoPoint"];
            destination: components["schemas"]["GeoPoint"];
            /** Format: date-time */
            departure_at: string;
            network_snapshot_id: components["schemas"]["Uuid"];
            simulation_run_id?: components["schemas"]["Uuid"];
            /** @enum {string} */
            preference?: "BALANCED" | "FASTEST" | "FEWEST_TRANSFERS" | "LEAST_WALKING";
        };
        JourneyEntityBinding: {
            otp_entity_id: string;
            canonical_entity_id: components["schemas"]["Uuid"];
            mobility_entity_id: components["schemas"]["Uuid"] | null;
            /** @enum {string} */
            entity_type: "STOP" | "STATION" | "ROUTE";
            /** @enum {string} */
            resolution_method: "EXACT_SOURCE_REFERENCE" | "OPERATOR_SCOPED_EXACT_ALIAS" | "CONTROLLED_ROUTING_IDENTITY";
            provenance_ref: string;
        };
        JourneyOperationalFlag: {
            mobility_entity_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            availability: "DEGRADED" | "DISRUPTED";
            evidence_type: components["schemas"]["NullableEvidenceType"];
            freshness_status: components["schemas"]["FreshnessStatus"];
            provenance_ref: string | null;
        };
        JourneyEndpoint: {
            name: string;
            otp_stop_id: string | null;
            latitude?: number | null;
            longitude?: number | null;
        };
        JourneyGeometry: {
            /** @enum {string} */
            type: "LineString";
            coordinates: number[][];
        };
        JourneyWalkingStep: {
            latitude: number;
            longitude: number;
            distance_meters: number;
            relative_direction: string | null;
            absolute_direction: string | null;
            street_name: string | null;
            bogus_name: boolean;
            area: boolean;
            stay_on: boolean;
        };
        JourneySegment: {
            sequence: number;
            /** @enum {string} */
            mode: "WALK" | "TRANSJAKARTA" | "MIKROTRANS" | "KRL" | "MRT_JAKARTA" | "LRT_JAKARTA" | "LRT_JABODEBEK";
            otp_mode: string;
            from: components["schemas"]["JourneyEndpoint"];
            to: components["schemas"]["JourneyEndpoint"];
            /** Format: date-time */
            start_at: string;
            /** Format: date-time */
            end_at: string;
            duration_seconds: number;
            distance_meters: number;
            route_id: string | null;
            route_short_name: string | null;
            trip_id: string | null;
            /** Format: date */
            service_date: string | null;
            /** @enum {string} */
            timing_precision: "EXACT_SCHEDULE" | "FREQUENCY_DERIVED" | "SOURCE_GTFS_WITH_FREQUENCIES" | "ESTIMATED";
            geometry: components["schemas"]["JourneyGeometry"] | null;
            walking_steps: components["schemas"]["JourneyWalkingStep"][];
            evidence_type: components["schemas"]["EvidenceType"];
            entity_bindings: components["schemas"]["JourneyEntityBinding"][];
            operational_flags: components["schemas"]["JourneyOperationalFlag"][];
        };
        JourneyRoutingContext: {
            /** @enum {string} */
            provider: "OTP";
            provider_version: string;
            routing_snapshot_id: string;
            routing_manifest_sha256: string;
            graph_sha256: string;
            network_snapshot_id: components["schemas"]["Uuid"];
            network_snapshot_hash: string;
            mobility_projection_version: string;
            /** Format: date-time */
            planned_at: string;
            /** Format: date */
            common_service_date: string;
            /** @enum {string} */
            timezone: "Asia/Jakarta";
            attempt_count: number;
            excluded_route_ids: string[];
        };
        Journey: {
            journey_id: components["schemas"]["Uuid"];
            plan_journey_id?: components["schemas"]["Uuid"];
            origin: components["schemas"]["GeoPoint"];
            destination: components["schemas"]["GeoPoint"];
            network_snapshot_id: components["schemas"]["Uuid"];
            simulation_run_id?: components["schemas"]["Uuid"];
            /** @enum {string} */
            status: "PLANNED" | "ACTIVE" | "DISRUPTED" | "COMPLETED" | "CANCELLED";
            /** Format: date-time */
            start_at: string;
            /** Format: date-time */
            end_at: string;
            duration_seconds: number;
            transfer_count: number;
            walking_distance_meters: number;
            /** @enum {string} */
            fare_status: "UNKNOWN";
            segments: components["schemas"]["JourneySegment"][];
            routing_context: components["schemas"]["JourneyRoutingContext"];
            /** Format: date-time */
            activated_at?: string;
            /** Format: date-time */
            completed_at?: string | null;
            plan_fingerprint?: string;
            accepted_recovery_id?: components["schemas"]["Uuid"] | null;
            accepted_before_segment_count?: number | null;
            original_plan?: components["schemas"]["Journey"] | null;
            progress?: components["schemas"]["JourneyProgress"];
            dependencies?: components["schemas"]["JourneyDependency"][];
        };
        JourneyPlanEnvelope: {
            data: components["schemas"]["Journey"][];
            meta: components["schemas"]["Meta"];
        };
        JourneyEnvelope: {
            data: components["schemas"]["Journey"];
            meta: components["schemas"]["Meta"];
        };
        JourneyActivationRequest: {
            selected_journey: components["schemas"]["Journey"];
            /** Format: date-time */
            activated_at?: string;
        };
        JourneyConfirmationRequest: {
            /** Format: date-time */
            confirmed_at: string;
            accepted_recovery_id?: components["schemas"]["Uuid"] | null;
        };
        JourneyProgressRequest: {
            completed_segment_count: number;
            current_segment_sequence?: number;
            /** Format: date-time */
            recorded_at: string;
            current_position?: components["schemas"]["GeoPoint"];
            accepted_recovery_id?: components["schemas"]["Uuid"] | null;
        };
        JourneyProgress: {
            completed_segment_count: number;
            current_segment_sequence: number | null;
            /** @enum {string} */
            method: "CONTROLLED_MANUAL";
            /** Format: date-time */
            recorded_at: string;
            revision: number;
            boarding_confirmed_segment_sequence: number | null;
            /** Format: date-time */
            boarding_confirmed_at: string | null;
            alighting_confirmed_segment_sequence: number | null;
            /** Format: date-time */
            alighting_confirmed_at: string | null;
        };
        JourneyDependency: {
            dependency_id: components["schemas"]["Uuid"];
            leg_sequence: number;
            mobility_entity_id: components["schemas"]["Uuid"];
            canonical_entity_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            entity_type: "STOP" | "STATION" | "ROUTE";
            /** @enum {string} */
            product_mode: "TRANSJAKARTA" | "MIKROTRANS" | "KRL" | "MRT_JAKARTA" | "LRT_JAKARTA" | "LRT_JABODEBEK";
            provenance_ref: string;
        };
        JourneyAlert: {
            alert_id: components["schemas"]["Uuid"];
            impact_id: components["schemas"]["Uuid"];
            journey_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            alert_type: "BLOCKING" | "DISRUPTION" | "RECOVERY_UPDATE";
            message: string;
            mobility_entity_id: components["schemas"]["Uuid"];
            affected_segment_sequences: number[];
            /** @enum {string} */
            operational_state: "UNAVAILABLE" | "DEGRADED" | "DISRUPTED" | "RECOVERING";
            evidence_type: components["schemas"]["NullableEvidenceType"];
            freshness_status: string;
            observation_id: components["schemas"]["Uuid"] | null;
            source_id: components["schemas"]["Uuid"] | null;
            /** Format: date-time */
            observed_at: string | null;
            /** Format: date-time */
            received_at: string | null;
            /** Format: date-time */
            expires_at: string | null;
            provenance_ref: string | null;
            projection_version: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            resolved_at: string | null;
        };
        JourneyAlertCollectionEnvelope: {
            data: components["schemas"]["JourneyAlert"][];
            meta: components["schemas"]["Meta"];
        };
        JourneyStatusEnvelope: {
            data: {
                journey_id: components["schemas"]["Uuid"];
                /** @enum {string} */
                status: "ACTIVE" | "COMPLETED" | "CANCELLED";
                availability: components["schemas"]["AvailabilityState"];
                progress: components["schemas"]["JourneyProgress"];
                open_alert_count: number;
            };
            meta: components["schemas"]["Meta"];
        };
        RecoveryCreateRequest: {
            original_journey_id: components["schemas"]["Uuid"];
            impact_id: components["schemas"]["Uuid"];
            /** Format: date-time */
            recovery_at: string;
        };
        RecoveryMetrics: {
            recovery_success: boolean;
            preserved_leg_ratio: number;
            eligible_remaining_leg_count: number;
            plan_change_count: number;
            disrupted_entity_avoidance: boolean;
            state_validation_ms: number;
            preservation_processing_ms: number;
            proposed_routing_ms: number;
            baseline_routing_ms: number;
            total_computation_ms: number;
            state_aware: components["schemas"]["RecoveryMethodMetrics"];
            full_replan: components["schemas"]["RecoveryMethodMetrics"];
        };
        RecoveryMethodMetrics: {
            recovery_success: boolean;
            preserved_leg_ratio: number;
            additional_duration_seconds: number | null;
            additional_transfers: number | null;
            plan_change_count: number | null;
            disrupted_entity_avoidance: boolean;
            timing: {
                total_ms: number;
                routing_ms: number;
                validation_ms: number;
                merge_ms?: number;
            };
        };
        Recovery: {
            recovery_id: components["schemas"]["Uuid"];
            original_journey_id: components["schemas"]["Uuid"];
            impact_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            method: "STATE_AWARE_REPAIR";
            /** @enum {string} */
            status: "COMPLETED" | "NO_PATH" | "FAILED";
            progress_revision: number;
            completed_segment_count: number;
            recovery_anchor: components["schemas"]["GeoPoint"] & {
                name: string;
            };
            /** Format: date-time */
            recovery_at: string;
            network_snapshot_id: components["schemas"]["Uuid"];
            mobility_projection_version: string;
            original_journey_fingerprint: string;
            proposed_fingerprint: string | null;
            baseline_fingerprint: string | null;
            triggering_entity_id: components["schemas"]["Uuid"];
            state_transition_id: components["schemas"]["Uuid"];
            reason: string;
            preserved_segment_count: number;
            changed_segment_count: number;
            additional_duration_seconds: number | null;
            additional_transfers: number | null;
            metrics: components["schemas"]["RecoveryMetrics"];
            completed_segments: number[];
            preserved_segments: number[];
            invalidated_segments: number[];
            repaired_segments: number[];
            rejoined_segments: number[];
            /** @enum {string} */
            rejoin_status: "REJOINED" | "SUFFIX_REPLANNED" | "NO_PATH";
            rejoin_reason: string;
            proposed_journey: components["schemas"]["Journey"] | null;
            baseline_journey: components["schemas"]["Journey"] | null;
            accepted?: boolean;
            /** Format: date-time */
            accepted_at?: string | null;
            accepted_journey_fingerprint?: string | null;
        };
        RecoveryEnvelope: {
            data: components["schemas"]["Recovery"];
            meta: components["schemas"]["Meta"];
        };
        RecoveryAcceptRequest: {
            progress_revision: number;
            /** Format: date-time */
            accepted_at?: string;
        };
        RecoveryAcceptance: {
            recovery_id: components["schemas"]["Uuid"];
            original_journey_id: components["schemas"]["Uuid"];
            accepted_progress_revision: number;
            accepted_impact_id: components["schemas"]["Uuid"];
            accepted_state_transition_id: components["schemas"]["Uuid"];
            accepted_mobility_projection_version: string;
            accepted_journey_fingerprint: string;
            current_replacement_journey: components["schemas"]["Journey"];
            /** Format: date-time */
            accepted_at: string;
            /** @enum {boolean} */
            original_plan_preserved: true;
            /** @enum {boolean} */
            current_pointer_advanced: true;
        };
        RecoveryAcceptanceEnvelope: {
            data: components["schemas"]["RecoveryAcceptance"];
            meta: components["schemas"]["Meta"];
        };
        /** @description FR-007 bounded conservative split. Explicit closures are SIMULATED assumptions, never verified live dispatch. Maximum 1000 segments in one route direction. */
        OperatorAnalysisRequest: {
            route_id: components["schemas"]["Uuid"];
            simulation_run_id?: components["schemas"]["Uuid"];
            blocked_transit_segment_ids?: components["schemas"]["Uuid"][];
            network_snapshot_id: components["schemas"]["Uuid"];
            target_headway_seconds: number;
            turnaround_buffer_seconds: number;
            temporary_bridge_resource?: {
                mode: string;
                vehicle_count: number;
                cycle_time_seconds: number;
            };
        } | unknown | unknown;
        /** @description FR-007 outputs are decision support only, never autonomous commands. estimated_vehicle_requirement is null until validated bidirectional timing exists; bridge vehicles use formula ESTIMATED VEHICLE REQUIREMENT = ceil(cycle_seconds / target_headway_seconds). All outputs REQUIRE operator validation or are INSUFFICIENT_EVIDENCE. */
        OperatorAnalysis: {
            analysis_id: components["schemas"]["Uuid"];
            route_id: components["schemas"]["Uuid"];
            upstream_service: components["schemas"]["Uuid"][];
            downstream_service: components["schemas"]["Uuid"][];
            cut_point_candidate?: components["schemas"]["Uuid"];
            restart_point_candidate?: components["schemas"]["Uuid"];
            unresolved_gap: {
                [key: string]: unknown;
            };
            estimated_vehicle_requirement: number;
            assumptions: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            validation_status: "VALIDATED" | "REQUIRES_OPERATOR_VALIDATION" | "INSUFFICIENT_EVIDENCE";
            provenance?: components["schemas"]["ProvenanceSummary"];
        };
        OperatorAnalysisEnvelope: {
            data: components["schemas"]["OperatorAnalysis"];
            meta: components["schemas"]["Meta"];
        };
        CopilotMessageRequest: {
            message: string;
            context_references?: string[];
            /** @description Existing owner session; omitted creates one. */
            session_id?: components["schemas"]["Uuid"] | null;
        };
        CopilotSessionEnvelope: {
            data: {
                session_id: components["schemas"]["Uuid"];
                /** Format: date-time */
                created_at: string;
                /** Format: date-time */
                expires_at: string;
                /** @constant */
                history_limit: 100;
                messages: {
                    message_id: components["schemas"]["Uuid"];
                    /** Format: date-time */
                    created_at: string;
                    request_digest: string;
                    answer: string;
                    evidence_type: components["schemas"]["EvidenceType"];
                    evidence_references: string[];
                    tool_result_references: string[];
                    /** @enum {string} */
                    fallback_status: "GROUNDED" | "DETERMINISTIC_FALLBACK" | "INSUFFICIENT_EVIDENCE";
                    tool_audit: Record<string, never>[];
                }[];
            };
            meta: components["schemas"]["Meta"];
        };
        CopilotMessage: {
            message_id: components["schemas"]["Uuid"];
            answer: string;
            evidence_references: string[];
            tool_result_references: string[];
            evidence_type?: components["schemas"]["EvidenceType"];
            /** @enum {string} */
            fallback_status: "GROUNDED" | "DETERMINISTIC_FALLBACK" | "INSUFFICIENT_EVIDENCE";
        };
        /** @enum {string} */
        PassengerReportCategory: "CLEANLINESS" | "CROWDING" | "ACCESSIBILITY" | "SAFETY" | "SERVICE" | "OTHER";
        /** @enum {string} */
        ControlledReportOperationalState: "DEGRADED" | "DISRUPTED" | "UNAVAILABLE" | "RECOVERING";
        /** @enum {string} */
        PassengerOperationalIncidentType: "STATION_CLOSURE" | "STOP_CLOSURE" | "SERVICE_SUSPENSION" | "SERVICE_TRUNCATION" | "ROUTE_DIVERSION" | "INFRASTRUCTURE_FAILURE" | "MANUAL_OPERATOR_INCIDENT" | "OTHER";
        PassengerReport: {
            report_id: components["schemas"]["Uuid"];
            active_journey_id: components["schemas"]["Uuid"] | null;
            category: components["schemas"]["PassengerReportCategory"];
            /** Format: date-time */
            observed_at: string;
            /** Format: date-time */
            received_at: string;
            mobility_entity_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            entity_type: "STOP" | "STATION" | "ROUTE";
            description: string;
            /** @enum {string} */
            source: "PASSENGER_SELF_REPORT";
            /** @enum {string} */
            verification_status: "REPORTED_UNVERIFIED" | "CONTROLLED_VERIFIED" | "ADMIN_RESTRICTED";
            /** Format: date-time */
            created_at: string;
        };
        PassengerReportEnvelope: {
            data: components["schemas"]["PassengerReport"];
            meta: components["schemas"]["Meta"];
        };
        PassengerReportCollectionEnvelope: {
            data: components["schemas"]["PassengerReport"][];
            meta: components["schemas"]["Meta"];
        };
        PassengerReportCreateRequest: {
            active_journey_id?: components["schemas"]["Uuid"] | null;
            category: components["schemas"]["PassengerReportCategory"];
            /** Format: date-time */
            observed_at: string;
            mobility_entity_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            entity_type: "STOP" | "STATION" | "ROUTE";
            description: string;
        };
        AdminPassengerReport: components["schemas"]["PassengerReport"] & {
            review_authority: string | null;
            incident_id: components["schemas"]["Uuid"] | null;
            /** Format: date-time */
            expires_at: string | null;
            lifecycle_status: string | null;
            actor_user_id: components["schemas"]["Uuid"] | null;
            evidence_reference: string | null;
            restriction_active: boolean;
        };
        AdminRestrictionRequest: {
            /** @enum {string} */
            operational_state: "DEGRADED" | "DISRUPTED" | "UNAVAILABLE" | "RECOVERING";
            /** @enum {string} */
            incident_type: "STATION_CLOSURE" | "STOP_CLOSURE" | "SERVICE_SUSPENSION" | "SERVICE_TRUNCATION" | "ROUTE_DIVERSION" | "INFRASTRUCTURE_FAILURE" | "MANUAL_OPERATOR_INCIDENT" | "OTHER";
            /** @description Public explanation, no private evidence or personal information. */
            reason: string;
            /** @description Private documented field evidence reference; retained in admin audit only. */
            evidence_reference: string;
            /**
             * Format: date-time
             * @description Actual observation within previous 30 minutes, not future.
             */
            observed_at: string;
            valid_for_minutes: number;
        };
        ControlledPassengerReportVerifyRequest: {
            operational_state: components["schemas"]["ControlledReportOperationalState"];
            incident_type: components["schemas"]["PassengerOperationalIncidentType"];
            reason: string;
        };
        ControlledPassengerReportVerifyResponse: {
            report_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            verification_status: "CONTROLLED_VERIFIED";
            incident_id: components["schemas"]["Uuid"];
            review_replay?: boolean;
            evidence_status?: string;
        };
        ControlledPassengerReportVerifyEnvelope: {
            data: components["schemas"]["ControlledPassengerReportVerifyResponse"];
            meta: components["schemas"]["Meta"];
        };
        ControlledPassengerReportCloseRequest: {
            /** @enum {string} */
            decision: "RESOLVED" | "RETRACTED";
            reason: string;
        };
        ControlledPassengerReportCloseResponse: {
            report_id: components["schemas"]["Uuid"];
            incident_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            lifecycle_status: "RESOLVED" | "RETRACTED";
            /** @enum {string} */
            decision: "RESOLVED" | "RETRACTED";
        };
        ControlledPassengerReportCloseEnvelope: {
            data: components["schemas"]["ControlledPassengerReportCloseResponse"];
            meta: components["schemas"]["Meta"];
        };
        CopilotMessageEnvelope: {
            data: components["schemas"]["CopilotMessage"];
            meta: components["schemas"]["Meta"];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_ERROR" | "DATA_COVERAGE_LIMITATION" | "NO_FEASIBLE_JOURNEY" | "NO_RECOVERY_PATH" | "SCENARIO_INVALID" | "SIMULATION_FAILED" | "UPSTREAM_UNAVAILABLE" | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL_ERROR";
        ErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"];
                message: string;
                details?: {
                    [key: string]: unknown;
                };
                request_id: string;
            };
        };
    };
    responses: {
        /** @description Snapshot-scoped canonical transit places */
        TransitPlaceCollectionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["TransitPlaceCollectionEnvelope"];
            };
        };
        /** @description Cursor-paginated resource summaries */
        CollectionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["CollectionEnvelope"];
            };
        };
        /** @description Cursor-paginated, read-only dataset source summaries */
        DataSourceCollectionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["DataSourceCollectionEnvelope"];
            };
        };
        /** @description Cursor-paginated, read-only dataset version summaries */
        DatasetVersionCollectionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["DatasetVersionCollectionEnvelope"];
            };
        };
        /** @description Effective network state */
        NetworkStateResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["NetworkStateEnvelope"];
            };
        };
        /** @description Mobility entity */
        NetworkEntityResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["NetworkEntityEnvelope"];
            };
        };
        /** @description Immutable network snapshot */
        NetworkSnapshotResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["NetworkSnapshotEnvelope"];
            };
        };
        /** @description Disruption event */
        DisruptionEventResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["DisruptionEventEnvelope"];
            };
        };
        /** @description Reproducible experiment resource */
        ExperimentResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ExperimentEnvelope"];
            };
        };
        /** @description Scenario resource */
        ScenarioResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ScenarioEnvelope"];
            };
        };
        /** @description Simulation run resource */
        SimulationRunResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["SimulationRunEnvelope"];
            };
        };
        /** @description Run impact result */
        ImpactResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ImpactEnvelope"];
            };
        };
        /** @description Candidate journeys */
        JourneyPlanResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["JourneyPlanEnvelope"];
            };
        };
        /** @description Accepted recovery with immutable-plan pointer semantics */
        RecoveryAcceptanceResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["RecoveryAcceptanceEnvelope"];
            };
        };
        /** @description Journey resource */
        JourneyResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["JourneyEnvelope"];
            };
        };
        /** @description Journey status */
        JourneyStatusResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["JourneyStatusEnvelope"];
            };
        };
        /** @description Owner- and journey-scoped targeted alerts */
        JourneyAlertCollectionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["JourneyAlertCollectionEnvelope"];
            };
        };
        /** @description Recovery resource */
        RecoveryResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["RecoveryEnvelope"];
            };
        };
        /** @description Operator recovery analysis */
        OperatorAnalysisResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["OperatorAnalysisEnvelope"];
            };
        };
        /** @description Grounded copilot response */
        CopilotMessageResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["CopilotMessageEnvelope"];
            };
        };
        /** @description Owner-scoped copilot session audit, latest 100 messages */
        CopilotSessionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["CopilotSessionEnvelope"];
            };
        };
        /** @description Owner-scoped passenger report */
        PassengerReportResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["PassengerReportEnvelope"];
            };
        };
        /** @description Owner-scoped journey-associated passenger reports */
        PassengerReportCollectionResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["PassengerReportCollectionEnvelope"];
            };
        };
        /** @description Controlled verification outcome */
        ControlledPassengerReportVerifyResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ControlledPassengerReportVerifyEnvelope"];
            };
        };
        /** @description Controlled close outcome */
        ControlledPassengerReportCloseResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ControlledPassengerReportCloseEnvelope"];
            };
        };
        /** @description Machine-readable error */
        ErrorResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorEnvelope"];
            };
        };
    };
    parameters: {
        EntityId: components["schemas"]["Uuid"];
        SnapshotId: components["schemas"]["Uuid"];
        EventId: components["schemas"]["Uuid"];
        SourceId: components["schemas"]["Uuid"];
        ExperimentId: components["schemas"]["Uuid"];
        Limit: number;
        Cursor: string;
        ScenarioId: components["schemas"]["Uuid"];
        RunId: components["schemas"]["Uuid"];
        JourneyId: components["schemas"]["Uuid"];
        /** @description Bounded opaque owner/session reference; not passenger PII. */
        JourneyOwner: string;
        RecoveryId: components["schemas"]["Uuid"];
        AnalysisId: components["schemas"]["Uuid"];
        IdempotencyKey: string;
        /** @description Logical activation idempotency key; retries with the same key and equivalent plan replay one server-generated instance. */
        ActivationIdempotencyKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listTransitOperators: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["CollectionResponse"];
        };
    };
    getNetworkState: {
        parameters: {
            query: {
                snapshot_id: components["schemas"]["Uuid"];
                entity_id?: components["schemas"]["Uuid"];
                simulation_run_id?: components["schemas"]["Uuid"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["NetworkStateResponse"];
            400: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    getNetworkEntity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entityId: components["parameters"]["EntityId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["NetworkEntityResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    getNetworkSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                snapshotId: components["parameters"]["SnapshotId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["NetworkSnapshotResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    createDisruptionEvent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DisruptionEventRequest"];
            };
        };
        responses: {
            201: components["responses"]["DisruptionEventResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    getDisruptionEventImpact: {
        parameters: {
            query: {
                snapshot_id: components["schemas"]["Uuid"];
                simulation_run_id?: components["schemas"]["Uuid"];
            };
            header?: never;
            path: {
                eventId: components["parameters"]["EventId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["ImpactResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    createScenario: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioCreateRequest"];
            };
        };
        responses: {
            201: components["responses"]["ScenarioResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    getScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["ScenarioResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    updateScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioPatchRequest"];
            };
        };
        responses: {
            200: components["responses"]["ScenarioResponse"];
            400: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    createSimulationRun: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SimulationRunCreateRequest"];
            };
        };
        responses: {
            202: components["responses"]["SimulationRunResponse"];
            400: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    getSimulationRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["SimulationRunResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    getSimulationRunImpact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["ImpactResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    streamOperationalEvents: {
        parameters: {
            query?: never;
            header?: {
                "Last-Event-ID"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Operational event stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
        };
    };
    getPlanningHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Probe completed, including OTP unavailable. Never cached. */
            200: {
                headers: {
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            status: "AVAILABLE" | "UNAVAILABLE";
                            /** @constant */
                            provider: "OTP";
                            version: string;
                            /** Format: date-time */
                            checked_at: string;
                            latency_milliseconds: number;
                        };
                    };
                };
            };
            403: components["responses"]["ErrorResponse"];
            503: components["responses"]["ErrorResponse"];
        };
    };
    planJourneys: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JourneyPlanRequest"];
            };
        };
        responses: {
            200: components["responses"]["JourneyPlanResponse"];
            400: components["responses"]["ErrorResponse"];
            422: components["responses"]["ErrorResponse"];
            503: components["responses"]["ErrorResponse"];
        };
    };
    getJourney: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["JourneyResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    activateJourney: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
                /** @description Logical activation idempotency key; retries with the same key and equivalent plan replay one server-generated instance. */
                "Idempotency-Key": components["parameters"]["ActivationIdempotencyKey"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JourneyActivationRequest"];
            };
        };
        responses: {
            200: components["responses"]["JourneyResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    confirmLegBoarding: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
                legSequence: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JourneyConfirmationRequest"];
            };
        };
        responses: {
            200: components["responses"]["JourneyResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    confirmLegAlighting: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
                legSequence: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JourneyConfirmationRequest"];
            };
        };
        responses: {
            200: components["responses"]["JourneyResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    updateJourneyProgress: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JourneyProgressRequest"];
            };
        };
        responses: {
            200: components["responses"]["JourneyResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    getJourneyStatus: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["JourneyStatusResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    listJourneyAlerts: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["JourneyAlertCollectionResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    streamJourneyAlerts: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
                "Last-Event-ID"?: string;
            };
            path: {
                journeyId: components["parameters"]["JourneyId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Targeted journey alert stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    createRecovery: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecoveryCreateRequest"];
            };
        };
        responses: {
            201: components["responses"]["RecoveryResponse"];
            403: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
            422: components["responses"]["ErrorResponse"];
        };
    };
    getRecovery: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                recoveryId: components["parameters"]["RecoveryId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["RecoveryResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    acceptRecovery: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                recoveryId: components["parameters"]["RecoveryId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecoveryAcceptRequest"];
            };
        };
        responses: {
            200: components["responses"]["RecoveryAcceptanceResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
            422: components["responses"]["ErrorResponse"];
        };
    };
    createOperatorRecoveryAnalysis: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperatorAnalysisRequest"];
            };
        };
        responses: {
            201: components["responses"]["OperatorAnalysisResponse"];
            401: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
            422: components["responses"]["ErrorResponse"];
        };
    };
    getOperatorRecoveryAnalysis: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                analysisId: components["parameters"]["AnalysisId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["OperatorAnalysisResponse"];
            401: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    createResearchCopilotMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CopilotMessageRequest"];
            };
        };
        responses: {
            200: components["responses"]["CopilotMessageResponse"];
            401: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    getResearchCopilotSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["CopilotSessionResponse"];
            401: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    createCopilotMessage: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CopilotMessageRequest"];
            };
        };
        responses: {
            200: components["responses"]["CopilotMessageResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    getCopilotSession: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                sessionId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["CopilotSessionResponse"];
            400: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    listPassengerReportsByJourney: {
        parameters: {
            query?: {
                active_journey_id?: components["schemas"]["Uuid"];
                idempotency_key?: string;
            };
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Journey list, or one report (null while absent) when idempotency_key is supplied. Absence does not prove rollback. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["PassengerReport"][] | components["schemas"]["PassengerReport"] | null;
                        meta: components["schemas"]["Meta"];
                    };
                };
            };
            400: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    createPassengerReport: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PassengerReportCreateRequest"];
            };
        };
        responses: {
            200: components["responses"]["PassengerReportResponse"];
            400: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
            /** @description Owner-scoped rolling quota reached; no report inserted. Retry-After is whole seconds until earliest slot. */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    getPassengerReport: {
        parameters: {
            query?: never;
            header: {
                /** @description Bounded opaque owner/session reference; not passenger PII. */
                "x-journey-owner": components["parameters"]["JourneyOwner"];
            };
            path: {
                reportId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["PassengerReportResponse"];
            400: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
    listAdminPassengerReports: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Latest reports, newest first. restriction_active is evaluated at response time. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: components["schemas"]["AdminPassengerReport"][];
                        meta: {
                            /** @constant */
                            limit?: 100;
                        };
                    };
                };
            };
            401: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
        };
    };
    restrictAdminPassengerReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reportId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminRestrictionRequest"];
            };
        };
        responses: {
            /** @description Restriction applied or identical claim replayed. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            report_id: components["schemas"]["Uuid"];
                            incident_id: components["schemas"]["Uuid"];
                            /** @constant */
                            verification_status: "ADMIN_RESTRICTED";
                            review_replay?: boolean;
                            evidence_status?: string;
                        };
                        meta: Record<string, never>;
                    };
                };
            };
            400: components["responses"]["ErrorResponse"];
            401: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    closeAdminPassengerReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reportId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ControlledPassengerReportCloseRequest"];
            };
        };
        responses: {
            201: components["responses"]["ControlledPassengerReportCloseResponse"];
            400: components["responses"]["ErrorResponse"];
            401: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    verifyControlledPassengerReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reportId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ControlledPassengerReportVerifyRequest"];
            };
        };
        responses: {
            200: components["responses"]["ControlledPassengerReportVerifyResponse"];
            400: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    closeControlledPassengerReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reportId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ControlledPassengerReportCloseRequest"];
            };
        };
        responses: {
            200: components["responses"]["ControlledPassengerReportCloseResponse"];
            400: components["responses"]["ErrorResponse"];
            403: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            409: components["responses"]["ErrorResponse"];
        };
    };
    listDataSources: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["DataSourceCollectionResponse"];
            400: components["responses"]["ErrorResponse"];
            500: components["responses"]["ErrorResponse"];
        };
    };
    searchTransitPlaces: {
        parameters: {
            query: {
                q: string;
                snapshot_id: components["schemas"]["Uuid"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["TransitPlaceCollectionResponse"];
            400: components["responses"]["ErrorResponse"];
        };
    };
    listDataSourceVersions: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path: {
                sourceId: components["parameters"]["SourceId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["DatasetVersionCollectionResponse"];
            400: components["responses"]["ErrorResponse"];
            404: components["responses"]["ErrorResponse"];
            500: components["responses"]["ErrorResponse"];
        };
    };
    createExperimentReplay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExperimentReplayRequest"];
            };
        };
        responses: {
            202: components["responses"]["ExperimentResponse"];
        };
    };
    getExperiment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                experimentId: components["parameters"]["ExperimentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["ExperimentResponse"];
            404: components["responses"]["ErrorResponse"];
        };
    };
}
