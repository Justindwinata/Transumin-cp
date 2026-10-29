import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE, type FoundationDatabase } from './database.constants.js';

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}
