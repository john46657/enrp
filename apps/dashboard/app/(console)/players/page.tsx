'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ResourceTable } from '@/components/data/resource-table';
import { FACTION_OPTIONS } from '@/components/data/options';
import { Badge, FactionTag, PageHeader } from '@/components/ui/primitives';
import { fmtDuration, fmtRelative } from '@/lib/format';

interface Row {
  robloxUserId: number;
  username: string;
  displayName: string | null;
  playtimeSeconds: number;
  lastSeenAt: string | null;
  verified: boolean;
  discordUserId: string | null;
  factionKey: string | null;
  factionName: string | null;
}

function Players() {
  const initialQ = useSearchParams().get('q') ?? undefined;
  return (
    <ResourceTable<Row>
      key={initialQ}
      path="/players"
      baseQuery={{ q: initialQ }}
      rowKey={(r) => String(r.robloxUserId)}
      rowHref={(r) => `/players/roblox/${r.robloxUserId}`}
      filters={[
        { name: 'faction', label: 'Fraktion', options: FACTION_OPTIONS },
        {
          name: 'verified',
          label: 'Verifiziert',
          options: [
            { value: 'true', label: 'Ja' },
            { value: 'false', label: 'Nein' },
          ],
        },
        {
          name: 'sortBy',
          label: 'Sortierung',
          options: [
            { value: 'playtime', label: 'Spielzeit' },
            { value: 'name', label: 'Name' },
            { value: 'lastSeen', label: 'Zuletzt gesehen' },
          ],
        },
      ]}
      emptyTitle="Keine Spieler gefunden"
      emptyText="Spieler erscheinen, sobald sie einen verbundenen Roblox-Server betreten oder sich verifizieren."
      columns={[
        { key: 'name', header: 'Roblox-Name', render: (r) => r.username, sortValue: (r) => r.username.toLowerCase() },
        { key: 'id', header: 'Roblox-ID', render: (r) => <span className="tabular">{r.robloxUserId}</span> },
        {
          key: 'faction',
          header: 'Fraktion',
          render: (r) => <FactionTag factionKey={r.factionKey} name={r.factionName} />,
        },
        {
          key: 'verified',
          header: 'Verifizierung',
          render: (r) => (r.verified ? <Badge tone="ok">Verifiziert</Badge> : <Badge>Offen</Badge>),
        },
        {
          key: 'playtime',
          header: 'Spielzeit',
          render: (r) => fmtDuration(r.playtimeSeconds),
          sortValue: (r) => r.playtimeSeconds,
        },
        {
          key: 'seen',
          header: 'Zuletzt im Spiel',
          render: (r) => fmtRelative(r.lastSeenAt),
          sortValue: (r) => r.lastSeenAt ?? '',
        },
      ]}
    />
  );
}

export default function PlayersPage() {
  return (
    <>
      <PageHeader title="Spieler" description="Alle bekannten Roblox-Konten mit Verknüpfung, Fraktion und Spielzeit." />
      <Suspense>
        <Players />
      </Suspense>
    </>
  );
}
