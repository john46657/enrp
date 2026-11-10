'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, Button, PageHeader } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Bolo {
  id: string;
  number: number;
  kind: 'person' | 'vehicle';
  status: 'active' | 'resolved' | 'expired';
  robloxUserId: number | null;
  personName: string | null;
  plate: string | null;
  vehicleDescription: string | null;
  reason: string;
  priority: number;
  hitCount: number;
  lastHitAt: string | null;
  lastHit: {
    jobId: string;
    player?: { username: string; team: string | null };
    vehicle?: { model: string; color: string | null };
  } | null;
  expiresAt: string | null;
  createdAt: string;
  resolveNote: string | null;
}

const STATUS: Record<Bolo['status'], { label: string; tone: 'bad' | 'ok' | 'muted' }> = {
  active: { label: 'Aktiv', tone: 'bad' },
  resolved: { label: 'Erledigt', tone: 'ok' },
  expired: { label: 'Abgelaufen', tone: 'muted' },
};
const PRIORITY: Record<number, string> = { 1: 'Hoch', 2: 'Mittel', 3: 'Niedrig' };

const PRIORITY_FIELD = {
  name: 'priority',
  label: 'Priorität',
  type: 'select' as const,
  defaultValue: '2',
  options: [
    { value: '1', label: 'Hoch' },
    { value: '2', label: 'Mittel' },
    { value: '3', label: 'Niedrig' },
  ],
};
const COMMON_FIELDS = [
  { name: 'reason', label: 'Grund', type: 'textarea' as const, required: true },
  PRIORITY_FIELD,
  {
    name: 'expiresInHours',
    label: 'Automatisch beenden nach (Stunden)',
    type: 'number' as const,
    min: 1,
    max: 720,
    hint: 'Leer = bis zur Erledigung aktiv.',
  },
];
const common = (v: Record<string, unknown>) => ({
  reason: v.reason,
  priority: Number(v.priority ?? 2),
  expiresInHours: v.expiresInHours,
});

/**
 * Fahndungen (BOLO) nach Personen und Kennzeichen. Jeder Heartbeat der Spielserver wird damit abgeglichen;
 * Treffer erscheinen hier live und – falls eingerichtet – mit Ping im Fahndungskanal auf Discord.
 */
export default function BoloPage() {
  const can = useCan();
  const invalidate = [['list', '/dispatch/bolos']];
  return (
    <>
      <PageHeader
        title="Fahndungen (BOLO)"
        description="Gesuchte Personen und Kennzeichen. Ist eine gesuchte Person oder ein gesuchtes Fahrzeug im Spiel, wird das sofort gemeldet."
        actions={
          can('dispatch:create') ? (
            <span className="flex gap-2">
              <ActionDialog
                title="Nach Person fahnden"
                submitLabel="Fahndung anlegen"
                fields={[
                  {
                    name: 'player',
                    label: 'Roblox-Benutzername oder -ID',
                    required: true,
                    hint: 'Benutzernamen kennt die Plattform nur von Spielern, die schon einmal im Spiel waren.',
                  },
                  ...COMMON_FIELDS,
                ]}
                onSubmit={(v, key) => {
                  const player = String(v.player);
                  return post(
                    '/dispatch/bolos',
                    {
                      kind: 'person',
                      ...(/^\d+$/.test(player) ? { robloxUserId: Number(player) } : { username: player }),
                      ...common(v),
                    },
                    key,
                  );
                }}
                successMessage={(r) => `Fahndung #${(r as Bolo).number} angelegt`}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Person
                  </Button>
                )}
              />
              <ActionDialog
                title="Nach Kennzeichen fahnden"
                submitLabel="Fahndung anlegen"
                fields={[
                  { name: 'plate', label: 'Kennzeichen', required: true, placeholder: 'EN-A1234' },
                  { name: 'vehicleDescription', label: 'Fahrzeug (optional)', placeholder: 'schwarzer SUV' },
                  ...COMMON_FIELDS,
                ]}
                onSubmit={(v, key) =>
                  post(
                    '/dispatch/bolos',
                    { kind: 'vehicle', plate: v.plate, vehicleDescription: v.vehicleDescription, ...common(v) },
                    key,
                  )
                }
                successMessage={(r) => `Fahndung #${(r as Bolo).number} angelegt`}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Kennzeichen
                  </Button>
                )}
              />
            </span>
          ) : undefined
        }
      />
      <ResourceTable<Bolo>
        path="/dispatch/bolos"
        rowKey={(b) => b.id}
        baseQuery={{ status: 'active' }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'active', label: 'Aktiv' },
              { value: 'resolved', label: 'Erledigt' },
              { value: 'expired', label: 'Abgelaufen' },
              { value: 'active,resolved,expired', label: 'Alle' },
            ],
          },
          {
            name: 'kind',
            label: 'Art',
            options: [
              { value: 'person', label: 'Personen' },
              { value: 'vehicle', label: 'Fahrzeuge' },
            ],
          },
        ]}
        emptyTitle="Keine Fahndungen"
        emptyText="Lege eine Fahndung an – Treffer aus dem Spiel werden automatisch gemeldet."
        columns={[
          { key: 'n', header: 'Nr.', render: (b) => `#${b.number}`, sortValue: (b) => b.number },
          {
            key: 't',
            header: 'Gesucht',
            render: (b) =>
              b.kind === 'person' ? (
                <span>
                  👤 <strong>{b.personName ?? '–'}</strong> <span className="text-muted">({b.robloxUserId})</span>
                </span>
              ) : (
                <span>
                  🚗 <strong className="font-mono">{b.plate}</strong>
                  {b.vehicleDescription && <span className="text-muted"> · {b.vehicleDescription}</span>}
                </span>
              ),
          },
          { key: 'r', header: 'Grund', render: (b) => b.reason },
          {
            key: 'p',
            header: 'Priorität',
            render: (b) => PRIORITY[b.priority] ?? b.priority,
            sortValue: (b) => b.priority,
          },
          {
            key: 's',
            header: 'Status',
            render: (b) => <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>,
          },
          {
            key: 'h',
            header: 'Letzter Treffer',
            render: (b) =>
              b.lastHitAt ? (
                <span>
                  {fmtDateTime(b.lastHitAt)} <span className="text-muted">({b.hitCount}×)</span>
                  {b.lastHit?.vehicle && (
                    <span className="block text-muted">
                      {b.lastHit.vehicle.model}
                      {b.lastHit.vehicle.color ? ` · ${b.lastHit.vehicle.color}` : ''}
                    </span>
                  )}
                  {b.lastHit?.player && (
                    <span className="block text-muted">
                      {b.lastHit.player.username} · {b.lastHit.player.team ?? 'ohne Team'}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted">noch keiner</span>
              ),
            sortValue: (b) => b.lastHitAt ?? '',
          },
          {
            key: 'c',
            header: 'Angelegt',
            render: (b) => (
              <span>
                {fmtDateTime(b.createdAt)}
                {b.expiresAt && b.status === 'active' && (
                  <span className="block text-muted">bis {fmtDateTime(b.expiresAt)}</span>
                )}
              </span>
            ),
            sortValue: (b) => b.createdAt,
          },
          {
            key: 'a',
            header: '',
            render: (b) =>
              can('dispatch:edit') && b.status === 'active' ? (
                <ActionDialog
                  title={`Fahndung #${b.number} erledigen`}
                  submitLabel="Erledigt"
                  fields={[
                    { name: 'note', label: 'Notiz (optional)', placeholder: 'z. B. festgenommen', type: 'textarea' },
                  ]}
                  onSubmit={(v) => post(`/dispatch/bolos/${b.id}/resolve`, { note: v.note || undefined })}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
                      Erledigt
                    </Button>
                  )}
                />
              ) : (
                <span className="text-muted">{b.resolveNote ?? ''}</span>
              ),
          },
        ]}
      />
    </>
  );
}
