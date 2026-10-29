'use client';

import { useEffect, useState } from 'react';

type Props = Readonly<{
  journeyId?: string;
  recoveryId?: string;
  defaultQuestion?: string;
}>;

type ToolAudit = Readonly<{
  tool: string;
  resultRef: string;
  status: string;
  latencyMs: number;
}>;
type CopilotResponse = {
  data: {
    message_id: string;
    session_id?: string;
    answer: string;
    evidence_references: string[];
    tool_result_references: string[];
    evidence_type: string;
    fallback_status: string;
  };
  meta: {
    request_id?: string;
    warnings: string[];
    provenance: {
      evidence_type: string;
      reference_ids: string[];
      observed_at: string | null;
      limitations: string[];
    } | null;
    tool_audit: ToolAudit[];
  };
};

export function CopilotDrawer({
  journeyId,
  recoveryId,
  defaultQuestion,
}: Props) {
  const recoveryContext = Boolean(recoveryId);
  const questionDefault =
    defaultQuestion ??
    (recoveryContext
      ? 'Jelaskan rute pengganti ini dan dasar rekomendasinya.'
      : 'Jelaskan rute ini dan langkah perjalanannya.');
  const [question, setQuestion] = useState(questionDefault);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const context = recoveryId
    ? `recovery:${recoveryId}`
    : journeyId
      ? `journey:${journeyId}`
      : null;
  const disabled = !context || !question.trim() || busy;

  useEffect(() => {
    setQuestion(questionDefault);
    setBusy(false);
    setResult(null);
    setError(null);
  }, [context, questionDefault]);

  async function ask() {
    if (!context) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/passenger/copilot/messages', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: question.trim(),
          context_references: [context],
        }),
        cache: 'no-store',
      });
      const body = (await response.json()) as CopilotResponse & {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          body.error?.message ?? `Request failed (${response.status}).`,
        );
      setResult(body);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Permintaan gagal. Periksa koneksi dan coba lagi.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="copilot-drawer"
      aria-label="Asisten perjalanan"
      aria-busy={busy}
    >
      <div>
        <strong>Bantuan memahami perjalanan</strong>
        <p className="fine-print">
          Penjelasan memakai data perjalanan yang tersedia. Asisten tidak
          memesan kendaraan atau mengubah rute Anda. Ringkasan permintaan dan
          jejak pemeriksaan disimpan 90 hari dengan akses terbatas bagi
          pemiliknya.
        </p>
      </div>
      <label htmlFor="copilot-question">Pertanyaan</label>
      <textarea
        id="copilot-question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        rows={3}
        maxLength={4000}
        placeholder={
          recoveryContext
            ? 'Jelaskan rute pengganti ini.'
            : 'Jelaskan rute ini dan langkah perjalanannya.'
        }
        aria-describedby="copilot-context"
      />
      <p id="copilot-context" className="fine-print">
        Konteks: <code>{context ?? 'belum ada — pilih rute dahulu'}</code>
      </p>
      {!context && (
        <p className="empty-state">
          Pilih rute atau rute pengganti untuk mendapatkan penjelasan.
        </p>
      )}
      <button
        className="primary-button"
        type="button"
        onClick={() => void ask()}
        disabled={disabled}
      >
        {busy ? 'Membaca rute…' : 'Jelaskan perjalanan'}
      </button>
      {busy && (
        <p className="fine-print" role="status">
          Memeriksa data perjalanan Anda…
        </p>
      )}
      {error && (
        <div className="feedback error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="copilot-result" aria-live="polite">
          <pre>{result.data.answer}</pre>
          <p className="fine-print">
            Sumber data:{' '}
            {result.meta.provenance?.evidence_type ?? result.data.evidence_type}
            ; referensi{' '}
            {result.data.evidence_references.join(', ') || 'tidak ada'};
            observed {result.meta.provenance?.observed_at ?? 'belum tersedia'}.{' '}
            Sesi {result.data.session_id ?? '—'}.
          </p>
          <p className="fine-print">
            Jenis bukti <code>{result.data.evidence_type}</code> · Metode
            jawaban <code>{result.data.fallback_status}</code>
          </p>
          {result.meta.tool_audit.length > 0 && (
            <ul className="fine-print" aria-label="Jejak pemeriksaan">
              {result.meta.tool_audit.map((audit) => (
                <li key={audit.resultRef}>
                  <code>{audit.tool}</code> — {audit.status} · {audit.latencyMs}{' '}
                  ms · <code>{audit.resultRef}</code>
                </li>
              ))}
            </ul>
          )}
          {result.meta.tool_audit.length === 0 && (
            <p className="fine-print">
              Data belum cukup untuk memberi penjelasan.
            </p>
          )}
          {result.meta.warnings.length > 0 && (
            <ul className="fine-print" aria-label="Keterbatasan informasi">
              {result.meta.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
