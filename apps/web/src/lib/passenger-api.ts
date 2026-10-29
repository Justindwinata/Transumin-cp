import type {
  Journey,
  JourneyAlert,
  PassengerReport,
  Recovery,
  RecoveryAcceptance,
  TransitPlace,
} from './passenger';

type Envelope<T> = { data: T; meta?: unknown };

export async function reportAttemptHash(input: object): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class PassengerApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  constructor(
    code: string,
    message: string,
    status: number,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const mutation = method !== 'GET';
  const controller = new AbortController();
  const external = options.signal;
  const cancel = () => controller.abort(external?.reason);
  if (external?.aborted) cancel();
  else external?.addEventListener('abort', cancel, { once: true });
  // ponytail: proxy deadlines are 30s/120s; no automatic mutation retry.
  // Timeout cannot prove whether a write committed. Reconcile stored state.
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out.', 'TimeoutError')),
    path === 'recoveries' && method === 'POST' ? 125_000 : 35_000,
  );
  try {
    const response = await fetch(`/api/passenger/${path}`, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      controller.signal.throwIfAborted();
      if (!(cause instanceof SyntaxError)) throw cause;
      if (response.ok)
        throw new PassengerApiError(
          'INVALID_RESPONSE',
          'Server returned an invalid response. Reload status before retrying.',
          502,
        );
      body = null;
    }
    if (!response.ok) {
      const error = (
        body as { error?: { code?: string; message?: string } } | null
      )?.error;
      const rawRetry = response.headers.get('retry-after');
      const retryAfterSeconds =
        rawRetry !== null && /^(0|[1-9][0-9]*)$/.test(rawRetry)
          ? Math.min(parseInt(rawRetry, 10), 65535)
          : null;
      throw new PassengerApiError(
        error?.code ?? 'REQUEST_FAILED',
        error?.message ?? 'The service could not complete this request.',
        response.status,
        retryAfterSeconds,
      );
    }
    if (
      body === null ||
      typeof body !== 'object' ||
      !('data' in (body as Record<string, unknown>))
    ) {
      throw new PassengerApiError(
        'INVALID_RESPONSE',
        'Server response missing expected data. Reload status before retrying.',
        502,
      );
    }
    return (body as Envelope<T>).data;
  } catch (cause) {
    if (controller.signal.reason?.name === 'TimeoutError') {
      throw new PassengerApiError(
        'REQUEST_TIMEOUT',
        'Request timed out. Outcome is unknown. Reload status before retrying.',
        408,
      );
    }
    if (cause instanceof TypeError && !controller.signal.aborted) {
      throw new PassengerApiError(
        'NETWORK_ERROR',
        mutation
          ? 'Connection interrupted. Outcome is unknown. Reload status before retrying.'
          : 'Connection interrupted. Check your connection and retry.',
        0,
      );
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancel);
  }
}

export const passengerApi = {
  config: () => request<{ network_snapshot_id: string }>('config'),
  planningHealth: () =>
    request<{
      status: 'AVAILABLE' | 'UNAVAILABLE';
      provider: 'OTP';
      version: string;
      checked_at: string;
      latency_milliseconds: number;
    }>('journeys/planning-health'),
  places: (query: string, snapshotId: string, signal?: AbortSignal) =>
    request<TransitPlace[]>(
      `transit/places?q=${encodeURIComponent(query)}&snapshot_id=${encodeURIComponent(snapshotId)}`,
      { signal },
    ),
  plan: (input: object, signal?: AbortSignal) =>
    request<Journey[]>('journeys/plan', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  activate: (journey: Journey, idempotencyKey: string, activatedAt?: string) =>
    request<Journey>(`journeys/${journey.journey_id}/activate`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        selected_journey: journey,
        ...(activatedAt ? { activated_at: activatedAt } : {}),
      }),
    }),
  getJourney: (id: string, signal?: AbortSignal) =>
    request<Journey>(`journeys/${id}`, { signal }),
  progress: (
    id: string,
    completed: number,
    total: number,
    recordedAt: string,
    acceptedRecoveryId?: string | null,
  ) =>
    request<Journey>(`journeys/${id}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({
        completed_segment_count: completed,
        current_segment_sequence: completed < total ? completed : null,
        recorded_at: recordedAt,
        accepted_recovery_id: acceptedRecoveryId,
      }),
    }),
  confirmBoarding: (
    id: string,
    leg: number,
    confirmedAt: string,
    acceptedRecoveryId: string | null,
  ) =>
    request<Journey>(`journeys/${id}/boarding/${leg}`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed_at: confirmedAt,
        accepted_recovery_id: acceptedRecoveryId,
      }),
    }),
  confirmAlighting: (
    id: string,
    leg: number,
    confirmedAt: string,
    acceptedRecoveryId: string | null,
  ) =>
    request<Journey>(`journeys/${id}/alighting/${leg}`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed_at: confirmedAt,
        accepted_recovery_id: acceptedRecoveryId,
      }),
    }),
  alerts: (id: string) => request<JourneyAlert[]>(`journeys/${id}/alerts`),
  streamAlerts: async (
    id: string,
    lastEventId: string | null,
    signal: AbortSignal,
    onEvent: (event: { id: string | null; type: string }) => void,
    onOpen: () => void,
  ): Promise<void> => {
    const response = await fetch(
      `/api/passenger/journeys/${id}/alerts/stream`,
      {
        headers: {
          accept: 'text/event-stream',
          ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
        },
        cache: 'no-store',
        signal,
      },
    );
    if (!response.ok || !response.body)
      throw new PassengerApiError(
        'STREAM_UNAVAILABLE',
        'Live journey updates are temporarily unavailable.',
        response.status,
      );
    onOpen();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder
          .decode(value, { stream: true })
          .replaceAll('\r\n', '\n');
        if (buffer.length > 65_536)
          throw new Error('Journey event exceeded its size limit.');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const idLine = frame
            .split('\n')
            .find((line) => line.startsWith('id:'));
          const eventLine = frame
            .split('\n')
            .find((line) => line.startsWith('event:'));
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) {
            const payload = JSON.parse(data) as { type?: string };
            onEvent({
              id: idLine?.slice(3).trim() ?? null,
              type: eventLine?.slice(6).trim() ?? payload.type ?? 'message',
            });
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  },
  acceptRecovery: (
    id: string,
    progressRevision: number,
    key: string,
    signal?: AbortSignal,
  ) =>
    request<RecoveryAcceptance>(`recoveries/${id}/accept`, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({ progress_revision: progressRevision }),
      signal,
    }),
  recovery: (
    journeyId: string,
    impactId: string,
    key: string,
    recoveryAt: string,
    signal?: AbortSignal,
  ) =>
    request<Recovery>('recoveries', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        original_journey_id: journeyId,
        impact_id: impactId,
        recovery_at: recoveryAt,
      }),
      signal,
    }),
  getRecovery: (id: string, signal?: AbortSignal) =>
    request<Recovery>(`recoveries/${id}`, { signal }),
  reconcileRecovery: async (
    journeyId: string,
    recoveryId: string,
    signal?: AbortSignal,
  ) => {
    // Successive reads, no blind mutation: the stored acceptance is source of
    // truth, and the matching proposal belongs to that journey pointer.
    const journey = await request<Journey>(`journeys/${journeyId}`, { signal });
    if (journey.accepted_recovery_id === recoveryId) {
      const recovery = await request<Recovery>(`recoveries/${recoveryId}`, {
        signal,
      });
      if (recovery.original_journey_id !== journey.journey_id)
        throw new PassengerApiError(
          'RECOVERY_MISMATCH',
          'Recovery belongs to a different journey.',
          409,
        );
      return { journey, recovery };
    }
    return {
      journey,
      recovery: await request<Recovery>(`recoveries/${recoveryId}`, { signal }),
    };
  },
  submitReport: (
    input: {
      active_journey_id: string | null;
      category: string;
      observed_at: string;
      mobility_entity_id: string;
      entity_type: string;
      description: string;
    },
    idempotencyKey: string,
  ) =>
    request<PassengerReport>('passenger-reports', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  listReports: (journeyId: string) =>
    request<PassengerReport[]>(
      `passenger-reports?active_journey_id=${encodeURIComponent(journeyId)}`,
    ),
  lookupReport: (idempotencyKey: string) =>
    request<PassengerReport | null>(
      `passenger-reports?idempotency_key=${encodeURIComponent(idempotencyKey)}`,
    ),
  getReport: (id: string) =>
    request<PassengerReport>(`passenger-reports/${id}`),
};

// G1-A identity guards. Pure and deterministic so they are unit-testable
// without a DOM: request ids are monotonic per client, and journey identity
// is (journey_id, progress.revision, accepted_recovery_id). A recovery POST
// does not advance progress.revision, so accepted_recovery_id is required to
// tell a fresh proposal apart from one already accepted.
export type RecoverySource = {
  journeyId: string;
  revision: number;
  acceptedRecoveryId: string | null;
};

export function recoverySource(
  journey: Pick<Journey, 'journey_id' | 'accepted_recovery_id' | 'progress'>,
): RecoverySource {
  return {
    journeyId: journey.journey_id,
    revision: journey.progress?.revision ?? 0,
    acceptedRecoveryId: journey.accepted_recovery_id ?? null,
  };
}

export function sameRecoverySource(
  a: RecoverySource,
  b: RecoverySource,
): boolean {
  return (
    a.journeyId === b.journeyId &&
    a.revision === b.revision &&
    a.acceptedRecoveryId === b.acceptedRecoveryId
  );
}

// Commit guard for proposal/acceptance: the response may only be applied when
// it is still the newest request, the journey generation is unchanged, and the
// live journey still matches the source captured before the request went out.
export function canCommitRecovery(input: {
  requestId: number;
  latestRequestId: number;
  generation: number;
  latestGeneration: number;
  captured: RecoverySource;
  latest: RecoverySource | null;
}): boolean {
  return (
    input.requestId === input.latestRequestId &&
    input.generation === input.latestGeneration &&
    input.latest !== null &&
    sameRecoverySource(input.captured, input.latest)
  );
}

// Idempotency key: progress revision alone is not enough because accepting a
// recovery leaves revision unchanged, so the accepted recovery pointer (or
// the G0 sentinel for the original plan) scopes the key.
export function recoveryProposalKey(input: {
  journeyId: string;
  impactId: string;
  revision: number;
  acceptedRecoveryId: string | null;
  attemptNonce?: number | null;
}): string {
  const base = `passenger:${input.journeyId}:${input.impactId}:${input.revision}:${input.acceptedRecoveryId ?? 'G0'}`;
  return input.attemptNonce == null || input.attemptNonce === 0
    ? base
    : `${base}:attempt-${input.attemptNonce}`;
}

export type RecoveryAttempt = { nonce: number; known: boolean };

// Fresh computation is opt-in and only follows a known outcome. Unknown writes
// (including proxy 5xx, aborts and invalid responses) must replay identical input.
export function nextRecoveryAttempt(
  prior: RecoveryAttempt | null,
  fresh: boolean,
): RecoveryAttempt {
  if (fresh && !prior?.known)
    throw new Error(
      'Hasil recovery belum pasti. Coba lagi dengan identitas yang sama.',
    );
  return { nonce: (prior?.nonce ?? 0) + (fresh ? 1 : 0), known: false };
}

// After an uncertain acceptance POST, reconcile from an authoritative journey
// read instead of assuming failure. APPLIED means the source of truth already
// points at this recovery; NOT_APPLIED means a safe idempotent retry; UNKNOWN
// means the read itself did not resolve.
export function acceptanceReconcileOutcome(input: {
  journey: { accepted_recovery_id?: string | null } | null;
  recoveryId: string;
}): 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN' {
  if (!input.journey) return 'UNKNOWN';
  return input.journey.accepted_recovery_id === input.recoveryId
    ? 'APPLIED'
    : 'NOT_APPLIED';
}
