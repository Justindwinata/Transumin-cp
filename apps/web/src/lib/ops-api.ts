// FR-011 thin wrappers over real API routes; no proxy mutation.
// Read paths mirror apps/api/src/disruption/interface/disruption-intelligence.controller.ts
// and apps/api/src/auth/auth.controller.ts (GET auth/me, cookie tnx_session).
//
// Same-origin proxy forwards only opaque session cookie; backend enforces roles.

import type {
  OperatorPrincipal,
  ScenarioView,
  SimulationRunView,
  ImpactView,
  NetworkSnapshotView,
  ScenarioSummary,
  RunSummary,
  GeometryView,
  NetworkStateEntityView,
} from './ops';

// Same-origin only; route is web proxy at /api/v1.
const API_BASE = '/api/v1';

// FR-011: aborted or superseded requests cannot commit stale dashboard state.
type Envelope<T> = {
  data: T;
  meta?: { next_cursor?: string | null; availability?: string };
};

async function readPage<T>(
  path: string,
  signal?: AbortSignal,
): Promise<{ data: T; nextCursor: string | null; availability?: string }> {
  const response = await fetch(`${API_BASE}/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = response.statusText;
    try {
      message =
        (JSON.parse(text) as { error?: { message?: string } }).error?.message ??
        message;
    } catch {
      if (text) message = text;
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  const parsed = (await response.json()) as Envelope<T>;
  return {
    data: parsed.data,
    nextCursor: parsed.meta?.next_cursor ?? null,
    availability: parsed.meta?.availability,
  };
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = response.statusText;
    try {
      message =
        (JSON.parse(text) as { error?: { message?: string } }).error?.message ??
        message;
    } catch {
      if (text) message = text;
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return ((await response.json()) as Envelope<T>).data;
}

async function write<T>(
  path: string,
  input: unknown,
  options?: { idempotencyKey?: string },
): Promise<T> {
  const response = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(options?.idempotencyKey
        ? { 'idempotency-key': options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = response.statusText;
    try {
      message =
        (JSON.parse(text) as { error?: { message?: string } }).error?.message ??
        message;
    } catch {
      if (text) message = text;
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return ((await response.json()) as Envelope<T>).data;
}

export type AdminReport = Readonly<{
  report_id: string;
  category: string;
  description: string;
  observed_at: string;
  received_at: string;
  entity_type: string;
  mobility_entity_id: string;
  verification_status: string;
  review_authority: string | null;
  incident_id: string | null;
  expires_at: string | null;
  lifecycle_status: string | null;
  actor_user_id: string | null;
  evidence_reference: string | null;
  restriction_active: boolean;
}>;

export const opsApi = {
  reports: (signal?: AbortSignal) =>
    read<AdminReport[]>('admin/passenger-reports', signal),
  restrictReport: (
    id: string,
    input: {
      operational_state: string;
      incident_type: string;
      reason: string;
      evidence_reference: string;
      observed_at: string;
      valid_for_minutes: number;
    },
  ) =>
    write<{ incident_id: string }>(
      `admin/passenger-reports/${id}/restrict`,
      input,
    ),
  closeReport: (
    id: string,
    decision: 'RESOLVED' | 'RETRACTED',
    reason: string,
  ) =>
    write<{ incident_id: string }>(`admin/passenger-reports/${id}/close`, {
      decision,
      reason,
    }),
  me: (signal?: AbortSignal) => read<OperatorPrincipal>('auth/me', signal),
  login: async (
    email: string,
    password: string,
  ): Promise<OperatorPrincipal> => {
    const result = await write<{ user: OperatorPrincipal }>('auth/login', {
      email,
      password,
    });
    return result.user;
  },
  logout: () => write<{ logged_out: boolean }>('auth/logout', {}),
  provision: (email: string, password: string, roles: string[]) =>
    write<{ id: string; email: string; roles: string[] }>('auth/users', {
      email,
      password,
      roles,
    }),
  users: (signal?: AbortSignal) =>
    read<Array<{ id: string; email: string; roles: string[] }>>(
      'auth/users',
      signal,
    ),
  listScenarios: (
    params?: { limit?: number; cursor?: string },
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return readPage<ScenarioSummary[]>(`scenarios${suffix}`, signal);
  },
  listRuns: (
    params?: { limit?: number; cursor?: string },
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return readPage<RunSummary[]>(`simulation-runs${suffix}`, signal);
  },
  listExperiments: (
    params?: { limit?: number; cursor?: string },
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return readPage<unknown[]>(`experiments${suffix}`, signal);
  },
  createScenario: (input: {
    name: string;
    description?: string;
    actions: Array<{
      mobility_entity_id: string;
      action_type: string;
      availability?: string;
      reason: string;
      parameters?: Record<string, unknown>;
    }>;
  }) => write<ScenarioSummary>('scenarios', input),
  createRun: (
    scenarioId: string,
    input: {
      network_snapshot_id: string;
      configuration: Record<string, unknown>;
    },
    idempotencyKey: string,
  ) =>
    write<SimulationRunView>(
      `scenarios/${encodeURIComponent(scenarioId)}/runs`,
      input,
      { idempotencyKey },
    ),
  compareImpacts: (runIds: string[], signal?: AbortSignal) =>
    Promise.all(
      runIds.map((id) =>
        read<ImpactView>(
          `simulation-runs/${encodeURIComponent(id)}/impact`,
          signal,
        ),
      ),
    ),
  geometry: (snapshotId: string, bbox?: string, signal?: AbortSignal) => {
    const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : '';
    return read<GeometryView>(
      `network/snapshots/${encodeURIComponent(snapshotId)}/geometry${q}`,
      signal,
    );
  },
  scenario: (id: string, signal?: AbortSignal) =>
    read<ScenarioView>(`scenarios/${encodeURIComponent(id)}`, signal),
  run: (id: string, signal?: AbortSignal) =>
    read<SimulationRunView>(
      `simulation-runs/${encodeURIComponent(id)}`,
      signal,
    ),
  runImpact: (id: string, signal?: AbortSignal) =>
    read<ImpactView>(
      `simulation-runs/${encodeURIComponent(id)}/impact`,
      signal,
    ),
  disruptionImpact: (
    eventId: string,
    snapshotId: string,
    signal?: AbortSignal,
  ) =>
    read<ImpactView>(
      `disruption-events/${encodeURIComponent(eventId)}/impact?snapshot_id=${encodeURIComponent(snapshotId)}`,
      signal,
    ),
  networkSnapshot: (snapshotId: string, signal?: AbortSignal) =>
    read<NetworkSnapshotView>(
      `network/snapshots/${encodeURIComponent(snapshotId)}`,
      signal,
    ),
  networkState: (snapshotId: string, signal?: AbortSignal) =>
    read<{ network_snapshot_id: string; entities: NetworkStateEntityView[] }>(
      `network/state?snapshot_id=${encodeURIComponent(snapshotId)}`,
      signal,
    ),
};
