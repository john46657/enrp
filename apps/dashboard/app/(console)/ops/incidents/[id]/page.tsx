'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { SEVERITY_OPTIONS } from '@/components/data/options';
import { Timeline, type TimelineEvent } from '@/components/data/timeline';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, patch, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Detail {
  incident: {
    id: string;
    number: number;
    title: string;
    description: string;
    severity: string;
    status: string;
    assigneeId: string | null;
    source: string;
    createdBy: string;
    createdAt: string;
    resolution: string | null;
    resolvedAt: string | null;
  };
  events: TimelineEvent[];
}

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const q = useQuery({ queryKey: ['incident', id], queryFn: () => get<Detail>(`/incidents/${id}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { incident: i, events } = q.data!;
  const invalidate = [
    ['incident', id],
    ['list', '/incidents'],
  ];
  const open = i.status !== 'resolved';
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Vorfall #${i.number}`}
        description={i.title}
        actions={
          open &&
          can('incidents:edit') && (
            <>
              <ActionDialog
                title="Vorfall aktualisieren"
                submitLabel="Speichern"
                fields={[
                  {
                    name: 'status',
                    label: 'Status',
                    type: 'select',
                    defaultValue: i.status,
                    options: [
                      { value: 'open', label: 'Offen' },
                      { value: 'investigating', label: 'Untersuchung' },
                      { value: 'monitoring', label: 'Beobachtung' },
                    ],
                  },
                  {
                    name: 'severity',
                    label: 'Priorität',
                    type: 'select',
                    defaultValue: i.severity,
                    options: SEVERITY_OPTIONS,
                  },
                  { name: 'assigneeId', label: 'Zuständig (Discord-ID)', defaultValue: i.assigneeId ?? '' },
                  { name: 'comment', label: 'Kommentar', type: 'textarea' },
                ]}
                onSubmit={(v) => patch(`/incidents/${i.id}`, v)}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Aktualisieren</Button>}
              />
              <ActionDialog
                title="Vorfall abschließen"
                submitLabel="Abschließen"
                fields={[{ name: 'resolution', label: 'Ursache und Lösung', type: 'textarea', required: true }]}
                onSubmit={(v) => post(`/incidents/${i.id}/resolve`, v)}
                invalidate={invalidate}
                trigger={(o) => (
                  <Button variant="primary" onClick={o}>
                    Abschließen
                  </Button>
                )}
              />
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title="Verlauf">
          {i.description && <p className="mb-4 whitespace-pre-wrap">{i.description}</p>}
          <Timeline events={events} />
        </Panel>
        <Panel title="Details">
          <KeyValues
            items={[
              ['Status', <StatusBadge key="s" status={i.status} />],
              ['Priorität', i.severity.toUpperCase()],
              ['Zuständig', i.assigneeId ?? 'niemand'],
              ['Quelle', i.source],
              ['Eröffnet', `${fmtDateTime(i.createdAt)} (${i.createdBy})`],
              ...(i.resolvedAt
                ? [['Abgeschlossen', `${fmtDateTime(i.resolvedAt)}: ${i.resolution}`] as [string, string]]
                : []),
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
