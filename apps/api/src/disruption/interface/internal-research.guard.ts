import { timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class InternalResearchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_RESEARCH_TOKEN;
    const request = context.switchToHttp().getRequest<{
      headers: Readonly<Record<string, string | string[] | undefined>>;
    }>();
    const authorization = request.headers.authorization;
    const supplied =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
    if (!expected || !supplied)
      throw new UnauthorizedException('AUTH_REQUIRED');
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new UnauthorizedException('AUTH_REQUIRED');
    return true;
  }
}
