// FR-014: server-side principal only; request role claims never trusted.
import {
  HttpException,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authError } from './auth.error.js';
import { AuthService, type Principal, type Role } from './auth.service.js';

export const Roles = (...roles: Role[]) => SetMetadata('auth.roles', roles);
export const SESSION_COOKIE = 'tnx_session';
export type AuthRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
  viaBearer?: boolean;
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function assertMutationOrigin(
  request: AuthRequest,
  origin: string | undefined,
): void {
  if (!MUTATION_METHODS.has(request.method ?? '')) return;
  if (request.viaBearer) return;
  if (!origin) throw authError('CSRF_ORIGIN_REQUIRED', 403);
  const allowed = [process.env.AUTH_ORIGIN, process.env.PUBLIC_ORIGIN].filter(
    (value): value is string => Boolean(value),
  );
  if (process.env.AUTH_ALLOW_LOOPBACK_ORIGIN === 'true')
    allowed.push('http://127.0.0.1:3000', 'http://localhost:3000');
  let actual: string;
  try {
    actual = new URL(origin).origin;
  } catch {
    throw authError('CSRF_ORIGIN_FORBIDDEN', 403);
  }
  if (allowed.length === 0 || !allowed.includes(actual))
    throw authError('CSRF_ORIGIN_FORBIDDEN', 403);
}

export function sessionToken(request: AuthRequest): {
  token: string | undefined;
  viaBearer: boolean;
} {
  const cookie = request.headers.cookie;
  let cookieToken: string | undefined;
  if (typeof cookie === 'string') {
    const matches = cookie
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${SESSION_COOKIE}=`))
      .map((v) => v.slice(SESSION_COOKIE.length + 1));
    if (matches.length > 1) return { token: '', viaBearer: false };
    if (matches.length === 1 && matches[0]) cookieToken = matches[0];
  }
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer '))
    return { token: authorization.slice(7), viaBearer: true };
  return { token: cookieToken, viaBearer: false };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const { token, viaBearer } = sessionToken(request);
    request.viaBearer = viaBearer;
    if (viaBearer && (!token || !/^[0-9a-f]{64}$/.test(token)))
      throw authError('AUTH_REQUIRED', 401);
    try {
      request.principal = await this.auth.resolve(token);
    } catch (error) {
      if (error instanceof HttpException) throw authError('AUTH_REQUIRED', 401);
      throw authError('AUTH_UNAVAILABLE', 503);
    }
    assertMutationOrigin(
      request,
      typeof request.headers.origin === 'string'
        ? request.headers.origin
        : undefined,
    );
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles =
      this.reflector.getAllAndOverride<Role[]>('auth.roles', [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const principal = context
      .switchToHttp()
      .getRequest<AuthRequest>().principal;
    if (!principal) throw authError('AUTH_REQUIRED', 401);
    if (
      roles.length > 0 &&
      !roles.some((role) => principal.roles.includes(role))
    )
      throw authError('FORBIDDEN', 403);
    return true;
  }
}
