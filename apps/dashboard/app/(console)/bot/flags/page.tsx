'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Flag {
  key: string;
  description: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

export default function FlagsPage() {
  const can = useCan();
  const q = useQuery({ queryKey: ['flags'], queryFn: () => get<{ items: Flag[] }>('/flags') });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const kill = q.data!.items.find((f) => f.key === 'kill_switch');
  const others = q.data!.items.filter((f) => f.key !== 'kill_switch');
  const invalidate = [['flags'], ['overview']];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature-Flags & Kill-Switch"
        description="Flags schalten Funktionen ab, ersetzen aber nie Anmeldung oder Berechtigungsprüfungen."
        actions={
          can('feature_flags:configure') && (
            <ActionDialog
              title="Neues Flag"
              submitLabel="Anlegen"
              requireReason
              fields={[
                { name: 'key', label: 'Name (a–z, 0–9, _)', required: true },
                { name: 'description', label: 'Beschreibung', required: true },
                { name: 'enabled', label: 'Sofort aktiv', type: 'checkbox' },
              ]}
              onSubmit={(v) =>
                put(`/flags/${v.key}`, { enabled: Boolean(v.enabled), description: v.description, reason: v.reason })
              }
              invalidate={invalidate}
              trigger={(open) => <Button onClick={open}>Flag anlegen</Button>}
            />
          )
        }
      />
      <section className={`rounded-lg border p-5 ${kill?.enabled ? 'border-bad bg-bad/10' : 'border-line bg-surface'}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-lg">Notfall-Kill-Switch</h2>
            <p className="mt-1 text-sm text-muted">
              Sperrt sofort alle schreibenden Aktionen in Bot und API sowie Spielereignisse (außer Betreten/Verlassen).
              Anmeldung, Lesezugriffe und das Aufheben bleiben möglich.
            </p>
            {kill && (
              <p className="mt-2 text-sm">
                {kill.enabled
                  ? `Aktiv seit ${fmtDateTime(kill.updatedAt)} (${kill.updatedBy ?? 'unbekannt'})`
                  : `Zuletzt geändert ${fmtDateTime(kill.updatedAt)}`}
              </p>
            )}
          </div>
          {can('feature_flags:edit') && (
            <ActionDialog
              title={kill?.enabled ? 'Kill-Switch deaktivieren' : 'Kill-Switch aktivieren'}
              submitLabel={kill?.enabled ? 'Deaktivieren' : 'Aktivieren'}
              danger={!kill?.enabled}
              requireReason
              confirmWord={kill?.enabled ? undefined : 'NOTFALL'}
              fields={[]}
              onSubmit={(v) => put('/flags/kill_switch', { enabled: !kill?.enabled, reason: v.reason })}
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant={kill?.enabled ? 'secondary' : 'danger'} onClick={open}>
                  {kill?.enabled ? 'Kill-Switch deaktivieren' : 'Kill-Switch aktivieren'}
                </Button>
              )}
            />
          )}
        </div>
      </section>
      <Panel title="Feature-Flags">
        <ul className="divide-y divide-line">
          {others.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-56 flex-1">
                <p className="font-medium">
                  <code>{f.key}</code>
                </p>
                <p className="text-sm text-muted">{f.description}</p>
              </div>
              <Badge tone={f.enabled ? 'ok' : 'muted'}>{f.enabled ? 'aktiv' : 'aus'}</Badge>
              <span className="text-xs text-muted">{fmtDateTime(f.updatedAt)}</span>
              {can('feature_flags:edit') && (
                <ActionDialog
                  title={`${f.key} ${f.enabled ? 'deaktivieren' : 'aktivieren'}`}
                  submitLabel={f.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  requireReason
                  fields={[]}
                  onSubmit={(v) => put(`/flags/${f.key}`, { enabled: !f.enabled, reason: v.reason })}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
                      {f.enabled ? 'Deaktivieren' : 'Aktivieren'}
                    </Button>
                  )}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
