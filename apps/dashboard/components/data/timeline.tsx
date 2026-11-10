import { Lock } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';

export interface TimelineEvent {
  id: string;
  type: string;
  actorId: string | null;
  body: string | null;
  internal: boolean;
  createdAt: string;
}

const LABELS: Record<string, string> = {
  created: 'erstellt',
  message: 'Nachricht',
  note: 'Interne Notiz',
  claim: 'übernommen',
  unclaim: 'freigegeben',
  assign: 'zugewiesen',
  status: 'Status geändert',
  priority: 'Priorität geändert',
  close: 'geschlossen',
  closed: 'geschlossen',
  reopen: 'wieder geöffnet',
  reopened: 'wieder geöffnet',
  resolved: 'abgeschlossen',
  updated: 'aktualisiert',
  comment: 'Kommentar',
  reference_added: 'Referenz hinzugefügt',
  moderation: 'Moderationsaktion verknüpft',
};

/** Verlauf eines Vorgangs; interne Notizen sind deutlich gekennzeichnet. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted">Noch kein Verlauf.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li
          key={e.id}
          className={`rounded-md border px-3 py-2 text-sm ${e.internal ? 'border-warn/40 bg-warn/5' : 'border-line'}`}
        >
          <p className="flex flex-wrap items-center gap-2 text-muted">
            {e.internal && <Lock className="size-3.5 text-warn" aria-label="Intern" />}
            <span className="text-text">{LABELS[e.type] ?? e.type.replace(/^status\./, 'Status: ')}</span>
            <span>{e.actorId ?? 'System'}</span>
            <span className="ml-auto">{fmtDateTime(e.createdAt)}</span>
          </p>
          {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
        </li>
      ))}
    </ol>
  );
}
