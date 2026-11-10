'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

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

const ACTIONS = [
  { value: 'heal', label: 'Heilen' },
  { value: 'respawn', label: 'Respawn' },
  { value: 'jail', label: 'Gefängnis (Minuten angeben)' },
  { value: 'unjail', label: 'Aus dem Gefängnis entlassen' },
  { value: 'wanted', label: 'Fahndungsstufe setzen (Stufe angeben)' },
  { value: 'team', label: 'Team wechseln (Team angeben)' },
];
const ACTION_LABEL: Record<string, string> = {
  heal: 'Heilen',
  kill: 'Töten',
  respawn: 'Respawn',
  jail: 'Gefängnis',
  unjail: 'Entlassen',
  wanted: 'Fahndungsstufe',
  team: 'Teamwechsel',
};
const COMMAND_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  pending: { label: 'wartet', tone: 'warn' },
  delivered: { label: 'zugestellt', tone: 'warn' },
  succeeded: { label: 'ausgeführt', tone: 'ok' },
  failed: { label: 'fehlgeschlagen', tone: 'bad' },
  expired: { label: 'verfallen', tone: 'muted' },
};

interface PlayerAction {
  id: string;
  type: string;
  robloxUserId: number;
  username: string | null;
  params: Record<string, unknown> | null;
  reason: string;
  status: string;
  error: string | null;
  createdBy: string;
  createdAt: string;
}

/** Aktion an einem Spieler im Spiel. Töten nur mit ingame_actions:approve; Kick/Bann laufen über die Moderation. */
function PlayerActionButton({ player, canKill }: { player: Player; canKill: boolean }) {
  return (
    <ActionDialog
      title={`Aktion an ${player.username}`}
      description="Der Server, auf dem der Spieler gerade ist, führt die Aktion in wenigen Sekunden aus. Kick und Bann im Spiel: Moderation (Plattform Roblox)."
      submitLabel="Ausführen"
      requireReason
      fields={[
        {
          name: 'action',
          label: 'Aktion',
          type: 'select',
          required: true,
          options: canKill ? [...ACTIONS, { value: 'kill', label: 'Töten' }] : ACTIONS,
        },
        { name: 'minutes', label: 'Minuten (Gefängnis)', type: 'number', min: 1, max: 240 },
        { name: 'level', label: 'Fahndungsstufe 0–5', type: 'number', min: 0, max: 5 },
        { name: 'team', label: 'Team', placeholder: 'Name des Teams im Spiel' },
      ]}
      onSubmit={(v) => {
        const action = String(v.action);
        const command =
          action === 'jail'
            ? { action, minutes: v.minutes }
            : action === 'wanted'
              ? { action, level: v.level }
              : action === 'team'
                ? { action, team: v.team }
                : { action };
        return post(`/roblox/players/${player.userId}/actions`, { command, reason: v.reason });
      }}
      successMessage="Aktion gesendet"
      invalidate={[['player-actions']]}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Aktion
        </Button>
      )}
    />
  );
}

function BoloVehicleButton({ vehicle }: { vehicle: Vehicle }) {
  return (
    <ActionDialog
      title={`Fahndung nach ${vehicle.plate}`}
      submitLabel="Fahndung anlegen"
      fields={[
        { name: 'reason', label: 'Grund', type: 'textarea', required: true },
        { name: 'expiresInHours', label: 'Automatisch beenden nach (Stunden)', type: 'number', min: 1, max: 720 },
      ]}
      onSubmit={(v, key) =>
        post(
          '/dispatch/bolos',
          {
            kind: 'vehicle',
            plate: vehicle.plate,
            vehicleDescription: [vehicle.model, vehicle.color].filter(Boolean).join(', '),
            reason: v.reason,
            expiresInHours: v.expiresInHours,
          },
          key,
        )
      }
      successMessage="Fahndung angelegt"
      invalidate={[['list', '/dispatch/bolos']]}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Fahnden
        </Button>
      )}
    />
  );
}

/** Live-Lage aus dem letzten Heartbeat jedes Servers (alle 30 s). Aktualisiert sich automatisch. */
export default function LivePage() {
  const can = useCan();
  const canAct = can('ingame_actions:edit');
  const canBolo = can('dispatch:create');
  const [q, setQ] = useState('');
  const [plate, setPlate] = useState('');
  const players = useQuery({
    queryKey: ['live-players', q],
    queryFn: () => get<{ items: Player[] }>('/roblox/live/players', { q: q || undefined }),
  });
  const vehicles = useQuery({
    queryKey: ['live-vehicles', plate],
    queryFn: () => get<{ items: Vehicle[] }>('/roblox/live/vehicles', { plate: plate || undefined }),
  });
  const actions = useQuery({
    queryKey: ['player-actions'],
    queryFn: () => get<{ items: PlayerAction[] }>('/roblox/player-actions', { limit: 15 }),
    enabled: can('ingame_actions:view'),
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
                  {canAct && <th />}
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
                    {canAct && (
                      <td className="text-right">
                        <PlayerActionButton player={p} canKill={can('ingame_actions:approve')} />
                      </td>
                    )}
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
                  {canBolo && <th />}
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
                    {canBolo && <td className="text-right">{v.plate && <BoloVehicleButton vehicle={v} />}</td>}
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
      {can('ingame_actions:view') && (
        <div className="mt-6">
          <Panel title="Letzte Ingame-Aktionen">
            {actions.isLoading ? (
              <Skeleton />
            ) : actions.error ? (
              <ErrorState error={actions.error} />
            ) : actions.data!.items.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1">Zeit</th>
                    <th>Spieler</th>
                    <th>Aktion</th>
                    <th>Grund</th>
                    <th>Von</th>
                    <th>Ergebnis</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.data!.items.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="py-1.5">{fmtDateTime(a.createdAt)}</td>
                      <td>{a.username ?? a.robloxUserId}</td>
                      <td>
                        {ACTION_LABEL[a.type] ?? a.type}
                        {a.params && <span className="text-muted"> ({Object.values(a.params).join(', ')})</span>}
                      </td>
                      <td>{a.reason}</td>
                      <td className="text-muted">{a.createdBy}</td>
                      <td>
                        <Badge tone={COMMAND_STATUS[a.status]?.tone ?? 'muted'}>
                          {COMMAND_STATUS[a.status]?.label ?? a.status}
                        </Badge>
                        {a.error && <span className="block text-muted">{a.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title="Noch keine Ingame-Aktionen">
                Aktionen startest du über „Aktion“ in der Spielerliste.
              </EmptyState>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
