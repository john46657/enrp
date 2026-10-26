'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { FACTION_COLORS, statusLabel } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-signal text-signal-ink hover:brightness-110 font-semibold',
  secondary: 'border border-line-strong bg-surface-2 hover:border-muted',
  danger: 'border border-bad/60 text-bad hover:bg-bad/10',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }
>(function Button({ variant = 'secondary', size = 'md', className = '', ...props }, ref) {
  return (
    <button
      ref={ref}
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md transition disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-3.5 py-1.5'} ${VARIANT[variant]} ${className}`}
    />
  );
});

const fieldBase =
  'w-full rounded-md border border-line-strong bg-bg px-3 py-1.5 text-text placeholder:text-muted/70 focus:border-signal focus:outline-none aria-[invalid=true]:border-bad';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...props },
  ref,
) {
  return <input ref={ref} {...props} className={`${fieldBase} ${className}`} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = '', ...props },
  ref,
) {
  return <textarea ref={ref} rows={4} {...props} className={`${fieldBase} ${className}`} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', ...props },
  ref,
) {
  return <select ref={ref} {...props} className={`${fieldBase} ${className}`} />;
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: 'text-ok border-ok/40 bg-ok/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  bad: 'text-bad border-bad/40 bg-bad/10',
  info: 'text-info border-info/40 bg-info/10',
  muted: 'text-muted border-line-strong bg-surface-2',
};
const STATUS_TONE: Record<string, keyof typeof TONE> = {
  active: 'ok',
  up: 'ok',
  online: 'ok',
  succeeded: 'ok',
  resolved: 'ok',
  completed: 'ok',
  accepted: 'ok',
  executed: 'ok',
  deployed: 'ok',
  published: 'ok',
  implemented: 'ok',
  approved: 'info',
  claimed: 'info',
  in_review: 'info',
  investigating: 'info',
  deploying: 'info',
  running: 'info',
  verifying: 'info',
  under_review: 'info',
  open: 'warn',
  pending: 'warn',
  pending_execution: 'warn',
  degraded: 'warn',
  awaiting_approval: 'warn',
  monitoring: 'warn',
  scheduled: 'warn',
  failed: 'bad',
  down: 'bad',
  rejected: 'bad',
  sev1: 'bad',
  sev2: 'warn',
};

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'muted'}>{statusLabel(status)}</Badge>;
}

export function FactionTag({ factionKey, name }: { factionKey: string | null | undefined; name?: string | null }) {
  if (!factionKey) return <span className="text-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2 rounded-full"
        style={{ background: FACTION_COLORS[factionKey] ?? 'var(--muted)' }}
        aria-hidden
      />
      {name ?? factionKey}
    </span>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-base">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function KeyValues({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { message?: string; status?: number; requestId?: string };
  const forbidden = e.status === 403;
  return (
    <div className="rounded-lg border border-bad/40 bg-bad/5 px-4 py-3 text-sm" role="alert">
      <p className="font-medium text-bad">{forbidden ? 'Keine Berechtigung' : 'Daten konnten nicht geladen werden'}</p>
      <p className="mt-0.5 text-muted">
        {e.message}
        {e.requestId ? ` (Referenz ${e.requestId})` : ''}
      </p>
      {onRetry && !forbidden && (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          Erneut laden
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Wird geladen">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-2xl">
        <h1 className="text-2xl">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
