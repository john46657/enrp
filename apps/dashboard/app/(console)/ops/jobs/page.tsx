'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Queues {
  configured: boolean;
  queues: Record<string, Record<string, number>> | null;
  failed: Array<{
    queue: string;
    id: string;
    name: string;
    failedReason: string;
    attemptsMade: number;
    timestamp: number;
  }>;
  recentRuns: Array<{
    id: string;
    queue: string;
    name: string;
    status: string;
    attempts: number;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
}
const QUEUE_LABEL: Record<string, string> = {
  discord: 'Discord-Aktionen',
  maintenance: 'Wartung & Planung',
  backups: 'Backups',
  automations: 'Automatisierungen',
};

export default function JobsPage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['queues'],
    queryFn: () => get<Queues>('/monitoring/queues'),
    refetchInterval: 15_000,
  });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Warteschlangen & Hintergrundjobs"
        description="Der Worker verarbeitet Discord-Aktionen, geplante Veröffentlichungen, Watchdogs, Aufbewahrungsfristen und Backups."
      />
      {!d.configured ? (
        <EmptyState title="Warteschlange nicht verbunden">
          Ohne REDIS_URL werden keine Hintergrundjobs ausgeführt.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(d.queues ?? {}).map(([name, c]) => (
            <Panel key={name} title={QUEUE_LABEL[name] ?? name}>
              <dl className="tabular grid grid-cols-2 gap-1 text-sm">
                {(['waiting', 'active', 'delayed', 'failed'] as const).map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">
                      {{ waiting: 'Wartend', active: 'Aktiv', delayed: 'Geplant', failed: 'Fehlgeschlagen' }[k]}
                    </dt>
                    <dd className={k === 'failed' && c[k] ? 'text-bad' : ''}>{c[k] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ))}
        </div>
      )}
      {d.failed.length > 0 && (
        <Panel title="Fehlgeschlagene Jobs">
          <ul className="divide-y divide-line text-sm">
            {d.failed.map((f) => (
              <li key={`${f.queue}-${f.id}`} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">
                  {f.queue}/{f.name}
                </span>
                <span className="text-muted">{fmtDateTime(new Date(f.timestamp).toISOString())}</span>
                <span className="min-w-0 flex-1 text-bad">{f.failedReason}</span>
                {can('jobs:edit') && (
                  <ActionDialog
                    title="Job erneut ausführen"
                    submitLabel="Erneut ausführen"
                    fields={[]}
                    onSubmit={() => post(`/monitoring/queues/${f.queue}/jobs/${f.id}/retry`)}
                    invalidate={[['queues']]}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Wiederholen
                      </Button>
                    )}
                  />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Letzte Ausführungen">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1.5 font-medium">Job</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Versuch</th>
                <th className="font-medium">Start</th>
                <th className="font-medium">Fehler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.recentRuns.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5">
                    {r.queue}/{r.name}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="tabular">{r.attempts}</td>
                  <td>{fmtDateTime(r.startedAt)}</td>
                  <td className="max-w-md truncate text-bad">{r.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
