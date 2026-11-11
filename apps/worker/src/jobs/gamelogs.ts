import { gamelogs, getSetting, guilds, type CoreContext } from '@enrp/core';
import { plain } from './dispatch-messages';

/** Spiel-Logs und Live-Panel als Discord-Nachrichten. Spielertexte werden immer entschärft. */

interface Entry {
  type: string;
  at: string;
  data: Record<string, unknown>;
}

const s = (value: unknown) => plain(value === undefined || value === null ? '' : String(value));
const who = (name: unknown, id: unknown) => (name ? `**${s(name)}**` : id ? `\`${s(id)}\`` : 'Unbekannt');
const time = (iso: string) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:T>`;

const ACTION: Record<string, string> = {
  jail: '🔒 Gefängnis',
  unjail: '🔓 Entlassen',
  wanted: '⭐ Fahndungsstufe',
  heal: '❤️ Geheilt',
  respawn: '🔄 Respawn',
  team: '👕 Team gesetzt',
  pm: '✉️ Nachricht',
  kill: '💀 Getötet',
  kick: '👢 Gekickt',
};

export function formatLogEntry(e: Entry): string {
  const d = e.data;
  switch (e.type) {
    case 'player_killed':
      return d.killerId || d.killerName
        ? `💀 ${who(d.killerName, d.killerId)} hat ${who(d.username, d.userId)} getötet${d.weapon ? ` (${s(d.weapon)})` : ''}`
        : `💀 ${who(d.username, d.userId)} ist gestorben`;
    case 'team_changed':
      return `👕 ${who(d.username, d.userId)}: ${s(d.from) || '—'} → ${s(d.to) || '—'}`;
    case 'vehicle_spawned':
    case 'vehicle_despawned':
      return `${e.type === 'vehicle_spawned' ? '🚗 Gespawnt' : '🅿️ Entfernt'}: ${s(d.model)}${d.plate ? ` [${s(d.plate)}]` : ''}${
        d.color ? ` · ${s(d.color)}` : ''
      }${d.username ? ` · ${who(d.username, d.userId)}` : ''}`;
    case 'player_joined':
      return `📥 ${who(d.username, d.userId)} ist beigetreten`;
    case 'player_left':
      return `📤 ${who(d.username, d.userId)} hat den Server verlassen`;
    case 'duty_start':
      return `🟢 ${who(d.username, d.userId)} Dienstbeginn${d.faction ? ` (${s(d.faction)})` : ''}`;
    case 'duty_end':
      return `🔴 ${who(d.username, d.userId)} Dienstende`;
    case 'player_action': {
      const extra = d.minutes
        ? ` · ${s(d.minutes)} Min.`
        : d.level !== undefined
          ? ` · Stufe ${s(d.level)}`
          : d.team
            ? ` · ${s(d.team)}`
            : '';
      return `${ACTION[String(d.action)] ?? s(d.action)}: ${who(d.username, d.userId)}${extra} · von ${d.issuerName ? `**${s(d.issuerName)}** (Privat-Server)` : `<@${s(d.by).replace(/\D/g, '') || '0'}>`} · Grund: ${s(d.reason)}`;
    }
    default:
      return `${s(e.type)}`;
  }
}

export function gameLogMessage(server: { jobId: string; serverType: string } | null, entries: Entry[]) {
  const label = server
    ? `${server.serverType === 'private' ? '🔒 Privat-Server' : server.serverType === 'reserved' ? '🔐 Reserviert' : '🌐 Öffentlich'} · ${server.jobId
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 6)}`
    : 'Spiel';
  return {
    embed: {
      description: entries
        .map((e) => `${time(e.at)} ${formatLogEntry(e)}`)
        .join('\n')
        .slice(0, 4000),
      color: '#4b5563',
      footer: label,
    },
  };
}

const TYPE: Record<string, string> = { public: '🌐', private: '🔒', reserved: '🔐' };

export async function livePanelMessage(ctx: CoreContext, showPlayers: boolean, onlyJobIds?: string[]) {
  const data = await gamelogs.livePanelData(ctx.db, ctx.now(), onlyJobIds);
  const fields = [
    { name: '🎮 Server', value: String(data.servers.length), inline: true },
    { name: '👥 Spieler', value: String(data.playerCount), inline: true },
    { name: '🚓 Einheiten im Dienst', value: String(data.unitsOnDuty), inline: true },
    { name: '🚨 Offene Einsätze', value: String(data.openIncidents), inline: true },
    { name: '🔎 Aktive Fahndungen', value: String(data.activeBolos), inline: true },
    {
      name: '🛡️ Fraktionen im Dienst',
      value: data.onDuty.map((d) => `${s(d.factionKey)}: ${d.count}`).join('\n') || '—',
      inline: true,
    },
  ];
  if (data.servers.length)
    fields.push({
      name: 'Server',
      value: data.servers
        .slice(0, 15)
        .map(
          (sv) =>
            `${TYPE[sv.serverType] ?? '🌐'} \`${sv.jobId.replace(/[^a-z0-9]/gi, '').slice(0, 6)}\` · ${sv.playerCount}${sv.maxPlayers ? `/${sv.maxPlayers}` : ''}`,
        )
        .join('\n'),
      inline: false,
    });
  if (data.teams.length)
    fields.push({
      name: 'Teams',
      value: data.teams
        .map((t) => `${s(t.name)}: ${t.count}`)
        .join(' · ')
        .slice(0, 1000),
      inline: false,
    });
  if (showPlayers && data.players.length)
    fields.push({
      name: 'Spieler online',
      value: data.players
        .map((p) => s(p.username))
        .join(', ')
        .slice(0, 1000),
      inline: false,
    });
  return {
    embed: {
      title: onlyJobIds ? '📡 Live-Lage · Privat-Server' : '📡 Live-Lage',
      description: `Stand <t:${Math.floor(new Date(data.at).getTime() / 1000)}:R> · aktualisiert sich jede Minute`,
      color: data.servers.length ? '#16a34a' : '#4b5563',
      fields,
      footer: 'ENRP Live-Panel',
    },
  };
}

/** Live-Panel anlegen oder bearbeiten; gelöschte Nachricht oder neuer Kanal → neue Nachricht. */
async function upsertPanel(
  ctx: CoreContext,
  key: string,
  channelId: string,
  message: Awaited<ReturnType<typeof livePanelMessage>>,
) {
  const panel = await gamelogs.getPanel(ctx.db, key);
  if (panel && panel.channelId === channelId) {
    try {
      await ctx.discord.editMessage(panel.channelId, panel.messageId, message);
      return 'edited' as const;
    } catch (err) {
      ctx.logger.warn({ err: (err as Error).message, key }, 'Live-Panel: Bearbeiten fehlgeschlagen, sende neu');
    }
  }
  const sent = await ctx.discord.sendMessage(channelId, message);
  await gamelogs.savePanel(ctx.db, key, channelId, sent.id, ctx.now());
  return 'sent' as const;
}

/**
 * Live-Panel im Haupt-Discord (alle Server) und in weiteren Discords mit eigenem Panel-Kanal (beim Discord eines
 * Privat-Servers nur dessen Server). Ein Fehler in einem Discord hält die anderen nicht auf.
 */
export async function updateLivePanel(ctx: CoreContext) {
  if (!ctx.discord.configured) return { status: 'off' as const };
  const settings = await getSetting(ctx.db, 'live_panel');
  const result: { status: 'off' | 'edited' | 'sent'; guilds?: Record<string, string> } = { status: 'off' };
  if (settings.channelId)
    result.status = await upsertPanel(
      ctx,
      'live',
      settings.channelId,
      await livePanelMessage(ctx, settings.showPlayers),
    );
  for (const guild of await guilds.livePanelGuilds(ctx.db)) {
    try {
      const jobIds = guild.privateServerId
        ? await guilds.jobIdsForPrivateServer(ctx.db, guild.privateServerId)
        : undefined;
      const message = await livePanelMessage(ctx, guild.channels.livePanelShowPlayers === true, jobIds);
      (result.guilds ??= {})[guild.id] = await upsertPanel(
        ctx,
        `live:${guild.id}`,
        guild.channels.livePanelChannelId!,
        message,
      );
    } catch (err) {
      (result.guilds ??= {})[guild.id] = 'failed';
      ctx.logger.warn(
        { err: (err as Error).message, guildId: guild.id },
        'Live-Panel im weiteren Discord fehlgeschlagen',
      );
    }
  }
  return result;
}
