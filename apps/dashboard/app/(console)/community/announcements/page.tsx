'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Announcement {
  id: string;
  kind: string;
  title: string;
  body: string;
  version: string | null;
  inGame: boolean;
  status: string;
  publishAt: string | null;
  publishedAt: string | null;
}
const KIND: Record<string, string> = { general: 'Ankündigung', changelog: 'Changelog', maintenance: 'Wartung' };

export default function AnnouncementsPage() {
  const can = useCan();
  const invalidate = [['list', '/announcements']];
  return (
    <>
      <PageHeader
        title="Ankündigungen & Changelog"
        description="Veröffentlichung in Discord (Ankündigungskanal oder gewählter Kanal) und optional im Spiel. Mit Zeitpunkt geplante Beiträge veröffentlicht der Worker automatisch."
        actions={
          can('announcements:create') && (
            <ActionDialog
              title="Beitrag anlegen"
              submitLabel="Anlegen"
              fields={[
                {
                  name: 'kind',
                  label: 'Art',
                  type: 'select',
                  required: true,
                  options: Object.entries(KIND).map(([value, label]) => ({ value, label })),
                },
                { name: 'title', label: 'Titel', required: true },
                { name: 'body', label: 'Text', type: 'textarea', required: true },
                { name: 'version', label: 'Version (Changelog)' },
                { name: 'channelId', label: 'Discord-Kanal-ID (optional)' },
                { name: 'inGame', label: 'Auch im Spiel anzeigen', type: 'checkbox' },
                { name: 'publishAt', label: 'Geplant für (leer = Entwurf)', type: 'datetime' },
              ]}
              onSubmit={(v, k) => post('/announcements', v, k)}
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Beitrag anlegen
                </Button>
              )}
            />
          )
        }
      />
      <ResourceTable<Announcement>
        path="/announcements"
        searchable={false}
        rowKey={(a) => a.id}
        filters={[
          { name: 'kind', label: 'Art', options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'draft', label: 'Entwurf' },
              { value: 'scheduled', label: 'Geplant' },
              { value: 'published', label: 'Veröffentlicht' },
            ],
          },
        ]}
        emptyTitle="Noch keine Beiträge"
        columns={[
          {
            key: 't',
            header: 'Titel',
            render: (a) => (
              <span className="font-medium">
                {a.title}
                {a.version ? ` (${a.version})` : ''}
              </span>
            ),
          },
          { key: 'k', header: 'Art', render: (a) => KIND[a.kind] },
          { key: 's', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
          { key: 'g', header: 'Im Spiel', render: (a) => (a.inGame ? <Badge tone="info">ja</Badge> : 'nein') },
          { key: 'd', header: 'Zeitpunkt', render: (a) => fmtDateTime(a.publishedAt ?? a.publishAt) },
          {
            key: 'x',
            header: '',
            render: (a) =>
              a.status !== 'published' && can('announcements:publish') ? (
                <ActionDialog
                  title={`„${a.title}“ veröffentlichen`}
                  description={<p className="whitespace-pre-wrap">{a.body}</p>}
                  submitLabel="Veröffentlichen"
                  fields={[]}
                  onSubmit={(_, k) => post(`/announcements/${a.id}/publish`, {}, k)}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
                      Veröffentlichen
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
