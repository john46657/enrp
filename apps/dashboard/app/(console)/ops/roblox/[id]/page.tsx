'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, EmptyState, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtDuration, fmtRelative, statusLabel } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Detail {
  server: {
    id: string;
    jobId: string;
    placeId: string;
    placeVersion: number | null;
    status: string;
    serverType: 'public' | 'private' | 'reserved';
    privateServerOwnerId: number | null;
    playerCount: number;
    maxPlayers: number | null;
    startedAt: string;
    lastHeartbeatAt: string;
    endedAt: string | null;
  };
  players: Array<{ userId: number; username: string; displayName: string | null; joinedAt: string }>;
  commands: Array<{
    id: string;
    type: 'message_server' | 'message_player' | 'shutdown';
    robloxUserId: number | null;
    message: string | null;
    reason: string;
    status: string;
    createdBy: string;
    createdAt: string;
    error: string | null;
  }>;
}

const COMMAND_LABELS: Record<Detail['commands'][number]['type'], string> = {
  message_server: 'Nachricht an Server',
  message_player: 'Nachricht an Spieler',
  shutdown: 'Herunterfahren',
};

export default function RobloxServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const detail = useQuery({
    queryKey: ['roblox-server', id],
    queryFn: () => get<Detail>(`/roblox/servers/${id}`),
    refetchInterval: 10_000,
  });
  if (detail.isLoading) return <Skeleton />;
  if (detail.error) return <ErrorState error={detail.error} />;
  const { server, players, commands } = detail.data!;
  const online = server.status === 'online';
  const send = (command: Record<string, unknown>, reason: unknown) =>
    post('/roblox/commands', { serverId: server.id, command, reason });
  const uptimeSeconds = Math.floor(
    ((server.endedAt ? new Date(server.endedAt) : new Date()).getTime() - new Date(server.startedAt).getTime()) / 1000,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Server ${server.jobId.slice(0, 18)}`}
        description={`${statusLabel(server.serverType)} · ${players.length} Spieler · letzter Heartbeat ${fmtRelative(server.lastHeartbeatAt)}`}
      />
      <Panel
        title="Server"
        actions={
          online && (
            <div className="flex flex-wrap gap-2">
              {can('roblox_servers:edit') && (
                <ActionDialog
                  title="Nachricht an diesen Server"
                  description="Erscheint als Banner bei allen Spielern dieses Servers."
                  submitLabel="Senden"
                  requireReason
                  fields={[{ name: 'message', label: 'Nachricht', type: 'textarea', required: true, max: 300 }]}
                  onSubmit={(v) => send({ type: 'message_server', message: v.message }, v.reason)}
                  successMessage="Nachricht in Zustellung"
                  invalidate={[['roblox-server', id]]}
                  trigger={(open) => <Button onClick={open}>Nachricht senden</Button>}
                />
              )}
              {can('roblox_servers:configure') && (
                <ActionDialog
                  title="Server herunterfahren"
                  description="Alle Spieler sehen eine Ankündigung und werden nach 10 Sekunden vom Server entfernt."
                  submitLabel="Herunterfahren"
                  danger
                  requireReason
                  confirmWord="HERUNTERFAHREN"
                  fields={[{ name: 'message', label: 'Text für die Spieler (optional)', type: 'textarea', max: 300 }]}
                  onSubmit={(v) => send({ type: 'shutdown', message: v.message }, v.reason)}
                  successMessage="Herunterfahren angeordnet"
                  invalidate={[['roblox-server', id]]}
                  trigger={(open) => (
                    <Button variant="danger" onClick={open}>
                      Herunterfahren
                    </Button>
                  )}
                />
              )}
            </div>
          )
        }
      >
        <KeyValues
          items={[
            ['Status', <StatusBadge key="s" status={server.status} />],
            ['Typ', <Badge key="t">{statusLabel(server.serverType)}</Badge>],
            [
              'Besitzer (privat)',
              server.privateServerOwnerId ? (
                <Link className="hover:underline" href={`/players/roblox/${server.privateServerOwnerId}`}>
                  {server.privateServerOwnerId}
                </Link>
              ) : null,
            ],
            ['JobId', <code key="j" className="text-xs">{server.jobId}</code>],
            ['Place / Version', `${server.placeId} / ${server.placeVersion ?? '–'}`],
            ['Spieler', `${server.playerCount}${server.maxPlayers ? ` / ${server.maxPlayers}` : ''}`],
            ['Gestartet', fmtDateTime(server.startedAt)],
            ['Laufzeit', fmtDuration(uptimeSeconds)],
          ]}
        />
      </Panel>
      <Panel title="Spieler auf dem Server">
        {players.length ? (
          <ul className="divide-y divide-line text-sm">
            {players.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-3 py-2">
                <Link className="font-medium hover:underline" href={`/players/roblox/${p.userId}`}>
                  {p.displayName ?? p.username}
                </Link>
                <span className="text-muted">@{p.username}</span>
                <span className="text-muted">seit {fmtRelative(p.joinedAt)}</span>
                {online && can('roblox_servers:edit') && (
                  <ActionDialog
                    title={`Nachricht an ${p.username}`}
                    submitLabel="Senden"
                    requireReason
                    fields={[{ name: 'message', label: 'Nachricht', type: 'textarea', required: true, max: 300 }]}
                    onSubmit={(v) => send({ type: 'message_player', robloxUserId: p.userId, message: v.message }, v.reason)}
                    successMessage="Nachricht in Zustellung"
                    invalidate={[['roblox-server', id]]}
                    trigger={(open) => (
                      <Button size="sm" className="ml-auto" onClick={open}>
                        Nachricht
                      </Button>
                    )}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Keine Spieler">Auf diesem Server ist gerade niemand.</EmptyState>
        )}
      </Panel>
      <Panel title="Befehle">
        <ul className="divide-y divide-line text-sm">
          {commands.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-1.5">
              <span className="w-40 shrink-0 text-muted">{fmtDateTime(c.createdAt)}</span>
              <span className="w-44 shrink-0">{COMMAND_LABELS[c.type]}</span>
              <StatusBadge status={c.status} />
              <span className="min-w-0 truncate">{c.message ?? '–'}</span>
              <span className="text-muted">Grund: {c.reason}</span>
              {c.error && <span className="text-bad">{c.error}</span>}
            </li>
          ))}
          {!commands.length && <li className="text-muted">Noch keine Befehle.</li>}
        </ul>
      </Panel>
    </div>
  );
}
