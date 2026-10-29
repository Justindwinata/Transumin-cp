import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  OperatorAnalysis,
  OperatorAnalysisRequest,
  OperatorRecoveryPort,
} from '../domain/operator-recovery.js';
import { OperatorRecoveryError } from '../domain/operator-recovery.js';

export const OPERATOR_RECOVERY_PORT = Symbol('OPERATOR_RECOVERY_PORT');
export const OPERATOR_ANALYSIS_REPOSITORY = Symbol(
  'OPERATOR_ANALYSIS_REPOSITORY',
);
export type AnalysisReceipt = Readonly<{
  owner: string;
  key: string;
  fingerprint: string;
  analysis: OperatorAnalysis;
}>;
export interface OperatorAnalysisRepository {
  find(owner: string, key: string): Promise<AnalysisReceipt | null>;
  get(owner: string, id: string): Promise<OperatorAnalysis | null>;
  save(receipt: AnalysisReceipt): Promise<AnalysisReceipt>;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

// FR-007: bounded canonical input. Unknown fields fail rather than silently changing replay semantics.
export function parseOperatorRequest(value: unknown): OperatorAnalysisRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Request must be an object.');
  const input = value as Record<string, unknown>;
  const fields = [
    'route_id',
    'network_snapshot_id',
    'simulation_run_id',
    'blocked_transit_segment_ids',
    'target_headway_seconds',
    'turnaround_buffer_seconds',
    'temporary_bridge_resource',
  ];
  if (
    Object.keys(input).some((key) => !fields.includes(key)) ||
    !validUuid(input.route_id) ||
    !validUuid(input.network_snapshot_id) ||
    (input.simulation_run_id !== undefined &&
      !validUuid(input.simulation_run_id))
  )
    throw new Error(
      'Canonical UUID route/snapshot/run references required; unknown fields rejected.',
    );
  if (
    !Number.isInteger(input.target_headway_seconds) ||
    Number(input.target_headway_seconds) < 1 ||
    Number(input.target_headway_seconds) > 7200 ||
    !Number.isInteger(input.turnaround_buffer_seconds) ||
    Number(input.turnaround_buffer_seconds) < 0 ||
    Number(input.turnaround_buffer_seconds) > 7200
  )
    throw new Error(
      'Headway must be 1–7200 seconds; turnaround buffer 0–7200 seconds.',
    );
  const blocked = input.blocked_transit_segment_ids;
  if (
    blocked !== undefined &&
    (!Array.isArray(blocked) ||
      blocked.length < 1 ||
      blocked.length > 100 ||
      blocked.some((id) => !validUuid(id)) ||
      new Set(blocked.map((id) => String(id).toLowerCase())).size !==
        blocked.length)
  )
    throw new Error('Provide 1–100 unique blocked segment UUIDs.');
  if (blocked === undefined && input.simulation_run_id === undefined)
    throw new Error('Blocked segments or simulation_run_id required.');
  const bridge = input.temporary_bridge_resource;
  if (bridge !== undefined) {
    if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge))
      throw new Error('Bridge resource must be an object.');
    const b = bridge as Record<string, unknown>;
    if (
      Object.keys(b).some(
        (key) => !['mode', 'vehicle_count', 'cycle_time_seconds'].includes(key),
      ) ||
      typeof b.mode !== 'string' ||
      !/^[A-Z_]{2,40}$/.test(b.mode) ||
      !Number.isInteger(b.vehicle_count) ||
      Number(b.vehicle_count) < 0 ||
      Number(b.vehicle_count) > 1000 ||
      !Number.isInteger(b.cycle_time_seconds) ||
      Number(b.cycle_time_seconds) < 1 ||
      Number(b.cycle_time_seconds) > 86400
    )
      throw new Error(
        'Bridge requires operator-defined mode, vehicle_count 0–1000 and cycle_time_seconds 1–86400.',
      );
  }
  return {
    route_id: input.route_id.toLowerCase(),
    network_snapshot_id: input.network_snapshot_id.toLowerCase(),
    ...(input.simulation_run_id === undefined
      ? {}
      : { simulation_run_id: String(input.simulation_run_id).toLowerCase() }),
    ...(blocked === undefined
      ? {}
      : {
          blocked_transit_segment_ids: (blocked as string[])
            .map((id) => id.toLowerCase())
            .sort(),
        }),
    target_headway_seconds: Number(input.target_headway_seconds),
    turnaround_buffer_seconds: Number(input.turnaround_buffer_seconds),
    ...(bridge === undefined
      ? {}
      : {
          temporary_bridge_resource: {
            mode: (bridge as Record<string, unknown>).mode,
            vehicle_count: (bridge as Record<string, unknown>).vehicle_count,
            cycle_time_seconds: (bridge as Record<string, unknown>)
              .cycle_time_seconds,
          },
        }),
  };
}

@Injectable()
export class OperatorRecoveryService {
  constructor(
    @Inject(OPERATOR_RECOVERY_PORT)
    private readonly intelligence: OperatorRecoveryPort,
    @Inject(OPERATOR_ANALYSIS_REPOSITORY)
    private readonly repository: OperatorAnalysisRepository,
  ) {}

  async create(
    owner: string,
    key: string,
    input: OperatorAnalysisRequest,
  ): Promise<OperatorAnalysis> {
    const canonical = parseOperatorRequest(input);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
    const existing = await this.repository.find(owner, key);
    if (existing) return this.replay(existing, fingerprint);
    const analysis = await this.intelligence.analyze(canonical, randomUUID());
    const receipt = await this.repository.save({
      owner,
      key,
      fingerprint,
      analysis,
    });
    return this.replay(receipt, fingerprint);
  }

  async get(owner: string, id: string): Promise<OperatorAnalysis> {
    const analysis = await this.repository.get(owner, id);
    if (!analysis)
      throw new OperatorRecoveryError(
        'NOT_FOUND',
        'Operator analysis not found.',
      );
    return analysis;
  }

  private replay(
    receipt: AnalysisReceipt,
    fingerprint: string,
  ): OperatorAnalysis {
    if (receipt.fingerprint !== fingerprint)
      throw new OperatorRecoveryError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency-Key belongs to different input.',
      );
    return receipt.analysis;
  }
}
