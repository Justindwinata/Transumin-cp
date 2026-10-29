import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { OperatorRecoveryError } from './domain/operator-recovery.js';
import {
  OperatorRecoveryService,
  parseOperatorRequest,
} from './application/operator-recovery.service.js';
import { splitRoute } from './infrastructure/operator-recovery.adapters.js';

function body() {
  return {
    route_id: 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee',
    network_snapshot_id: 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeef',
    blocked_transit_segment_ids: [
      'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee1',
      'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee2',
    ],
    target_headway_seconds: 300,
    turnaround_buffer_seconds: 60,
  };
}

test('FR-007 validation rejects unknown fields and bounds', () => {
  assert.throws(() => parseOperatorRequest({ unknown_field: 1 }), /unknown/i);
  assert.throws(
    () =>
      parseOperatorRequest({ ...body(), blocked_transit_segment_ids: ['bad'] }),
    /unknown|unique/i,
  );
  assert.throws(
    () => parseOperatorRequest({ ...body(), target_headway_seconds: 0 }),
    /Headway/i,
  );
  assert.throws(() =>
    parseOperatorRequest({
      ...body(),
      temporary_bridge_resource: {
        mode: 'lower',
        vehicle_count: 1,
        cycle_time_seconds: 10,
      },
    }),
  );
});

test('FR-007 splitRoute derives fleet only from matched forward and reverse timing', () => {
  const request = parseOperatorRequest({
    ...body(),
    blocked_transit_segment_ids: ['aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee2'],
  });
  const segments = [
    {
      id: 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee1',
      from: 'stop-1',
      to: 'stop-2',
      length: 400,
      running_seconds: 120,
    },
    {
      id: 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee2',
      from: 'stop-2',
      to: 'stop-3',
      length: 600,
      running_seconds: 180,
    },
    {
      id: 'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee3',
      from: 'stop-3',
      to: 'stop-4',
      length: 500,
      running_seconds: 150,
    },
  ];
  const reverse = [
    {
      id: 'bbbbbbbb-bbbb-1ccc-8ddd-eeeeeeeeeee3',
      from: 'stop-4',
      to: 'stop-3',
      length: 500,
      running_seconds: 160,
    },
    {
      id: 'bbbbbbbb-bbbb-1ccc-8ddd-eeeeeeeeeee2',
      from: 'stop-3',
      to: 'stop-2',
      length: 600,
      running_seconds: 190,
    },
    {
      id: 'bbbbbbbb-bbbb-1ccc-8ddd-eeeeeeeeeee1',
      from: 'stop-2',
      to: 'stop-1',
      length: 400,
      running_seconds: 130,
    },
  ];
  const analysis = splitRoute(
    segments,
    reverse,
    request.blocked_transit_segment_ids!,
    request,
    'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeee9',
  );
  assert.equal(analysis.cut_point_candidate, 'stop-2');
  assert.equal(analysis.restart_point_candidate, 'stop-3');
  assert.equal(analysis.estimated_vehicle_requirement, 4);
  assert.equal(analysis.validation_status, 'REQUIRES_OPERATOR_VALIDATION');
  assert.equal(
    splitRoute(
      segments,
      [],
      request.blocked_transit_segment_ids!,
      request,
      'aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeea',
    ).estimated_vehicle_requirement,
    null,
  );
  assert.throws(() =>
    parseOperatorRequest({
      ...body(),
      blocked_transit_segment_ids: Array.from(
        { length: 101 },
        (_, i) => `aaaaaaaa-bbbb-1ccc-8ddd-eeeeee${String(i).padStart(4, '0')}`,
      ),
    }),
  );
});

test('FR-007 idempotency is sanitized to bounded owner+key+fingerprint', async () => {
  const store = new Map<
    string,
    { fp: string; analysis: ReturnType<typeof fakeAnalysis> }
  >();
  function fakeAnalysis(id: string) {
    return {
      analysis_id: id,
      route_id: body().route_id,
      upstream_service: [],
      downstream_service: [],
      cut_point_candidate: null,
      restart_point_candidate: null,
      unresolved_gap: {},
      estimated_vehicle_requirement: null,
      assumptions: {} as Record<string, unknown>,
      validation_status: 'INSUFFICIENT_EVIDENCE' as const,
      provenance: {
        evidence_type: 'SIMULATED' as const,
        reference_ids: [],
        limitations: [],
      },
    };
  }
  const service = new OperatorRecoveryService(
    {
      analyze: async (_request: never, analysisId: string) =>
        fakeAnalysis(analysisId),
    } as never,
    {
      find: async (owner: string, key: string) =>
        store.get(`${owner}:${key}`)?.fp
          ? ({
              owner,
              key,
              fingerprint: store.get(`${owner}:${key}`)!.fp,
              analysis: store.get(`${owner}:${key}`)!.analysis,
            } as never)
          : null,
      get: async () => null as never,
      save: async (receipt: {
        owner: string;
        key: string;
        fingerprint: string;
        analysis: ReturnType<typeof fakeAnalysis>;
      }) => {
        store.set(`${receipt.owner}:${receipt.key}`, {
          fp: receipt.fingerprint,
          analysis: receipt.analysis as never,
        });
        return receipt;
      },
    } as never,
  );
  const input = body();
  const fp = createHash('sha256')
    .update(JSON.stringify(parseOperatorRequest(input)))
    .digest('hex');
  await service.create('INTERNAL_RESEARCH', 'idemp-key-01', input as never);
  const same = await service.create(
    'INTERNAL_RESEARCH',
    'idemp-key-01',
    input as never,
  );
  assert.equal(same.route_id, input.route_id);
  await assert.rejects(
    () =>
      service.create('INTERNAL_RESEARCH', 'idemp-key-01', {
        ...input,
        target_headway_seconds: 400,
      } as never),
    (e: unknown) =>
      e instanceof OperatorRecoveryError && e.code === 'IDEMPOTENCY_CONFLICT',
  );
  void fp;
});
