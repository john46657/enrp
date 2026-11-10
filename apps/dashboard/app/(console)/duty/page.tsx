'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { DUTY_FACTION_OPTIONS, PERIOD_OPTIONS } from '@/components/data/options';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, Button, FactionTag, PageHeader, Panel, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Session {
  id: string;
  robloxUserId: number;
  username: string;
  factionKey: string;
  factionName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  flags: string[];
}

const FLAG_LABELS: Record<string, string> = {
  clock_skew: 'Zeitabweichung',
  double_start: 'Doppelter Start',
  previous_session_closed: 'Vorherige Session beendet',
  server_timeout: 'Server-Timeout',
  max_duration: 'Höchstdauer erreicht',
  player_missing: 'Spieler nicht mehr auf dem Server',
  player_left: 'Spieler hat das Spiel verlassen',
  faction_changed: 'Fraktion gewechselt',
  faction_removed: 'Aus Fraktion entfernt',
  server_shutdown: 'Server heruntergefahren',
  corrected: 'Korrigiert',
};

function DutyContent() {
  const can = useCan();
  const robloxUserId = useSearchParams().get('robloxUserId') ?? undefined;
  const onDuty = useQuery({
    queryKey: ['on-duty'],
    queryFn: () => get<{ items: Array<{ factionKey: string; count: number }> }>('/duty/on-duty'),
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dienstsystem"
        description="Dienstbeginn und -ende meldet ausschließlich der Roblox-Server; maßgeblich ist die Serverzeit des Backends. Auffälligkeiten werden markiert."
      />
      <Panel title="Aktuell im Dienst">
        <div className="flex flex-wrap gap-6">
          {DUTY_FACTION_OPTIONS.map((f) => (
            <div key={f.value}>
              <p className="tabular text-2xl font-semibold">
                {onDuty.data?.items.find((i) => i.factionKey === f.value)?.count ?? 0}
              </p>
              <FactionTag factionKey={f.value} name={f.label} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Dienstsessions">
        <ResourceTable<Session>
          path="/duty/sessions"
          baseQuery={{ robloxUserId }}
          searchable={false}
          rowKey={(s) => s.id}
          filters={[
            { name: 'faction', label: 'Fraktion', options: DUTY_FACTION_OPTIONS },
            {
              name: 'status',
              label: 'Status',
              options: ['active', 'completed', 'auto_closed', 'invalidated'].map((v) => ({
                value: v,
                label: {
                  active: 'Aktiv',
                  completed: 'Abgeschlossen',
                  auto_closed: 'Automatisch beendet',
                  invalidated: 'Ungültig',
                }[v]!,
              })),
            },
            { name: 'flagged', label: 'Auffällig', options: [{ value: 'true', label: 'Nur markierte' }] },
            { name: 'period', label: 'Zeitraum', options: PERIOD_OPTIONS },
          ]}
          emptyTitle="Keine Dienstsessions"
          emptyText="Sessions entstehen, wenn ein verbundener Roblox-Server einen Dienstbeginn meldet."
          columns={[
            { key: 'player', header: 'Spieler', render: (s) => s.username, sortValue: (s) => s.username },
            {
              key: 'faction',
              header: 'Fraktion',
              render: (s) => <FactionTag factionKey={s.factionKey} name={s.factionName} />,
            },
            { key: 'start', header: 'Beginn', render: (s) => fmtDateTime(s.startedAt), sortValue: (s) => s.startedAt },
            {
              key: 'duration',
              header: 'Dauer',
              render: (s) => (s.durationSeconds === null ? 'läuft' : fmtDuration(s.durationSeconds)),
              sortValue: (s) => s.durationSeconds ?? 0,
            },
            { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
            {
              key: 'flags',
              header: 'Hinweise',
              render: (s) => (
                <div className="flex flex-wrap gap-1">
                  {s.flags.map((f, i) => (
                    <Badge key={i} tone="warn">
                      {FLAG_LABELS[f] ?? f}
                    </Badge>
                  ))}
                </div>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (s) =>
                can('duty:edit') ? (
                  <ActionDialog
                    title="Session korrigieren"
                    description="Leere Felder bleiben unverändert. Jede Korrektur wird mit Begründung protokolliert."
                    submitLabel="Korrektur speichern"
                    requireReason
                    fields={[
                      { name: 'startedAt', label: 'Neuer Beginn', type: 'datetime' },
                      { name: 'endedAt', label: 'Neues Ende', type: 'datetime' },
                      { name: 'invalidate', label: 'Session ungültig machen (zählt nicht mehr)', type: 'checkbox' },
                    ]}
                    onSubmit={(v, k) =>
                      post(`/duty/sessions/${s.id}/correct`, { ...v, invalidate: v.invalidate || undefined }, k)
                    }
                    invalidate={[['list', '/duty/sessions']]}
                    trigger={(open) => (
                      <Button size="sm" variant="ghost" onClick={open}>
                        Korrigieren
                      </Button>
                    )}
                  />
                ) : null,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

export default function DutyPage() {
  return (
    <Suspense>
      <DutyContent />
    </Suspense>
  );
}
