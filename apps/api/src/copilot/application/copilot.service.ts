import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';

import { ActiveJourneyService } from '../../journey/application/active-journey.service.js';
import { RecoveryService } from '../../journey/application/recovery.service.js';
import { DisruptionIntelligenceService } from '../../disruption/application/disruption-intelligence.service.js';
import { OperatorRecoveryService } from '../../operator-recovery/application/operator-recovery.service.js';
import type { OperatorAnalysis } from '../../operator-recovery/domain/operator-recovery.js';
import type { JourneyLeg } from '../../journey/domain/journey.js';
import type { RecoveryProposal } from '../../journey/domain/recovery.js';
import {
  renderFacts,
  validateFactuality,
  type CopilotFact,
} from '../domain/copilot.validator.js';

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CONTEXT = new RegExp(
  `^(journey|recovery|scenario|simulation-run|impact|operator):(${UUID})$`,
  'i',
);
const OWNER = /^[A-Za-z0-9._:-]{1,128}$/;
const LIMITATION = 'Deterministic read-only template; no generative provider.';
// `simulation-run:<id>` is canonical because impact IDs are not input-resolvable.
// `impact:<id>` remains accepted only as legacy run-id alias.

type Context = Readonly<{
  kind:
    | 'journey'
    | 'recovery'
    | 'scenario'
    | 'simulation-run'
    | 'impact'
    | 'operator';
  id: string;
  reference: string;
}>;
type ToolName =
  | 'explainJourneyRoute'
  | 'explainRecovery'
  | 'explainScenario'
  | 'explainImpact'
  | 'explainOperatorAnalysis';
type EvidenceType =
  | 'SCHEDULED'
  | 'SIMULATED'
  | 'OBSERVED'
  | 'LIVE'
  | 'FORECAST'
  | 'ESTIMATED'
  | null;

export type CopilotQuestion = Readonly<{
  message: string;
  contextReferences?: readonly string[];
  ownerRef?: string;
  /** FR-010/014: set only by server-side role guard, never request body. */
  researchAuthorized?: boolean;
}>;

export type CopilotAnswer = Readonly<{
  messageId: string;
  answer: string;
  evidenceReferences: readonly string[];
  toolResultReferences: readonly string[];
  evidenceType: EvidenceType;
  fallbackStatus: 'DETERMINISTIC_FALLBACK' | 'INSUFFICIENT_EVIDENCE';
  toolAudit: readonly {
    tool: ToolName;
    resultRef: string;
    status: 'OK' | 'UNAVAILABLE';
    latencyMs: number;
  }[];
  meta: { warnings: readonly string[]; observedAt: string | null };
}>;

@Injectable()
export class CopilotService {
  constructor(
    @Inject(ActiveJourneyService)
    private readonly journeys: Pick<ActiveJourneyService, 'get' | 'listAlerts'>,
    @Inject(RecoveryService)
    private readonly recoveries: Pick<RecoveryService, 'get'>,
    @Optional()
    @Inject(DisruptionIntelligenceService)
    private readonly intelligence?: Pick<
      DisruptionIntelligenceService,
      'getScenario' | 'getRun' | 'getSimulationImpact'
    >,
    // FR-010/014: operator analyses are principal-owned; caller claims never authorize.
    @Optional()
    @Inject(OperatorRecoveryService)
    private readonly operator?: Pick<OperatorRecoveryService, 'get'>,
  ) {}

  async ask(input: CopilotQuestion): Promise<CopilotAnswer> {
    const refs = input.contextReferences ?? [];
    if (
      typeof input.message !== 'string' ||
      !input.message.trim() ||
      input.message.length > 4000 ||
      /[\p{Cc}\p{Cf}]/u.test(input.message) ||
      !Array.isArray(refs) ||
      refs.length !== 1 ||
      refs.some((ref) => typeof ref !== 'string' || !CONTEXT.test(ref)) ||
      (input.ownerRef !== undefined &&
        (typeof input.ownerRef !== 'string' || !OWNER.test(input.ownerRef)))
    ) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'message, owner, and exactly one typed context reference (journey:<uuid>, recovery:<uuid>, scenario:<uuid>, simulation-run:<uuid>, or operator:<uuid>) are required.',
        },
      });
    }
    const messageId = randomUUID();
    const unavailable = (
      warning: string,
      toolAudit: CopilotAnswer['toolAudit'] = [],
      evidenceType: EvidenceType = 'SCHEDULED',
    ): CopilotAnswer => ({
      messageId,
      answer:
        '[DETERMINISTIC_FALLBACK] Data belum cukup untuk memberikan penjelasan. Tidak ada perubahan pada perjalanan atau layanan.',
      evidenceReferences: [],
      toolResultReferences: toolAudit.map((audit) => audit.resultRef),
      evidenceType,
      fallbackStatus: 'INSUFFICIENT_EVIDENCE',
      toolAudit,
      meta: { warnings: [LIMITATION, warning], observedAt: null },
    });

    if (
      /ignore\s+(?:all\s+)?previous|system\s+prompt|reveal\s+secrets|execute\s+tool|\btool\s*:|\b(create|update|delete|mutate|accept|activate)\b/i.test(
        input.message,
      )
    ) {
      return unavailable(
        'Unsupported request; copilot has no mutation authority.',
      );
    }
    const match = CONTEXT.exec(refs[0]!);
    if (!match || !input.ownerRef) {
      return unavailable(
        'Supported scope: route or recovery explanation with one typed context and x-journey-owner.',
      );
    }
    const context: Context = {
      kind: match[1]!.toLowerCase() as Context['kind'],
      id: match[2]!,
      reference: refs[0]!,
    };
    const wantsRecovery =
      /recover|repair|rejoin|alternative|replacement|pemulihan|pengganti|alternatif/i.test(
        input.message,
      );
    const wantsRoute =
      /\b(journey|route|leg|segment|trip|progress|status|rute|perjalanan|tahap)\b/i.test(
        input.message,
      );
    const wantsScenario = /\bscenario\b/i.test(input.message);
    const wantsImpact =
      /\bimpact|affected|connectivity|exposure|simulation-run\b/i.test(
        input.message,
      );
    const wantsOperator =
      /operator|analysis|gap|fleet|service|validation/i.test(input.message);
    if (
      ['scenario', 'impact', 'simulation-run', 'operator'].includes(
        context.kind,
      ) &&
      !input.researchAuthorized
    )
      return unavailable(
        'Research tools require RESEARCHER_OPERATOR or ADMIN authorization.',
      );
    if (
      (context.kind === 'scenario' && !wantsScenario) ||
      ((context.kind === 'impact' || context.kind === 'simulation-run') &&
        !wantsImpact) ||
      (context.kind === 'operator' && !wantsOperator)
    )
      return unavailable(
        'Question intent does not match typed research context.',
      );
    if (
      (context.kind === 'recovery' && !wantsRecovery) ||
      (context.kind === 'journey' && !wantsRoute)
    )
      return unavailable(
        'Question intent does not match typed journey context.',
      );
    const tool: ToolName =
      context.kind === 'recovery'
        ? 'explainRecovery'
        : context.kind === 'journey'
          ? 'explainJourneyRoute'
          : context.kind === 'scenario'
            ? 'explainScenario'
            : context.kind === 'operator'
              ? 'explainOperatorAnalysis'
              : 'explainImpact';
    if (
      (tool === 'explainScenario' || tool === 'explainImpact') &&
      !this.intelligence
    )
      return unavailable('Authorized research evidence unavailable.');
    if (tool === 'explainOperatorAnalysis' && !this.operator)
      return unavailable('Authorized operator evidence unavailable.');

    const resultRef = `tool-result:${randomUUID()}`;
    const start = performance.now();
    try {
      if (tool === 'explainScenario') {
        const scenario = await this.intelligence!.getScenario(context.id);
        const facts: CopilotFact[] = [
          {
            reference: context.reference,
            field: 'scenario_name',
            value: scenario.name,
          },
          {
            reference: context.reference,
            field: 'scenario_status',
            value: scenario.status,
          },
          {
            reference: context.reference,
            field: 'scenario_version',
            value: scenario.version,
          },
          {
            reference: context.reference,
            field: 'action_count',
            value: scenario.actions.length,
          },
        ];
        const evidence = 'SIMULATED' as const;
        return grounded(
          messageId,
          resultRef,
          tool,
          facts,
          evidence,
          start,
          [
            LIMITATION,
            'Stored scenario definition only; no simulation was executed.',
          ],
          null,
        );
      }
      if (tool === 'explainImpact') {
        const run = await this.intelligence!.getRun(context.id);
        const impact = await this.intelligence!.getSimulationImpact(context.id);
        const reference = `simulation-run:${run.simulationRunId}`;
        const facts: CopilotFact[] = [
          { reference, field: 'run_status', value: run.status },
          { reference, field: 'scenario_id', value: run.scenarioId },
          {
            reference,
            field: 'impact_id',
            value: impact.impactId,
          },
          {
            reference,
            field: 'network_snapshot_id',
            value: run.networkSnapshotId,
          },
          {
            reference,
            field: 'directly_affected_count',
            value: impact.directExposedCount,
          },
          {
            reference,
            field: 'components_before',
            value: impact.componentsBefore,
          },
          {
            reference,
            field: 'components_after',
            value: impact.componentsAfter,
          },
          {
            reference,
            field: 'connectivity_loss',
            value: impact.connectivityLoss,
          },
          {
            reference,
            field: 'isolated_entity_count',
            value: impact.isolatedEntityCount,
          },
          {
            reference,
            field: 'affected_route_count',
            value: impact.affectedRouteCount,
          },
          {
            reference,
            field: 'affected_segment_count',
            value: impact.affectedSegmentCount,
          },
          { reference, field: 'fingerprint', value: impact.fingerprint },
        ];
        return grounded(
          messageId,
          resultRef,
          tool,
          facts,
          'SIMULATED',
          start,
          [
            LIMITATION,
            'Impact is persisted scenario simulation output, not observed or live conditions.',
          ],
          run.completedAt,
        );
      }
      if (tool === 'explainOperatorAnalysis') {
        // Owner = exact principal userId resolved server-side; operator service enforces scope.
        if (!input.ownerRef.startsWith('user:'))
          throw new Error('COPILOT_SCOPE_MISMATCH');
        const analysis = await this.operator!.get(
          input.ownerRef.slice(5),
          context.id,
        );
        const reference = `operator:${analysis.analysis_id}`;
        const facts = operatorFacts(reference, analysis);
        return grounded(
          messageId,
          resultRef,
          tool,
          facts,
          analysis.provenance.evidence_type,
          start,
          [
            LIMITATION,
            'Operator split is decision support derived from persisted GTFS running time; no dispatch performed.',
            ...analysis.provenance.limitations,
          ],
        );
      }
      if (tool === 'explainRecovery') {
        const recovery = await this.recoveries.get(context.id, input.ownerRef);
        if (recovery.ownerRef !== input.ownerRef)
          throw new Error('COPILOT_SCOPE_MISMATCH');
        const facts = recoveryFacts(context.reference, recovery);
        const alerts = await this.journeys.listAlerts(
          recovery.activeJourneyId,
          input.ownerRef,
        );
        const impact = alerts.find(
          (alert) => alert.impactId === recovery.impactId,
        );
        const evidence: EvidenceType =
          impact?.evidenceType === 'SIMULATED' ? 'SIMULATED' : 'SCHEDULED';
        return grounded(messageId, resultRef, tool, facts, evidence, start, [
          LIMITATION,
          evidence === 'SIMULATED'
            ? 'Recovery re-routes around verified SIMULATED operational blockage; preserves completed history.'
            : 'Recovery is a stored owner-scoped proposal; no acceptance or network mutation was performed.',
        ]);
      }
      const journey = await this.journeys.get(context.id, input.ownerRef);
      if (
        journey.ownerRef !== input.ownerRef ||
        journey.journeyId.toLowerCase() !== context.id.toLowerCase()
      ) {
        throw new Error('COPILOT_SCOPE_MISMATCH');
      }
      const plan = journey.currentPlan ?? journey.originalPlan;
      const alerts = await this.journeys.listAlerts(context.id, input.ownerRef);
      const facts = routeFacts(
        context.reference,
        journey.lifecycleStatus,
        journey.progress,
        plan.legs,
      );
      const evidence: EvidenceType = alerts.some(
        (alert) => alert.evidenceType === 'SIMULATED',
      )
        ? 'SIMULATED'
        : 'SCHEDULED';
      return grounded(
        messageId,
        resultRef,
        tool,
        facts,
        evidence,
        start,
        [
          LIMITATION,
          evidence === 'SIMULATED'
            ? 'Presenting SIMULATED operational disruption from stored impacts; no live tracking.'
            : 'Route explanation comes from the stored OTP schedule snapshot, not live vehicle tracking.',
        ],
        journey.progress.recordedAt,
      );
    } catch {
      return unavailable('Authorized evidence unavailable.', [
        {
          tool,
          resultRef,
          status: 'UNAVAILABLE',
          latencyMs: Math.round(performance.now() - start),
        },
      ]);
    }
  }
}

function operatorFacts(
  reference: string,
  analysis: OperatorAnalysis,
): readonly CopilotFact[] {
  return [
    {
      reference,
      field: 'validation_status',
      value: analysis.validation_status,
    },
    {
      reference,
      field: 'upstream_service_segment_count',
      value: analysis.upstream_service.length,
    },
    {
      reference,
      field: 'downstream_service_segment_count',
      value: analysis.downstream_service.length,
    },
    {
      reference,
      field: 'cut_point_candidate',
      value: analysis.cut_point_candidate,
    },
    {
      reference,
      field: 'restart_point_candidate',
      value: analysis.restart_point_candidate,
    },
    {
      reference,
      field: 'blocked_segment_count',
      value:
        (
          analysis.unresolved_gap['blocked_transit_segment_ids'] as
            unknown[] | undefined
        )?.length ?? 0,
    },
    {
      reference,
      field: 'multiple_gaps',
      value: analysis.unresolved_gap['multiple_gaps'] === true,
    },
    {
      reference,
      field: 'gap_length_meters',
      value:
        typeof analysis.unresolved_gap['length_meters'] === 'number'
          ? (analysis.unresolved_gap['length_meters'] as number)
          : null,
    },
    {
      reference,
      field: 'estimated_vehicle_requirement',
      value: analysis.estimated_vehicle_requirement,
    },
    {
      reference,
      field: 'fleet_source',
      value:
        typeof analysis.assumptions['fleet_source'] === 'string'
          ? (analysis.assumptions['fleet_source'] as string)
          : null,
    },
    {
      reference,
      field: 'evidence_type',
      value: analysis.provenance.evidence_type,
    },
  ];
}

function routeFacts(
  reference: string,
  lifecycleStatus: string,
  progress: { completedLegCount: number; revision: number; method: string },
  legs: readonly JourneyLeg[],
): readonly CopilotFact[] {
  const facts: CopilotFact[] = [
    { reference, field: 'lifecycle_status', value: lifecycleStatus },
    {
      reference,
      field: 'completed_leg_count',
      value: progress.completedLegCount,
    },
    { reference, field: 'progress_revision', value: progress.revision },
    { reference, field: 'progress_method', value: progress.method },
    { reference, field: 'leg_count', value: legs.length },
  ];
  for (const leg of legs.slice(0, 8)) {
    facts.push(
      { reference, field: `leg_${leg.sequence}_mode`, value: leg.mode },
      { reference, field: `leg_${leg.sequence}_from`, value: leg.from.name },
      { reference, field: `leg_${leg.sequence}_to`, value: leg.to.name },
      {
        reference,
        field: `leg_${leg.sequence}_timing_precision`,
        value: leg.timingPrecision,
      },
      { reference, field: `leg_${leg.sequence}_start_at`, value: leg.startAt },
      { reference, field: `leg_${leg.sequence}_end_at`, value: leg.endAt },
    );
  }
  return facts;
}

function recoveryFacts(
  reference: string,
  recovery: RecoveryProposal,
): readonly CopilotFact[] {
  return [
    { reference, field: 'recovery_status', value: recovery.status },
    { reference, field: 'rejoin_status', value: recovery.rejoinStatus },
    { reference, field: 'rejoin_reason', value: recovery.rejoinReason },
    { reference, field: 'reason', value: recovery.reason },
    {
      reference,
      field: 'completed_leg_count',
      value: recovery.completedLegCount,
    },
    { reference, field: 'progress_revision', value: recovery.progressRevision },
    {
      reference,
      field: 'preserved_leg_count',
      value: recovery.preservedLegs.length,
    },
    {
      reference,
      field: 'invalidated_leg_count',
      value: recovery.invalidatedLegs.length,
    },
    {
      reference,
      field: 'repaired_leg_count',
      value: recovery.repairedLegs.length,
    },
    {
      reference,
      field: 'network_snapshot_id',
      value: recovery.networkSnapshotId,
    },
  ];
}

function grounded(
  messageId: string,
  resultRef: string,
  tool: ToolName,
  facts: readonly CopilotFact[],
  evidenceType: EvidenceType,
  start: number,
  warnings: readonly string[],
  observedAt: string | null = null,
): CopilotAnswer {
  if (!validateFactuality(facts, facts)) {
    return {
      messageId,
      answer:
        '[DETERMINISTIC_FALLBACK] Pemeriksaan fakta gagal. Penjelasan belum dapat diberikan.',
      evidenceReferences: [],
      toolResultReferences: [resultRef],
      evidenceType,
      fallbackStatus: 'INSUFFICIENT_EVIDENCE',
      toolAudit: [
        {
          tool,
          resultRef,
          status: 'UNAVAILABLE',
          latencyMs: Math.round(performance.now() - start),
        },
      ],
      meta: {
        warnings: [...warnings, 'Validator rejected tool facts.'],
        observedAt: null,
      },
    };
  }
  return {
    messageId,
    answer: `[DETERMINISTIC_FALLBACK] Penjelasan dari data tersimpan; tanpa layanan AI generatif.\n${renderFacts(facts)}`,
    evidenceReferences: [facts[0]!.reference],
    toolResultReferences: [resultRef],
    evidenceType,
    fallbackStatus: 'DETERMINISTIC_FALLBACK',
    toolAudit: [
      {
        tool,
        resultRef,
        status: 'OK',
        latencyMs: Math.round(performance.now() - start),
      },
    ],
    meta: { warnings, observedAt },
  };
}
