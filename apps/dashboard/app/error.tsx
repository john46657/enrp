'use client';

import { EmptyState } from '@/components/EmptyState';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState title="Diese Seite konnte nicht geladen werden">
      <p>Beim Laden ist ein Fehler aufgetreten. Details stehen im Server-Log.</p>
      <button type="button" className="button" onClick={reset}>
        Erneut laden
      </button>
    </EmptyState>
  );
}
