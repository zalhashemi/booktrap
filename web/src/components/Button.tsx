import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'quiet';

const base =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-board px-6 text-[0.975rem] font-medium ' +
  'transition-[background-color,transform,box-shadow] duration-200 ease-out-expo active:translate-y-px ' +
  'disabled:cursor-not-allowed disabled:active:translate-y-0';

const variants: Record<Variant, string> = {
  // Burgundy cloth with a gold hairline: the one colour that means "act".
  primary:
    'bg-burgundy text-on-cloth shadow-[inset_0_0_0_1px_var(--rule-gold)] hover:bg-burgundy-hover ' +
    'disabled:bg-surface-strong disabled:text-text-faint disabled:shadow-none',
  quiet:
    'text-text shadow-[inset_0_0_0_1px_var(--rule)] hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--rule-gold)] ' +
    'disabled:text-text-faint',
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
