'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type Step = 'email' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { status: string; data: { message?: string } };
      if (!res.ok) {
        setMessage(body.data.message ?? 'Request failed');
      } else {
        setStep('code');
        setMessage('If this email has access, a 6-digit code is on its way.');
      }
    } catch {
      setMessage('Network error, try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const body = (await res.json()) as { status: string; data: { message?: string } };
      if (!res.ok) {
        setMessage(body.data.message ?? 'Verification failed');
      } else {
        router.push('/');
      }
    } catch {
      setMessage('Network error, try again.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    background: 'var(--page)',
    border: '1px solid var(--border)',
    color: 'var(--ink)',
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-3.5 rounded-sm"
            style={{ background: 'var(--accent-bg)' }}
            aria-hidden
          />
          <h1 className="text-lg font-semibold">SimpleX Monitor</h1>
        </div>
        {step === 'email' ? (
          <form onSubmit={requestCode} className="space-y-3">
            <label className="block text-sm" style={{ color: 'var(--ink-2)' }}>
              Email address
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md px-3 py-2 text-base"
                style={inputStyle}
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md px-3 py-2 font-medium disabled:opacity-60"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent-bg-ink)' }}
            >
              {busy ? 'Sending…' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              Enter the 6-digit code sent to <strong>{email}</strong>.
            </p>
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="tabular w-full rounded-md px-3 py-2 text-center text-2xl tracking-[0.4em]"
              style={inputStyle}
              placeholder="000000"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-md px-3 py-2 font-medium disabled:opacity-60"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent-bg-ink)' }}
            >
              {busy ? 'Verifying…' : 'Log in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setMessage(null);
              }}
              className="w-full text-sm underline"
              style={{ color: 'var(--ink-muted)' }}
            >
              Use a different email
            </button>
          </form>
        )}
        {message && (
          <p className="mt-4 text-sm" style={{ color: 'var(--ink-2)' }}>
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
