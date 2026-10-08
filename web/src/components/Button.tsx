import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'quiet' | 'ghost';

const base =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-pill px-6 text-[0.98rem] font-bold tracking-[0.005em] ' +
  // A small press-in on tap: the one physical response every control shares.
  'transition-[background-color,transform,box-shadow,color] duration-200 ease-snappy active:scale-[0.97] ' +
  'disabled:cursor-not-allowed disabled:active:scale-100';

const variants: Record<Variant, string> = {
  // The action colour (teal) is the one colour that means "act".
  primary:
    'bg-action text-on-action shadow-[inset_0_1px_0_rgb(255_255_255/0.12),var(--elev-soft)] hover:bg-action-hover ' +
    'disabled:bg-surface-strong disabled:text-text-faint disabled:shadow-none',
  quiet:
    'bg-surface text-text shadow-[inset_0_0_0_1.5px_var(--rule)] hover:shadow-[inset_0_0_0_1.5px_var(--rule-accent)] ' +
    'disabled:text-text-faint',
  ghost: 'text-text-muted hover:bg-surface hover:text-text disabled:text-text-faint',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function ButtonLink({ variant = 'primary', className = '', ...props }: LinkProps & { variant?: Variant }) {
  return <Link {...props} className={`${base} ${variants[variant]} ${className}`} />;
}
