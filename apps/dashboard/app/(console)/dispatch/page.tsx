'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { DISPATCH_PRIORITY_OPTIONS, UNIT_STATUS_OPTIONS } from '@/components/data/options';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, Button, PageHeader, Panel, StatusBadge } from '@/components/ui/primitives';
import { get, post, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Incident {
  id: string;
  number: number;
  source: 'ingame' | 'discord' | 'dashboard';
  title: string;
  location: string;
  priority: number;
  department: string;
  status: string;
  callerName: string | null;
  activeUnits: number;
  createdAt: string;
}

interface Unit {
  unitId: string;
  callsign: string | null;
  status: string;
  incidentNumber: number | null;
  username: string | null;
  globalName: string | null;
  inGame: { team: string | null; jobId: string } | null;
  updatedAt: string;
}

interface Stats {
  total: number;
  open: number;
  closed: number;
  ingame: number;
  avgAssignSeconds: number | null;
  avgDurationSeconds: number | null;
}

const OPEN = 'open,assigned,en_route,on_scene';

const minutes = (seconds: number | null) => (seconds === null ? '–' : `${Math.round(seconds / 60)} Min.`);

function PriorityBadge({ priority }: { priority: number }) {
  return <Badge tone={priority === 1 ? 'bad' : priority === 2 ? 'warn' : 'muted'}>{`P${priority}`}</Badge>;
}

/** Leitstelle: Einsätze aus Ingame-Notrufen und eigene Einsätze, Einheiten und Kennzahlen – live aktualisiert. */
export default function DispatchPage() {
  const can = useCan();
  const units = useQuery({ queryKey: ['dispatch-units'], queryFn: () => get<{ items: Unit[] }>('/dispatch/units') });
  const stats = useQuery({ queryKey: ['dispatch-stats'], queryFn: () => get<Stats>('/dispatch/stats', { days: 7 }) });
  return (
    <>
      <PageHeader
        title="Einsätze & Einheiten"
        description="Notrufe aus dem Spiel erscheinen hier automatisch. Eigene Einsätze der Leitstelle sind als solche gekennzeichnet."
        actions={
          <>
            {can('dispatch:edit') && (
              <ActionDialog
                title="Mein Status"
                submitLabel="Speichern"
                successMessage="Status gespeichert"
                fields={[
                  {
                    name: 'status',
                    label: 'Status',
                    type: 'select',
                    required: true,
                    defaultValue: 'available',
                    options: UNIT_STATUS_OPTIONS,
                  },
                  { name: 'callsign', label: 'Rufname', placeholder: 'z. B. Adler 12/1' },
                ]}
                onSubmit={(v) => put('/dispatch/units/me', { status: v.status, callsign: v.callsign ?? undefined })}
                invalidate={[['dispatch-units']]}
                trigger={(open) => <Button onClick={open}>Mein Status</Button>}
              />
            )}
            {can('dispatch:create') && (
              <ActionDialog
                title="Einsatz anlegen"
                submitLabel="Anlegen"
                successMessage={(i) => `Einsatz #${(i as Incident).number} angelegt`}
                fields={[
                  { name: 'title', label: 'Titel', required: true },
                  { name: 'location', label: 'Ort', required: true },
                  { name: 'description', label: 'Beschreibung', type: 'textarea' },
                  {
                    name: 'priority',
                    label: 'Priorität',
                    type: 'select',
                    defaultValue: '2',
                    options: DISPATCH_PRIORITY_OPTIONS,
                  },
                  { name: 'department', label: 'Bereich', placeholder: 'Leer = erster Bereich aus der Konfiguration' },
                ]}
                onSubmit={(v, k) =>
                  post(
                    '/dispatch/incidents',
                    {
                      title: v.title,
                      location: v.location,
                      description: v.description || undefined,
                      priority: Number(v.priority ?? 2),
                      department: v.department || undefined,
                    },
                    k,
                  )
                }
                invalidate={[['list', '/dispatch/incidents'], ['dispatch-stats']]}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Einsatz anlegen
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      {stats.data && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Einsätze (7 Tage)', String(stats.data.total)],
            ['Offen', String(stats.data.open)],
            ['Ingame-Notrufe', String(stats.data.ingame)],
            ['Ø bis Zuweisung', minutes(stats.data.avgAssignSeconds)],
            ['Ø Einsatzdauer', minutes(stats.data.avgDurationSeconds)],
          ].map(([label, value]) => (
            <div key={label} className="rounded border border-line bg-surface p-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <ResourceTable<Incident>
          path="/dispatch/incidents"
          rowKey={(i) => i.id}
          rowHref={(i) => `/dispatch/${i.number}`}
          baseQuery={{ status: OPEN }}
          filters={[
            {
              name: 'status',
              label: 'Status',
              options: [
                { value: OPEN, label: 'Offene Einsätze' },
                { value: 'closed', label: 'Abgeschlossen' },
                { value: `${OPEN},closed`, label: 'Alle' },
              ],
            },
            {
              name: 'source',
              label: 'Quelle',
              options: [
                { value: 'ingame', label: 'Ingame-Notruf' },
                { value: 'discord', label: 'Discord' },
                { value: 'dashboard', label: 'Dashboard' },
              ],
            },
          ]}
          emptyTitle="Keine Einsätze"
          emptyText="Notrufe aus dem Spiel (/notruf, /110, /112) und eigene Einsätze erscheinen hier."
          columns={[
            {
              key: 'n',
              header: 'Einsatz',
              render: (i) => (
                <span>
                  {i.source === 'ingame' ? '🎮 ' : '📝 '}#{i.number} {i.title}
                </span>
              ),
              sortValue: (i) => i.number,
            },
            {
              key: 'p',
              header: 'Prio',
              render: (i) => <PriorityBadge priority={i.priority} />,
              sortValue: (i) => i.priority,
            },
            { key: 's', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
            { key: 'd', header: 'Bereich', render: (i) => i.department },
            { key: 'l', header: 'Ort', render: (i) => i.location || '–' },
            { key: 'u', header: 'Einheiten', render: (i) => String(i.activeUnits), sortValue: (i) => i.activeUnits },
            { key: 'c', header: 'Eingang', render: (i) => fmtDateTime(i.createdAt), sortValue: (i) => i.createdAt },
          ]}
        />
        <Panel title={`Einheiten im Dienst (${units.data?.items.length ?? 0})`}>
          {units.data?.items.length ? (
            <ul className="space-y-2 text-sm">
              {units.data.items.map((u) => (
                <li key={u.unitId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{u.callsign ?? u.globalName ?? u.username ?? u.unitId}</strong>
                    {u.incidentNumber ? <span className="text-muted"> · #{u.incidentNumber}</span> : null}
                    {u.inGame ? <span className="text-muted"> · 🎮 {u.inGame.team ?? 'im Spiel'}</span> : null}
                  </span>
                  <StatusBadge status={u.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Niemand im Dienst. „Mein Status“ setzt den eigenen Status.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
