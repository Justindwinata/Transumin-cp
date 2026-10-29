// FR-011 / FR-014: closed method/path/query boundary; backend enforces roles.
const uuid =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const routes: [string, RegExp][] = [
  ['GET', /^auth\/(?:me|users)$/],
  ['GET', /^admin\/passenger-reports$/],
  [
    'POST',
    new RegExp(`^admin/passenger-reports/${uuid}/(?:restrict|close)$`, 'i'),
  ],
  ['POST', /^auth\/(?:login|logout|users)$/],
  ['GET', new RegExp(`^operator-recovery/analyses/${uuid}$`, 'i')],
  ['POST', /^operator-recovery\/analyses$/],
  ['GET', new RegExp(`^network/(?:snapshots|entities)/${uuid}$`, 'i')],
  ['GET', new RegExp(`^network/snapshots/${uuid}/geometry(?:\\?.*)?$`, 'i')],
  ['GET', new RegExp(`^network/state\\?snapshot_id=${uuid}$`, 'i')],
  ['GET', /^scenarios(?:\?.*)?$/i],
  ['GET', new RegExp(`^scenarios/${uuid}$`, 'i')],
  ['POST', /^scenarios$/],
  ['POST', new RegExp(`^scenarios/${uuid}/runs$`, 'i')],
  ['GET', /^simulation-runs(?:\?.*)?$/i],
  ['GET', new RegExp(`^simulation-runs/${uuid}(?:/impact)?$`, 'i')],
  ['GET', /^experiments(?:\?.*)?$/i],
  [
    'GET',
    new RegExp(`^disruption-events/${uuid}/impact\\?snapshot_id=${uuid}$`, 'i'),
  ],
];
export function allowedResource(method: string, resource: string): boolean {
  const [path, query] = resource.split('?', 2);
  if (
    !path ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return false;
  const candidate = query === undefined ? path : `${path}?${query}`;
  return routes.some(
    ([verb, pattern]) => method === verb && pattern.test(candidate),
  );
}
export function apiBase(configured = 'http://127.0.0.1:3001/api/v1'): string {
  const url = new URL(configured);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname.replace(/\/$/, '') !== '/api/v1' ||
    url.search ||
    url.hash
  )
    throw new Error('API base must be loopback HTTP /api/v1.');
  return url.toString().replace(/\/$/, '');
}
export function originAllowed(
  origin: string | null,
  host: string | null,
  production: boolean,
): boolean {
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    return (
      source.origin === `${production ? 'https:' : 'http:'}//${host}` &&
      source.href === `${source.origin}/`
    );
  } catch {
    return false;
  }
}
export function sessionCookie(raw: string | null): string | null {
  const values = (raw ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('tnx_session='));
  if (!values.length) return null;
  if (values.length !== 1 || !/^tnx_session=[0-9a-f]{64}$/i.test(values[0]!))
    throw new Error('Invalid session cookie.');
  return values[0]!;
}
export function rewrittenSessionCookie(
  raw: string,
  production: boolean,
): string | null {
  if (!raw.startsWith('tnx_session=')) return null;
  const value = raw.split(';')[0]!.slice('tnx_session='.length);
  if (value && !/^[0-9a-f]{64}$/i.test(value))
    throw new Error('Invalid upstream session cookie.');
  return `tnx_session=${value}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=${value ? 43200 : 0}${production ? '; Secure' : ''}`;
}
