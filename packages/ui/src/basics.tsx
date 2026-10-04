import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useState } from 'react';
import { Link, type LinkProps } from 'react-router';
import { useService, useT } from '@shop/core';
import { SeoService } from '@shop/core';

/** Joins class names, skipping empty ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------- Icon ----------

export type IconName = 'search' | 'cart' | 'heart' | 'user' | 'menu' | 'x' | 'chevron-down' | 'chevron-right' | 'check' | 'alert' | 'info' | 'star' | 'bell' | 'mail' | 'trash';

const PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  cart: (
    <>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </>
  ),
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  star: <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </>
  ),
  trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />,
};

/** Decorative by default (aria-hidden); pass `label` when the icon stands alone. */
export function Icon({ name, size = 20, label = '', filled = false, className = '' }: { name: IconName; size?: number; label?: string; filled?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0', className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={name === 'star' && filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={name === 'chevron-right' ? 'rtl:-scale-x-100' : undefined}
        aria-hidden={label ? undefined : 'true'}
        role={label ? 'img' : undefined}
        aria-label={label || undefined}
      >
        {PATHS[name]}
      </svg>
    </span>
  );
}

// ---------- Button ----------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-contrast hover:bg-primary-hover',
  secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-alt',
  ghost: 'text-text hover:bg-surface-alt',
  danger: 'bg-danger text-on-status hover:opacity-90',
};
const SIZES: Record<ButtonSize, string> = { sm: 'min-h-9 px-3 text-sm', md: 'min-h-11 px-4 text-base', lg: 'min-h-12 px-6 text-lg' };

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], extra);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

/** A button. Min height keeps touch targets at 44px (md, lg). Loading keeps it focusable but ignores clicks. */
export function Button({ variant = 'primary', size = 'md', loading = false, className, children, onClick, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClasses(variant, size, className)}
      aria-busy={loading ? 'true' : undefined}
      aria-disabled={loading ? 'true' : undefined}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A link that looks like a button. */
export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...rest} className={buttonClasses(variant, size, className)} />;
}

// ---------- Badge, skeleton, spinner ----------

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'sale';
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-alt text-text border border-border',
  primary: 'bg-primary text-primary-contrast',
  success: 'bg-success text-on-status',
  warning: 'bg-warning text-on-status',
  danger: 'bg-danger text-on-status',
  sale: 'bg-sale text-on-status',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', TONES[tone], className)}>{children}</span>;
}

/** Pulsing placeholder. Size it from the parent with utility classes so it matches the final layout. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('block animate-pulse rounded-md bg-surface-alt', className)} aria-hidden="true" />;
}

export function Spinner() {
  return <span className="inline-block size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" role="status" aria-label="Loading" />;
}

// ---------- Rating ----------

/** Read-only star rating with an accessible text label. */
export function Rating({ value, count = null, size = 16 }: { value: number; count?: number | null; size?: number }) {
  const filled = Math.round(value);
  const label = `Rated ${value.toFixed(1)} out of 5${count === null ? '' : ` from ${count} reviews`}`;
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={label}>
      <span className="inline-flex text-accent" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <Icon key={n} name="star" size={size} filled={n <= filled} className={n <= filled ? '' : 'opacity-30'} />
        ))}
      </span>
      {count !== null && (
        <span className="text-sm text-text-muted" aria-hidden="true">
          ({count})
        </span>
      )}
    </span>
  );
}

/** Star picker (1 to 5) built as a radio group: arrow keys move and select, with a text alternative for each star. */
export function RatingInput({ value, onChange, label = 'Rating', invalid = false }: { value: number; onChange: (value: number) => void; label?: string; invalid?: boolean }) {
  const focusable = (n: number) => value === n || (value === 0 && n === 1);
  return (
    <div className="inline-flex" role="radiogroup" aria-label={label} aria-invalid={invalid ? 'true' : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          className="inline-flex size-11 items-center justify-center rounded-md text-accent hover:bg-surface-alt"
          aria-checked={value === n}
          aria-label={n + (n === 1 ? ' star' : ' stars')}
          tabIndex={focusable(n) ? 0 : -1}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            const step = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, number>)[e.key];
            if (!step) return;
            e.preventDefault();
            const next = Math.min(5, Math.max(1, n + step));
            onChange(next);
            (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next - 1])?.focus();
          }}
        >
          <Icon name="star" size={26} filled={n <= value} className={n > value ? 'opacity-40' : ''} />
        </button>
      ))}
    </div>
  );
}

// ---------- Form field ----------

/** The class list of a styled native input, select or textarea. */
export const inputClass =
  'block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-text ' +
  'placeholder:text-text-muted disabled:opacity-50 aria-[invalid=true]:border-danger';

export interface FieldIds {
  id: string;
  describedBy: string | undefined;
}

/** Label + hint + error wrapper. The child receives the id and `aria-describedby` to put on the control. */
export function FormField({ label, hint = '', error = '', required = false, children }: { label: string; hint?: string; error?: string; required?: boolean; children: (field: FieldIds) => ReactNode }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, describedBy })}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------- States ----------

export function EmptyState({ title, description = '', children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="block rounded-lg border border-dashed border-border-strong p-8 text-center">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {description && <p className="mt-1 text-text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function ErrorState({ title, description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="block rounded-lg border border-danger p-8 text-center" role="alert">
      <h2 className="text-lg font-semibold text-text">{title ?? t('common.somethingWrong')}</h2>
      <p className="mt-1 text-text-muted">{description ?? t('common.loadFailed')}</p>
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        {t('common.tryAgain')}
      </Button>
    </div>
  );
}

export function NotFound() {
  const seo = useService(SeoService);
  useEffect(() => seo.set({ title: 'Page not found', noindex: true }), [seo]);
  return (
    <section className="py-16 text-center">
      <p className="text-6xl font-bold text-primary" aria-hidden="true">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold">We could not find that page</h1>
      <p className="mt-2 text-text-muted">The link may be broken or the page may have moved.</p>
      <ButtonLink to="/" className="mt-6">
        Back to home
      </ButtonLink>
    </section>
  );
}

// ---------- Checkbox, chip, countdown ----------

/** Labelled checkbox with an optional result count (used by filter panels). */
export function Checkbox({ checked, onChange, disabled = false, count = null, children }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; count?: number | null; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1 text-text">{children}</span>
      {count !== null && <span className="text-text-muted">({count})</span>}
    </label>
  );
}

/** Removable chip, e.g. an active filter. */
export function Chip({ removable = true, label = '', onRemove, children }: { removable?: boolean; label?: string; onRemove?: () => void; children: ReactNode }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border-strong bg-surface ps-3 pe-1 text-sm">
      {children}
      {removable && (
        <button type="button" className="inline-flex size-8 items-center justify-center rounded-full hover:bg-surface-alt" aria-label={'Remove filter ' + label} onClick={onRemove}>
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
  );
}

/** Counts down to `endsAt`; renders HH:MM:SS. */
export function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  const left = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="inline-block font-mono font-semibold tabular-nums" role="timer">
      {`${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`}
    </span>
  );
}

// ---------- Quantity stepper, stepper, breadcrumb ----------

export function QuantityStepper({ value, onChange, min = 1, max = 10, label }: { value: number; onChange: (value: number) => void; min?: number; max?: number; label?: string }) {
  const t = useT();
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className="inline-flex items-center rounded-md border border-border-strong" role="group" aria-label={label ?? t('qty.label')}>
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-s-md hover:bg-surface-alt disabled:opacity-40" aria-label={t('qty.decrease')} disabled={value <= min} onClick={() => step(-1)}>
        <span aria-hidden="true" className="text-xl leading-none">
          −
        </span>
      </button>
      <output className="min-w-10 text-center font-medium" aria-live="polite">
        {value}
      </output>
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-e-md hover:bg-surface-alt disabled:opacity-40" aria-label={t('qty.increase')} disabled={value >= max} onClick={() => step(1)}>
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
      </button>
    </div>
  );
}

/** Step indicator for multi-step flows. Steps before `current` are complete. */
export function Stepper({ steps, current, label = 'Checkout progress' }: { steps: string[]; current: number; label?: string }) {
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label={label}>
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={cx(
              'inline-flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
              i < current ? 'border-success bg-success text-on-status' : i === current ? 'border-primary bg-primary text-primary-contrast' : 'border-border-strong text-text-muted',
            )}
            aria-hidden="true"
          >
            {i < current ? '✓' : i + 1}
          </span>
          <span className={cx(i === current ? 'font-semibold' : 'text-text-muted', i !== current && 'hidden', 'md:inline')}>{step}</span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-border-strong md:w-8" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export interface BreadcrumbItem {
  label: string;
  /** Omit for the current page. */
  link?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.link && !last ? (
                <>
                  <Link to={item.link} className="rounded underline-offset-2 hover:text-primary hover:underline">
                    {item.label}
                  </Link>
                  <Icon name="chevron-right" size={14} />
                </>
              ) : (
                <span aria-current="page" className="text-text">
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

