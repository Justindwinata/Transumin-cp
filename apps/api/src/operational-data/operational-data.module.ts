import { Module } from '@nestjs/common';

import { AiIncidentExtractionValidator } from './ai/ai-incident-extraction.js';
import { OperationalConflictResolutionService } from './application/conflict-resolution.service.js';
import { FreshnessEvaluator } from './application/freshness-evaluator.js';
import { OperationalContractValidator } from './application/operational-contract-validator.js';
import { OperatorConfirmedIncidentService } from './application/operator-confirmed-incident.service.js';
import { OperationalIncidentService } from './application/operational-incident.service.js';
import { SourcePriorityComparator } from './application/source-priority.js';

@Module({
  providers: [
    OperationalContractValidator,
    FreshnessEvaluator,
    SourcePriorityComparator,
    OperationalConflictResolutionService,
    OperatorConfirmedIncidentService,
    OperationalIncidentService,
    AiIncidentExtractionValidator,
  ],
  exports: [
    OperationalContractValidator,
    FreshnessEvaluator,
    SourcePriorityComparator,
    OperationalConflictResolutionService,
    OperatorConfirmedIncidentService,
    OperationalIncidentService,
    AiIncidentExtractionValidator,
  ],
})
export class OperationalDataModule {}
