'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Row {
  giveaway: {
    id: string;
    prize: string;
    winnerCount: number;
    endsAt: string;
    status: string;
    winners: string[] | null;
    requireVerified: boolean;
  };
  entries: number;
}

export default function GiveawaysPage() {
  const can = useCan();
  const invalidate = [['list', '/giveaways']];
  return (
    <>
      <PageHeader
        title="Giveaways"
        description="Gewinner werden mit kryptografisch sicherem Zufall gezogen, automatisch zum Endzeitpunkt oder manuell."
        actions={
          can('community:create') && (
            <ActionDialog
              title="Giveaway starten"
              submitLabel="Starten"
              fields={[
                { name: 'prize', label: 'Preis', required: true },
                { name: 'description', label: 'Beschreibung', type: 'textarea' },
                {
                  name: 'winnerCount',
                  label: 'Gewinner',
                  type: 'number',
                  required: true,
                  defaultValue: 1,
                  min: 1,
                  max: 20,
                },
                { name: 'durationHours', label: 'Dauer in Stunden', type: 'number', required: true, defaultValue: 24 },
                { name: 'channelId', label: 'Discord-Kanal-ID', required: true },
                { name: 'requireVerified', label: 'Nur verifizierte Mitglieder', type: 'checkbox', defaultValue: true },
              ]}
              onSubmit={(v) => post('/giveaways', v)}
              invalidate={invalidate}
              trigger={(o) => (
                <Button variant="primary" onClick={o}>
                  Giveaway starten
                </Button>
              )}
            />
          )
        }
      />
      <ResourceTable<Row>
        path="/giveaways"
        searchable={false}
        rowKey={(r) => r.giveaway.id}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open', label: 'Läuft' },
              { value: 'drawn', label: 'Ausgelost' },
              { value: 'cancelled', label: 'Abgebrochen' },
            ],
          },
        ]}
        emptyTitle="Keine Giveaways"
        columns={[
          { key: 'p', header: 'Preis', render: (r) => r.giveaway.prize },
          { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.giveaway.status} /> },
          { key: 'e', header: 'Teilnahmen', render: (r) => r.entries, sortValue: (r) => r.entries },
          { key: 'end', header: 'Ende', render: (r) => fmtDateTime(r.giveaway.endsAt) },
          { key: 'w', header: 'Gewinner', render: (r) => r.giveaway.winners?.join(', ') || '–' },
          {
            key: 'x',
            header: '',
            render: (r) =>
              r.giveaway.status === 'open' && can('community:edit') ? (
                <span className="flex gap-1">
                  <ActionDialog
                    title="Jetzt auslosen"
                    submitLabel="Auslosen"
                    fields={[]}
                    onSubmit={(_, k) => post(`/giveaways/${r.giveaway.id}/draw`, {}, k)}
                    invalidate={invalidate}
                    trigger={(o) => (
                      <Button size="sm" onClick={o}>
                        Auslosen
                      </Button>
                    )}
                  />
                  <ActionDialog
                    title="Giveaway abbrechen"
                    submitLabel="Abbrechen"
                    danger
                    requireReason
                    fields={[]}
                    onSubmit={(v) => post(`/giveaways/${r.giveaway.id}/cancel`, v)}
                    invalidate={invalidate}
                    trigger={(o) => (
                      <Button size="sm" variant="ghost" onClick={o}>
                        Abbrechen
                      </Button>
                    )}
                  />
                </span>
              ) : null,
          },
        ]}
      />
    </>
  );
}
