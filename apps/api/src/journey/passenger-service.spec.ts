import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import {
  Controller,
  Get,
  Module,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PassengerServiceGuard } from './interface/passenger-service.guard.js';

@Controller('protected')
@UseGuards(PassengerServiceGuard)
class ProtectedController {
  @Get() get() {
    return { ok: true };
  }
}
@Module({ controllers: [ProtectedController] })
class TestModule {}

const previous = process.env.PASSENGER_SERVICE_TOKEN;
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let url: string;
before(async () => {
  process.env.PASSENGER_SERVICE_TOKEN = 't'.repeat(64);
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/protected`;
});
after(async () => {
  await app.close();
  if (previous === undefined) delete process.env.PASSENGER_SERVICE_TOKEN;
  else process.env.PASSENGER_SERVICE_TOKEN = previous;
});
it('HTTP owner spoofing cannot bypass missing or invalid service identity', async () => {
  for (const token of [undefined, 'wrong', 't'.repeat(63)]) {
    const headers: Record<string, string> = {
      'x-journey-owner': 'passenger:victim',
    };
    if (token !== undefined) headers['x-passenger-service-token'] = token;
    assert.equal((await fetch(url, { headers })).status, 401);
  }
  assert.equal(
    (
      await fetch(url, {
        headers: { 'x-passenger-service-token': 't'.repeat(64) },
      })
    ).status,
    200,
  );
});
it('unset/short service token fails closed', () => {
  const guard = new PassengerServiceGuard();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-passenger-service-token': 't'.repeat(64) },
      }),
    }),
  } as unknown as ExecutionContext;
  for (const expected of ['', 'short']) {
    process.env.PASSENGER_SERVICE_TOKEN = expected;
    assert.throws(
      () => guard.canActivate(context),
      /PASSENGER_SERVICE_TOKEN_REQUIRED/,
    );
  }
  process.env.PASSENGER_SERVICE_TOKEN = 't'.repeat(64);
});
