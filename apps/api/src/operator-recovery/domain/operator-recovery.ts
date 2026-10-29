export type OperatorAnalysisRequest = Readonly<{
  route_id: string;
  network_snapshot_id: string;
  simulation_run_id?: string;
  blocked_transit_segment_ids?: readonly string[];
  target_headway_seconds: number;
  turnaround_buffer_seconds: number;
  temporary_bridge_resource?: Readonly<Record<string, unknown>>;
}>;

export type OperatorAnalysis = Readonly<{
  analysis_id: string;
  route_id: string;
  upstream_service: readonly string[];
  downstream_service: readonly string[];
  cut_point_candidate: string | null;
  restart_point_candidate: string | null;
  unresolved_gap: Readonly<Record<string, unknown>>;
  estimated_vehicle_requirement: number | null;
  assumptions: Readonly<Record<string, unknown>>;
  validation_status:
    'VALIDATED' | 'REQUIRES_OPERATOR_VALIDATION' | 'INSUFFICIENT_EVIDENCE';
  provenance: Readonly<{
    evidence_type: 'SCHEDULED' | 'SIMULATED';
    reference_ids: readonly string[];
    limitations: readonly string[];
  }>;
}>;

export interface OperatorRecoveryPort {
  analyze(
    request: OperatorAnalysisRequest,
    analysisId: string,
  ): Promise<OperatorAnalysis>;
}

export class OperatorRecoveryError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message);
  }
}
