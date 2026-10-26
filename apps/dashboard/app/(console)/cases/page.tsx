'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Case {
  id: string;
  number: number;
  title: string;
  status: string;
  subjectRobloxId: number | null;
  subjectDiscordId: string | null;
  createdBy: string;
  createdAt: string;
}

export default function CasesPage() {
  const can = useCan();
  return (
    <>
      <PageHeader
        title="Fallberichte"
        description="Bündeln Reports, Tickets, Moderationsaktionen und Belege. Anhänge werden als Links referenziert, nicht hochgeladen."
        actions={
          can('cases:create') && (
            <ActionDialog
              title="Fallbericht anlegen"
              submitLabel="Anlegen"
              successMessage={(c) => `Fallbericht #${(c as Case).number} angelegt`}
              fields={[
                { name: 'title', label: 'Titel', required: true },
                { name: 'summary', label: 'Zusammenfassung', type: 'textarea', required: true },
                { name: 'subjectRobloxId', label: 'Betroffene Roblox-ID', type: 'number' },
                { name: 'subjectDiscordId', label: 'Betroffene Discord-ID' },
              ]}
              onSubmit={(v, k) => post('/cases', v, k)}
              invalidate={[['list', '/cases']]}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Fallbericht anlegen
                </Button>
              )}
            />
          )
        }
      />
      <ResourceTable<Case>
        path="/cases"
        rowKey={(c) => c.id}
        rowHref={(c) => `/cases/${c.number}`}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open', label: 'Offen' },
              { value: 'closed', label: 'Geschlossen' },
            ],
          },
        ]}
        emptyTitle="Keine Fallberichte"
        columns={[
          { key: 'title', header: 'Fall', render: (c) => `#${c.number} ${c.title}`, sortValue: (c) => c.number },
          {
            key: 'subject',
            header: 'Betroffen',
            render: (c) =>
              [
                c.subjectRobloxId && `Roblox ${c.subjectRobloxId}`,
                c.subjectDiscordId && `Discord ${c.subjectDiscordId}`,
              ]
                .filter(Boolean)
                .join(', ') || '–',
          },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          { key: 'created', header: 'Angelegt', render: (c) => fmtDate(c.createdAt), sortValue: (c) => c.createdAt },
        ]}
      />
    </>
  );
}
