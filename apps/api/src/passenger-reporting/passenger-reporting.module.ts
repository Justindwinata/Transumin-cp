import { AuthModule } from '../auth/auth.module.js';
import { AdminReportController } from './admin-report.controller.js';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { JourneyModule } from '../journey/journey.module.js';
import { DisruptionModule } from '../disruption/disruption.module.js';
import { PassengerReportService } from './passenger-report.service.js';
import { PassengerReportController } from './passenger-report.controller.js';
import { ControlledReviewGuard } from './controlled-review.guard.js';
import { PassengerServiceGuard } from '../journey/interface/passenger-service.guard.js';

@Module({
  imports: [DatabaseModule, DisruptionModule, JourneyModule, AuthModule],
  controllers: [PassengerReportController, AdminReportController],
  providers: [
    PassengerReportService,
    ControlledReviewGuard,
    PassengerServiceGuard,
  ],
})
export class PassengerReportingModule {}
