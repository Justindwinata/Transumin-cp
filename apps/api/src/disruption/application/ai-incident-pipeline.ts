import { Inject, Injectable } from '@nestjs/common';

import { AiIncidentExtractionValidator } from '../../operational-data/ai/ai-incident-extraction.js';
import type { AiIncidentExtraction } from '../../operational-data/ai/ai-incident-extraction.js';

export type AiPipelineResult = Readonly<{
  status: 'VALIDATED_CANDIDATE' | 'REJECTED';
  errors: readonly string[];
  extraction: AiIncidentExtraction;
}>;

@Injectable()
export class AiIncidentPipeline {
  constructor(
    @Inject(AiIncidentExtractionValidator)
    private readonly validator: AiIncidentExtractionValidator,
  ) {}

  validate(
    sourceText: string,
    extraction: AiIncidentExtraction,
  ): AiPipelineResult {
    const validation = this.validator.validate(extraction, sourceText);
    return {
      status: validation.validCandidate ? 'VALIDATED_CANDIDATE' : 'REJECTED',
      errors: validation.errors,
      extraction,
    };
  }
}
