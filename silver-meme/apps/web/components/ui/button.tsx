import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonStyles = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        /* Gold is the only action colour, so a gold control always commits. */
        primary: 'bg-gold text-ink-950 hover:bg-gold/85',
        secondary: 'border border-ink-700 bg-ink-800 text-ink-100 hover:bg-ink-700',
        ghost: 'text-ink-300 hover:bg-ink-850 hover:text-ink-100',
        /* Destructive is outlined, never a solid red block: AKA already owns
           red on this screen, and the label has to carry the meaning anyway. */
        danger: 'border border-stop/70 text-stop hover:bg-stop/10',
        aka: 'border border-aka/60 bg-aka-soft text-aka hover:bg-aka/20',
        ao: 'border border-ao/60 bg-ao-soft text-ao hover:bg-ao/20',
      },
      size: {
        sm: 'h-8 rounded-md px-2.5 text-xs',
        md: 'h-10 rounded-md px-3.5 text-sm',
        lg: 'h-12 rounded-lg px-5 text-base',
        /* Operated at speed on a tablet with a queue of people waiting. */
        tap: 'h-16 rounded-xl px-4 text-lg',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export { buttonStyles };
