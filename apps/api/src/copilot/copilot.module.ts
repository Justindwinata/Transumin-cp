import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { CopilotAuditService } from './application/copilot-audit.service.js';
import { JourneyModule } from '../journey/journey.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DisruptionModule } from '../disruption/disruption.module.js';
import { OperatorRecoveryModule } from '../operator-recovery/operator-recovery.module.js';
import { CopilotService } from './application/copilot.service.js';
import { CopilotController } from './interface/copilot.controller.js';
import { ResearchCopilotController } from './interface/research-copilot.controller.js';

@Module({
  // FR-010/014: bounded tools, durable audit, principal-owned research sessions.
  imports: [
    JourneyModule,
    DatabaseModule,
    AuthModule,
    DisruptionModule,
    OperatorRecoveryModule,
  ],
  controllers: [CopilotController, ResearchCopilotController],
  providers: [CopilotService, CopilotAuditService],
})
export class CopilotModule {}
