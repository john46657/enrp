'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Action {
  id: string;
  number: number;
  type: string;
  platform: string;
  targetDiscordId: string | null;
  targetRobloxId: number | null;
  moderatorId: string;
  reason: string;
  status: string;
  expiresAt: string | null;
  executionError: string | null;
  createdAt: string;
}

const TYPE: Record<string, string> = {
  warn: 'Verwarnung',
  timeout: 'Timeout',
  kick: 'Kick',
  ban: 'Bann',
  unban: 'Entbannung',
  note: 'Notiz',
};

export default function ModerationPage() {
  const can = useCan();
  return (
    <>
      <PageHeader
        title="Moderation"
        description="Alle Verwarnungen, Timeouts, Kicks und Banns auf Discord und Roblox. Roblox-Sanktionen setzt der nächste verbundene Spielserver um."
        actions={
          can('moderation:create') && (
            <ActionDialog
              title="Moderationsaktion"
              submitLabel="Ausführen"
              danger
              requireReason
              fields={[
                {
                  name: 'type',
                  label: 'Aktion',
                  type: 'select',
                  required: true,
                  options: ['warn', 'timeout', 'kick', 'ban', 'note'].map((v) => ({ value: v, label: TYPE[v]! })),
                },
                {
                  name: 'platform',
                  label: 'Plattform',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'discord', label: 'Discord' },
                    { value: 'roblox', label: 'Roblox' },
                  ],
                },
                { name: 'targetDiscordId', label: 'Discord-ID' },
                { name: 'targetRobloxId', label: 'Roblox-ID', type: 'number' },
                {
                  name: 'durationHours',
                  label: 'Dauer in Stunden',
                  type: 'number',
                  hint: 'Timeouts: höchstens 672 Stunden (28 Tage).',
                },
              ]}
              onSubmit={(v, k) =>
                post(
                  '/moderation/actions',
                  {
                    ...v,
                    durationHours: undefined,
                    durationSeconds: v.durationHours ? Math.round(Number(v.durationHours) * 3600) : undefined,
                  },
                  k,
                )
              }
              successMessage={(r) => `Aktion #${(r as Action).number}: ${(r as Action).status}`}
              invalidate={[['list', '/moderation/actions']]}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Aktion ausführen
                </Button>
              )}
            />
          )
        }
      />
      <ResourceTable<Action>
        path="/moderation/actions"
        searchable={false}
        rowKey={(a) => a.id}
        filters={[
          { name: 'type', label: 'Art', options: Object.entries(TYPE).map(([value, label]) => ({ value, label })) },
          {
            name: 'status',
            label: 'Status',
            options: ['active', 'pending_execution', 'failed', 'completed', 'revoked', 'expired'].map((v) => ({
              value: v,
              label: v,
            })),
          },
        ]}
        emptyTitle="Keine Moderationsaktionen"
        columns={[
          { key: 'n', header: 'Nr.', render: (a) => `#${a.number}`, sortValue: (a) => a.number },
          {
            key: 'type',
            header: 'Art',
            render: (a) => `${TYPE[a.type] ?? a.type} (${a.platform === 'roblox' ? 'Roblox' : 'Discord'})`,
          },
          {
            key: 'target',
            header: 'Ziel',
            render: (a) =>
              a.targetRobloxId ? (
                <a href={`/players/roblox/${a.targetRobloxId}`} className="hover:underline">
                  Roblox {a.targetRobloxId}
                </a>
              ) : (
                `Discord ${a.targetDiscordId}`
              ),
          },
          { key: 'reason', header: 'Grund', render: (a) => <span className="line-clamp-2 max-w-sm">{a.reason}</span> },
          {
            key: 'status',
            header: 'Status',
            render: (a) => (
              <span title={a.executionError ?? undefined}>
                <StatusBadge status={a.status} />
              </span>
            ),
          },
          { key: 'mod', header: 'Moderator', render: (a) => a.moderatorId },
          { key: 'at', header: 'Zeitpunkt', render: (a) => fmtDateTime(a.createdAt), sortValue: (a) => a.createdAt },
          {
            key: 'x',
            header: '',
            render: (a) =>
              can('moderation:edit') && ['active', 'pending_execution', 'failed'].includes(a.status) ? (
                <ActionDialog
                  title={`Aktion #${a.number} aufheben`}
                  submitLabel="Aufheben"
                  danger
                  requireReason
                  fields={[]}
                  onSubmit={(v, k) => post(`/moderation/actions/${a.id}/revoke`, v, k)}
                  invalidate={[['list', '/moderation/actions']]}
                  trigger={(open) => (
                    <Button size="sm" variant="ghost" onClick={open}>
                      Aufheben
                    </Button>
                  )}
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}
