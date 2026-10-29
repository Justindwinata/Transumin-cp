import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);

  const port = Number.parseInt(process.env.API_PORT ?? '3001', 10);
  const host = process.env.API_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost')
    throw new Error(
      'API_HOST must be loopback-only for prototype passenger sessions.',
    );
  await app.listen(port, host);
}

void bootstrap();
