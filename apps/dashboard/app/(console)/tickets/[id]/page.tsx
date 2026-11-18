'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Timeline, type TimelineEvent } from '@/components/data/timeline';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';
import { PriorityBadge, type Ticket } from '@/components/data/tickets';

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const me = useSession();
  const q = useQuery({
    queryKey: ['ticket', id],
    queryFn: () =>
      get<{
        ticket: Ticket & { closeReason: string | null; closedAt: string | null };
        events: TimelineEvent[];
        canViewInternal: boolean;
      }>(`/tickets/${id}`),
  });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { ticket: t, events, canViewInternal } = q.data!;
  const invalidate = [
    ['ticket', id],
    ['list', '/tickets'],
  ];
  const action = (body: Record<string, unknown>) => (_: unknown, k: string) =>
    post(`/tickets/${t.id}/actions`, body, k);
  const closed = t.status === 'closed';
  const team = can('tickets:edit');
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Ticket #${t.number}`}
        description={t.subject}
        actions={
          <>
            {team && !closed && !t.assigneeDiscordId && (
              <ActionDialog
                title="Ticket übernehmen"
                submitLabel="Übernehmen"
                fields={[]}
                onSubmit={action({ action: 'claim' })}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Übernehmen
                  </Button>
                )}
              />
            )}
            {team && !closed && (
              <ActionDialog
                title="Zuweisen"
                description="Discord-ID der bearbeitenden Person (leer = freigeben)."
                submitLabel="Zuweisen"
                fields={[
                  { name: 'assigneeDiscordId', label: 'Discord-ID' },
                  { name: 'team', label: 'Team', placeholder: 'z. B. support, fraktionen' },
                ]}
                onSubmit={(v, k) =>
                  post(
                    `/tickets/${t.id}/actions`,
                    { action: 'assign', assigneeDiscordId: v.assigneeDiscordId ?? null, team: v.team ?? null },
                    k,
                  )
                }
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Zuweisen</Button>}
              />
            )}
            {team && !closed && (
              <ActionDialog
                title="Priorität setzen"
                submitLabel="Speichern"
                fields={[
                  {
                    name: 'priority',
                    label: 'Priorität',
                    type: 'select',
                    required: true,
                    defaultValue: t.priority,
                    options: [
                      { value: 'low', label: 'Niedrig' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'high', label: 'Hoch' },
                      { value: 'urgent', label: 'Dringend' },
                    ],
                  },
                ]}
                onSubmit={(v, k) => post(`/tickets/${t.id}/actions`, { action: 'priority', priority: v.priority }, k)}
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Priorität</Button>}
              />
            )}
            {!closed && (team || t.creatorDiscordId === me.user.id) && (
              <ActionDialog
                title="Ticket schließen"
                submitLabel="Schließen"
                danger
                requireReason
                fields={[]}
                onSubmit={(v, k) => post(`/tickets/${t.id}/actions`, { action: 'close', reason: v.reason }, k)}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="danger" onClick={open}>
                    Schließen
                  </Button>
                )}
              />
            )}
            {closed && team && (
              <ActionDialog
                title="Ticket wieder öffnen"
                submitLabel="Wieder öffnen"
                requireReason
                fields={[]}
                onSubmit={(v, k) => post(`/tickets/${t.id}/actions`, { action: 'reopen', reason: v.reason }, k)}
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Wieder öffnen</Button>}
              />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel
          title="Verlauf"
          actions={
            !closed && (
              <>
                <ActionDialog
                  title="Nachricht schreiben"
                  submitLabel="Senden"
                  fields={[{ name: 'body', label: 'Nachricht', type: 'textarea', required: true }]}
                  onSubmit={(v, k) => post(`/tickets/${t.id}/messages`, { body: v.body, internal: false }, k)}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
                      Nachricht
                    </Button>
                  )}
                />
                {can('ticket_internal:create') && (
                  <ActionDialog
                    title="Interne Notiz"
                    description="Nur für Teammitglieder mit Berechtigung sichtbar."
                    submitLabel="Notiz speichern"
                    fields={[{ name: 'body', label: 'Notiz', type: 'textarea', required: true }]}
                    onSubmit={(v, k) => post(`/tickets/${t.id}/messages`, { body: v.body, internal: true }, k)}
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Interne Notiz
                      </Button>
                    )}
                  />
                )}
              </>
            )
          }
        >
          <Timeline events={events} />
          {!canViewInternal && (
            <p className="mt-3 text-xs text-muted">Interne Notizen des Teams sind für dich nicht sichtbar.</p>
          )}
        </Panel>
        <Panel title="Details">
          <KeyValues
            items={[
              ['Status', <StatusBadge key="s" status={t.status} />],
              ['Priorität', <PriorityBadge key="p" p={t.priority} />],
              ['Kategorie', t.category],
              ['Erstellt von', t.creatorDiscordId],
              ['Bearbeitung', t.assigneeDiscordId ?? 'niemand'],
              ['Discord-Kanal', t.discordChannelId ?? '–'],
              ['Erstellt', fmtDateTime(t.createdAt)],
              ...(t.closedAt
                ? [['Geschlossen', `${fmtDateTime(t.closedAt)}: ${t.closeReason ?? ''}`] as [string, string]]
                : []),
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
