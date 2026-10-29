import { Module } from '@nestjs/common';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  OperatorRecoveryService,
  OPERATOR_ANALYSIS_REPOSITORY,
  OPERATOR_RECOVERY_PORT,
} from './application/operator-recovery.service.js';
import {
  DeterministicOperatorRecoveryAdapter,
  KyselyOperatorAnalysisRepository,
} from './infrastructure/operator-recovery.adapters.js';
import { OperatorRecoveryController } from './interface/operator-recovery.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OperatorRecoveryController],
  providers: [
    OperatorRecoveryService,
    DeterministicOperatorRecoveryAdapter,
    KyselyOperatorAnalysisRepository,
    {
      provide: OPERATOR_RECOVERY_PORT,
      useExisting: DeterministicOperatorRecoveryAdapter,
    },
    {
      provide: OPERATOR_ANALYSIS_REPOSITORY,
      useExisting: KyselyOperatorAnalysisRepository,
    },
  ],
  exports: [OperatorRecoveryService],
})
export class OperatorRecoveryModule {}
