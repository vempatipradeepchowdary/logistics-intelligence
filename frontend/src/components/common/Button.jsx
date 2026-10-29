import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary:
    'bg-cobalt-600 text-white hover:bg-cobalt-700 active:bg-cobalt-800 border border-cobalt-600 shadow-[0_1px_0_rgb(16_27_45/0.08)]',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-subtle hover:border-navy-300',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-subtle hover:text-ink',
  danger: 'bg-crit text-white border border-crit hover:bg-crit-ink',
};
const SIZES = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-2',
  lg: 'h-10 px-4 text-[14px] gap-2',
};

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon: Icon, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
});
