import type { components } from '@transum-in/shared-types';

export type Journey = components['schemas']['Journey'];
export type JourneySegment = components['schemas']['JourneySegment'];
export type JourneyAlert = components['schemas']['JourneyAlert'];
export type RecoveryAcceptance = components['schemas']['RecoveryAcceptance'];
export type Recovery = components['schemas']['Recovery'];
export type TransitPlace = components['schemas']['TransitPlace'];

export function recoveryComparisonSource(
  active: Journey | null,
  recovery: Recovery | null,
  captured: { recoveryId: string; journey: Journey } | null,
): Journey | null {
  if (
    !active ||
    !recovery ||
    active.journey_id !== recovery.original_journey_id
  )
    return null;
  if (
    captured?.recoveryId === recovery.recovery_id &&
    captured.journey.journey_id === recovery.original_journey_id
  )
    return captured.journey;
  // Accepted refresh has no proposal-source lineage, especially after R2+.
  if (
    recovery.accepted ||
    active.accepted_recovery_id === recovery.recovery_id ||
    active.progress?.revision !== recovery.progress_revision
  )
    return null;
  return active;
}

export function canReplayPendingReport(
  pendingKey: string | null,
  localAttemptKey: string | null,
  targetAvailable: boolean,
): boolean {
  return (
    pendingKey !== null && pendingKey === localAttemptKey && targetAvailable
  );
}
export type PassengerReport = Readonly<{
  report_id: string;
  active_journey_id: string | null;
  category: string;
  observed_at: string;
  received_at: string;
  mobility_entity_id: string;
  entity_type: 'STOP' | 'STATION' | 'ROUTE';
  description: string;
  source: 'PASSENGER_SELF_REPORT';
  verification_status:
    'REPORTED_UNVERIFIED' | 'CONTROLLED_VERIFIED' | 'ADMIN_RESTRICTED';
  created_at: string;
}>;

export function passengerReportCategoryLabel(category: string): string {
  const labels: Readonly<Record<string, string>> = {
    CLEANLINESS: 'Kebersihan',
    CROWDING: 'Kepadatan',
    ACCESSIBILITY: 'Aksesibilitas',
    SAFETY: 'Keselamatan',
    SERVICE: 'Layanan',
    OTHER: 'Lainnya',
  };
  return Object.hasOwn(labels, category) ? labels[category]! : 'Laporan';
}

/** Review history is distinct from a currently active operational restriction. */
export function passengerReportStatusLabel(status: string): string {
  if (status === 'REPORTED_UNVERIFIED') return 'Belum diverifikasi';
  if (status === 'CONTROLLED_VERIFIED') return 'SIMULASI: ditinjau terkontrol';
  if (status === 'ADMIN_RESTRICTED')
    return 'Diperiksa admin (pembatasan sementara)';
  return 'Status pemeriksaan belum tersedia';
}

export type PassengerReportTarget = Readonly<{
  key: string;
  id: string;
  type: 'STOP' | 'STATION' | 'ROUTE';
  label: string;
  provenance: string;
}>;

export function remainingReportTargets(
  journey: Journey,
  completedCount: number,
): PassengerReportTarget[] {
  const entityLabels: Record<string, string> = {
    STOP: 'Halte',
    STATION: 'Stasiun',
    ROUTE: 'Trayek',
  };
  const remaining = journey.segments.filter(
    (segment) => segment.sequence >= completedCount,
  );
  const byKey = new Map<string, PassengerReportTarget>();
  for (const segment of remaining) {
    for (const binding of segment.entity_bindings) {
      if (
        !binding.mobility_entity_id ||
        !['STOP', 'STATION', 'ROUTE'].includes(binding.entity_type)
      )
        continue;
      const key = `${binding.mobility_entity_id}:${binding.entity_type}`;
      if (byKey.has(key)) continue;
      const endpoint = [segment.from, segment.to].find(
        (point) =>
          point.otp_stop_id && point.otp_stop_id === binding.otp_entity_id,
      );
      const label =
        binding.entity_type === 'ROUTE'
          ? `${passengerRouteName(segment) || modeName(segment.mode)} · ${entityLabels[binding.entity_type] ?? binding.entity_type}`
          : endpoint
            ? `${endpoint.name} · ${entityLabels[binding.entity_type] ?? binding.entity_type}`
            : `${segment.from.name} – ${segment.to.name} · ${entityLabels[binding.entity_type] ?? binding.entity_type} · kode ${binding.otp_entity_id || binding.mobility_entity_id}`;
      byKey.set(key, {
        key,
        id: binding.mobility_entity_id,
        type: binding.entity_type as PassengerReportTarget['type'],
        label,
        provenance: binding.provenance_ref || 'provenance: tidak tersedia',
      });
    }
  }
  return [...byKey.values()];
}

export function isValidReportDescription(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 1 && trimmed.length <= 2000 && !/\p{Cc}/u.test(value)
  );
}

const names: Record<JourneySegment['mode'], string> = {
  WALK: 'Jalan kaki',
  TRANSJAKARTA: 'TransJakarta',
  MIKROTRANS: 'Mikrotrans',
  KRL: 'KRL Commuter Line',
  MRT_JAKARTA: 'MRT Jakarta',
  LRT_JAKARTA: 'LRT Jakarta',
  LRT_JABODEBEK: 'LRT Jabodebek',
};

export function modeName(mode: JourneySegment['mode']): string {
  return names[mode];
}

export type JourneyPreference =
  'BALANCED' | 'FASTEST' | 'FEWEST_TRANSFERS' | 'LEAST_WALKING';

const preferenceNames: Record<JourneyPreference, string> = {
  BALANCED: 'Seimbang',
  FASTEST: 'Tercepat',
  FEWEST_TRANSFERS: 'Paling sedikit pindah',
  LEAST_WALKING: 'Paling sedikit berjalan',
};

export type RankingFingerprint = Readonly<{
  journey_id: string;
  duration_seconds: number;
  walking_distance_meters: number;
  transfer_count: number;
}>;

export function rankingFingerprint(journey: Journey): RankingFingerprint {
  return {
    journey_id: journey.journey_id,
    duration_seconds: journey.duration_seconds,
    walking_distance_meters: journey.walking_distance_meters,
    transfer_count: journey.transfer_count,
  };
}

export function sameRankingCandidate(
  left: RankingFingerprint,
  right: RankingFingerprint,
): boolean {
  return (
    left.journey_id === right.journey_id &&
    left.duration_seconds === right.duration_seconds &&
    left.walking_distance_meters === right.walking_distance_meters &&
    left.transfer_count === right.transfer_count
  );
}

// Honest note when the server returns the identical best candidate under two
// distinct preferences: the calculations differ, the chosen journey does not.
export function rankingExplanation(
  previous: JourneyPreference,
  next: JourneyPreference,
  candidate: RankingFingerprint,
  candidateCount: number,
): string {
  return (
    `Rute terbaik untuk ${preferenceNames[previous]} dan ${preferenceNames[next]} sama. ` +
    `Seimbang mempertimbangkan waktu, jarak berjalan, dan jumlah pindah; pilihan lain mengutamakan metriknya masing-masing. ` +
    `${candidateCount} pilihan ditampilkan: ${formatDuration(candidate.duration_seconds)}, ` +
    `${formatDistance(candidate.walking_distance_meters)} berjalan, ${transferLabel(candidate.transfer_count)}.`
  );
}

export function easiestAmongShown(journeys: readonly Journey[]): string[] {
  const valid = journeys.filter(
    (journey) =>
      Number.isInteger(journey.transfer_count) &&
      journey.transfer_count >= 0 &&
      Number.isFinite(journey.walking_distance_meters) &&
      journey.walking_distance_meters >= 0,
  );
  if (valid.length === 0) return [];
  // Product-only heuristic: fewest transfers, then least walking; no weighted research metric.
  const transfers = Math.min(...valid.map((journey) => journey.transfer_count));
  const simplest = valid.filter(
    (journey) => journey.transfer_count === transfers,
  );
  const walking = Math.min(
    ...simplest.map((journey) => journey.walking_distance_meters),
  );
  return simplest
    .filter((journey) => journey.walking_distance_meters === walking)
    .map((journey) => journey.journey_id);
}

export function passengerRouteName(segment: JourneySegment): string {
  const value = segment.route_short_name?.trim() ?? '';
  return value === segment.mode ? '' : value;
}

export function transferLabel(count: number): string {
  return `${count} kali pindah`;
}

export function formatClock(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  return `${Math.floor(minutes / 60)} jam ${minutes % 60} menit`;
}

export function formatDistance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

export function toJakartaIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(local))
    throw new Error('Pilih tanggal dan waktu keberangkatan yang valid.');
  const value = `${local.length === 16 ? `${local}:00` : local}+07:00`;
  if (!Number.isFinite(Date.parse(value)))
    throw new Error('Pilih tanggal dan waktu keberangkatan yang valid.');
  return value;
}

export function initialJakartaDateTime(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Restore the persisted journey clock, never the device's wall clock.
 * Historical replay cannot advance into today's unsupported service date. */
export function journeyProgressDateTime(journey: Journey): string {
  const recorded = journey.progress?.recorded_at ?? journey.start_at;
  const date = new Date(recorded);
  const minutes = initialJakartaDateTime(date);
  const seconds = date.getUTCSeconds();
  const millis = date.getUTCMilliseconds();
  return seconds || millis
    ? `${minutes}:${String(seconds).padStart(2, '0')}${millis ? `.${String(millis).padStart(3, '0')}` : ''}`
    : minutes;
}

export function parsePoint(
  latitude: string,
  longitude: string,
): { latitude: number; longitude: number } {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (
    !latitude.trim() ||
    !longitude.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error(
      'Masukkan lintang dan bujur yang valid untuk kedua lokasi.',
    );
  }
  return { latitude: lat, longitude: lon };
}

export function segmentPosition(
  sequence: number,
  completedCount: number,
): 'completed' | 'current' | 'upcoming' {
  if (sequence < completedCount) return 'completed';
  if (sequence === completedCount) return 'current';
  return 'upcoming';
}

export function alertIsCurrent(alert: JourneyAlert, at = Date.now()): boolean {
  return (
    alert.resolved_at === null &&
    alert.freshness_status !== 'EXPIRED' &&
    (alert.expires_at === null || Date.parse(alert.expires_at) > at)
  );
}

export function operationalStateLabel(state: string): string {
  const labels: Readonly<Record<string, string>> = {
    AVAILABLE: 'Tersedia',
    DEGRADED: 'Layanan terbatas',
    DISRUPTED: 'Layanan terganggu',
    UNAVAILABLE: 'Tidak dapat digunakan',
    RECOVERING: 'Sedang dipulihkan',
    UNKNOWN: 'Status belum diketahui',
  };
  return Object.hasOwn(labels, state)
    ? labels[state]!
    : 'Status belum diketahui';
}

export function freshnessLabel(state: string): string {
  const labels: Readonly<Record<string, string>> = {
    FRESH: 'Masih segar',
    STALE: 'Perlu diperbarui',
    EXPIRED: 'Sudah kedaluwarsa',
  };
  return Object.hasOwn(labels, state)
    ? labels[state]!
    : 'Waktu pembaruan belum pasti';
}

export function evidenceLabel(evidence: string | null): string {
  switch (evidence) {
    case 'LIVE':
      return 'Informasi langsung dari operator';
    case 'OBSERVED':
      return 'Laporan pengamatan';
    case 'SIMULATED':
      return 'SIMULASI terkontrol';
    case 'FORECAST':
      return 'Prakiraan';
    case 'SCHEDULED':
      return 'Data jadwal';
    case 'ESTIMATED':
      return 'Perkiraan';
    default:
      return 'Bukti belum dikonfirmasi';
  }
}

export function distinctModes(journey: Journey): JourneySegment['mode'][] {
  return [...new Set(journey.segments.map((segment) => segment.mode))];
}

export function recoveryPart(
  sequence: number,
  recovery: Recovery,
): 'COMPLETED' | 'PRESERVED' | 'INVALIDATED' | 'REJOINED' | 'REPLACED' {
  if (recovery.completed_segments.includes(sequence)) return 'COMPLETED';
  if (recovery.rejoined_segments.includes(sequence)) return 'REJOINED';
  if (recovery.preserved_segments.includes(sequence)) return 'PRESERVED';
  if (recovery.invalidated_segments.includes(sequence)) return 'INVALIDATED';
  return 'REPLACED';
}

export function recoveryPartLabel(
  part: ReturnType<typeof recoveryPart>,
): string {
  return {
    COMPLETED: 'Sudah dilalui',
    PRESERVED: 'Tetap digunakan',
    INVALIDATED: 'Diubah pada rute pengganti',
    REJOINED: 'Kembali ke rute awal',
    REPLACED: 'Diganti rute baru',
  }[part];
}

export function samePassengerLeg(
  left: JourneySegment,
  right: JourneySegment,
): boolean {
  return (
    left.mode === right.mode &&
    left.route_id === right.route_id &&
    left.from.name === right.from.name &&
    left.to.name === right.to.name &&
    left.start_at === right.start_at &&
    left.end_at === right.end_at
  );
}

export function recoverySummary(recovery: Recovery): string {
  if (recovery.status !== 'COMPLETED' || !recovery.proposed_journey)
    return 'Belum ada rute pengganti yang memenuhi pemeriksaan sistem. Rencana awal Anda tidak berubah.';
  const kept =
    recovery.preserved_segments.length + recovery.rejoined_segments.length;
  const parts = [
    `Mempertahankan ${kept} tahap sisa perjalanan`,
    recovery.additional_duration_seconds === null
      ? 'selisih waktu belum diketahui'
      : `${recovery.additional_duration_seconds >= 0 ? '+' : '−'}${formatDuration(Math.abs(recovery.additional_duration_seconds))}`,
    recovery.additional_transfers === null
      ? 'selisih jumlah pindah belum diketahui'
      : recovery.additional_transfers === 0
        ? 'tanpa tambahan pindah'
        : `${recovery.additional_transfers > 0 ? '+' : ''}${recovery.additional_transfers} kali pindah`,
  ];
  return parts.join(' · ');
}

export function errorMessage(error: unknown): string {
  const coded = error as { status?: number; code?: string } | null;
  const routingMessages: Readonly<Record<string, string>> = {
    ROUTER_UNAVAILABLE:
      'Pencarian rute sedang tidak tersedia. Tunggu sebentar lalu coba lagi.',
    NO_RECOVERY_PATH:
      'Rute pengganti belum ditemukan. Coba lagi atau pilih layanan lain di bawah.',
    INVALID_TIME:
      'Tanggal atau waktu berada di luar cakupan jadwal uji. Gunakan tanggal pada keterangan jadwal historis.',
    ORIGIN_UNRESOLVED:
      'Titik awal belum terhubung ke jaringan transportasi. Geser titik peta ke akses jalan atau pemberhentian terdekat.',
    DESTINATION_UNRESOLVED:
      'Tujuan belum terhubung ke jaringan transportasi. Geser titik peta ke akses jalan atau pemberhentian terdekat.',
    DATASET_NOT_READY:
      'Data transportasi belum siap. Coba lagi setelah layanan pencarian tersedia.',
    IDENTITY_UNRESOLVED:
      'Lokasi atau layanan pada rute belum dapat dicocokkan dengan data transportasi. Coba titik atau rute lain.',
    INVALID_RESPONSE:
      'Respons server belum dapat dibaca. Muat ulang status sebelum mengulangi tindakan.',
  };
  if (coded?.code && Object.hasOwn(routingMessages, coded.code))
    return routingMessages[coded.code]!;
  if (coded?.status === 401 || coded?.code === 'INVALID_SESSION')
    return 'Sesi sudah berakhir. Muat ulang halaman; masuk kembali jika Anda memakai akun admin.';
  if (coded?.status === 403)
    return 'Akses ditolak. Gunakan akun yang memiliki izin untuk tindakan ini.';
  if (coded?.status && coded.status >= 500)
    return 'Layanan belum dapat memproses permintaan. Tunggu sebentar lalu coba lagi.';
  if (coded?.status === 429)
    return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
  if (error instanceof TypeError)
    return 'Koneksi ke server terputus. Periksa koneksi lalu coba lagi.';
  if (error instanceof Error) return error.message;
  return 'Permintaan belum berhasil. Periksa koneksi lalu coba lagi.';
}

export function journeySearchFailure(error: unknown): {
  empty: boolean;
  message: string;
} {
  const coded = error as { code?: string; status?: number } | null;
  if (
    coded?.code === 'NO_ROUTE' ||
    coded?.code === 'NO_VALID_ROUTE_AFTER_STATE_VALIDATION'
  )
    return {
      empty: true,
      message:
        'Rute belum ditemukan. Coba waktu keberangkatan lain atau geser titik awal dan tujuan ke akses transportasi terdekat.',
    };
  if (coded?.code === 'ROUTER_UNAVAILABLE' || coded?.status === 503)
    return {
      empty: false,
      message:
        'Mesin pencarian rute belum tersedia. Coba lagi nanti; hasil perkiraan tidak digunakan sebagai pengganti.',
    };
  return { empty: false, message: errorMessage(error) };
}
