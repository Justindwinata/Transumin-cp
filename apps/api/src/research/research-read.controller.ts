// FR-011/FR-013: bounded, role-guarded read models for the operator dashboard.
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthGuard, Roles, RolesGuard } from '../auth/auth.guard.js';
import { ResearchReadModel } from './research.read-model.js';

function envelope(
  data: unknown,
  nextCursor: string | null = null,
  availability?: string,
) {
  return {
    data,
    meta: {
      request_id: randomUUID(),
      warnings: [],
      provenance: [],
      next_cursor: nextCursor,
      availability,
    },
  };
}

@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles('RESEARCHER_OPERATOR', 'ADMIN')
export class ResearchReadController {
  constructor(
    @Inject(ResearchReadModel) private readonly read: ResearchReadModel,
  ) {}

  @Get('scenarios')
  async scenarios(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.read.scenarios(limit, cursor);
    return envelope(page.data, page.next_cursor);
  }

  @Get('simulation-runs')
  async runs(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const page = await this.read.runs(limit, cursor);
    return envelope(page.data, page.next_cursor);
  }

  @Get('experiments')
  async experiments(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.read.experiments(limit, cursor);
    return envelope(page.data, page.next_cursor, page.availability);
  }

  @Get('network/snapshots/:snapshotId/geometry')
  async geometry(
    @Param('snapshotId') snapshotId: string,
    @Query('bbox') bbox?: string,
  ) {
    return envelope(await this.read.geometry(snapshotId, bbox));
  }
}
