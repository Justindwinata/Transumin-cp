'use client';

import { useState, type FormEvent } from 'react';
import { opsApi } from '../../lib/ops-api';
import type { OperatorPrincipal } from '../../lib/ops';

export function LoginView({
  onLogin,
}: {
  onLogin?: (principal: OperatorPrincipal) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setMessage('');
    try {
      const result = await opsApi.login(email, password);
      onLogin?.(result);
      window.location.assign(
        result.roles.includes('ADMIN') ? '/ops/admin/reports' : '/ops/network',
      );
    } catch (cause) {
      setState('error');
      const status = (cause as { status?: number } | null)?.status;
      setMessage(
        status === 401
          ? 'Email atau kata sandi tidak sesuai. Periksa lalu coba lagi.'
          : status === 400
            ? 'Isian belum valid. Periksa email dan kata sandi.'
            : status === 429
              ? 'Terlalu banyak percobaan masuk. Tunggu sebentar sebelum mencoba lagi.'
              : 'Belum dapat masuk. Periksa koneksi atau muat ulang halaman lalu coba lagi.',
      );
    }
  }
  return (
    <main className="ops-auth-state">
      <form className="ops-login" onSubmit={submit}>
        <p className="ops-eyebrow">TRANSUM-IN / AKSES PENGELOLA</p>
        <h1>Masuk</h1>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="login-password">Kata sandi</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button disabled={state === 'submitting'}>
          {state === 'submitting' ? 'Memeriksa akun…' : 'Masuk'}
        </button>
        {message && (
          <p className="ops-form-error" role="alert">
            {message}
          </p>
        )}
      </form>
    </main>
  );
}

export function RoleAwareNavigation({
  principal,
  onLogout,
}: {
  principal: OperatorPrincipal;
  onLogout?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  async function logout() {
    setState('busy');
    try {
      await opsApi.logout();
      onLogout?.();
      window.location.assign('/ops/login');
    } finally {
      setState('idle');
    }
  }
  return (
    <div className="ops-identity">
      <strong>{principal.email}</strong>
      <small>{principal.roles.join(' / ')}</small>
      {principal.roles.includes('ADMIN') && (
        <a href="/ops/admin">Kelola akun</a>
      )}
      <button
        className="ops-link-button"
        disabled={state === 'busy'}
        onClick={logout}
      >
        {state === 'busy' ? 'Keluar…' : 'Keluar'}
      </button>
    </div>
  );
}

export function AdminAccountProvisioning({
  principal,
}: {
  principal: OperatorPrincipal;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('RESEARCHER_OPERATOR');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await opsApi.provision(email, password, [role]);
      setMessage('Akun berhasil dibuat.');
      setEmail('');
      setPassword('');
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Akun belum berhasil dibuat.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!principal.roles.includes('ADMIN'))
    return (
      <main className="ops-auth-state">
        <h1>Akses ditolak</h1>
        <p>Anda perlu masuk sebagai admin.</p>
      </main>
    );
  return (
    <main className="ops-shell">
      <section className="ops-admin-form">
        <p className="ops-eyebrow">ADMIN / KELOLA AKUN</p>
        <h1>Buat akun</h1>
        <form onSubmit={submit}>
          <label htmlFor="provision-email">Email</label>
          <input
            id="provision-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="provision-password">Kata sandi sementara</label>
          <input
            id="provision-password"
            type="password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label htmlFor="provision-role">Role</label>
          <select
            id="provision-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="RESEARCHER_OPERATOR">RESEARCHER_OPERATOR</option>
            <option value="ADMIN">ADMIN</option>
            <option value="PASSENGER">PASSENGER</option>
          </select>
          <button disabled={busy}>
            {busy ? 'Membuat akun…' : 'Buat akun'}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
      </section>
    </main>
  );
}
