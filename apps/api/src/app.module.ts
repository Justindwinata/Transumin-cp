import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module.js';
import { OperationalDataModule } from './operational-data/operational-data.module.js';
import { MobilityTwinModule } from './mobility-twin/mobility-twin.module.js';
import { SpatialModule } from './spatial/spatial.module.js';
import { TransitModule } from './transit/transit.module.js';
import { DisruptionModule } from './disruption/disruption.module.js';
import { JourneyModule } from './journey/journey.module.js';
import { CopilotModule } from './copilot/copilot.module.js';
import { PassengerReportingModule } from './passenger-reporting/passenger-reporting.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OperatorRecoveryModule } from './operator-recovery/operator-recovery.module.js';
import { ResearchModule } from './research/research.module.js';

@Module({
  imports: [
    HealthModule,
    TransitModule,
    OperationalDataModule,
    SpatialModule,
    MobilityTwinModule,
    DisruptionModule,
    JourneyModule,
    PassengerReportingModule,
    CopilotModule,
    AuthModule,
    OperatorRecoveryModule,
    ResearchModule,
  ],
})
export class AppModule {}
