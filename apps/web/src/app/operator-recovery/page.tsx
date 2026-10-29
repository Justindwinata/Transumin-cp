'use client';

import { useState } from 'react';

type Analysis = {
  analysis_id: string;
  upstream_service: string[];
  downstream_service: string[];
  cut_point_candidate: string | null;
  restart_point_candidate: string | null;
  unresolved_gap: Record<string, unknown>;
  estimated_vehicle_requirement: number | null;
  validation_status:
    'VALIDATED' | 'REQUIRES_OPERATOR_VALIDATION' | 'INSUFFICIENT_EVIDENCE';
  provenance: {
    evidence_type: string;
    reference_ids: string[];
    limitations: string[];
  };
};
type Form = {
  route_id: string;
  network_snapshot_id: string;
  blocked_transit_segment_ids: string;
  simulation_run_id: string;
  target_headway_seconds: string;
  turnaround_buffer_seconds: string;
  bridge_mode: string;
  bridge_vehicle_count: string;
  bridge_cycle_seconds: string;
};
const emptyForm: Form = {
  route_id: '',
  network_snapshot_id: '',
  blocked_transit_segment_ids: '',
  simulation_run_id: '',
  target_headway_seconds: '300',
  turnaround_buffer_seconds: '0',
  bridge_mode: '',
  bridge_vehicle_count: '',
  bridge_cycle_seconds: '',
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function OperatorRecoveryPage() {
  const [form, setForm] = useState(emptyForm);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const change = (field: keyof Form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setAnalysis(null);
    setError(null);
    setKey(null);
  };
  const run = async () => {
    setAnalysis(null);
    setError(null);
    const blocked = form.blocked_transit_segment_ids
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!UUID.test(form.route_id) || !UUID.test(form.network_snapshot_id))
      return setError('Enter valid route and finalized snapshot UUIDs.');
    if (
      blocked.length < 1 ||
      blocked.length > 100 ||
      blocked.some((id) => !UUID.test(id)) ||
      new Set(blocked.map((id) => id.toLowerCase())).size !== blocked.length
    )
      return setError('Enter 1–100 unique blocked segment UUIDs.');
    const headway = Number(form.target_headway_seconds);
    const buffer = Number(form.turnaround_buffer_seconds);
    if (
      !Number.isInteger(headway) ||
      headway < 1 ||
      headway > 7200 ||
      !Number.isInteger(buffer) ||
      buffer < 0 ||
      buffer > 7200
    )
      return setError('Headway must be 1–7200 seconds; buffer 0–7200 seconds.');
    if (form.simulation_run_id && !UUID.test(form.simulation_run_id))
      return setError('Simulation run ID must be a UUID.');
    const hasBridge = Boolean(
      form.bridge_mode ||
      form.bridge_vehicle_count ||
      form.bridge_cycle_seconds,
    );
    const vehicleCount = Number(form.bridge_vehicle_count);
    const cycle = Number(form.bridge_cycle_seconds);
    if (
      hasBridge &&
      (!/^[A-Z_]{2,40}$/.test(form.bridge_mode) ||
        !Number.isInteger(vehicleCount) ||
        vehicleCount < 0 ||
        vehicleCount > 1000 ||
        !Number.isInteger(cycle) ||
        cycle < 1 ||
        cycle > 86400)
    )
      return setError(
        'Bridge needs uppercase mode, 0–1000 vehicles, and 1–86400-second cycle.',
      );
    const body = {
      route_id: form.route_id,
      network_snapshot_id: form.network_snapshot_id,
      blocked_transit_segment_ids: blocked,
      ...(form.simulation_run_id
        ? { simulation_run_id: form.simulation_run_id }
        : {}),
      target_headway_seconds: headway,
      turnaround_buffer_seconds: buffer,
      ...(hasBridge
        ? {
            temporary_bridge_resource: {
              mode: form.bridge_mode,
              vehicle_count: vehicleCount,
              cycle_time_seconds: cycle,
            },
          }
        : {}),
    };
    const requestKey = key ?? `fr007-${crypto.randomUUID()}`;
    setKey(requestKey);
    setLoading(true);
    try {
      const response = await fetch('/api/v1/operator-recovery/analyses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': requestKey,
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        data?: Analysis;
        error?: { message: string };
      };
      if (!response.ok || !result.data)
        throw new Error(
          result.error?.message ?? `Analysis failed (${response.status}).`,
        );
      setAnalysis(result.data);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Analysis unavailable. Retry same request.',
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '32px 24px 64px',
        fontFamily: 'system-ui',
        color: 'CanvasText',
      }}
    >
      <header
        style={{
          borderBottom: '1px solid #a8ada7',
          paddingBottom: 24,
          marginBottom: 24,
        }}
      >
        <p
          style={{
            fontSize: 12,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          FR-007 · TransJakarta
        </p>
        <h1>Flood service split analysis</h1>
        <p>
          Decision support only. Operator retains safety and dispatch authority.
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 18,
        }}
      >
        <Field
          label="Route UUID"
          value={form.route_id}
          onChange={(v) => change('route_id', v)}
        />
        <Field
          label="Finalized network snapshot UUID"
          value={form.network_snapshot_id}
          onChange={(v) => change('network_snapshot_id', v)}
        />
        <Field
          label="Blocked transit segment UUIDs"
          value={form.blocked_transit_segment_ids}
          onChange={(v) => change('blocked_transit_segment_ids', v)}
          helper="Enter 1–100 IDs separated by commas or spaces."
        />
        <Field
          label="Completed simulation run UUID (optional)"
          value={form.simulation_run_id}
          onChange={(v) => change('simulation_run_id', v)}
        />
        <Field
          label="Target headway (seconds)"
          value={form.target_headway_seconds}
          onChange={(v) => change('target_headway_seconds', v)}
          inputMode="numeric"
        />
        <Field
          label="Turnaround buffer (seconds)"
          value={form.turnaround_buffer_seconds}
          onChange={(v) => change('turnaround_buffer_seconds', v)}
          inputMode="numeric"
        />
        <Field
          label="Operator bridge mode (optional)"
          value={form.bridge_mode}
          onChange={(v) => change('bridge_mode', v)}
          helper="Uppercase mode code. Leave all bridge fields blank to omit."
        />
        <Field
          label="Configured bridge vehicles"
          value={form.bridge_vehicle_count}
          onChange={(v) => change('bridge_vehicle_count', v)}
          inputMode="numeric"
        />
        <Field
          label="Bridge cycle time (seconds)"
          value={form.bridge_cycle_seconds}
          onChange={(v) => change('bridge_cycle_seconds', v)}
          inputMode="numeric"
        />
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '11px 18px',
              background: '#234d3b',
              color: 'white',
              border: 0,
              borderRadius: 4,
              fontWeight: 650,
            }}
          >
            {loading ? 'Analyzing…' : 'Run analysis'}
          </button>
          {error && key && (
            <button type="button" onClick={() => void run()}>
              Retry same request
            </button>
          )}
          {error && (
            <p role="alert" style={{ color: '#8a2020', width: '100%' }}>
              {error}
            </p>
          )}
          {loading && (
            <p role="status">Checking snapshot and route topology…</p>
          )}
        </div>
      </form>
      {!analysis && !error && (
        <p style={{ marginTop: 24 }}>
          Provide IDs from finalized data. No sample data submits automatically.
        </p>
      )}
      {analysis && (
        <section
          aria-label="Operator recovery analysis"
          style={{
            marginTop: 36,
            borderTop: '2px solid #234d3b',
            paddingTop: 20,
          }}
        >
          <p>
            <strong>{analysis.validation_status.replaceAll('_', ' ')}</strong> ·
            Evidence: {analysis.provenance.evidence_type}
          </p>
          <p>
            Estimated vehicle requirement:{' '}
            <strong>
              {analysis.estimated_vehicle_requirement ?? 'NOT ESTIMATED'}
            </strong>
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              gap: 20,
            }}
          >
            <Result
              label="Upstream service"
              value={analysis.upstream_service}
            />
            <Result
              label="Downstream service"
              value={analysis.downstream_service}
            />
            <Result
              label="Cut point candidate"
              value={analysis.cut_point_candidate}
            />
            <Result
              label="Restart point candidate"
              value={analysis.restart_point_candidate}
            />
          </div>
          <h2>Unresolved gap</h2>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(analysis.unresolved_gap, null, 2)}
          </pre>
          <h2>Provenance and limitations</h2>
          <p>{analysis.provenance.reference_ids.join(', ')}</p>
          <ul>
            {analysis.provenance.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
function Field({
  label,
  value,
  onChange,
  helper,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  inputMode?: 'numeric';
}) {
  const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
      {label}
      <input
        id={id}
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={helper ? `${id}-help` : undefined}
        style={{
          minWidth: 0,
          minHeight: 42,
          padding: '8px 10px',
          border: '1px solid #68716a',
          borderRadius: 4,
          background: 'Canvas',
          color: 'CanvasText',
        }}
      />
      {helper && (
        <small id={`${id}-help`} style={{ fontWeight: 400 }}>
          {helper}
        </small>
      )}
    </label>
  );
}
function Result({
  label,
  value,
}: {
  label: string;
  value: string[] | string | null;
}) {
  const display = Array.isArray(value) ? value.join(', ') : value;
  return (
    <div style={{ borderTop: '1px solid #a8ada7', paddingTop: 10 }}>
      <h2>{label}</h2>
      <p>{display || 'No candidate supported by available evidence.'}</p>
    </div>
  );
}
