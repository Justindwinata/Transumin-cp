import { Module } from '@nestjs/common';

import { createDatabase } from './database.client.js';
import { DATABASE } from './database.constants.js';
import { DatabaseLifecycle } from './database.lifecycle.js';

@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: createDatabase,
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
