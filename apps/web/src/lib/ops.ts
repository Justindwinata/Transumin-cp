// FR-011: types mirror real API envelopes. No fabricated fields.
export type OperatorRole = 'RESEARCHER_OPERATOR' | 'ADMIN';
export type OperatorPrincipal = Readonly<{
  id: string;
  email: string;
  roles: string[];
}>;
export type ScenarioActionView = Readonly<{
  mobility_entity_id: string;
  action_type: string;
  availability: string | null;
  reason: string;
  parameters: Record<string, unknown>;
}>;
export type ScenarioView = Readonly<{
  scenario_id: string;
  name: string;
  description: string;
  version: number;
  status: 'DRAFT' | 'READY' | 'ARCHIVED';
  actions: ScenarioActionView[];
}>;
export type ScenarioSummary = Readonly<{
  scenario_id: string;
  name: string;
  description: string;
  version: number;
  status: string;
  created_at: string;
  action_count: number;
  run_count: number;
}>;
export type SimulationRunView = Readonly<{
  simulation_run_id: string;
  scenario_id: string;
  network_snapshot_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  created_at: string;
  completed_at: string | null;
  failure_code: string | null;
  runtime_ms?: number | null;
}>;
export type RunSummary = Readonly<{
  simulation_run_id: string;
  scenario_id: string;
  scenario_name: string;
  network_snapshot_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  failure_code: string | null;
}>;
export type ImpactMetricsView = Readonly<{
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
}>;
export type ImpactView = Readonly<{
  impact_id: string;
  simulation_run_id: string | null;
  affected_entities: string[];
  metrics: ImpactMetricsView | null;
  provenance: { references: string[] };
}>;
export type NetworkSnapshotView = Readonly<{
  network_snapshot_id: string;
  captured_at: string;
  state_cutoff_at: string;
  fingerprint: string;
  dataset_version_ids: string[];
  processing_version: string;
  status: string;
  materialized_state_count: number;
}>;
export type NetworkStateEntityView = Readonly<{
  mobility_entity_id: string;
  availability: string;
  evidence_type: string;
  freshness_status: string;
  observed_at: string;
  expires_at: string | null;
  provenance_ref: string;
}>;
export type GeometryView = Readonly<{
  snapshot_id: string;
  dataset_version_ids?: string[];
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;
  truncated: boolean;
  coverage?: string;
}>;
export type OpsSurface = 'network' | 'scenarios' | 'scenario' | 'experiments';
