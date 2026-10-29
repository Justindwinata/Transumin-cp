import { RequestMethod, type INestApplication } from '@nestjs/common';

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
}
