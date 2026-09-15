import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const controlStyles =
  'w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-600 focus:border-ink-600 disabled:opacity-45';

/**
 * A labelled form control.
 *
 * The label is a real `<label for>`, never a placeholder standing in for one:
 * a placeholder disappears the moment someone starts typing, which is exactly
 * when they need to know what the field was.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-300">
        {label}
      </label>
      {children}
      {error !== undefined && (
        <p role="alert" className="text-xs text-stop">
          {error}
        </p>
      )}
      {error === undefined && hint !== undefined && (
        <p className="text-xs text-ink-600">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlStyles, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlStyles, 'min-h-32 font-mono text-xs leading-relaxed', className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlStyles, 'pr-8', className)} {...props} />;
}
