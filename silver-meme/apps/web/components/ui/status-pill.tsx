import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'aka' | 'ao' | 'gold';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-ink-700 bg-ink-850 text-ink-300',
  good: 'border-go/50 bg-go/10 text-go',
  warn: 'border-gold/50 bg-gold-soft text-gold',
  bad: 'border-stop/60 bg-stop/10 text-stop',
  aka: 'border-aka/50 bg-aka-soft text-aka',
  ao: 'border-ao/50 bg-ao-soft text-ao',
  gold: 'border-gold/50 bg-gold-soft text-gold',
};

/**
 * A status label.
 *
 * Always renders its text. Colour is a second signal here, never the only one:
 * the same rule that makes AKA and AO readable to a colour-blind spectator
 * applies to every state in the product.
 */
export function StatusPill({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Maps bracket and match status onto a tone, in one place. */
export function toneForMatchStatus(status: string): Tone {
  switch (status) {
    case 'READY':
      return 'gold';
    case 'LIVE':
      return 'good';
    case 'FINISHED':
    case 'CONFIRMED':
      return 'neutral';
    case 'WALKOVER':
      return 'neutral';
    default:
      return 'neutral';
  }
}
