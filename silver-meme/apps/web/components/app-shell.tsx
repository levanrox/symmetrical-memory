'use client';

import { Radio } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The frame every operator surface sits in.
 *
 * Navigation is a real nav with real links so the keyboard path exists, and the
 * live indicator is text plus icon rather than a coloured dot: an operator has
 * to be able to tell a quiet connection from a live one at a glance, and "I
 * can't see the difference between green and amber" is not an acceptable answer.
 */
export function AppShell({
  title,
  subtitle,
  links = [],
  connected,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  links?: Array<{ href: string; label: string }>;
  connected?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-ink-800 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-semibold text-ink-50">{title}</span>
              {subtitle !== undefined && (
                <span className="truncate text-xs text-ink-400">{subtitle}</span>
              )}
            </div>
          </div>

          <nav className="ml-auto flex items-center gap-1" aria-label="Sections">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-ink-800 text-ink-50'
                      : 'text-ink-400 hover:bg-ink-850 hover:text-ink-100',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/*
            Only shown when something is wrong. An always-on "live" badge is
            noise, and on a ring console the word "live" already means the bout
            is running — two meanings for one word is a bug, not a feature.
          */}
          {connected === false && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold-soft px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-gold"
              role="status"
            >
              <Radio size={12} />
              Reconnecting
            </span>
          )}

          {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
