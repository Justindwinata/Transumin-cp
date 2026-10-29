'use client';
import { useEffect, useState } from 'react';
type Source = {
  operator: string;
  url: string;
  checked_at: string;
  website_reachable: boolean;
  arrival_status: 'NOT_CONNECTED';
};
export function OperatorSchedules() {
  const [open, setOpen] = useState(false),
    [sources, setSources] = useState<Source[]>([]),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/passenger/operator-schedules', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!controller.signal.aborted) {
          setSources(body.data);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15 * 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [open]);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Jadwal dari operator</summary>
      <p>
        Jam kedatangan terkini belum terhubung. Jadwal pada rute uji memakai
        data historis.
      </p>
      {failed ? (
        <p role="status">Sumber jadwal belum dapat diperiksa.</p>
      ) : sources.length === 0 ? (
        <p role="status">Memeriksa situs operator…</p>
      ) : (
        <ul>
          {sources.map((source) => (
            <li key={source.operator}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                Buka jadwal {source.operator}
              </a>
              <small>
                {' '}
                ·{' '}
                {source.website_reachable
                  ? 'Situs dapat diakses'
                  : 'Situs belum dapat diakses'}{' '}
                · diperiksa{' '}
                {new Date(source.checked_at).toLocaleTimeString('id-ID', {
                  timeZone: 'Asia/Jakarta',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                WIB
              </small>
            </li>
          ))}
        </ul>
      )}
      <p className="fine-print">
        Pemeriksaan situs tiap 15 menit selama bagian ini dibuka. Status situs
        bukan estimasi kedatangan.
      </p>
    </details>
  );
}
