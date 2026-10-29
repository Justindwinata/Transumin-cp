import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type {
  OperatorAnalysis,
  OperatorAnalysisRequest,
  OperatorRecoveryPort,
} from '../domain/operator-recovery.js';
import type {
  AnalysisReceipt,
  OperatorAnalysisRepository,
} from '../application/operator-recovery.service.js';

export type RouteSegment = {
  id: string;
  from: string;
  to: string;
  length: number;
  running_seconds: number | null;
};

const FLEET_FORMULA =
  'estimated_vehicle_requirement = ceil((one_way_seconds + reverse_seconds + 2 * turnaround_buffer_seconds) / target_headway_seconds) per split service, summed over upstream and downstream; null unless every retained segment has GTFS running time in BOTH directions';

/** Deterministic linear chain order; branching/circular/disconnected topology returns null. */
function orderedChain(
  segments: readonly RouteSegment[],
): RouteSegment[] | null {
  const outgoing = new Map<string, RouteSegment[]>();
  const destinations = new Set(segments.map((segment) => segment.to));
  for (const segment of segments)
    outgoing.set(segment.from, [
      ...(outgoing.get(segment.from) ?? []),
      segment,
    ]);
  const starts = segments.filter((segment) => !destinations.has(segment.from));
  if (starts.length !== 1) return null;
  const ordered: RouteSegment[] = [];
  const seen = new Set<string>();
  let current: RouteSegment | undefined = starts[0];
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    ordered.push(current);
    const next = outgoing.get(current.to) ?? [];
    if (next.length > 1) return null;
    current = next[0];
  }
  return ordered.length === segments.length ? ordered : null;
}

function sumRunning(segments: readonly RouteSegment[]): number | null {
  if (segments.length === 0) return 0;
  if (segments.some((segment) => !Number.isFinite(segment.running_seconds)))
    return null;
  return segments.reduce(
    (sum, segment) => sum + Number(segment.running_seconds),
    0,
  );
}

/**
 * FR-007 conservative split. Reuses canonical topology only; never invents services.
 * Fleet is derived from actual per-segment running time in the split direction AND its
 * mirrored reverse direction; it stays null when either is not legitimately available.
 */
export function splitRoute(
  segments: readonly RouteSegment[],
  reverseSegments: readonly RouteSegment[],
  blocked: readonly string[],
  request: OperatorAnalysisRequest,
  analysisId: string,
): OperatorAnalysis {
  const ordered = orderedChain(segments);
  const reverseOrdered = orderedChain(reverseSegments);
  const topologyValid = ordered !== null && ordered.length > 0;
  const reverseMirrorsForward =
    ordered !== null &&
    reverseOrdered !== null &&
    reverseOrdered.length === ordered.length &&
    reverseOrdered.every((segment, index) => {
      const mirror = ordered[ordered.length - 1 - index]!;
      return segment.from === mirror.to && segment.to === mirror.from;
    });
  const indices = topologyValid
    ? ordered!.flatMap((segment, index) =>
        blocked.includes(segment.id) ? [index] : [],
      )
    : [];
  const first = indices[0] ?? -1;
  const last = indices.at(-1) ?? -1;
  const matched = blocked.length > 0 && indices.length === blocked.length;
  const multipleGaps = indices.some(
    (value, index) => index > 0 && value !== indices[index - 1]! + 1,
  );
  const usable = topologyValid && matched && !multipleGaps;
  const upstream = usable ? ordered!.slice(0, first) : [];
  const downstream = usable ? ordered!.slice(last + 1) : [];
  // Mirror each split service into the reverse direction: forward[0..first-1] <-> reverse[length-first..length-1].
  const fleet = (() => {
    if (
      !usable ||
      upstream.length === 0 ||
      downstream.length === 0 ||
      !reverseMirrorsForward ||
      ordered === null ||
      reverseOrdered === null
    )
      return null;
    const upstreamReverse = reverseOrdered.slice(
      ordered.length - upstream.length,
    );
    const downstreamReverse = reverseOrdered.slice(0, downstream.length);
    const upstreamFleet = serviceFleet(upstream, upstreamReverse, request);
    const downstreamFleet = serviceFleet(
      downstream,
      downstreamReverse,
      request,
    );
    if (upstreamFleet === null || downstreamFleet === null) return null;
    return {
      upstream: upstreamFleet,
      downstream: downstreamFleet,
      total: upstreamFleet + downstreamFleet,
    };
  })();

  const bridgeRequirement = request.temporary_bridge_resource
    ? Math.ceil(
        Number(request.temporary_bridge_resource.cycle_time_seconds) /
          request.target_headway_seconds,
      )
    : null;
  const limitations = [
    'Decision support only; safety and dispatch remain with operator.',
  ];
  if (!topologyValid)
    limitations.push(
      'Route direction has branching, circular, missing or disconnected topology.',
    );
  if (!matched)
    limitations.push(
      'Blocked segment evidence does not match the selected route direction.',
    );
  if (multipleGaps)
    limitations.push(
      'Multiple separated gaps require multi-section operator analysis; no two-service split asserted.',
    );
  if (usable && !reverseMirrorsForward)
    limitations.push(
      'Reverse-direction topology does not mirror the split direction; cycle time unverified.',
    );
  if (usable && fleet === null && reverseMirrorsForward)
    limitations.push(
      'GTFS running-time evidence missing for at least one retained segment; no fleet estimate fabricated.',
    );
  limitations.push(
    'Fleet output is an ESTIMATED VEHICLE REQUIREMENT, not a dispatch instruction.',
  );

  return {
    analysis_id: analysisId,
    route_id: request.route_id,
    upstream_service: upstream.map((segment) => segment.id),
    downstream_service: downstream.map((segment) => segment.id),
    cut_point_candidate: upstream.at(-1)?.to ?? null,
    restart_point_candidate: downstream[0]?.from ?? null,
    unresolved_gap: {
      blocked_transit_segment_ids: blocked,
      multiple_gaps: multipleGaps,
      length_meters: usable
        ? ordered!
            .slice(first, last + 1)
            .reduce((sum, segment) => sum + segment.length, 0)
        : null,
      bridge_option: request.temporary_bridge_resource
        ? {
            ...request.temporary_bridge_resource,
            evidence_type: 'SIMULATED',
            validation_status: 'REQUIRES_OPERATOR_VALIDATION',
            estimated_vehicle_requirement: bridgeRequirement,
            sufficient_configured_vehicles:
              Number(request.temporary_bridge_resource.vehicle_count) >=
              Number(bridgeRequirement),
          }
        : null,
    },
    estimated_vehicle_requirement: fleet === null ? null : fleet.total,
    assumptions: {
      ...request,
      algorithm_version: 'FR-007-conservative-split-v1',
      fleet_formula: FLEET_FORMULA,
      fleet_source:
        fleet === null ? null : 'GTFS stop_time running time, both directions',
      fleet_breakdown: fleet,
      retained_segment_count: upstream.length + downstream.length,
      total_segment_count: segments.length,
      reverse_direction_verified: reverseMirrorsForward,
    },
    validation_status:
      usable && upstream.length > 0 && downstream.length > 0
        ? 'REQUIRES_OPERATOR_VALIDATION'
        : 'INSUFFICIENT_EVIDENCE',
    provenance: {
      evidence_type: 'SCHEDULED',
      reference_ids: [
        request.route_id,
        request.network_snapshot_id,
        ...(request.simulation_run_id ? [request.simulation_run_id] : []),
        ...blocked,
      ],
      limitations,
    },
  };
}

function serviceFleet(
  forward: readonly RouteSegment[],
  reverse: readonly RouteSegment[],
  request: OperatorAnalysisRequest,
): number | null {
  if (forward.length === 0) return 0;
  const oneWay = sumRunning(forward);
  const back = sumRunning(reverse);
  if (oneWay === null || back === null || oneWay <= 0 || back <= 0) return null;
  return Math.ceil(
    (oneWay + back + 2 * request.turnaround_buffer_seconds) /
      request.target_headway_seconds,
  );
}

@Injectable()
export class DeterministicOperatorRecoveryAdapter implements OperatorRecoveryPort {
  constructor(
    @Inject(DATABASE) private readonly database: Kysely<FoundationDatabase>,
  ) {}

  private async directionSegments(
    routeId: string,
    direction: number,
  ): Promise<RouteSegment[]> {
    const rows = await sql<RouteSegment>`
      select t.id, t.from_stop_id as "from", t.to_stop_id as "to",
        ST_Length(t.geom::geography) as length,
        (
          select max(st_to.departure_seconds - st_from.departure_seconds)
          from transit.trip_segment_traversal v
          join transit.stop_time st_from
            on st_from.trip_id=v.trip_id and st_from.stop_id=v.from_stop_id
          join transit.stop_time st_to
            on st_to.trip_id=v.trip_id and st_to.stop_id=v.to_stop_id
              and st_to.stop_sequence=st_from.stop_sequence + 1
          where v.transit_segment_id=t.id
            and (select count(*) from transit.stop_time s where s.trip_id=v.trip_id and s.stop_id=v.from_stop_id)=1
            and (select count(*) from transit.stop_time s where s.trip_id=v.trip_id and s.stop_id=v.to_stop_id)=1
            and st_to.departure_seconds > st_from.departure_seconds
        ) as running_seconds
      from transit.transit_segment t
      where t.route_id=${routeId}::uuid and t.direction_id=${direction}
      limit 1001
    `.execute(this.database);
    return rows.rows;
  }

  async analyze(
    request: OperatorAnalysisRequest,
    analysisId: string,
  ): Promise<OperatorAnalysis> {
    // Reuse canonical persisted transit/snapshot/run truth. No synthetic production topology.
    const context = await sql<{ id: string }>`
      select r.id from transit.route r join twin.network_snapshot s
        on s.transit_dataset_version_id=r.dataset_version_id
      where r.id=${request.route_id}::uuid and s.id=${request.network_snapshot_id}::uuid
        and s.status='FINALIZED' and r.active
    `.execute(this.database);
    if (!context.rows.length)
      throw new UnprocessableEntityException({
        error: {
          code: 'DATA_COVERAGE_LIMITATION',
          message: 'Finalized snapshot with matching active route required.',
        },
      });
    let blocked = [...(request.blocked_transit_segment_ids ?? [])];
    if (request.simulation_run_id) {
      const run = await sql<{
        id: string;
      }>`select id from simulation.run where id=${request.simulation_run_id}::uuid and network_snapshot_id=${request.network_snapshot_id}::uuid and status='COMPLETED'`.execute(
        this.database,
      );
      if (!run.rows.length)
        throw new UnprocessableEntityException({
          error: {
            code: 'DATA_COVERAGE_LIMITATION',
            message: 'Completed simulation run matching snapshot required.',
          },
        });
      const overrides = await sql<{
        id: string;
      }>`select t.id from simulation.state_override o join transit.transit_segment t on t.mobility_entity_id=o.mobility_entity_id where o.simulation_run_id=${request.simulation_run_id}::uuid and t.route_id=${request.route_id}::uuid and o.override_state='UNAVAILABLE' limit 101`.execute(
        this.database,
      );
      blocked = [
        ...new Set([...blocked, ...overrides.rows.map((row) => row.id)]),
      ];
    }
    if (!blocked.length || blocked.length > 100)
      throw new UnprocessableEntityException({
        error: {
          code: 'DATA_COVERAGE_LIMITATION',
          message: 'Analysis needs 1–100 explicitly blocked route segments.',
        },
      });
    const direction = await sql<{
      direction: number;
    }>`select distinct direction_id as direction from transit.transit_segment where route_id=${request.route_id}::uuid and id=any(${blocked}::uuid[])`.execute(
      this.database,
    );
    if (direction.rows.length !== 1)
      throw new UnprocessableEntityException({
        error: {
          code: 'DATA_COVERAGE_LIMITATION',
          message:
            'Blocked segments must resolve to exactly one route direction.',
        },
      });
    const primary = direction.rows[0]!.direction;
    const segments = await this.directionSegments(request.route_id, primary);
    if (segments.length === 0 || segments.length > 1000)
      throw new UnprocessableEntityException({
        error: {
          code: 'DATA_COVERAGE_LIMITATION',
          message:
            segments.length > 1000
              ? 'Route direction exceeds 1000 segment analysis limit.'
              : 'Route direction has no canonical segments.',
        },
      });
    const reverseSegments = await this.directionSegments(
      request.route_id,
      primary === 0 ? 1 : 0,
    );
    return splitRoute(segments, reverseSegments, blocked, request, analysisId);
  }
}

@Injectable()
export class KyselyOperatorAnalysisRepository implements OperatorAnalysisRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async find(owner: string, key: string): Promise<AnalysisReceipt | null> {
    const result =
      await sql<AnalysisReceipt>`select owner_ref as owner, idempotency_key as key, fingerprint, analysis_json as analysis from recovery.operator_recovery_plan where owner_ref=${owner} and idempotency_key=${key}`.execute(
        this.database,
      );
    return result.rows[0] ?? null;
  }

  async get(owner: string, id: string): Promise<OperatorAnalysis | null> {
    const result = await sql<{
      analysis: OperatorAnalysis;
    }>`select analysis_json as analysis from recovery.operator_recovery_plan where owner_ref=${owner} and id=${id}::uuid`.execute(
      this.database,
    );
    return result.rows[0]?.analysis ?? null;
  }

  async save(receipt: AnalysisReceipt): Promise<AnalysisReceipt> {
    const request = receipt.analysis.assumptions as OperatorAnalysisRequest;
    await sql`insert into recovery.operator_recovery_plan (id, owner_ref, idempotency_key, fingerprint, route_id, network_snapshot_id, simulation_run_id, validation_status, estimated_vehicle_requirement, analysis_json) values (${receipt.analysis.analysis_id}::uuid, ${receipt.owner}, ${receipt.key}, ${receipt.fingerprint}, ${receipt.analysis.route_id}::uuid, ${request.network_snapshot_id}::uuid, ${request.simulation_run_id ?? null}::uuid, ${receipt.analysis.validation_status}, ${receipt.analysis.estimated_vehicle_requirement}, ${JSON.stringify(receipt.analysis)}::jsonb) on conflict (owner_ref, idempotency_key) do nothing`.execute(
      this.database,
    );
    return (await this.find(receipt.owner, receipt.key))!;
  }
}
