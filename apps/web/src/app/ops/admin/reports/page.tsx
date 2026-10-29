'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { opsApi, type AdminReport } from '../../../../lib/ops-api';
import { errorMessage } from '../../../../lib/passenger';

const labels: Record<string, string> = {
  CLEANLINESS: 'Kebersihan',
  CROWDING: 'Kepadatan',
  ACCESSIBILITY: 'Aksesibilitas',
  SAFETY: 'Keselamatan',
  SERVICE: 'Layanan',
  OTHER: 'Lainnya',
  STOP: 'Halte',
  STATION: 'Stasiun',
  ROUTE: 'Trayek',
  REPORTED_UNVERIFIED: 'Menunggu pemeriksaan',
  ADMIN_RESTRICTED: 'Dibatasi oleh admin',
  CONTROLLED_VERIFIED: 'SIMULASI terverifikasi',
  ADMIN_FIELD_REVIEW: 'Bukti lapangan yang diperiksa admin',
};
const label = (value: string | null) =>
  value ? (labels[value] ?? value) : 'Belum tersedia';
function waktu(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta',
      }).format(parsed) + ' WIB'
    : 'Waktu belum tersedia';
}

export default function AdminReports() {
  const [rows, setRows] = useState<AdminReport[]>([]);
  const [status, setStatus] = useState('Memeriksa sesi admin…');
  const [allowed, setAllowed] = useState(false);
  const [selected, setSelected] = useState<AdminReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('ALL');
  const pending = rows.filter(
    (row) => row.verification_status === 'REPORTED_UNVERIFIED',
  );
  const restricted = rows.filter((row) => row.restriction_active);
  const visibleRows = rows.filter(
    (row) =>
      filter === 'ALL' ||
      (filter === 'PENDING'
        ? row.verification_status === 'REPORTED_UNVERIFIED'
        : row.restriction_active),
  );
  async function refresh() {
    setRows(await opsApi.reports());
  }
  useEffect(() => {
    const controller = new AbortController();
    void opsApi
      .me(controller.signal)
      .then(async (principal) => {
        if (!principal.roles.includes('ADMIN'))
          throw new Error('Halaman ini memerlukan akses admin.');
        const reports = await opsApi.reports(controller.signal);
        if (!controller.signal.aborted) {
          setRows(reports);
          setAllowed(true);
          setStatus('');
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setStatus(errorMessage(e));
      });
    return () => controller.abort();
  }, []);
  async function restrict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setStatus('');
    try {
      const observed = new Date(String(data.get('observed_at')));
      if (!Number.isFinite(observed.getTime()))
        throw new Error('Waktu observasi tidak valid.');
      await opsApi.restrictReport(selected.report_id, {
        operational_state: String(data.get('state')),
        incident_type: String(data.get('incident_type')),
        evidence_reference: String(data.get('evidence_reference')),
        observed_at: observed.toISOString(),
        valid_for_minutes: Number(data.get('minutes')),
        reason,
      });
      await refresh();
      setSelected(null);
      setReason('');
      setStatus(
        'Pembatasan sementara tersimpan. Periksa masa berlaku; ini verifikasi admin, bukan konfirmasi operator.',
      );
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function close(decision: 'RESOLVED' | 'RETRACTED') {
    if (!selected || busy || !reason.trim()) return;
    setBusy(true);
    setStatus('');
    try {
      await opsApi.closeReport(selected.report_id, decision, reason);
      await refresh();
      setSelected(null);
      setReason('');
      setStatus('Pembatasan diakhiri; audit tetap tersimpan.');
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-dashboard">
      <a href="/ops/admin">Kembali ke admin</a>
      <header className="admin-dashboard-header">
        <div>
          <p>TRANSUM-IN NEXUS · Admin</p>
          <h1>Verifikasi laporan penumpang</h1>
          <p>Periksa bukti, ambil keputusan, pantau masa berlaku.</p>
        </div>
        <a href="/">Buka aplikasi penumpang</a>
      </header>
      {status && <p role="status">{status}</p>}
      {!allowed ? (
        <a href="/ops/login">Masuk sebagai admin</a>
      ) : (
        <>
          <section className="admin-counts" aria-label="Ringkasan laporan">
            <button
              aria-pressed={filter === 'ALL'}
              onClick={() => setFilter('ALL')}
            >
              <strong>{rows.length}</strong> Laporan dimuat
            </button>
            <button
              aria-pressed={filter === 'PENDING'}
              onClick={() => setFilter('PENDING')}
            >
              <strong>{pending.length}</strong> Menunggu pemeriksaan
            </button>
            <button
              aria-pressed={filter === 'ACTIVE'}
              onClick={() => setFilter('ACTIVE')}
            >
              <strong>{restricted.length}</strong> Pembatasan aktif
            </button>
          </section>
          <details className="admin-policy">
            <summary>Aturan pemeriksaan</summary>
            <p>
              Maksimal 100 laporan terbaru. Bukti pengamatan harus dalam 30
              menit terakhir. Pembatasan berlaku 5–60 menit, tercatat dalam
              audit, dan bukan konfirmasi resmi operator. Akses pejalan kaki dan
              titik jemput belum divalidasi.
            </p>
          </details>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void refresh()
                .catch((e: unknown) =>
                  setStatus(
                    e instanceof Error
                      ? e.message
                      : 'Laporan gagal dimuat ulang.',
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Muat ulang laporan
          </button>
          {visibleRows.length === 0 && (
            <p>
              {rows.length === 0
                ? 'Belum ada laporan tersimpan.'
                : 'Tidak ada laporan pada filter ini.'}
            </p>
          )}
          <ul className="admin-report-list">
            {visibleRows.map((row) => (
              <li key={row.report_id}>
                <button
                  aria-label={`${label(row.category)} · ${label(row.entity_type)} · ${row.report_id}`}
                  disabled={busy}
                  onClick={() => {
                    setSelected(row);
                    setReason('');
                    setStatus('');
                  }}
                >
                  Periksa {label(row.category).toLowerCase()} ·{' '}
                  {label(row.entity_type)}
                  <span className="admin-report-code">
                    #{row.report_id.slice(0, 8)}
                  </span>
                </button>
                <p>{row.description}</p>
                <p>
                  Observasi: {waktu(row.observed_at)} ·{' '}
                  {label(row.verification_status)}
                </p>
                {row.expires_at && (
                  <p>
                    Pembatasan{' '}
                    {row.restriction_active
                      ? 'aktif saat data diperiksa'
                      : 'tidak aktif saat data diperiksa'}{' '}
                    · sampai {waktu(row.expires_at)} ·{' '}
                    {label(row.review_authority)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {selected && (
            <section
              className="admin-review-panel"
              aria-label="Pemeriksaan laporan terpilih"
            >
              <h2>Periksa laporan</h2>
              <button type="button" onClick={() => setSelected(null)}>
                Tutup pemeriksaan
              </button>
              <small>Kode laporan: {selected.report_id}</small>
              <p>{selected.description}</p>
              {selected.evidence_reference && (
                <p>Bukti: {selected.evidence_reference}</p>
              )}
              <form onSubmit={(e) => void restrict(e)}>
                <label>
                  Alasan publik (hindari data pribadi)
                  <textarea
                    required
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {selected.verification_status === 'REPORTED_UNVERIFIED' ? (
                  <>
                    <label>
                      Referensi bukti lapangan
                      <input
                        name="evidence_reference"
                        required
                        maxLength={1000}
                      />
                    </label>
                    <label>
                      Waktu observasi (waktu perangkat)
                      <input
                        type="datetime-local"
                        name="observed_at"
                        required
                      />
                    </label>
                    <label>
                      Masa berlaku (menit)
                      <input
                        type="number"
                        name="minutes"
                        min={5}
                        max={60}
                        defaultValue={30}
                        required
                      />
                    </label>
                    <label>
                      Kondisi operasional
                      <select name="state">
                        <option value="UNAVAILABLE">
                          Tidak dapat digunakan
                        </option>
                        <option value="DISRUPTED">Terganggu</option>
                        <option value="DEGRADED">Menurun</option>
                      </select>
                    </label>
                    <label>
                      Dampak pada layanan
                      <select name="incident_type">
                        <option value="SERVICE_SUSPENSION">
                          Layanan dihentikan sementara
                        </option>
                        <option value="STOP_CLOSURE">Halte ditutup</option>
                        <option value="STATION_CLOSURE">Stasiun ditutup</option>
                        <option value="ROUTE_DIVERSION">Pengalihan rute</option>
                        <option value="INFRASTRUCTURE_FAILURE">
                          Gangguan infrastruktur
                        </option>
                      </select>
                    </label>
                    <p>
                      Keputusan mengubah kondisi jaringan untuk pengguna lain.
                      Bukti disimpan untuk audit dan tidak diklaim sebagai
                      konfirmasi resmi operator.
                    </p>
                    <button type="submit" disabled={busy}>
                      Tetapkan pembatasan sementara
                    </button>
                  </>
                ) : selected.review_authority === 'ADMIN_FIELD_REVIEW' &&
                  selected.lifecycle_status === 'VERIFIED_ACTIVE' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      onClick={() => void close('RESOLVED')}
                    >
                      Kondisi pulih
                    </button>
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      onClick={() => void close('RETRACTED')}
                    >
                      Cabut pembatasan
                    </button>
                  </>
                ) : (
                  <p>
                    Laporan ini tidak dapat diubah melalui review admin
                    lapangan.
                  </p>
                )}
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}
