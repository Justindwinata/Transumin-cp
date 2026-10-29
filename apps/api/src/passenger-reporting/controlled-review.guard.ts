import { timingSafeEqual } from 'node:crypto';

import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

@Injectable()
export class ControlledReviewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.CONTROLLED_REVIEW_ENABLED !== 'true'
    )
      throw new UnauthorizedException('CONTROLLED_REVIEW_DISABLED');
    const expected = process.env.CONTROLLED_REVIEW_TOKEN;
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const supplied = request.headers.authorization;
    const token =
      typeof supplied === 'string' && supplied.startsWith('Bearer ')
        ? supplied.slice(7)
        : '';
    if (!expected || expected.length < 32 || !token)
      throw new UnauthorizedException('AUTH_REQUIRED');
    if (typeof request.headers['x-passenger-service-token'] === 'string')
      throw new UnauthorizedException('CONTROLLED_REVIEW_CREDENTIAL_REQUIRED');
    const left = Buffer.from(expected);
    const right = Buffer.from(token);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new UnauthorizedException('AUTH_REQUIRED');
    return true;
  }
}
