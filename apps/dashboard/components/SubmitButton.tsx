'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** Absende-Knopf, der sich während der Übertragung sperrt, damit nichts doppelt abgeschickt wird. */
export function SubmitButton({
  children,
  pendingText = 'Wird gespeichert …',
  variant = 'primary',
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`button button--${variant}`} disabled={pending} aria-disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
