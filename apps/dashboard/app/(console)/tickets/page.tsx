'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { PriorityBadge, PRIORITY, type Ticket } from '@/components/data/tickets';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';

export default function TicketsPage() {
  return (
    <>
      <PageHeader
        title="Tickets"
        description="Tickets aus dem Discord-Ticketpanel werden automatisch gespiegelt. Ohne Teamrechte siehst du nur deine eigenen."
        actions={
          <ActionDialog
            title="Ticket erstellen"
            submitLabel="Ticket erstellen"
            successMessage={(t) => `Ticket #${(t as Ticket).number} erstellt`}
            fields={[
              { name: 'subject', label: 'Betreff', required: true },
              { name: 'body', label: 'Beschreibung', type: 'textarea' },
              {
                name: 'priority',
                label: 'Priorität',
                type: 'select',
                options: Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label })),
              },
            ]}
            onSubmit={(v, k) => post('/tickets', v, k)}
            invalidate={[['list', '/tickets']]}
            trigger={(open) => (
              <Button variant="primary" onClick={open}>
                Ticket erstellen
              </Button>
            )}
          />
        }
      />
      <ResourceTable<Ticket>
        path="/tickets"
        rowKey={(t) => t.id}
        rowHref={(t) => `/tickets/${t.number}`}
        baseQuery={{ status: 'open,claimed,waiting' }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open,claimed,waiting', label: 'Nicht geschlossen' },
              { value: 'open', label: 'Offen' },
              { value: 'claimed', label: 'In Bearbeitung' },
              { value: 'waiting', label: 'Wartet' },
              { value: 'closed', label: 'Geschlossen' },
            ],
          },
        ]}
        emptyTitle="Keine Tickets in dieser Ansicht"
        columns={[
          { key: 'subject', header: 'Betreff', render: (t) => `#${t.number} ${t.subject}`, sortValue: (t) => t.number },
          { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
          {
            key: 'priority',
            header: 'Priorität',
            render: (t) => <PriorityBadge p={t.priority} />,
            sortValue: (t) => ['low', 'normal', 'high', 'urgent'].indexOf(t.priority),
          },
          { key: 'assignee', header: 'Bearbeitung', render: (t) => t.assigneeDiscordId ?? 'niemand' },
          { key: 'category', header: 'Kategorie', render: (t) => t.category },
          {
            key: 'created',
            header: 'Erstellt',
            render: (t) => <span title={fmtDateTime(t.createdAt)}>{fmtRelative(t.createdAt)}</span>,
            sortValue: (t) => t.createdAt,
          },
        ]}
      />
    </>
  );
}
