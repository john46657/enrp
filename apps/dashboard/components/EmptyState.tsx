import type { ReactNode } from 'react';

/** Leerzustand: sagt klar, warum hier (noch) nichts ist und was als Nächstes passiert. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="empty-state" aria-label={title}>
      <h2>{title}</h2>
      <div className="empty-state__body">{children}</div>
    </section>
  );
}
