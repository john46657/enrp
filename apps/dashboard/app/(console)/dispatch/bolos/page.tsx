'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Bolo {
  id: string;
  number: number;
  kind: 'vehicle' | 'person';
  plate: string | null;
  robloxUserId: number | null;
  username: string | null;
  description: string;
  reason: string;
  status: 'active' | 'cleared';
  hitCount: number;
  lastHitAt: string | null;
  lastHit: Record<string, string | number | null> | null;
  createdBy: string;
  createdAt: string;
}

const target = (b: Bolo) => (b.kind === 'vehicle' ? `🚗 ${b.plate}` : `👤 ${b.username ?? '–'} (${b.robloxUserId})`);

const lastSeen = (b: Bolo) => {
  if (!b.lastHitAt || !b.lastHit) return '–';
  const h = b.lastHit;
  const what =
    b.kind === 'vehicle'
      ? `${h.model ?? 'Fahrzeug'}${h.ownerName ? ` · ${h.ownerName}` : ''}`
      : `${h.team ? `Team ${h.team}` : 'im Spiel'}`;
  return `${fmtDateTime(b.lastHitAt)} · ${what}`;
};

/** Fahndungen: Alarm im Leitstellen-Kanal und hier, sobald Kennzeichen oder Spieler im Spiel auftauchen. */
export default function BolosPage() {
  const can = useCan();
  const invalidate = [['list', '/dispatch/bolos']];
  return (
    <>
      <PageHeader
        title="Fahndungen"
        description="Jeder Heartbeat der Spielserver (alle 30 s) wird gegen aktive Fahndungen geprüft. Treffer erscheinen hier und im Leitstellen-Kanal – je Fahndung höchstens alle 10 Minuten."
        actions={
          can('dispatch:create') && (
            <>
              <ActionDialog
                title="Fahndung nach Kennzeichen"
                submitLabel="Anlegen"
                successMessage={(b) => `Fahndung #${(b as Bolo).number} angelegt`}
                fields={[
                  { name: 'plate', label: 'Kennzeichen', required: true, placeholder: 'z. B. EN-AB 123' },
                  { name: 'reason', label: 'Grund', required: true },
                  { name: 'description', label: 'Beschreibung', type: 'textarea' },
                ]}
                onSubmit={(v, k) =>
                  post(
                    '/dispatch/bolos',
                    { kind: 'vehicle', plate: v.plate, reason: v.reason, description: v.description || undefined },
                    k,
                  )
                }
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>🚗 Fahrzeug</Button>}
              />
              <ActionDialog
                title="Fahndung nach Spieler"
                submitLabel="Anlegen"
                successMessage={(b) => `Fahndung #${(b as Bolo).number} angelegt`}
                fields={[
                  { name: 'robloxUserId', label: 'Roblox-ID', type: 'number', required: true, min: 1 },
                  { name: 'reason', label: 'Grund', required: true },
                  { name: 'description', label: 'Beschreibung', type: 'textarea' },
                ]}
                onSubmit={(v, k) =>
                  post(
                    '/dispatch/bolos',
                    {
                      kind: 'person',
                      robloxUserId: v.robloxUserId,
                      reason: v.reason,
                      description: v.description || undefined,
                    },
                    k,
                  )
                }
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    👤 Person
                  </Button>
                )}
              />
            </>
          )
        }
      />
      <ResourceTable<Bolo>
        path="/dispatch/bolos"
        searchable={false}
        rowKey={(b) => b.id}
        baseQuery={{ status: 'active' }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'active', label: 'Aktiv' },
              { value: 'cleared', label: 'Aufgehoben' },
              { value: 'active,cleared', label: 'Alle' },
            ],
          },
        ]}
        emptyTitle="Keine Fahndungen"
        emptyText="Fahndungen nach Kennzeichen oder Spieler lösen einen Alarm aus, sobald der Gesuchte im Spiel auftaucht."
        columns={[
          { key: 'n', header: 'Nr.', render: (b) => `#${b.number}`, sortValue: (b) => b.number },
          { key: 't', header: 'Gesucht', render: (b) => target(b) },
          {
            key: 'r',
            header: 'Grund',
            render: (b) => (
              <span>
                {b.reason}
                {b.description && <span className="block text-xs text-muted">{b.description}</span>}
              </span>
            ),
          },
          { key: 's', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
          { key: 'h', header: 'Treffer', render: (b) => String(b.hitCount), sortValue: (b) => b.hitCount },
          { key: 'l', header: 'Zuletzt gesichtet', render: (b) => lastSeen(b), sortValue: (b) => b.lastHitAt ?? '' },
          { key: 'c', header: 'Angelegt', render: (b) => fmtDateTime(b.createdAt), sortValue: (b) => b.createdAt },
          {
            key: 'a',
            header: '',
            render: (b) =>
              can('dispatch:edit') && b.status === 'active' ? (
                <ActionDialog
                  title={`Fahndung #${b.number} aufheben`}
                  submitLabel="Aufheben"
                  fields={[{ name: 'note', label: 'Notiz (optional)', type: 'textarea' }]}
                  onSubmit={(v) => post(`/dispatch/bolos/${b.id}/clear`, { note: v.note || undefined })}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
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
