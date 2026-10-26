'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Timeline, type TimelineEvent } from '@/components/data/timeline';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, patch } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Detail {
  case: {
    id: string;
    number: number;
    title: string;
    summary: string;
    status: string;
    subjectRobloxId: number | null;
    subjectDiscordId: string | null;
    createdBy: string;
    createdAt: string;
    closeReason: string | null;
  };
  references: Array<{
    id: string;
    kind: string;
    value: string;
    label: string | null;
    addedBy: string;
    createdAt: string;
  }>;
  events: TimelineEvent[];
}

const KIND_LABEL: Record<string, string> = {
  url: 'Link',
  report: 'Report',
  ticket: 'Ticket',
  moderation_action: 'Moderationsaktion',
  discord_message: 'Discord-Nachricht',
};

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const q = useQuery({ queryKey: ['case', id], queryFn: () => get<Detail>(`/cases/${id}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { case: c, references, events } = q.data!;
  const invalidate = [
    ['case', id],
    ['list', '/cases'],
  ];
  const open = c.status === 'open';
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Fall #${c.number}: ${c.title}`}
        actions={
          can('cases:edit') && (
            <>
              <ActionDialog
                title="Referenz hinzufügen"
                description="Nur HTTPS-Links (z. B. Clips) oder interne Nummern. Dateien werden nicht gespeichert."
                submitLabel="Hinzufügen"
                fields={[
                  {
                    name: 'kind',
                    label: 'Art',
                    type: 'select',
                    required: true,
                    options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
                  },
                  { name: 'value', label: 'Link oder Nummer/ID', required: true },
                  { name: 'label', label: 'Bezeichnung' },
                ]}
                onSubmit={(v) => patch(`/cases/${c.id}`, { addReference: v })}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Referenz hinzufügen</Button>}
              />
              <ActionDialog
                title="Interne Notiz"
                submitLabel="Speichern"
                fields={[{ name: 'note', label: 'Notiz', type: 'textarea', required: true }]}
                onSubmit={(v) => patch(`/cases/${c.id}`, { note: v.note })}
                invalidate={invalidate}
                trigger={(o) => <Button onClick={o}>Notiz</Button>}
              />
              {open ? (
                <ActionDialog
                  title="Fall schließen"
                  submitLabel="Schließen"
                  requireReason
                  fields={[]}
                  onSubmit={(v) => patch(`/cases/${c.id}`, { close: { reason: v.reason } })}
                  invalidate={invalidate}
                  trigger={(o) => (
                    <Button variant="danger" onClick={o}>
                      Schließen
                    </Button>
                  )}
                />
              ) : (
                <ActionDialog
                  title="Fall wieder öffnen"
                  submitLabel="Wieder öffnen"
                  fields={[]}
                  onSubmit={() => patch(`/cases/${c.id}`, { reopen: true })}
                  invalidate={invalidate}
                  trigger={(o) => <Button onClick={o}>Wieder öffnen</Button>}
                />
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Panel title="Zusammenfassung">
            <p className="whitespace-pre-wrap">{c.summary}</p>
          </Panel>
          <Panel title="Referenzen">
            {references.length ? (
              <ul className="space-y-1.5 text-sm">
                {references.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="text-muted">{KIND_LABEL[r.kind]}</span>
                    {r.kind === 'url' || r.kind === 'discord_message' ? (
                      <a
                        href={r.value}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {r.label ?? r.value}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span>{r.label ?? r.value}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Keine Referenzen.</p>
            )}
          </Panel>
          <Panel title="Verlauf">
            <Timeline events={events} />
          </Panel>
        </div>
        <Panel title="Details">
          <KeyValues
            items={[
              ['Status', <StatusBadge key="s" status={c.status} />],
              [
                'Roblox',
                c.subjectRobloxId ? (
                  <a key="r" href={`/players/roblox/${c.subjectRobloxId}`} className="hover:underline">
                    {c.subjectRobloxId}
                  </a>
                ) : (
                  '–'
                ),
              ],
              ['Discord', c.subjectDiscordId ?? '–'],
              ['Angelegt von', c.createdBy],
              ['Angelegt', fmtDateTime(c.createdAt)],
              ...(c.closeReason ? [['Abschluss', c.closeReason] as [string, string]] : []),
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
