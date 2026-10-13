import { cn } from '@/lib/utils';
import { FocusEvent, InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const ZERO_VALUE = /^\s*0+([.,]0*)?\s*$/;

/** A field holding only zero is selected on focus so typing "25" gives 25, not 025. */
export function selectZeroOnFocus(e: FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  if (!ZERO_VALUE.test(el.value)) return;
  el.select();
  // Mouse-up after a click can collapse the selection in some browsers.
  requestAnimationFrame(() => {
    if (document.activeElement === el && ZERO_VALUE.test(el.value)) el.select();
  });
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, onFocus, ...props }, ref) => (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-[var(--app-text-muted)]">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(
          'w-full rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-input-bg,var(--app-surface))]',
          'px-[var(--space-input-x)] py-[var(--space-input-y)] text-sm text-[var(--app-text)] shadow-sm transition-all duration-200',
          'placeholder:text-[var(--app-text-dim)]',
          'hover:border-[color-mix(in_srgb,var(--app-accent)_35%,var(--app-border-strong))]',
          'focus:border-[var(--app-accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--app-accent)_25%,transparent)] focus:shadow-[var(--app-shadow-md)]',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/25',
          className,
        )}
        onFocus={(e) => {
          selectZeroOnFocus(e);
          onFocus?.(e);
        }}
        {...props}
      />
      {hint && !error ? <p className="text-xs text-[var(--app-text-dim)]">{hint}</p> : null}
      {error && <p className="text-xs font-medium text-red-700 dark:text-red-400">{error}</p>}
    </div>
  ),
);
Input.displayName = 'Input';
