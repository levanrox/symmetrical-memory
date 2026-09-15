import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names, last-wins, the way shadcn components expect. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** `01:14` from milliseconds remaining. Used by every clock in the product. */
export function formatClock(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
