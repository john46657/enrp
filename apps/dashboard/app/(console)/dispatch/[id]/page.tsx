'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { DISPATCH_STATUS_OPTIONS } from '@/components/data/options';
import { Timeline, type TimelineEvent } from '@/components/data/timeline';
import {
  Badge,
  Button,
  ErrorState,
  KeyValues,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Detail {
  incident: {
    id: string;
    number: number;
    source: 'ingame' | 'discord' | 'dashboard';
    title: string;
    description: string;
    location: string;
    priority: number;
    department: string;
    status: string;
    callNumber: number | null;
    createdBy: string;
    createdAt: string;
    closedAt: string | null;
    closedBy: string | null;
    report: string | null;
  };
  assignments: Array<{
    unitId: string;
    callsign: string | null;
    unitStatus: string | null;
    username: string | null;
    globalName: string | null;
    assignedAt: string;
    releasedAt: string | null;
  }>;
  caller: { robloxUserId: number; name: string | null; online: boolean; team: string | null } | null;
  events: TimelineEvent[];
}

const SOURCE: Record<string, string> = {
  ingame: '🎮 Ingame-Notruf',
  discord: '📝 Einsatz der Leitstelle (Discord)',
  dashboard: '📝 Einsatz der Leitstelle (Dashboard)',
};

export default function DispatchIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const q = useQuery({ queryKey: ['dispatch-incident', id], queryFn: () => get<Detail>(`/dispatch/incidents/${id}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { incident: i, assignments, caller, events } = q.data!;
  const invalidate = [
    ['dispatch-incident', id],
    ['list', '/dispatch/incidents'],
    ['dispatch-units'],
    ['dispatch-stats'],
  ];
  const open = i.status !== 'closed';
  const active = assignments.filter((a) => !a.releasedAt);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Einsatz #${i.number}`}
        description={`${i.title}${i.source === 'ingame' && i.callNumber ? ` · Notruf #${i.callNumber}` : ''}`}
        actions={
          open &&
          can('dispatch:edit') && (
            <>
              <ActionDialog
                title="Einsatz übernehmen"
                description="Du wirst als Einheit zugewiesen (Status 3 · Anfahrt). Beim ersten Zuweisen eines Ingame-Notrufs bekommt der Anrufer im Spiel eine Rückmeldung."
                submitLabel="Übernehmen"
                fields={[]}
                onSubmit={() => post(`/dispatch/incidents/${i.id}/assign`, {})}
                invalidate={invalidate}
                trigger={(o) => (
                  <Button variant="primary" onClick={o}>
                    Übernehmen
                  </Button>
                )}
              />
              <ActionDialog
                title="Einheit zuweisen"
                submitLabel="Zuweisen"
                fields={[{ name: 'unitId', label: 'Discord-ID der Einheit', required: true }]}
                onSubmit={(v) => post(`/dispatch/incidents/${i.id}/assign`, { unitId: v.unitId })}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Einheit zuweisen</Button>}
              />
              <ActionDialog
                title="Status ändern"
                submitLabel="Speichern"
                fields={[
                  {
                    name: 'status',
                    label: 'Status',
                    type: 'select',
                    required: true,
                    defaultValue: i.status,
                    options: DISPATCH_STATUS_OPTIONS,
                  },
                ]}
                onSubmit={(v) => post(`/dispatch/incidents/${i.id}/status`, { status: v.status })}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Status</Button>}
              />
              <ActionDialog
                title="Notiz"
                submitLabel="Speichern"
                fields={[{ name: 'text', label: 'Notiz', type: 'textarea', required: true }]}
                onSubmit={(v) => post(`/dispatch/incidents/${i.id}/notes`, { text: v.text })}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Notiz</Button>}
              />
              <ActionDialog
                title="Einsatz abschließen"
                submitLabel="Abschließen"
                fields={[{ name: 'report', label: 'Einsatzbericht', type: 'textarea' }]}
                onSubmit={(v) => post(`/dispatch/incidents/${i.id}/close`, { report: v.report || undefined })}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Abschließen</Button>}
              />
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Panel title="Verlauf">
          {i.description && <p className="mb-4 whitespace-pre-wrap">{i.description}</p>}
          <Timeline events={events} />
          {i.report && (
            <div className="mt-4 rounded border border-line p-3">
              <div className="mb-1 text-xs text-muted">Einsatzbericht</div>
              <p className="whitespace-pre-wrap">{i.report}</p>
            </div>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel title="Details">
            <KeyValues
              items={[
                ['Status', <StatusBadge key="s" status={i.status} />],
                [
                  'Priorität',
                  <Badge
                    key="p"
                    tone={i.priority === 1 ? 'bad' : i.priority === 2 ? 'warn' : 'muted'}
                  >{`P${i.priority}`}</Badge>,
                ],
                ['Quelle', SOURCE[i.source] ?? i.source],
                ['Bereich', i.department],
                ['Ort', i.location || '–'],
                ['Eingang', fmtDateTime(i.createdAt)],
                ...(i.closedAt
                  ? [['Abgeschlossen', `${fmtDateTime(i.closedAt)} (${i.closedBy})`] as [string, string]]
                  : []),
              ]}
            />
          </Panel>
          {caller && (
            <Panel title="Anrufer">
              <KeyValues
                items={[
                  ['Roblox', `${caller.name ?? '–'} (${caller.robloxUserId})`],
                  ['Im Spiel', caller.online ? `🟢 online · ${caller.team ?? 'ohne Team'}` : '⚫ offline'],
                ]}
              />
            </Panel>
          )}
          <Panel title={`Einheiten (${active.length})`}>
            {assignments.length ? (
              <ul className="space-y-2 text-sm">
                {assignments.map((a) => (
                  <li key={`${a.unitId}-${a.assignedAt}`} className="flex items-center justify-between gap-2">
                    <span className={a.releasedAt ? 'text-muted line-through' : ''}>
                      <strong>{a.callsign ?? a.globalName ?? a.username ?? a.unitId}</strong> · seit{' '}
                      {fmtDateTime(a.assignedAt)}
                    </span>
                    {!a.releasedAt && a.unitStatus && <StatusBadge status={a.unitStatus} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Noch keine Einheit zugewiesen.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
