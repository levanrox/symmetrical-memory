import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dense data primitives.
 *
 * The admin and results surfaces are compare surfaces: operators scan columns
 * looking for the one row that needs attention. A table with stable lanes beats
 * a grid of cards for that, every time.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-ink-700 px-3 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-wider text-ink-400',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-ink-800 px-3 py-2 align-middle', className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-ink-850/60', className)} {...props} />;
}

/** Shown in place of rows. Says what belongs here and what fills it. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-ink-400">
        {children}
      </td>
    </tr>
  );
}
