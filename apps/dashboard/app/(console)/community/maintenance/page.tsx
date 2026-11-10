'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Data {
  current: { active: boolean; flag: boolean; window: { title: string; message: string } | null };
  windows: Array<{ id: string; title: string; message: string; startsAt: string; endsAt: string; status: string }>;
}

export default function MaintenancePage() {
  const can = useCan();
  const q = useQuery({ queryKey: ['maintenance'], queryFn: () => get<Data>('/maintenance') });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  const invalidate = [['maintenance'], ['flags'], ['overview']];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Wartung"
        description="Während der Wartung zeigen Bot und Spiel einen Hinweis; schreibende Community-Aktionen sind gesperrt."
        actions={
          <>
            {can('feature_flags:edit') && (
              <ActionDialog
                title={d.current.flag ? 'Wartungsmodus beenden' : 'Wartungsmodus sofort aktivieren'}
                submitLabel={d.current.flag ? 'Beenden' : 'Aktivieren'}
                requireReason
                fields={[]}
                onSubmit={(v) => put('/flags/maintenance_mode', { enabled: !d.current.flag, reason: v.reason })}
                invalidate={invalidate}
                trigger={(o) => (
                  <Button onClick={o}>{d.current.flag ? 'Wartungsmodus beenden' : 'Wartungsmodus aktivieren'}</Button>
                )}
              />
            )}
            {can('announcements:publish') && (
              <ActionDialog
                title="Wartung planen"
                submitLabel="Planen"
                fields={[
                  { name: 'title', label: 'Titel', required: true },
                  { name: 'message', label: 'Hinweis für Spieler', type: 'textarea', required: true },
                  { name: 'startsAt', label: 'Beginn', type: 'datetime', required: true },
                  { name: 'endsAt', label: 'Ende', type: 'datetime', required: true },
                ]}
                onSubmit={(v) => post('/maintenance', v)}
                invalidate={invalidate}
                trigger={(o) => (
                  <Button variant="primary" onClick={o}>
                    Wartung planen
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      <Panel title="Aktueller Zustand">
        <p>
          {d.current.active
            ? `Wartung aktiv${d.current.window ? `: ${d.current.window.message}` : ' (Wartungsmodus)'}`
            : 'Keine Wartung aktiv.'}
        </p>
      </Panel>
      <Panel title="Wartungsfenster">
        <ul className="divide-y divide-line text-sm">
          {d.windows.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{w.title}</span>
              <StatusBadge status={w.status} />
              <span className="text-muted">
                {fmtDateTime(w.startsAt)} bis {fmtDateTime(w.endsAt)}
              </span>
              {can('announcements:publish') && (w.status === 'scheduled' || w.status === 'active') && (
                <span className="ml-auto flex gap-1">
                  {w.status === 'scheduled' && (
                    <ActionDialog
                      title="Wartung jetzt starten"
                      submitLabel="Starten"
                      fields={[]}
                      onSubmit={() => post(`/maintenance/${w.id}/status`, { status: 'active' })}
                      invalidate={invalidate}
                      trigger={(o) => (
                        <Button size="sm" onClick={o}>
                          Starten
                        </Button>
                      )}
                    />
                  )}
                  {w.status === 'active' && (
                    <ActionDialog
                      title="Wartung beenden"
                      submitLabel="Beenden"
                      fields={[]}
                      onSubmit={() => post(`/maintenance/${w.id}/status`, { status: 'completed' })}
                      invalidate={invalidate}
                      trigger={(o) => (
                        <Button size="sm" onClick={o}>
                          Beenden
                        </Button>
                      )}
                    />
                  )}
                  <ActionDialog
                    title="Wartung absagen"
                    submitLabel="Absagen"
                    danger
                    fields={[]}
                    onSubmit={() => post(`/maintenance/${w.id}/status`, { status: 'cancelled' })}
                    invalidate={invalidate}
                    trigger={(o) => (
                      <Button size="sm" variant="ghost" onClick={o}>
                        Absagen
                      </Button>
                    )}
                  />
                </span>
              )}
            </li>
          ))}
          {!d.windows.length && <li className="text-muted">Keine geplanten Wartungen.</li>}
        </ul>
      </Panel>
    </div>
  );
}
