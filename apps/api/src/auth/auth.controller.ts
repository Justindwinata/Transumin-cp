import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AuthService, isRole, type Role } from './auth.service.js';
import {
  AuthGuard,
  Roles,
  RolesGuard,
  sessionToken,
  SESSION_COOKIE,
  type AuthRequest,
} from './auth.guard.js';
import { authError } from './auth.error.js';

type CookieResponse = {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
};
type Addressed = AuthRequest &
  IncomingMessage & { ip?: string; socket: { remoteAddress?: string } };
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email?: unknown; password?: unknown },
    @Headers('origin') origin: string | undefined,
    @Req() request: Addressed,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    this.assertCookieMutationOrigin(origin, false);
    if (
      !body ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string'
    )
      throw authError('INVALID_INPUT', 400);
    const result = await this.auth.login(
      body.email,
      body.password,
      request.ip ?? request.socket.remoteAddress ?? '127.0.0.1',
    );
    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1',
      maxAge: 12 * 60 * 60 * 1000,
    });
    return ok({
      user: {
        id: result.principal.userId,
        email: result.principal.email,
        roles: result.principal.roles,
      },
    });
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Addressed,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const slot = sessionToken(request);
    this.assertCookieMutationOrigin(origin, slot.viaBearer);
    await this.auth.logout(slot.token);
    // Avoid instanceof flip on missing token; normalize to auth-required envelope
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1',
    });
    return ok({ logged_out: true });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthRequest) {
    const { userId, email, roles } = request.principal!;
    return ok({ id: userId, email, roles });
  }

  @Post('users')
  @HttpCode(201)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  async provision(
    @Body()
    body: { email?: unknown; password?: unknown; roles?: unknown } | null,
    @Req() request: AuthRequest,
    @Headers('origin') origin: string | undefined,
  ) {
    this.assertCookieMutationOrigin(origin, sessionToken(request).viaBearer);
    if (
      !body ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      !Array.isArray(body.roles) ||
      !body.roles.every(isRole)
    )
      throw authError('INVALID_INPUT', 400);
    return ok(
      await this.auth.provision(
        body.email,
        body.password,
        body.roles as Role[],
      ),
    );
  }

  @Get('users')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  async listUsers() {
    return ok(await this.auth.listUsers());
  }

  private assertCookieMutationOrigin(
    origin: string | undefined,
    viaBearer: boolean,
  ): void {
    if (viaBearer) return;
    if (!origin) throw authError('CSRF_ORIGIN_REQUIRED', 403);
    const allowed = [process.env.AUTH_ORIGIN, process.env.PUBLIC_ORIGIN].filter(
      (value): value is string => Boolean(value),
    );
    if (process.env.AUTH_ALLOW_LOOPBACK_ORIGIN === 'true')
      allowed.push('http://127.0.0.1:3000', 'http://localhost:3000');
    try {
      if (!allowed.includes(new URL(origin).origin))
        throw authError('CSRF_ORIGIN_FORBIDDEN', 403);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw authError('CSRF_ORIGIN_FORBIDDEN', 403);
    }
  }
}
function ok(data: unknown) {
  return { data, meta: { request_id: randomUUID(), warnings: [] } };
}
