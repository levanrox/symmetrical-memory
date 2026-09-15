import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A grouped section with an optional header.
 *
 * Used where content genuinely belongs together as a unit. Not a default
 * container: a row of identical floating cards signals an unchosen layout, so
 * the admin surface uses tables and rules instead wherever content is a list.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = title !== undefined || actions !== undefined;

  return (
    <section className={cn('overflow-hidden rounded-xl border border-ink-700 bg-ink-900', className)}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-4 py-3">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="truncate text-sm font-semibold text-ink-50">{title}</h2>
            )}
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-ink-400">{description}</p>
            )}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
