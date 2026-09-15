import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">404</p>
      <h1 className="text-2xl font-semibold text-ink-50">That page does not exist</h1>
      <p className="max-w-sm text-sm text-ink-400">
        The link may be from a different event, or the ring may have been reconfigured.
      </p>
      <Link
        href="/"
        className="rounded-md border border-ink-700 bg-ink-800 px-4 py-2 text-sm font-semibold text-ink-100 hover:bg-ink-700"
      >
        Back to sign in
      </Link>
    </div>
  );
}
