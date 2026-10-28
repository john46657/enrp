'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { SEVERITY_OPTIONS } from '@/components/data/options';

interface Incident {
  id: string;
  number: number;
  title: string;
  severity: string;
  status: string;
  assigneeId: string | null;
  source: string;
  createdAt: string;
}

export default function IncidentsPage() {
  const can = useCan();
  return (
    <>
      <PageHeader
        title="Vorfälle"
        description="Technische Störungen und Sicherheitsvorfälle. Automatisierungen können Vorfälle eröffnen; doppelte Ursachen werden zusammengeführt."
        actions={
          can('incidents:create') && (
            <ActionDialog
              title="Vorfall eröffnen"
              submitLabel="Eröffnen"
              successMessage={(i) => `Vorfall #${(i as Incident).number} eröffnet`}
              fields={[
                { name: 'title', label: 'Titel', required: true },
                { name: 'description', label: 'Beschreibung', type: 'textarea' },
                {
                  name: 'severity',
                  label: 'Priorität',
                  type: 'select',
                  required: true,
                  defaultValue: 'sev3',
                  options: SEVERITY_OPTIONS,
                },
              ]}
              onSubmit={(v, k) => post('/incidents', v, k)}
              invalidate={[['list', '/incidents']]}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Vorfall eröffnen
                </Button>
              )}
            />
          )
        }
      />
      <ResourceTable<Incident>
        path="/incidents"
        searchable={false}
        rowKey={(i) => i.id}
        rowHref={(i) => `/ops/incidents/${i.number}`}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open,investigating,monitoring', label: 'Nicht abgeschlossen' },
              { value: 'resolved', label: 'Abgeschlossen' },
            ],
          },
          { name: 'severity', label: 'Priorität', options: SEVERITY_OPTIONS },
        ]}
        emptyTitle="Keine Vorfälle"
        columns={[
          { key: 't', header: 'Vorfall', render: (i) => `#${i.number} ${i.title}`, sortValue: (i) => i.number },
          {
            key: 's',
            header: 'Priorität',
            render: (i) => (
              <Badge tone={i.severity === 'sev1' ? 'bad' : i.severity === 'sev2' ? 'warn' : 'muted'}>
                {i.severity.toUpperCase()}
              </Badge>
            ),
            sortValue: (i) => i.severity,
          },
          { key: 'st', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
          { key: 'a', header: 'Zuständig', render: (i) => i.assigneeId ?? 'niemand' },
          { key: 'src', header: 'Quelle', render: (i) => (i.source === 'automation' ? 'Automatisierung' : 'manuell') },
          { key: 'c', header: 'Eröffnet', render: (i) => fmtDateTime(i.createdAt), sortValue: (i) => i.createdAt },
        ]}
      />
    </>
  );
}
