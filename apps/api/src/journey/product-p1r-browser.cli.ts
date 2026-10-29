import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { configureApplication } from '../application.js';
import { LiveOperationalGateway } from '../disruption/application/live-operational-gateway.js';
import { DisruptionIntelligenceService } from '../disruption/application/disruption-intelligence.service.js';
import { INCIDENT_LIFECYCLE_PORT } from '../operational-data/application/incident-lifecycle.port.js';
import { OperationalIncidentServiceError } from '../operational-data/application/operational-incident.service.js';
import type { IncidentEvidenceInput } from '../operational-data/domain/hazard-incident.js';
import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../mobility-twin/application/mobility-state.port.js';
import { JourneyImpactService } from './application/journey-impact.service.js';
import type { OperationalObservation } from '../operational-data/domain/operational-data.js';

/** Local-only acceptance host: browser API and simulated injector share one event bus. */
if (process.env.PRODUCT_P1R_ACCEPTANCE !== '1')
  throw new Error(
    'Set PRODUCT_P1R_ACCEPTANCE=1 for controlled local acceptance.',
  );

/**
 * Canonical demo identifiers from data/manifests/DEMO-20261011-EVIDENCE.json.
 * Fixed timestamps keep the fixture dedupe identities deterministic across demo
 * runs: reruns replay ALREADY_PERSISTED evidence instead of appending rows.
 */
const DEMO_ROUTE_6H = 'c95bde93-682f-5742-ab1f-3b0f653ecbae';
const DEMO_SNAPSHOT_ID = '07d3393e-e7f4-5708-b467-807406c25a10';
const DEMO_SOURCE_ID = 'e0e9bda7-4649-48c6-a64a-ebf421f48e61';
const DEMO_DUPLICATE_INCIDENT_ID = '3b6a4b0e-6d4e-4f3a-8f2c-9d7e5b1a4c3e';

type HarnessCommand = {
  event?: 'hazard_geometry' | 'incident_duplicate';
  entityId?: string;
  mode?: OperationalObservation['affectedModes'][number];
  state?: 'UNAVAILABLE' | 'UNKNOWN';
  expired?: boolean;
  observationId?: string;
  incidentId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function hazardGeometryCommand(app: INestApplication) {
  const intelligence = app.get(DisruptionIntelligenceService);
  const states = app.get<MobilityStatePort>(MOBILITY_STATE_PORT);
  const kuninganGeometry = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [106.8323, -6.2297],
        [106.8342, -6.2297],
        [106.8342, -6.2279],
        [106.8323, -6.2279],
        [106.8323, -6.2297],
      ],
    ],
  };
  const input = {
    incidentType: 'FLOOD',
    sourceId: DEMO_SOURCE_ID,
    evidenceType: 'SIMULATED' as const,
    operationalState: 'UNKNOWN' as const,
    observedAt: '2026-10-02T08:00:00+07:00',
    effectiveFrom: '2026-10-02T08:00:00+07:00',
    effectiveTo: '2026-10-02T14:00:00+07:00',
    expiresAt: '2026-10-02T14:00:00+07:00',
    receivedAt: '2026-10-02T08:00:00+07:00',
    geometry: kuninganGeometry,
    reason: 'CONTROLLED SIMULATED D6 Kuningan hazard-geometry fixture.',
    provenanceRef: 'demo:CONTROLLED:SIMULATED:hazard-geometry',
    rawReference: 'demo:CONTROLLED:SIMULATED:hazard-geometry',
    sourceClassification: 'NOT_AVAILABLE',
  };
  // 1) Real hazard-geometry path: bounded validation + PostGIS persistence.
  const hazard = await intelligence.createControlledEvent(input);
  // 2) Real spatial exposure evaluation of that persisted geometry.
  const impact = await intelligence.calculateFloodImpact(
    hazard.eventId,
    DEMO_SNAPSHOT_ID,
  );
  // 3) Effective Mobility Twin state of the demo route, BEFORE operational state injection.
  const route = await states.getCurrentState(DEMO_ROUTE_6H);
  // Negative guard A: hazard cannot assert closure.
  let closureRejected = false;
  try {
    await intelligence.createControlledEvent({
      ...input,
      operationalState: 'UNAVAILABLE',
    });
  } catch (error) {
    closureRejected =
      error instanceof Error &&
      error.message.includes('ENVIRONMENTAL_EXPOSURE_CANNOT_ASSERT_CLOSURE');
  }
  // Negative guard B: geometry validation rejects malformed polygons.
  let invalidGeometryRejected = false;
  try {
    await intelligence.createControlledEvent({
      ...input,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [106.8323, -6.2297],
            [106.8342, -6.2279],
            [106.8323, -6.2297],
          ],
        ],
      },
    });
  } catch (error) {
    invalidGeometryRejected =
      error instanceof Error &&
      error.message.includes('INVALID_HAZARD_GEOMETRY');
  }
  return {
    status: 'HAZARD_GEOMETRY_RECORDED',
    event: {
      eventId: hazard.eventId,
      incidentType: hazard.incidentType,
      evidenceType: hazard.evidenceType,
      operationalState: hazard.operationalState,
      provenanceRef: hazard.provenanceRef,
    },
    exposure: {
      impactId: impact.impactId,
      directExposedCount: impact.directExposedCount,
      confirmedUnavailableCount: impact.confirmedUnavailableCount,
    },
    routeState: route.operationalState,
    freshnessStatus: route.freshnessStatus,
    guards: { closureRejected, invalidGeometryRejected },
  };
}

async function incidentDuplicateCommand(app: INestApplication) {
  const lifecycle = app.get(INCIDENT_LIFECYCLE_PORT);
  const evidence: IncidentEvidenceInput = {
    incidentId: DEMO_DUPLICATE_INCIDENT_ID,
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityIds: [DEMO_ROUTE_6H],
    affectedModes: ['TRANSJAKARTA'],
    operationalState: 'UNKNOWN',
    sourceClass: 'SIMULATED',
    sourceId: DEMO_SOURCE_ID,
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    evidenceType: 'SIMULATED',
    sourceClassification: 'NOT_AVAILABLE',
    observedAt: '2026-10-02T08:00:00+07:00',
    effectiveFrom: '2026-10-02T08:00:00+07:00',
    expiresAt: '2026-10-02T14:00:00+07:00',
    receivedAt: '2026-10-02T08:00:00+07:00',
    reason: 'CONTROLLED SIMULATED duplicate-identity probe.',
    provenanceRef: 'demo:CONTROLLED:SIMULATED:incident-duplicate',
    rawReference: 'demo:CONTROLLED:SIMULATED:incident-duplicate',
    supportingHazardEventId: null,
  };
  const first = await lifecycle.ingest(evidence, 'UNVERIFIED', new Date());
  const second = await lifecycle.ingest(evidence, 'UNVERIFIED', new Date());
  let conflict: string | null = null;
  try {
    await lifecycle.ingest(
      { ...evidence, reason: 'ALTERED conflicting duplicate evidence.' },
      'UNVERIFIED',
      new Date(),
    );
  } catch (error) {
    conflict =
      error instanceof OperationalIncidentServiceError
        ? error.failure.code
        : 'UNEXPECTED';
  }
  return {
    status: 'INCIDENT_DUPLICATE_CONTROL',
    first: first.status,
    second: second.status,
    conflict,
  };
}

const app = await NestFactory.create(AppModule, { logger: ['error'] });
configureApplication(app);
const port = Number(process.env.PRODUCT_P1R_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PRODUCT_P1R_PORT must be an integer from 1 to 65535.');
await app.listen(port, '127.0.0.1');
process.stdout.write(`P1R_ACCEPTANCE_READY 127.0.0.1:${port}\n`);

const gateway = app.get(LiveOperationalGateway);
const impacts = app.get(JourneyImpactService);
const controlledObservations = new Map<string, OperationalObservation>();
const input = createInterface({ input: process.stdin, terminal: false });
try {
  for await (const line of input) {
    try {
      const command = JSON.parse(line) as HarnessCommand;
      if (command.event === 'hazard_geometry') {
        process.stdout.write(
          `${JSON.stringify(await hazardGeometryCommand(app))}\n`,
        );
        continue;
      }
      if (command.event === 'incident_duplicate') {
        process.stdout.write(
          `${JSON.stringify(await incidentDuplicateCommand(app))}\n`,
        );
        continue;
      }
      if (
        !command.entityId ||
        !UUID_PATTERN.test(command.entityId) ||
        !command.mode ||
        ![
          'TRANSJAKARTA',
          'MIKROTRANS',
          'KRL',
          'MRT_JAKARTA',
          'LRT_JAKARTA',
          'LRT_JABODEBEK',
          'WALK',
        ].includes(command.mode) ||
        !command.state ||
        !['UNAVAILABLE', 'UNKNOWN'].includes(command.state) ||
        (command.observationId !== undefined &&
          !UUID_PATTERN.test(command.observationId)) ||
        (command.incidentId !== undefined &&
          !UUID_PATTERN.test(command.incidentId))
      )
        throw new Error(
          'Expected canonical entityId, product mode, and UNAVAILABLE or UNKNOWN.',
        );
      const now = new Date();
      const observation: OperationalObservation = {
        observationId: command.observationId ?? randomUUID(),
        incidentId: command.incidentId ?? randomUUID(),
        incidentType: 'SERVICE_SUSPENSION',
        affectedEntityRefs: [`CANONICAL:${command.entityId}`],
        affectedModes: [command.mode],
        operationalState: command.state,
        evidenceType: 'SIMULATED',
        sourceAuthority: 'SIMULATION',
        sourceChannel: 'CONTROLLED_SIMULATION',
        impactBasis: 'CONTROLLED_SIMULATION',
        observedAt: new Date(now.getTime() - 1000).toISOString(),
        receivedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + (command.expired ? -100 : 3_600_000),
        ).toISOString(),
        reason: 'Controlled PRODUCT-P1-R browser acceptance.',
        confidenceStatus: 'SIMULATED',
        confidence: 1,
        provenance: {
          sourceId: randomUUID(),
          sourceClassification: 'UNKNOWN',
          rawReference: 'fixture:SIMULATED:product-p1r-browser',
          lineageReference: 'fixture:SIMULATED:product-p1r-browser',
          retrievedAt: now.toISOString(),
        },
        sourceAttributes: { fixture: true },
      };
      // Repeat the exact stored evidence, including timestamps/provenance.
      const previous = command.observationId
        ? controlledObservations.get(command.observationId)
        : undefined;
      if (
        previous &&
        (previous.incidentId !== command.incidentId ||
          previous.operationalState !== command.state ||
          previous.affectedEntityRefs[0] !== `CANONICAL:${command.entityId}` ||
          previous.affectedModes[0] !== command.mode)
      )
        throw new Error('CONTROLLED_OBSERVATION_IDENTITY_CONFLICT');
      const submitted = previous ?? observation;
      controlledObservations.set(submitted.observationId, submitted);
      const result = await gateway.ingestObservations([submitted], now);
      await impacts.whenIdle();
      process.stdout.write(
        `${JSON.stringify({ status: 'INJECTED_SIMULATED', ...result })}\n`,
      );
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ status: 'ERROR', message: error instanceof Error ? error.message : String(error) })}\n`,
      );
    }
  }
} finally {
  await app.close();
}
