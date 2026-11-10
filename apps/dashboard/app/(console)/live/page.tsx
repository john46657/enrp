'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives';
import { PlayerActionButton } from '@/components/data/player-action';
import { get } from '@/lib/api';

interface ServerRef {
  id: string;
  jobId: string;
  serverType: string;
}
interface Player {
  userId: number;
  username: string;
  displayName?: string;
  team?: string;
  wanted: number;
  jailed: boolean;
  callsign?: string;
  server: ServerRef;
}
interface Vehicle {
  model: string;
  plate?: string;
  color?: string;
  ownerId?: number;
  ownerName: string | null;
  server: ServerRef;
}

const shortJob = (s: ServerRef) => s.jobId.replace(/[^a-z0-9]/gi, '').slice(0, 6);

function ServerTag({ server }: { server: ServerRef }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge status={server.serverType} />
      <span className="text-muted">{shortJob(server)}</span>
    </span>
  );
}

/** Live-Lage aus dem letzten Heartbeat jedes Servers (alle 30 s). Aktualisiert sich automatisch. */
export default function LivePage() {
  const [q, setQ] = useState('');
  const [plate, setPlate] = useState('');
  const players = useQuery({
    queryKey: ['live-players', q],
    queryFn: () => get<{ items: Player[] }>('/roblox/live/players', { q: q || undefined }),
  });
  const teams = useQuery({
    queryKey: ['live-players', 'teams'],
    queryFn: () => get<{ items: string[] }>('/roblox/live/teams'),
  });
  const vehicles = useQuery({
    queryKey: ['live-vehicles', plate],
    queryFn: () => get<{ items: Vehicle[] }>('/roblox/live/vehicles', { plate: plate || undefined }),
  });
  return (
    <>
      <PageHeader
        title="Live-Lage"
        description="Spieler mit Team, Fahndungsstufe, Gefängnis und Rufname sowie gespawnte Fahrzeuge – aus dem letzten Heartbeat jedes laufenden Servers."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title={`Spieler online (${players.data?.items.length ?? 0})`}
          actions={
            <Input placeholder="Name oder ID" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          }
        >
          {players.isLoading ? (
            <Skeleton />
          ) : players.error ? (
            <ErrorState error={players.error} />
          ) : players.data!.items.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Spieler</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Server</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {players.data!.items.map((p) => (
                  <tr key={`${p.server.id}-${p.userId}`} className="border-t border-line">
                    <td className="py-1.5">
                      <strong>{p.username}</strong>
                      {p.displayName && p.displayName !== p.username && (
                        <span className="text-muted"> ({p.displayName})</span>
                      )}
                      {p.callsign && <span className="text-muted"> · 📻 {p.callsign}</span>}
                    </td>
                    <td>{p.team ?? '–'}</td>
                    <td className="space-x-1">
                      {p.wanted > 0 && <Badge tone="bad">{'★'.repeat(p.wanted)}</Badge>}
                      {p.jailed && <Badge tone="warn">Gefängnis</Badge>}
                      {!p.wanted && !p.jailed && <span className="text-muted">–</span>}
                    </td>
                    <td>
                      <ServerTag server={p.server} />
                    </td>
                    <td className="text-right">
                      <PlayerActionButton userId={p.userId} username={p.username} teams={teams.data?.items ?? []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Niemand online">Oder es kommen noch keine Live-Daten vom Spiel.</EmptyState>
          )}
        </Panel>
        <Panel
          title={`Fahrzeuge (${vehicles.data?.items.length ?? 0})`}
          actions={
            <Input
              placeholder="Kennzeichen"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              className="w-40"
            />
          }
        >
          {vehicles.isLoading ? (
            <Skeleton />
          ) : vehicles.error ? (
            <ErrorState error={vehicles.error} />
          ) : vehicles.data!.items.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Kennzeichen</th>
                  <th>Fahrzeug</th>
                  <th>Besitzer</th>
                  <th>Server</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.data!.items.map((v, index) => (
                  <tr key={`${v.server.id}-${v.plate ?? index}`} className="border-t border-line">
                    <td className="py-1.5 font-mono">{v.plate ?? '–'}</td>
                    <td>
                      {v.model}
                      {v.color && <span className="text-muted"> · {v.color}</span>}
                    </td>
                    <td>{v.ownerName ?? (v.ownerId ? String(v.ownerId) : '–')}</td>
                    <td>
                      <ServerTag server={v.server} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Keine Fahrzeuge">
              {plate ? 'Kein passendes Kennzeichen.' : 'Gerade ist kein Fahrzeug gespawnt.'}
            </EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}
