import { timingSafeEqual } from 'node:crypto';

import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

/** Prototype proxy identity only; passenger ownership remains repository-scoped. */
@Injectable()
export class PassengerServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.PASSENGER_SERVICE_TOKEN;
    if (!expected || expected.length < 32)
      throw new UnauthorizedException('PASSENGER_SERVICE_TOKEN_REQUIRED');
    const supplied = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>().headers['x-passenger-service-token'];
    if (typeof supplied !== 'string')
      throw new UnauthorizedException('AUTH_REQUIRED');
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new UnauthorizedException('AUTH_REQUIRED');
    return true;
  }
}
