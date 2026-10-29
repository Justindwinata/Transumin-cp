import { Module } from '@nestjs/common';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { DisruptionModule } from '../disruption/disruption.module.js';
import { MobilityTwinModule } from '../mobility-twin/mobility-twin.module.js';
import { ACTIVE_JOURNEY_REPOSITORY } from './application/active-journey.repository.port.js';
import { ActiveJourneyService } from './application/active-journey.service.js';
import { JourneyImpactService } from './application/journey-impact.service.js';
import { JourneyPlannerService } from './application/journey-planner.service.js';
import { RECOVERY_REPOSITORY } from './application/recovery.repository.port.js';
import { RecoveryService } from './application/recovery.service.js';
import { JOURNEY_ROUTING_PORT } from './application/journey-routing.port.js';
import { ROUTING_IDENTITY_PORT } from './application/routing-identity.port.js';
import { KyselyRoutingIdentityBridge } from './infrastructure/kysely-routing-identity.bridge.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';
import { KyselyRecoveryRepository } from './infrastructure/kysely-recovery.repository.js';
import { OtpJourneyRoutingAdapter } from './infrastructure/otp-journey-routing.adapter.js';
import { ActiveJourneyController } from './interface/active-journey.controller.js';
import { JourneyController } from './interface/journey.controller.js';
import { RecoveryController } from './interface/recovery.controller.js';
import { PassengerServiceGuard } from './interface/passenger-service.guard.js';

@Module({
  imports: [DatabaseModule, MobilityTwinModule, DisruptionModule],
  controllers: [JourneyController, ActiveJourneyController, RecoveryController],
  providers: [
    JourneyPlannerService,
    PassengerServiceGuard,
    ActiveJourneyService,
    JourneyImpactService,
    RecoveryService,
    OtpJourneyRoutingAdapter,
    KyselyRoutingIdentityBridge,
    KyselyActiveJourneyRepository,
    KyselyRecoveryRepository,
    {
      provide: ACTIVE_JOURNEY_REPOSITORY,
      useExisting: KyselyActiveJourneyRepository,
    },
    {
      provide: RECOVERY_REPOSITORY,
      useExisting: KyselyRecoveryRepository,
    },
    { provide: JOURNEY_ROUTING_PORT, useExisting: OtpJourneyRoutingAdapter },
    {
      provide: ROUTING_IDENTITY_PORT,
      useExisting: KyselyRoutingIdentityBridge,
    },
  ],
  exports: [
    JourneyPlannerService,
    ActiveJourneyService,
    JourneyImpactService,
    RecoveryService,
    JOURNEY_ROUTING_PORT,
    ROUTING_IDENTITY_PORT,
  ],
})
export class JourneyModule {}
