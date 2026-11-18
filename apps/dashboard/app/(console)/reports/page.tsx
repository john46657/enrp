'use client';

import { ResourceTable } from '@/components/data/resource-table';
import { PageHeader, StatusBadge } from '@/components/ui/primitives';
import { fmtRelative } from '@/lib/format';

interface Report {
  id: string;
  number: number;
  reporterDiscordId: string;
  reportedRobloxId: number | null;
  reportedDiscordId: string | null;
  ruleReference: string | null;
  description: string;
  status: string;
  assigneeDiscordId: string | null;
  createdAt: string;
}

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Spielerreports"
        description="Meldungen über Regelverstöße aus Discord (/report create) und dem Dashboard."
      />
      <ResourceTable<Report>
        path="/reports"
        rowKey={(r) => r.id}
        rowHref={(r) => `/reports/${r.number}`}
        baseQuery={{ status: 'open,in_review' }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open,in_review', label: 'Unerledigt' },
              { value: 'open', label: 'Offen' },
              { value: 'in_review', label: 'In Prüfung' },
              { value: 'resolved', label: 'Erledigt' },
              { value: 'rejected', label: 'Abgelehnt' },
            ],
          },
        ]}
        emptyTitle="Keine Reports in dieser Ansicht"
        columns={[
          { key: 'n', header: 'Report', render: (r) => `#${r.number}`, sortValue: (r) => r.number },
          {
            key: 'who',
            header: 'Gemeldet',
            render: (r) =>
              [
                r.reportedRobloxId && `Roblox ${r.reportedRobloxId}`,
                r.reportedDiscordId && `Discord ${r.reportedDiscordId}`,
              ]
                .filter(Boolean)
                .join(', '),
          },
          { key: 'rule', header: 'Regel', render: (r) => r.ruleReference ?? '–' },
          {
            key: 'desc',
            header: 'Beschreibung',
            render: (r) => <span className="line-clamp-2 max-w-md">{r.description}</span>,
          },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'created', header: 'Eingang', render: (r) => fmtRelative(r.createdAt), sortValue: (r) => r.createdAt },
        ]}
      />
    </>
  );
}
