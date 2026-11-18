'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Faction {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  discordRoleId: string | null;
  isActive: boolean;
  hasDuty: boolean;
}
interface Member {
  membershipId: string;
  robloxUserId: number;
  username: string;
  joinedAt: string;
  addedBy: string;
}
interface HistoryRow {
  membership: {
    id: string;
    status: string;
    joinedAt: string;
    endedAt: string | null;
    addReason: string | null;
    endReason: string | null;
    addedBy: string;
    endedBy: string | null;
  };
  username: string;
}

export default function FactionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const can = useCan();
  const faction = useQuery({ queryKey: ['faction', key], queryFn: () => get<Faction>(`/factions/${key}`) });
  const history = useQuery({
    queryKey: ['faction-history', key],
    queryFn: () => get<{ items: HistoryRow[] }>(`/factions/${key}/history`),
  });
  if (faction.isLoading) return <Skeleton />;
  if (faction.error) return <ErrorState error={faction.error} />;
  const f = faction.data!;
  const invalidate = [
    ['list', `/factions/${key}/members`],
    ['faction-history', key],
    ['faction', key],
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title={f.name}
        description={f.description || (f.hasDuty ? 'Fraktion mit Dienstsystem' : 'Fraktion ohne Dienstsystem')}
        actions={
          <>
            {can('factions:edit') && (
              <ActionDialog
                title={`In ${f.name} aufnehmen`}
                description="Roblox-Name oder -ID. Gehört die Person einer anderen Fraktion an, wird sie versetzt (dafür brauchst du auch dort Rechte)."
                submitLabel="Aufnehmen"
                successMessage="Aufgenommen"
                requireReason
                fields={[{ name: 'roblox', label: 'Roblox-Name oder -ID', required: true }]}
                onSubmit={(v, k) => {
                  const r = String(v.roblox);
                  return post(
                    `/factions/${key}/members`,
                    { ...(/^\d+$/.test(r) ? { robloxUserId: Number(r) } : { robloxUsername: r }), reason: v.reason },
                    k,
                  );
                }}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Mitglied aufnehmen
                  </Button>
                )}
              />
            )}
            {can('factions:configure') && (
              <ActionDialog
                title="Fraktion konfigurieren"
                submitLabel="Speichern"
                successMessage="Gespeichert"
                requireReason
                fields={[
                  { name: 'name', label: 'Name', defaultValue: f.name, required: true },
                  { name: 'description', label: 'Beschreibung', type: 'textarea', defaultValue: f.description },
                  { name: 'color', label: 'Farbe (#RRGGBB)', defaultValue: f.color },
                  {
                    name: 'discordRoleId',
                    label: 'Discord-Rolle (optional)',
                    defaultValue: f.discordRoleId ?? '',
                    hint: 'Wird Mitgliedern mit verknüpftem Konto bei Aufnahme vergeben und bei Austritt entzogen.',
                  },
                  { name: 'isActive', label: 'Fraktion aktiv', type: 'checkbox', defaultValue: f.isActive },
                ]}
                onSubmit={(v) => patch(`/factions/${key}`, { ...v, discordRoleId: v.discordRoleId ?? null })}
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Konfigurieren</Button>}
              />
            )}
          </>
        }
      />
      <Panel title="Mitglieder">
        <ResourceTable<Member>
          path={`/factions/${key}/members`}
          rowKey={(m) => m.membershipId}
          rowHref={(m) => `/players/roblox/${m.robloxUserId}`}
          emptyTitle="Keine Mitglieder"
          columns={[
            {
              key: 'name',
              header: 'Roblox-Name',
              render: (m) => m.username,
              sortValue: (m) => m.username.toLowerCase(),
            },
            { key: 'since', header: 'Mitglied seit', render: (m) => fmtDate(m.joinedAt), sortValue: (m) => m.joinedAt },
            { key: 'by', header: 'Aufgenommen von', render: (m) => m.addedBy },
            {
              key: 'actions',
              header: '',
              render: (m) =>
                can('factions:edit') ? (
                  <ActionDialog
                    title={`${m.username} entfernen`}
                    submitLabel="Entfernen"
                    danger
                    requireReason
                    fields={[]}
                    onSubmit={(v, k) =>
                      post('/factions/members/remove', { robloxUserId: m.robloxUserId, reason: v.reason }, k)
                    }
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" variant="ghost" onClick={open}>
                        Entfernen
                      </Button>
                    )}
                  />
                ) : null,
            },
          ]}
        />
      </Panel>
      <Panel title="Änderungshistorie">
        {history.data?.items.length ? (
          <ul className="space-y-1.5 text-sm">
            {history.data.items.map((h) => (
              <li key={h.membership.id}>
                <span className="text-muted">{fmtDateTime(h.membership.joinedAt)}</span>{' '}
                <span className="font-medium">{h.username}</span> aufgenommen ({h.membership.addReason ?? 'ohne Angabe'}
                )
                {h.membership.endedAt && (
                  <span className="text-muted">
                    , beendet {fmtDateTime(h.membership.endedAt)}: {h.membership.endReason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Keine Änderungen.</p>
        )}
      </Panel>
      <Panel title="Einstellungen">
        <KeyValues
          items={[
            ['Schlüssel', f.key],
            ['Dienstsystem', f.hasDuty ? 'ja' : 'nein'],
            ['Discord-Rolle', f.discordRoleId ?? 'keine'],
            ['Status', f.isActive ? 'aktiv' : 'deaktiviert'],
          ]}
        />
      </Panel>
    </div>
  );
}
