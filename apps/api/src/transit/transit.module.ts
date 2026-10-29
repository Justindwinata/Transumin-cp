import { Module } from '@nestjs/common';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { DATA_SOURCE_REPOSITORY } from './application/data-source.repository.js';
import {
  ListDataSourcesUseCase,
  ListDatasetVersionsUseCase,
} from './application/data-source.use-cases.js';
import { KyselyDataSourceRepository } from './infrastructure/kysely-data-source.repository.js';
import { DataSourcesController } from './interface/data-sources.controller.js';
import { TransitPlaceSearchService } from './application/transit-place-search.service.js';
import { TransitPlacesController } from './interface/transit-places.controller.js';
import { LocalPlaceIndexAdapter } from './infrastructure/local-place-index.adapter.js';

@Module({
  imports: [DatabaseModule],
  controllers: [DataSourcesController, TransitPlacesController],
  providers: [
    KyselyDataSourceRepository,
    {
      provide: DATA_SOURCE_REPOSITORY,
      useExisting: KyselyDataSourceRepository,
    },
    ListDataSourcesUseCase,
    ListDatasetVersionsUseCase,
    TransitPlaceSearchService,
    LocalPlaceIndexAdapter,
  ],
  exports: [
    ListDataSourcesUseCase,
    ListDatasetVersionsUseCase,
    TransitPlaceSearchService,
  ],
})
export class TransitModule {}
