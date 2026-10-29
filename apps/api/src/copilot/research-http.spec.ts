import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module, NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthService } from '../auth/auth.service.js';
import { authError } from '../auth/auth.error.js';
import { CopilotService } from './application/copilot.service.js';
import { CopilotAuditService } from './application/copilot-audit.service.js';
import { ResearchCopilotController } from './interface/research-copilot.controller.js';
import { CopilotController } from './interface/copilot.controller.js';

const userId = '550e8400-e29b-41d4-a716-446655440001';
const foreignId = '550e8400-e29b-41d4-a716-446655440002';
const sid = '550e8400-e29b-41d4-a716-446655440003';
const savedOwners: string[] = [];
const inputs: unknown[] = [];
@Module({
  controllers: [ResearchCopilotController, CopilotController],
  providers: [
    {
      provide: AuthService,
      useValue: {
        resolve: async (token: string) => {
          if (!['a', 'b', 'c', 'd'].some((c) => token === c.repeat(64)))
            throw authError('AUTH_REQUIRED', 401);
          return {
            userId: token.startsWith('b') ? foreignId : userId,
            roles: [
              token.startsWith('c')
                ? 'PASSENGER'
                : token.startsWith('d')
                  ? 'ADMIN'
                  : 'RESEARCHER_OPERATOR',
            ],
          };
        },
      },
    },
    {
      provide: CopilotService,
      useValue: {
        ask: async (input: unknown) => {
          inputs.push(input);
          return {
            messageId: sid,
            answer: 'SAMPLE',
            evidenceReferences: [],
            toolResultReferences: [],
            evidenceType: null,
            fallbackStatus: 'INSUFFICIENT_EVIDENCE',
            toolAudit: [],
            meta: { warnings: [], observedAt: null },
          };
        },
      },
    },
    {
      provide: CopilotAuditService,
      useValue: {
        record: async (
          input: { ownerRef: string; sessionId?: string },
          execute: () => Promise<unknown>,
        ) => {
          if (input.sessionId && input.ownerRef !== `user:${userId}`)
            throw new NotFoundException();
          savedOwners.push(input.ownerRef);
          return { ...((await execute()) as object), sessionId: sid };
        },
        get: async (_id: string, owner: string) => {
          if (owner !== `user:${userId}`) throw new NotFoundException();
          return {
            session_id: sid,
            messages: [{ answer: 'SAMPLE private history' }],
          };
        },
      },
    },
  ],
})
class TestModule {}

test('FR-010/014 research HTTP guards all roles, principal ownership, no spoof or passenger audit leak', async () => {
  const prior = process.env.PASSENGER_SERVICE_TOKEN;
  process.env.PASSENGER_SERVICE_TOKEN = 't'.repeat(64);
  const app = await NestFactory.create(TestModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/copilot`;
    const body = {
      message: 'Explain scenario',
      context_references: [`scenario:${sid}`],
      owner_ref: `user:${foreignId}`,
      researchAuthorized: true,
    };
    const post = (token?: string, extra = {}) =>
      fetch(`${base}/research/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token.repeat(64)}` } : {}),
          'x-journey-owner': `user:${foreignId}`,
          'x-role': 'ADMIN',
        },
        body: JSON.stringify({ ...body, ...extra }),
      });
    const get = (token?: string) =>
      fetch(`${base}/research/sessions/${sid}`, {
        headers: {
          ...(token ? { authorization: `Bearer ${token.repeat(64)}` } : {}),
          'x-journey-owner': `user:${userId}`,
          'x-role': 'ADMIN',
        },
      });
    for (const token of [undefined, 'e', 'c']) {
      assert.equal((await post(token)).status, token === 'c' ? 403 : 401);
      assert.equal((await get(token)).status, token === 'c' ? 403 : 401);
    }
    for (const token of ['a', 'd']) {
      assert.equal((await post(token)).status, 200);
      assert.equal((await get(token)).status, 200);
    }
    assert.deepEqual(savedOwners, [`user:${userId}`, `user:${userId}`]);
    for (const input of inputs)
      assert.deepEqual(input, {
        message: body.message,
        contextReferences: body.context_references,
        ownerRef: `user:${userId}`,
        researchAuthorized: true,
      });
    const foreign = await get('b');
    assert.equal(foreign.status, 404);
    assert.doesNotMatch(await foreign.text(), /private history/);
    assert.equal((await post('b', { session_id: sid })).status, 404);
    for (const path of ['messages', `sessions/${sid}`]) {
      const response = await fetch(`${base}/${path}`, {
        method: path === 'messages' ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          'x-passenger-service-token': 't'.repeat(64),
          'x-journey-owner': `user:${userId}`,
        },
        ...(path === 'messages' ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /private history/);
    }
  } finally {
    await app.close();
    if (prior === undefined) delete process.env.PASSENGER_SERVICE_TOKEN;
    else process.env.PASSENGER_SERVICE_TOKEN = prior;
  }
});
