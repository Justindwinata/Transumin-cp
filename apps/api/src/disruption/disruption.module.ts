import { Module } from '@nestjs/common';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { MobilityTwinModule } from '../mobility-twin/mobility-twin.module.js';
import { OperationalDataModule } from '../operational-data/operational-data.module.js';
import { AiIncidentPipeline } from './application/ai-incident-pipeline.js';
import { DisruptionIntelligenceService } from './application/disruption-intelligence.service.js';
import { INCIDENT_LIFECYCLE_PORT } from '../operational-data/application/incident-lifecycle.port.js';
import { LiveOperationalGateway } from './application/live-operational-gateway.js';
import { OPERATIONAL_ENTITY_RESOLVER } from './application/operational-entity-resolver.port.js';
import { OperationalEventBus } from './application/operational-event-bus.js';
import { SOURCE_HEALTH_PORT } from './application/source-health.port.js';
import { KyselyOperationalEntityResolver } from './infrastructure/kysely-operational-entity-resolver.js';
import { KyselyIncidentLifecycleRepository } from './infrastructure/kysely-incident-lifecycle.repository.js';
import { KyselySourceHealthRepository } from './infrastructure/kysely-source-health.repository.js';
import { OperationalEventsController } from './interface/operational-events.controller.js';
import { DisruptionIntelligenceController } from './interface/disruption-intelligence.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    DatabaseModule,
    OperationalDataModule,
    MobilityTwinModule,
    AuthModule,
  ],
  controllers: [OperationalEventsController, DisruptionIntelligenceController],
  providers: [
    AiIncidentPipeline,
    DisruptionIntelligenceService,
    LiveOperationalGateway,
    OperationalEventBus,
    KyselyOperationalEntityResolver,
    KyselyIncidentLifecycleRepository,
    KyselySourceHealthRepository,
    {
      provide: OPERATIONAL_ENTITY_RESOLVER,
      useExisting: KyselyOperationalEntityResolver,
    },
    {
      provide: INCIDENT_LIFECYCLE_PORT,
      useExisting: KyselyIncidentLifecycleRepository,
    },
    {
      provide: SOURCE_HEALTH_PORT,
      useExisting: KyselySourceHealthRepository,
    },
  ],
  exports: [
    AiIncidentPipeline,
    DisruptionIntelligenceService,
    LiveOperationalGateway,
    OperationalEventBus,
    INCIDENT_LIFECYCLE_PORT,
    KyselyIncidentLifecycleRepository,
    SOURCE_HEALTH_PORT,
  ],
})
export class DisruptionModule {}
