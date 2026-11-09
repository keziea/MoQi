import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-[10px]',
  md: 'h-9 px-4 text-sm gap-2 rounded-[12px]',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-[12px]',
};

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[var(--shadow-xs)]',
  secondary:
    'bg-transparent text-ink-2 border border-line hover:bg-surface hover:text-ink hover:border-line-strong',
  ghost: 'bg-transparent text-ink-2 hover:bg-[var(--accent-soft)] hover:text-accent',
  danger: 'bg-transparent text-danger hover:bg-[var(--danger-soft)]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center font-medium select-none',
        'transition-[background-color,color,border-color,transform] duration-[120ms] ease-out',
        'active:scale-[0.985] disabled:opacity-40 disabled:pointer-events-none',
        SIZE[size],
        VARIANT[variant],
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
