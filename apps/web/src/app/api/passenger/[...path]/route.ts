import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

type Context = { params: Promise<{ path: string[] }> };

const allowed = [
  /^transit\/places$/,
  /^journeys\/(?:plan|planning-health)$/,
  /^journeys\/[0-9a-f-]{36}(?:\/(?:activate|progress|status|alerts(?:\/stream)?|boarding\/\d+|alighting\/\d+))?$/i,
  /^recoveries(?:\/[0-9a-f-]{36}(?:\/accept)?)?$/i,
  /^passenger-reports(?:\/[0-9a-f-]{36})?$/i,
  /^copilot\/messages$/,
  /^copilot\/sessions\/[0-9a-f-]{36}$/i,
];

const SESSION_COOKIE = 'transumin_proto_session';
const OWNER_PATTERN = /^passenger:[0-9a-f-]{36}$/;
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sessionSecret(): string | null {
  const secret = process.env.PASSENGER_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

/** ponytail: prototype session identity, not production authentication. */
function sign(owner: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${owner}.${expiresAt}`)
    .digest('base64url');
}

function verify(
  token: string,
  owner: string,
  expiresAtText: string,
  secret: string,
): boolean {
  if (!/^[0-9]{1,12}$/.test(expiresAtText)) return false;
  const expiresAt = Number(expiresAtText);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + SESSION_TTL_SECONDS
  )
    return false;
  const expected = sign(owner, expiresAt, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionValue(owner: string, secret: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${owner}.${expiresAt}.${sign(owner, expiresAt, secret)}`;
}

/**
 * Server-derived identity. The browser never supplies the owner value:
 * a first visitor gets a minted HttpOnly cookie; later requests reuse the
 * signed cookie. Fail-closed when PASSENGER_SESSION_SECRET is absent.
 */
function isStreamResource(resource: string): boolean {
  return resource.endsWith('/alerts/stream');
}

function ownerFor(
  request: NextRequest,
  secret: string,
): { owner: string; mintNew: boolean } {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookieValue) {
    const parts = cookieValue.split('.');
    const owner = parts[0] ?? '';
    const expiresAt = parts[1] ?? '';
    const signature = parts[2] ?? '';
    if (
      parts.length === 3 &&
      verify(signature, owner, expiresAt, secret) &&
      OWNER_PATTERN.test(owner)
    )
      return { owner, mintNew: false };
    return { owner: '', mintNew: false }; // invalid cookie: refuse
  }
  return { owner: `passenger:${randomUUID()}`, mintNew: true };
}

async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const resource = path.join('/');
  // CONTROLLED verification never via passenger proxy; only direct internal endpoint.
  if (
    resource === 'controlled/passenger-reports' ||
    resource.startsWith('controlled/passenger-reports/')
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message:
            'Controlled operations are not available via passenger proxy.',
        },
      },
      { status: 403 },
    );
  }
  if (!allowed.some((pattern) => pattern.test(resource))) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown passenger resource.' } },
      { status: 404 },
    );
  }
  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: 'OWNER_IDENTITY_UNAVAILABLE',
          message:
            'Passenger session identity is unavailable; set PASSENGER_SESSION_SECRET.',
        },
      },
      { status: 503 },
    );
  }
  let { owner, mintNew } = ownerFor(request, secret);
  const publicRead =
    request.method === 'GET' &&
    (resource === 'transit/places' || resource === 'journeys/planning-health');
  const newPlan = request.method === 'POST' && resource === 'journeys/plan';
  const renewedSession = !owner && newPlan;
  // Catalog/health reads do not establish ownership. In particular, parallel
  // startup reads must not race to overwrite the browser's session cookie.
  if (publicRead) {
    if (!owner) owner = `passenger:${randomUUID()}`;
    mintNew = false;
  } else if (renewedSession) {
    // A new search may start a NEW guest session. Never trust or reuse any
    // identity from an invalid/expired cookie, and never replay an owned write.
    owner = `passenger:${randomUUID()}`;
    mintNew = true;
  }
  if (!owner) {
    return NextResponse.json(
      { error: { code: 'INVALID_SESSION', message: 'Session is invalid.' } },
      { status: 403 },
    );
  }
  const secure = process.env.NODE_ENV === 'production';
  if (request.method !== 'GET' && !isStreamResource(resource)) {
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none')
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Cross-site request denied.' } },
        { status: 403 },
      );
    const source =
      request.headers.get('origin') ?? request.headers.get('referer');
    const host = request.headers.get('host');
    if (!source || !host)
      return NextResponse.json(
        {
          error: { code: 'FORBIDDEN', message: 'Request origin is required.' },
        },
        { status: 403 },
      );
    try {
      const sourceUrl = new URL(source);
      const expectedProtocol = secure ? 'https:' : 'http:';
      if (sourceUrl.host !== host || sourceUrl.protocol !== expectedProtocol)
        return NextResponse.json(
          {
            error: { code: 'FORBIDDEN', message: 'Cross-site request denied.' },
          },
          { status: 403 },
        );
    } catch {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Cross-site request denied.' } },
        { status: 403 },
      );
    }
  }
  const apiBase = (
    process.env.PASSENGER_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://127.0.0.1:3001/api/v1'
  ).replace(/\/$/, '');
  const isStream = resource.endsWith('/alerts/stream');
  const timeoutMs =
    resource === 'recoveries' && request.method === 'POST' ? 120_000 : 30_000;
  const upstreamHeaders = new Headers();
  upstreamHeaders.set(
    'accept',
    isStream ? 'text/event-stream' : 'application/json',
  );
  const serviceToken = process.env.PASSENGER_SERVICE_TOKEN;
  if (!serviceToken || serviceToken.length < 32)
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_IDENTITY_UNAVAILABLE',
          message: 'Passenger service identity is unavailable.',
        },
      },
      { status: 503 },
    );
  upstreamHeaders.set('x-passenger-service-token', serviceToken);
  upstreamHeaders.set('x-journey-owner', owner);
  const lastEventId = request.headers.get('last-event-id');
  if (isStream && lastEventId)
    upstreamHeaders.set('last-event-id', lastEventId);
  const key = request.headers.get('idempotency-key');
  if (key) upstreamHeaders.set('idempotency-key', key);
  let body: string | undefined;
  if (request.method !== 'GET') {
    body = await request.text();
    if (body.length > 262_144) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_PARAMETER',
            message: 'Request is too large.',
          },
        },
        { status: 413 },
      );
    }
    upstreamHeaders.set('content-type', 'application/json');
  }
  try {
    const upstream = new URL(`${apiBase}/${resource}`);
    if (resource === 'transit/places' || resource === 'passenger-reports')
      upstream.search = request.nextUrl.search;
    const response = await fetch(upstream, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      cache: 'no-store',
      signal: isStream ? request.signal : AbortSignal.timeout(timeoutMs),
    });
    if (isStream && response.ok && response.body) {
      const streamed = new NextResponse(response.body, {
        status: response.status,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
        },
      });
      if (mintNew)
        streamed.cookies.set(SESSION_COOKIE, sessionValue(owner, secret), {
          httpOnly: true,
          secure,
          sameSite: 'strict',
          path: '/',
          maxAge: SESSION_TTL_SECONDS,
        });
      return streamed;
    }
    const responseHeaders = new Headers({
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    if (renewedSession)
      responseHeaders.set('x-passenger-session-renewed', 'true');
    if (resource === 'passenger-reports' && response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter && /^(0|[1-9][0-9]*)$/.test(retryAfter))
        responseHeaders.set('retry-after', retryAfter);
    }
    const result = new NextResponse(await response.text(), {
      status: response.status,
      headers: responseHeaders,
    });
    if (mintNew)
      result.cookies.set(SESSION_COOKIE, sessionValue(owner, secret), {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_SECONDS,
      });
    return result;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'ROUTER_UNAVAILABLE',
          message: 'Passenger service is temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
