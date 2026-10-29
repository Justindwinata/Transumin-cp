import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { ResearchReadController } from './research-read.controller.js';
import { ResearchReadModel } from './research.read-model.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ResearchReadController],
  providers: [ResearchReadModel],
})
export class ResearchModule {}
