'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Row {
  suggestion: {
    id: string;
    number: number;
    title: string;
    body: string;
    status: string;
    statusReason: string | null;
    createdAt: string;
  };
  up: number;
  down: number;
}
const STATUS = [
  { value: 'open', label: 'Offen' },
  { value: 'under_review', label: 'In Prüfung' },
  { value: 'accepted', label: 'Angenommen' },
  { value: 'rejected', label: 'Abgelehnt' },
  { value: 'implemented', label: 'Umgesetzt' },
];

export default function SuggestionsPage() {
  const can = useCan();
  return (
    <>
      <PageHeader
        title="Vorschläge"
        description="Eingereicht mit /suggest create. Statusänderungen aktualisieren die Nachricht im Vorschlagskanal."
      />
      <ResourceTable<Row>
        path="/suggestions"
        searchable={false}
        rowKey={(r) => r.suggestion.id}
        filters={[{ name: 'status', label: 'Status', options: STATUS }]}
        emptyTitle="Keine Vorschläge"
        columns={[
          {
            key: 't',
            header: 'Vorschlag',
            render: (r) => (
              <div>
                <p className="font-medium">
                  #{r.suggestion.number} {r.suggestion.title}
                </p>
                <p className="line-clamp-2 max-w-lg text-muted">{r.suggestion.body}</p>
              </div>
            ),
          },
          {
            key: 'v',
            header: 'Stimmen',
            render: (r) => (
              <span className="tabular">
                +{r.up} / −{r.down}
              </span>
            ),
            sortValue: (r) => r.up - r.down,
          },
          { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.suggestion.status} /> },
          {
            key: 'd',
            header: 'Eingereicht',
            render: (r) => fmtDate(r.suggestion.createdAt),
            sortValue: (r) => r.suggestion.createdAt,
          },
          {
            key: 'x',
            header: '',
            render: (r) =>
              can('community:edit') ? (
                <ActionDialog
                  title={`Status von #${r.suggestion.number}`}
                  submitLabel="Speichern"
                  requireReason
                  fields={[
                    {
                      name: 'status',
                      label: 'Status',
                      type: 'select',
                      required: true,
                      defaultValue: r.suggestion.status,
                      options: STATUS,
                    },
                  ]}
                  onSubmit={(v) => post(`/suggestions/${r.suggestion.id}/status`, v)}
                  invalidate={[['list', '/suggestions']]}
                  trigger={(o) => (
                    <Button size="sm" onClick={o}>
                      Status
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
