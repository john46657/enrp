'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Timeline, type TimelineEvent } from '@/components/data/timeline';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, patch, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Detail {
  report: {
    id: string;
    number: number;
    status: string;
    description: string;
    ruleReference: string | null;
    reporterDiscordId: string;
    reportedRobloxId: number | null;
    reportedDiscordId: string | null;
    assigneeDiscordId: string | null;
    resolution: string | null;
    createdAt: string;
    resolvedAt: string | null;
  };
  events: TimelineEvent[];
}

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const q = useQuery({ queryKey: ['report', id], queryFn: () => get<Detail>(`/reports/${id}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { report: r, events } = q.data!;
  const invalidate = [
    ['report', id],
    ['list', '/reports'],
  ];
  const done = r.status === 'resolved' || r.status === 'rejected';
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Report #${r.number}`}
        actions={
          can('reports:edit') && (
            <>
              {!done && r.status !== 'in_review' && (
                <ActionDialog
                  title="Prüfung beginnen"
                  submitLabel="In Prüfung nehmen"
                  fields={[]}
                  onSubmit={() => patch(`/reports/${r.id}`, { status: 'in_review' })}
                  invalidate={invalidate}
                  trigger={(open) => <Button onClick={open}>In Prüfung nehmen</Button>}
                />
              )}
              <ActionDialog
                title="Interne Notiz"
                submitLabel="Speichern"
                fields={[{ name: 'note', label: 'Notiz', type: 'textarea', required: true }]}
                onSubmit={(v) => patch(`/reports/${r.id}`, { note: v.note })}
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Notiz</Button>}
              />
              {!done && (
                <ActionDialog
                  title="Report abschließen"
                  submitLabel="Abschließen"
                  fields={[
                    {
                      name: 'status',
                      label: 'Ergebnis',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'resolved', label: 'Erledigt (Verstoß bestätigt)' },
                        { value: 'rejected', label: 'Abgelehnt' },
                      ],
                    },
                    { name: 'resolution', label: 'Begründung', type: 'textarea', required: true },
                  ]}
                  onSubmit={(v) => patch(`/reports/${r.id}`, v)}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button variant="primary" onClick={open}>
                      Abschließen
                    </Button>
                  )}
                />
              )}
              {!done && can('moderation:create') && (
                <ActionDialog
                  title="Sanktion zum Report"
                  submitLabel="Ausführen"
                  danger
                  requireReason
                  fields={[
                    {
                      name: 'type',
                      label: 'Aktion',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'warn', label: 'Verwarnung' },
                        { value: 'kick', label: 'Kick' },
                        { value: 'ban', label: 'Bann' },
                      ],
                    },
                    {
                      name: 'platform',
                      label: 'Plattform',
                      type: 'select',
                      required: true,
                      options: [
                        {
                          value: r.reportedRobloxId ? 'roblox' : 'discord',
                          label: r.reportedRobloxId ? 'Roblox' : 'Discord',
                        },
                        {
                          value: r.reportedRobloxId ? 'discord' : 'roblox',
                          label: r.reportedRobloxId ? 'Discord' : 'Roblox',
                        },
                      ],
                    },
                    { name: 'durationHours', label: 'Dauer in Stunden', type: 'number' },
                  ]}
                  onSubmit={(v, k) =>
                    post(
                      '/moderation/actions',
                      {
                        type: v.type,
                        platform: v.platform,
                        reason: v.reason,
                        targetDiscordId: r.reportedDiscordId ?? undefined,
                        targetRobloxId: r.reportedRobloxId ?? undefined,
                        relatedReportId: r.id,
                        durationSeconds: v.durationHours ? Math.round(Number(v.durationHours) * 3600) : undefined,
                      },
                      k,
                    )
                  }
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button variant="danger" onClick={open}>
                      Sanktionieren
                    </Button>
                  )}
                />
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title="Meldung">
          <p className="whitespace-pre-wrap">{r.description}</p>
          <div className="mt-6">
            <Timeline events={events} />
          </div>
        </Panel>
        <Panel title="Details">
          <KeyValues
            items={[
              ['Status', <StatusBadge key="s" status={r.status} />],
              ['Regel', r.ruleReference ?? '–'],
              [
                'Gemeldet (Roblox)',
                r.reportedRobloxId ? (
                  <a key="r" className="hover:underline" href={`/players/roblox/${r.reportedRobloxId}`}>
                    {r.reportedRobloxId}
                  </a>
                ) : (
                  '–'
                ),
              ],
              ['Gemeldet (Discord)', r.reportedDiscordId ?? '–'],
              ['Gemeldet von', r.reporterDiscordId],
              ['Eingang', fmtDateTime(r.createdAt)],
              ['Ergebnis', r.resolution ?? '–'],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
