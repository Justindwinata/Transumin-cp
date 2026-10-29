import { Module } from '@nestjs/common';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { OperationalDataModule } from '../operational-data/operational-data.module.js';
import { MOBILITY_STATE_PORT } from './application/mobility-state.port.js';
import { KyselyMobilityStateRepository } from './infrastructure/kysely-mobility-state.repository.js';
import { MobilityStateController } from './interface/mobility-state.controller.js';

@Module({
  imports: [DatabaseModule, OperationalDataModule],
  controllers: [MobilityStateController],
  providers: [
    KyselyMobilityStateRepository,
    {
      provide: MOBILITY_STATE_PORT,
      useExisting: KyselyMobilityStateRepository,
    },
  ],
  exports: [MOBILITY_STATE_PORT, KyselyMobilityStateRepository],
})
export class MobilityTwinModule {}
