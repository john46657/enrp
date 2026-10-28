'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Server {
  id: string;
  jobId: string;
  placeId: string;
  placeVersion: number | null;
  status: string;
  playerCount: number;
  maxPlayers: number | null;
  startedAt: string;
  lastHeartbeatAt: string;
}
interface Key {
  id: string;
  name: string;
  prefix: string;
  allowedPlaceIds: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function RobloxPage() {
  const can = useCan();
  const [newKey, setNewKey] = useState<string | null>(null);
  const servers = useQuery({ queryKey: ['roblox-servers'], queryFn: () => get<{ overview: { connected: boolean; playersOnline: number }; recent: Server[] }>('/roblox/servers'), refetchInterval: 30_000 });
  const keys = useQuery({ queryKey: ['roblox-keys'], queryFn: () => get<{ items: Key[] }>('/roblox/keys'), enabled: can('roblox_servers:view') });
  const events = useQuery({ queryKey: ['roblox-events'], queryFn: () => get<{ items: Array<{ id: string; type: string; status: string; receivedAt: string; result: unknown }> }>('/roblox/events', { limit: 30 }), enabled: can('roblox_servers:view') });
  if (servers.isLoading) return <Skeleton />;
  if (servers.error) return <ErrorState error={servers.error} />;
  const s = servers.data!;
  return (
    <div className="space-y-6">
      <PageHeader title="Roblox-Server" description={s.overview.connected ? `${s.overview.playersOnline} Spieler auf verbundenen Servern.` : 'Derzeit sendet kein Spielserver Heartbeats. Prüfe API-Schlüssel und HttpService (siehe roblox/README.md).'} />
      <Panel title="Server-Instanzen">
        {s.recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1.5 font-medium">JobId</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Spieler</th>
                  <th className="font-medium">Place / Version</th>
                  <th className="font-medium">Gestartet</th>
                  <th className="font-medium">Letzter Heartbeat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.recent.map((x) => (
                  <tr key={x.id}>
                    <td className="py-1.5 font-mono text-xs">{x.jobId.slice(0, 18)}</td>
                    <td>
                      <StatusBadge status={x.status} />
                    </td>
                    <td className="tabular">
                      {x.playerCount}
                      {x.maxPlayers ? ` / ${x.maxPlayers}` : ''}
                    </td>
                    <td className="tabular">
                      {x.placeId} / {x.placeVersion ?? '–'}
                    </td>
                    <td>{fmtDateTime(x.startedAt)}</td>
                    <td>{fmtRelative(x.lastHeartbeatAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Noch kein Server verbunden">Lege unten einen API-Schlüssel an, speichere ihn im Roblox Secrets Store und starte einen Server mit den Skripten aus dem Ordner roblox/.</EmptyState>
        )}
      </Panel>
      {can('roblox_servers:view') && (
        <Panel
          title="API-Schlüssel der Spielserver"
          actions={
            can('roblox_servers:configure') && (
              <ActionDialog
                title="API-Schlüssel erzeugen"
                description="Der Schlüssel wird genau einmal angezeigt. Speichere ihn als Secret im Roblox Creator Hub (nie in einem Skript oder im Client)."
                submitLabel="Erzeugen"
                requireReason
                fields={[
                  { name: 'name', label: 'Bezeichnung', required: true, placeholder: 'Live-Server' },
                  { name: 'placeIds', label: 'Erlaubte Place-IDs (kommagetrennt, optional)' },
                ]}
                onSubmit={(v) => post<{ key: string }>('/roblox/keys', { name: v.name, reason: v.reason, allowedPlaceIds: v.placeIds ? String(v.placeIds).split(',').map((x) => x.trim()) : undefined })}
                onDone={(r) => setNewKey((r as { key: string }).key)}
                successMessage="Schlüssel erzeugt"
                invalidate={[['roblox-keys']]}
                trigger={(open) => <Button onClick={open}>Schlüssel erzeugen</Button>}
              />
            )
          }
        >
          {newKey && (
            <div className="mb-4 rounded-md border border-signal/60 bg-signal/10 p-3 text-sm" role="status">
              <p className="font-medium">Neuer Schlüssel – jetzt kopieren, er wird nicht erneut angezeigt:</p>
              <code className="mt-1 block break-all select-all">{newKey}</code>
              <Button size="sm" className="mt-2" onClick={() => setNewKey(null)}>
                Ich habe ihn gespeichert
              </Button>
            </div>
          )}
          <ul className="divide-y divide-line text-sm">
            {keys.data?.items.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">{k.name}</span>
                <code className="text-xs text-muted">{k.prefix}…</code>
                {k.revokedAt ? <Badge tone="bad">widerrufen</Badge> : <Badge tone="ok">aktiv</Badge>}
                <span className="text-muted">zuletzt genutzt {fmtRelative(k.lastUsedAt)}</span>
                {k.allowedPlaceIds && <span className="text-muted">Places: {k.allowedPlaceIds.join(', ')}</span>}
                {!k.revokedAt && can('roblox_servers:configure') && (
                  <ActionDialog title={`Schlüssel „${k.name}“ widerrufen`} description="Server mit diesem Schlüssel werden sofort abgewiesen." submitLabel="Widerrufen" danger requireReason fields={[]} onSubmit={(v) => post(`/roblox/keys/${k.id}/revoke`, v)} invalidate={[['roblox-keys']]} trigger={(open) => <Button size="sm" variant="danger" className="ml-auto" onClick={open}>Widerrufen</Button>} />
                )}
              </li>
            ))}
            {!keys.data?.items.length && <li className="py-2 text-muted">Noch keine Schlüssel.</li>}
          </ul>
        </Panel>
      )}
      {can('roblox_servers:view') && (
        <Panel title="Letzte Spielereignisse">
          <ul className="divide-y divide-line text-sm">
            {events.data?.items.map((e) => (
              <li key={e.id} className="flex gap-3 py-1.5">
                <span className="w-40 shrink-0 text-muted">{fmtDateTime(e.receivedAt)}</span>
                <span className="w-36 shrink-0">{e.type}</span>
                <StatusBadge status={e.status === 'processed' ? 'succeeded' : e.status} />
                <span className="truncate text-muted">{JSON.stringify(e.result)}</span>
              </li>
            ))}
            {!events.data?.items.length && <li className="text-muted">Keine Ereignisse.</li>}
          </ul>
        </Panel>
      )}
    </div>
  );
}
