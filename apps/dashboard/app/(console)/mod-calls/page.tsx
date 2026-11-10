'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface ModCall {
  id: string;
  number: number;
  robloxUserId: number;
  username: string | null;
  text: string;
  status: 'open' | 'claimed' | 'closed';
  claimedBy: string | null;
  note: string | null;
  createdAt: string;
}

/** Mod-Calls aus dem Spiel (/modcall). Übernehmen benachrichtigt den Spieler im Spiel. */
export default function ModCallsPage() {
  const can = useCan();
  const invalidate = [['list', '/mod-calls']];
  return (
    <>
      <PageHeader
        title="Mod-Calls"
        description="Hilferufe von Spielern aus dem Spiel. Wer übernimmt, wird dem Spieler im Spiel genannt."
      />
      <ResourceTable<ModCall>
        path="/mod-calls"
        searchable={false}
        rowKey={(c) => c.id}
        baseQuery={{ status: 'open,claimed' }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open,claimed', label: 'Nicht geschlossen' },
              { value: 'closed', label: 'Geschlossen' },
              { value: 'open,claimed,closed', label: 'Alle' },
            ],
          },
        ]}
        emptyTitle="Keine Mod-Calls"
        emptyText="Spieler senden Mod-Calls im Spiel mit /modcall."
        columns={[
          { key: 'n', header: 'Nr.', render: (c) => `#${c.number}`, sortValue: (c) => c.number },
          { key: 'p', header: 'Spieler', render: (c) => `${c.username ?? '–'} (${c.robloxUserId})` },
          { key: 't', header: 'Anliegen', render: (c) => c.text || '–' },
          { key: 's', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          { key: 'b', header: 'Übernommen von', render: (c) => c.claimedBy ?? '–' },
          { key: 'c', header: 'Eingang', render: (c) => fmtDateTime(c.createdAt), sortValue: (c) => c.createdAt },
          {
            key: 'a',
            header: '',
            render: (c) =>
              can('mod_calls:edit') && c.status !== 'closed' ? (
                <span className="flex gap-2">
                  {c.status === 'open' && (
                    <ActionDialog
                      title={`Mod-Call #${c.number} übernehmen`}
                      description="Der Spieler bekommt im Spiel die Nachricht, dass du dich kümmerst."
                      submitLabel="Übernehmen"
                      fields={[]}
                      onSubmit={() => post(`/mod-calls/${c.id}/claim`, {})}
                      invalidate={invalidate}
                      trigger={(open) => (
                        <Button size="sm" variant="primary" onClick={open}>
                          Übernehmen
                        </Button>
                      )}
                    />
                  )}
                  <ActionDialog
                    title={`Mod-Call #${c.number} schließen`}
                    submitLabel="Schließen"
                    fields={[{ name: 'note', label: 'Notiz (optional)', type: 'textarea' }]}
                    onSubmit={(v) => post(`/mod-calls/${c.id}/close`, { note: v.note || undefined })}
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Schließen
                      </Button>
                    )}
                  />
                </span>
              ) : (
                (c.note ?? '')
              ),
          },
        ]}
      />
    </>
  );
}
