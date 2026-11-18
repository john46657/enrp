'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  KeyValues,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/ui/primitives';
import { get, put } from '@/lib/api';
import { useCan } from '@/lib/session';

type LogKey =
  | 'killChannelId'
  | 'teamChannelId'
  | 'vehicleChannelId'
  | 'joinChannelId'
  | 'dutyChannelId'
  | 'actionChannelId';

interface Guild {
  id: string;
  name: string;
  kind: 'private_server' | 'other';
  active: boolean;
  syncBans: boolean;
  botPresent: boolean;
  privateServer: { id: string; name: string | null; ownerRobloxId: number | null } | null;
  channels: {
    dispatchChannelId?: string;
    dispatchPingRoleId?: string;
    modCallChannelId?: string;
    livePanelChannelId?: string;
    livePanelShowPlayers?: boolean;
    gameLogs?: Partial<Record<LogKey, string>>;
  };
}

interface PrivateServerOption {
  id: string;
  name: string | null;
  ownerName: string | null;
  ownerRobloxId: number;
}

const LOGS: Array<[LogKey, string]> = [
  ['killChannelId', 'Kill-Log'],
  ['teamChannelId', 'Teamwechsel-Log'],
  ['vehicleChannelId', 'Fahrzeug-Log'],
  ['joinChannelId', 'Join/Leave-Log'],
  ['dutyChannelId', 'Dienst-Log'],
  ['actionChannelId', 'Aktions-Log (Team an Spielern)'],
];

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export default function GuildsPage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['discord-guilds'],
    queryFn: () => get<{ mainGuildId: string | null; items: Guild[] }>('/discord-guilds'),
  });
  const ps = useQuery({
    queryKey: ['private-servers'],
    queryFn: () => get<{ items: PrivateServerOption[] }>('/private-servers'),
  });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { mainGuildId, items } = q.data!;
  const psOptions = [
    { value: '', label: '— keiner —' },
    ...(ps.data?.items ?? []).map((p) => ({
      value: p.id,
      label: `${p.name ?? 'Privat-Server'} (Besitzer ${p.ownerName ?? p.ownerRobloxId})`,
    })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discord-Server"
        description="Haupt-Discord und weitere Discords (z. B. Discords der Privat-Server). Jeder weitere Discord hat eigene Kanäle für Leitstelle, Mod-Calls, Spiel-Logs und Live-Panel. Ist ein Privat-Server zugeordnet, landen dessen Notrufe, Mod-Calls, Fahndungstreffer und Logs dort."
      />
      <Panel title="Haupt-Discord">
        <KeyValues
          items={[
            ['Server-ID', mainGuildId ?? 'nicht gesetzt (DISCORD_GUILD_ID)'],
            ['Kanäle', 'wie bisher unter Bot-Verwaltung → Konfiguration (dispatch, game_logs, live_panel)'],
            ['Rechte', 'Zuweisungen ohne Discord-Server (Rollen & Rechte)'],
          ]}
        />
      </Panel>
      {!items.length ? (
        <EmptyState title="Noch keine weiteren Discords">
          Lade den Bot in einen weiteren Discord ein – er meldet sich dann automatisch hier.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {items.map((g) => (
            <Panel
              key={g.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {g.name}
                  <Badge tone={g.kind === 'private_server' ? 'info' : 'muted'}>
                    {g.kind === 'private_server' ? 'Privat-Server' : 'weiterer Discord'}
                  </Badge>
                  {!g.active && <Badge tone="warn">deaktiviert</Badge>}
                  {!g.botPresent && <Badge tone="bad">Bot nicht mehr drin</Badge>}
                </span>
              }
              actions={
                can('settings:edit') && (
                  <ActionDialog
                    title={`„${g.name}“ einstellen`}
                    submitLabel="Speichern"
                    description="Leere Felder = aus. IDs per Rechtsklick in Discord kopieren (Entwicklermodus)."
                    fields={[
                      { name: 'active', label: 'Aktiv', type: 'checkbox', defaultValue: g.active },
                      {
                        name: 'privateServerId',
                        label: 'Zugeordneter Privat-Server',
                        type: 'select',
                        options: psOptions,
                        defaultValue: g.privateServer?.id ?? '',
                      },
                      {
                        name: 'syncBans',
                        label: 'Globale Discord-Banns übernehmen',
                        type: 'checkbox',
                        defaultValue: g.syncBans,
                        hint: 'Banns mit der Option „global“ aus dem Haupt-Discord gelten dann auch hier.',
                      },
                      {
                        name: 'dispatchChannelId',
                        label: 'Leitstellen-Kanal',
                        defaultValue: g.channels.dispatchChannelId ?? '',
                      },
                      {
                        name: 'dispatchPingRoleId',
                        label: 'Leitstellen-Rolle (Ping bei Notrufen)',
                        defaultValue: g.channels.dispatchPingRoleId ?? '',
                      },
                      {
                        name: 'modCallChannelId',
                        label: 'Mod-Call-Kanal',
                        defaultValue: g.channels.modCallChannelId ?? '',
                      },
                      {
                        name: 'livePanelChannelId',
                        label: 'Live-Panel-Kanal',
                        defaultValue: g.channels.livePanelChannelId ?? '',
                      },
                      {
                        name: 'livePanelShowPlayers',
                        label: 'Spielernamen im Live-Panel',
                        type: 'checkbox',
                        defaultValue: g.channels.livePanelShowPlayers === true,
                      },
                      ...LOGS.map(([key, label]) => ({
                        name: key,
                        label,
                        defaultValue: g.channels.gameLogs?.[key] ?? '',
                      })),
                      { name: 'reason', label: 'Grund (optional)' },
                    ]}
                    onSubmit={(v) =>
                      put(`/discord-guilds/${g.id}`, {
                        active: Boolean(v.active),
                        syncBans: Boolean(v.syncBans),
                        privateServerId: str(v.privateServerId),
                        ...(str(v.privateServerId) ? {} : { kind: 'other' }),
                        channels: {
                          dispatchChannelId: str(v.dispatchChannelId),
                          dispatchPingRoleId: str(v.dispatchPingRoleId),
                          modCallChannelId: str(v.modCallChannelId),
                          livePanelChannelId: str(v.livePanelChannelId),
                          livePanelShowPlayers: Boolean(v.livePanelShowPlayers),
                          gameLogs: Object.fromEntries(LOGS.map(([key]) => [key, str(v[key])])),
                        },
                        ...(str(v.reason) ? { reason: str(v.reason) } : {}),
                      })
                    }
                    invalidate={[['discord-guilds']]}
                    trigger={(o) => (
                      <Button variant="primary" onClick={o}>
                        Bearbeiten
                      </Button>
                    )}
                  />
                )
              }
            >
              <KeyValues
                items={[
                  ['Server-ID', g.id],
                  [
                    'Privat-Server',
                    g.privateServer ? (g.privateServer.name ?? `Besitzer ${g.privateServer.ownerRobloxId}`) : '–',
                  ],
                  ['Globale Banns', g.syncBans ? 'werden übernommen' : 'nein'],
                  ['Leitstelle', g.channels.dispatchChannelId ?? 'aus (Haupt-Discord)'],
                  ['Mod-Calls', g.channels.modCallChannelId ?? 'aus (Haupt-Discord)'],
                  ['Live-Panel', g.channels.livePanelChannelId ?? 'aus'],
                  [
                    'Spiel-Logs',
                    LOGS.filter(([k]) => g.channels.gameLogs?.[k])
                      .map(([, l]) => l)
                      .join(', ') || 'aus',
                  ],
                ]}
              />
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
