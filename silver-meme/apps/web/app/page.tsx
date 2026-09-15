'use client';

import { Loader2, ShieldCheck, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/field';
import { api, getToken, login, registerFirstOperator } from '../lib/api';

type ServerState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'unreachable'; detail: string };

export default function SignInPage() {
  const router = useRouter();

  const [mode, setMode] = useState<'sign-in' | 'first-operator'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<ServerState>({ kind: 'checking' });

  useEffect(() => {
    if (getToken() !== null) {
      router.replace('/admin');
      return;
    }

    // The preflight endpoint is public, so the sign-in screen doubles as a
    // connection check: you learn the box is unreachable before typing a
    // password into a form that was never going to work.
    api
      .get<{ ok: boolean }>('/status')
      .then((result) => setServer(result.ok ? { kind: 'ready' } : { kind: 'ready' }))
      .catch((caught: unknown) =>
        setServer({
          kind: 'unreachable',
          detail: caught instanceof Error ? caught.message : 'No response',
        }),
      );
  }, [router]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === 'first-operator') {
        await registerFirstOperator(name, email, password);
      }

      await login(email, password);
      router.replace('/admin');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* The pitch half. On a phone it collapses to a header, because the form
          is the only thing that matters there. */}
      <section className="flex flex-col justify-between border-ink-800 px-8 py-10 lg:border-r lg:px-14 lg:py-14">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
            Tournament operations
          </p>
          <h1 className="mt-3 text-3xl font-bold text-ink-50 lg:text-4xl">
            Run the draw, the ring and the scoreboard from one box on the venue network.
          </h1>
          <p className="mt-4 max-w-prose text-ink-300">
            Entries in, draws locked, categories on a ring, matches scored, brackets advanced. It
            keeps working with the internet cable unplugged.
          </p>
        </div>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 text-sm lg:mt-0">
          {[
            ['Written rules', 'WKF Kumite 2026, with article references'],
            ['Draws', 'Versioned, locked, and reproducible'],
            ['Scoring', 'Event-sourced, so any result can be reversed'],
            ['Scale', 'Six rings on one modest machine'],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="font-semibold text-ink-100">{term}</dt>
              <dd className="text-ink-400">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The work half. */}
      <section className="flex items-center justify-center px-8 py-10">
        <div className="w-full max-w-sm">
          <header className="mb-6">
            <h2 className="text-xl font-semibold text-ink-50">
              {mode === 'sign-in' ? 'Sign in' : 'Create the first operator'}
            </h2>
            <p className="mt-1 text-sm text-ink-400">
              {mode === 'sign-in'
                ? 'Use the account this event was set up with.'
                : 'This route closes as soon as one operator exists.'}
            </p>
          </header>

          {server.kind === 'unreachable' && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-gold/50 bg-gold-soft px-3 py-2.5 text-sm text-gold"
            >
              <WifiOff size={16} className="mt-0.5 shrink-0" />
              <span>
                Cannot reach the event server. Check it is running on this network.
                <span className="mt-0.5 block text-xs text-gold/80">{server.detail}</span>
              </span>
            </div>
          )}

          {error !== null && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-stop/60 bg-stop/10 px-3 py-2.5 text-sm text-stop"
            >
              {error}
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate={false}>
            {mode === 'first-operator' && (
              <Field id="name" label="Your name">
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </Field>
            )}

            <Field id="email" label="Email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
              />
            </Field>

            <Field
              id="password"
              label="Password"
              hint={mode === 'first-operator' ? 'At least 8 characters.' : undefined}
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'first-operator' ? 'new-password' : 'current-password'}
                minLength={mode === 'first-operator' ? 8 : undefined}
                required
              />
            </Field>

            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy
                ? 'Signing in'
                : mode === 'sign-in'
                  ? 'Sign in'
                  : 'Create operator and sign in'}
            </Button>
          </form>

          <p className="mt-5 text-sm text-ink-400">
            {mode === 'sign-in' ? (
              <>
                Setting this up for the first time?{' '}
                <button
                  type="button"
                  onClick={() => setMode('first-operator')}
                  className="font-semibold text-gold underline-offset-4 hover:underline"
                >
                  Create the first operator
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('sign-in')}
                  className="font-semibold text-gold underline-offset-4 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          {server.kind === 'ready' && (
            <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-600">
              <ShieldCheck size={13} />
              Event server reachable
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
