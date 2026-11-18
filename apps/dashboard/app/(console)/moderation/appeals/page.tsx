'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';

interface Row {
  appeal: {
    id: string;
    appellantDiscordId: string;
    statement: string;
    status: string;
    reviewerId: string | null;
    decisionReason: string | null;
    createdAt: string;
  };
  action: { number: number; type: string; reason: string; moderatorId: string };
}

export default function AppealsPage() {
  const can = useCan();
  const me = useSession();
  return (
    <>
      <PageHeader
        title="Einsprüche"
        description="Über einen Einspruch entscheidet nie die Person, die die ursprüngliche Aktion ausgeführt hat."
      />
      <ResourceTable<Row>
        path="/moderation/appeals"
        searchable={false}
        rowKey={(r) => r.appeal.id}
        baseQuery={{ status: 'open' }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open', label: 'Offen' },
              { value: 'accepted', label: 'Angenommen' },
              { value: 'rejected', label: 'Abgelehnt' },
            ],
          },
        ]}
        emptyTitle="Keine Einsprüche in dieser Ansicht"
        columns={[
          {
            key: 'action',
            header: 'Aktion',
            render: (r) => `#${r.action.number} ${r.action.type}: ${r.action.reason}`,
          },
          {
            key: 'statement',
            header: 'Begründung des Einspruchs',
            render: (r) => <span className="line-clamp-3 max-w-md">{r.appeal.statement}</span>,
          },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.appeal.status} /> },
          {
            key: 'at',
            header: 'Eingang',
            render: (r) => fmtDateTime(r.appeal.createdAt),
            sortValue: (r) => r.appeal.createdAt,
          },
          {
            key: 'decide',
            header: '',
            render: (r) =>
              r.appeal.status === 'open' && can('appeals:approve') ? (
                r.action.moderatorId === me.user.id ? (
                  <span className="text-xs text-muted">Eigene Aktion: Entscheidung durch andere Person</span>
                ) : (
                  <ActionDialog
                    title="Einspruch entscheiden"
                    description="Bei Annahme wird die Moderationsaktion aufgehoben und die Person per DM informiert."
                    submitLabel="Entscheiden"
                    requireReason
                    fields={[
                      {
                        name: 'decision',
                        label: 'Entscheidung',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'accept', label: 'Annehmen' },
                          { value: 'reject', label: 'Ablehnen' },
                        ],
                      },
                    ]}
                    onSubmit={(v, k) => post(`/moderation/appeals/${r.appeal.id}/decide`, v, k)}
                    invalidate={[['list', '/moderation/appeals']]}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Entscheiden
                      </Button>
                    )}
                  />
                )
              ) : (
                (r.appeal.decisionReason ?? null)
              ),
          },
        ]}
      />
    </>
  );
}
