import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  allowedResource,
  apiBase,
  originAllowed,
  sessionCookie,
  rewrittenSessionCookie,
} from '../../../../lib/ops-proxy';

type Context = { params: Promise<{ path: string[] }> };

const MAX_BODY_BYTES = 262_144;

function jsonError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

async function forward(
  request: NextRequest,
  context: Context,
): Promise<NextResponse> {
  const { path } = await context.params;
  // Allowlist matches the exact path plus our own query, never a caller-supplied upstream.
  const resource = path.join('/') + (request.nextUrl.search || '');
  if (!allowedResource(request.method, resource))
    return jsonError('NOT_FOUND', 'Unknown API resource.', 404);
  const production = process.env.NODE_ENV === 'production';
  if (
    request.method !== 'GET' &&
    !originAllowed(
      request.headers.get('origin'),
      request.headers.get('host'),
      production,
    )
  )
    return jsonError('FORBIDDEN', 'Same-origin Origin is required.', 403);

  let base: string;
  try {
    const adminReview = resource.startsWith('admin/passenger-reports');
    if (adminReview && !process.env.ADMIN_REVIEW_API_BASE_URL)
      return jsonError(
        'ADMIN_REVIEW_NOT_CONFIGURED',
        'Admin review service is not configured.',
        503,
      );
    base = apiBase(
      adminReview
        ? process.env.ADMIN_REVIEW_API_BASE_URL
        : (process.env.OPS_API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1'),
    );
  } catch (error) {
    return jsonError(
      'API_CONFIGURATION_INVALID',
      error instanceof Error ? error.message : 'API configuration invalid.',
      503,
    );
  }

  const headers = new Headers({ accept: 'application/json' });
  let cookie: string | null;
  try {
    cookie = sessionCookie(request.headers.get('cookie'));
  } catch {
    return jsonError('INVALID_SESSION', 'Session cookie is invalid.', 400);
  }
  if (cookie) headers.set('cookie', cookie); // only tnx_session crosses upstream.
  const idempotency = request.headers.get('idempotency-key');
  if (idempotency) headers.set('idempotency-key', idempotency);
  if (request.method !== 'GET')
    headers.set('origin', request.headers.get('origin')!); // backend authorizes via Origin.

  let body: string | undefined;
  if (request.method !== 'GET') {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
      return jsonError('INVALID_PARAMETER', 'Request is too large.', 413);
    headers.set('content-type', 'application/json');
  }
  try {
    const upstream = await fetch(`${base}/${resource}`, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const result = new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: {
        'content-type':
          upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
    // Session token is only ever transported as an HttpOnly cookie scoped to /api/v1.
    const getSetCookie = (
      upstream.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie;
    for (const raw of typeof getSetCookie === 'function'
      ? getSetCookie.call(upstream.headers)
      : [])
      try {
        const rewritten = rewrittenSessionCookie(raw, production);
        if (rewritten) result.headers.append('set-cookie', rewritten);
      } catch {
        /* drop malformed session cookie */
      }
    return result;
  } catch {
    return jsonError(
      'ROUTER_UNAVAILABLE',
      'API service is temporarily unavailable.',
      503,
    );
  }
}

export const GET = forward;
export const POST = forward;
