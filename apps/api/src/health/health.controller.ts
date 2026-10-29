import { Controller, Get } from '@nestjs/common';

export type LivenessResponse = Readonly<{
  status: 'ok';
  service: 'transum-in-nexus-api';
}>;

@Controller('health')
export class HealthController {
  @Get('live')
  live(): LivenessResponse {
    return {
      status: 'ok',
      service: 'transum-in-nexus-api',
    };
  }
}
