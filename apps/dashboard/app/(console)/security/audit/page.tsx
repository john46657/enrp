'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, ErrorState, Input, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Event {
  id: number;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  requestId: string | null;
}

function DiffDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['audit', id],
    queryFn: () =>
      get<{ event: Event & { metadata: unknown }; diff: Array<{ path: string; before: unknown; after: unknown }> }>(
        `/audit/${id}`,
      ),
    enabled: id !== null,
  });
  return (
    <Dialog open={id !== null} onClose={onClose} title={`Audit-Eintrag ${id ?? ''}`} wide>
      {q.isLoading ? (
        <Skeleton rows={3} />
      ) : q.data ? (
        <div className="space-y-3 text-sm">
          <p>
            <strong>{q.data.event.action}</strong> auf {q.data.event.resourceType} {q.data.event.resourceId} durch{' '}
            {q.data.event.actorId ?? q.data.event.actorType}, {fmtDateTime(q.data.event.occurredAt)}
          </p>
          {q.data.event.reason && <p>Begründung: {q.data.event.reason}</p>}
          {q.data.diff.length ? (
            <table className="w-full text-left">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 font-medium">Feld</th>
                  <th className="font-medium">Vorher</th>
                  <th className="font-medium">Nachher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {q.data.diff.map((d) => (
                  <tr key={d.path}>
                    <td className="py-1 pr-3 font-mono text-xs">{d.path}</td>
                    <td className="pr-3 font-mono text-xs break-all text-bad">{JSON.stringify(d.before)}</td>
                    <td className="font-mono text-xs break-all text-ok">{JSON.stringify(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted">Keine Vorher/Nachher-Daten gespeichert.</p>
          )}
          {q.data.event.metadata !== null && q.data.event.metadata !== undefined && (
            <pre className="overflow-x-auto rounded bg-bg p-2 text-xs">
              {JSON.stringify(q.data.event.metadata, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

export default function AuditPage() {
  const can = useCan();
  const [filters, setFilters] = useState({ actorId: '', action: '', resourceType: '', resourceId: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ['list', '/audit', applied, page],
    queryFn: () => get<{ items: Event[]; total: number }>('/audit', { ...applied, page, pageSize: 50 }),
  });
  const verify = useMutation({
    mutationFn: () => get<{ ok: boolean; checked: number; brokenAt?: { id: number; reason: string } }>('/audit/verify'),
  });

  function download(data: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit-Log"
        description="Unveränderliches Protokoll aller Verwaltungsaktionen. Jeder Eintrag ist per Hash mit dem vorherigen verkettet."
        actions={
          <>
            <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
              {verify.isPending ? 'Prüfe …' : 'Integrität prüfen'}
            </Button>
            {can('audit:export') && (
              <ActionDialog
                title="Audit-Log exportieren"
                description="Höchstens 31 Tage. Der Export selbst wird protokolliert."
                submitLabel="Exportieren"
                requireReason
                fields={[
                  { name: 'from', label: 'Von', type: 'datetime', required: true },
                  { name: 'to', label: 'Bis', type: 'datetime', required: true },
                ]}
                onSubmit={(v) =>
                  post('/audit/export', { ...v, ...Object.fromEntries(Object.entries(applied).filter(([, x]) => x)) })
                }
                onDone={(r) => download(r, `audit-export-${new Date().toISOString().slice(0, 10)}.json`)}
                successMessage="Export erstellt"
                trigger={(open) => <Button onClick={open}>Exportieren</Button>}
              />
            )}
          </>
        }
      />
      {verify.data && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${verify.data.ok ? 'border-ok/50 bg-ok/10' : 'border-bad bg-bad/10'}`}
          role="status"
        >
          {verify.data.ok
            ? `Hash-Kette intakt: ${verify.data.checked} Einträge geprüft.`
            : `Manipulation erkannt bei Eintrag ${verify.data.brokenAt?.id}: ${verify.data.brokenAt?.reason}`}
        </div>
      )}
      {verify.error && <ErrorState error={verify.error} />}
      <Panel>
        <form
          className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied(filters);
          }}
        >
          <Input
            aria-label="Akteur"
            placeholder="Akteur (Discord-ID)"
            value={filters.actorId}
            onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}
          />
          <Input
            aria-label="Aktion"
            placeholder="Aktion, z. B. moderation."
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          />
          <Input
            aria-label="Ressourcentyp"
            placeholder="Ressourcentyp"
            value={filters.resourceType}
            onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
          />
          <Input
            aria-label="Ressourcen-ID"
            placeholder="Ressourcen-ID"
            value={filters.resourceId}
            onChange={(e) => setFilters({ ...filters, resourceId: e.target.value })}
          />
          <Button type="submit">Filtern</Button>
        </form>
        {list.isLoading ? (
          <Skeleton rows={10} />
        ) : list.error ? (
          <ErrorState error={list.error} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1.5 font-medium">#</th>
                    <th className="font-medium">Zeitpunkt</th>
                    <th className="font-medium">Aktion</th>
                    <th className="font-medium">Ressource</th>
                    <th className="font-medium">Akteur</th>
                    <th className="font-medium">Begründung</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data!.items.map((e) => (
                    <tr key={e.id} className="hover:bg-surface-2">
                      <td className="tabular py-1.5">
                        <button className="hover:text-signal hover:underline" onClick={() => setDetail(e.id)}>
                          {e.id}
                        </button>
                      </td>
                      <td className="whitespace-nowrap">{fmtDateTime(e.occurredAt)}</td>
                      <td>{e.action}</td>
                      <td className="text-muted">
                        {e.resourceType}
                        {e.resourceId ? ` ${e.resourceId.slice(0, 12)}` : ''}
                      </td>
                      <td>
                        {e.actorType !== 'user' && <Badge>{e.actorType}</Badge>} {e.actorId}
                      </td>
                      <td className="max-w-xs truncate text-muted">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-muted">
              <span className="tabular">{list.data!.total.toLocaleString('de-DE')} Einträge</span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Zurück
                </Button>
                <Button size="sm" disabled={page * 50 >= list.data!.total} onClick={() => setPage(page + 1)}>
                  Weiter
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
      <DiffDialog id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
