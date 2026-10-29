import { Controller, Get, Inject } from '@nestjs/common';

import {
  ReadinessService,
  type ReadinessResponse,
} from './readiness.service.js';

@Controller('health')
export class ReadinessController {
  constructor(
    @Inject(ReadinessService)
    private readonly readinessService: ReadinessService,
  ) {}

  @Get('ready')
  ready(): Promise<ReadinessResponse> {
    return this.readinessService.check();
  }
}
