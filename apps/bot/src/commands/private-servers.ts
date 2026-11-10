import { ChannelType, SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { type ApiClient } from '@enrp/shared';
import { defineCommand } from '../command';
import { embed, reply, trunc, ts, user } from '../ui';

interface Link {
  id: string;
  guildId: string;
  name: string;
  ownerRobloxId: number;
  ownerName: string | null;
  teamLock: boolean;
  teamRoleId: string | null;
  logChannelId: string | null;
  active: boolean;
  syncedAt: string | null;
  grantedPeople?: number;
  serversOnline?: number;
}
interface Player {
  userId: number;
  username: string;
  team?: string;
  wanted?: number;
  jailed?: boolean;
}
interface ServerInfo {
  server: { id: string; jobId: string; playerCount: number; maxPlayers: number | null };
  players: Player[];
}
interface Grant {
  discordUserId: string;
  robloxUserId: number;
  username: string | null;
  right: string;
}

// ---------------------------------------------------------------------------
// Haupt-Discord: Privatserver-Discords verknüpfen
// ---------------------------------------------------------------------------

export const privatserver = defineCommand({
  data: new SlashCommandBuilder()
    .setName('privatserver')
    .setDescription('Privatserver-Discords verwalten (nur Haupt-Discord)')
    .addSubcommand((s) => s.setName('list').setDescription('Verknüpfte Privatserver-Discords'))
    .addSubcommand((s) =>
      s
        .setName('link')
        .setDescription('Discord-Server mit dem Roblox-Besitzer von Privatservern verknüpfen')
        .addStringOption((o) =>
          o.setName('discord_id').setDescription('ID des Privatserver-Discords').setRequired(true).setMaxLength(22),
        )
        .addStringOption((o) =>
          o.setName('besitzer').setDescription('Roblox-Name oder -ID des Besitzers').setRequired(true).setMaxLength(20),
        )
        .addStringOption((o) => o.setName('name').setDescription('Anzeigename').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('unlink')
        .setDescription('Verknüpfung entfernen (alle Spielrechte dieses Discords entfallen)')
        .addStringOption((o) =>
          o.setName('discord_id').setDescription('ID des Privatserver-Discords').setRequired(true).setMaxLength(22),
        )
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Rollen, Spielrechte und laufende Server eines Privatserver-Discords')
        .addStringOption((o) =>
          o.setName('discord_id').setDescription('ID des Privatserver-Discords').setRequired(true).setMaxLength(22),
        ),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    const byGuild = async (guildId: string) => {
      const res = await api.get<{ items: Link[] }>('/api/v1/private-servers');
      const link = res.items.find((l) => l.guildId === guildId.trim());
      if (!link) throw new Error('not-found');
      return link;
    };
    if (sub === 'list') {
      const res = await api.get<{ items: Link[] }>('/api/v1/private-servers');
      const lines = res.items.map(
        (l) =>
          `**${l.name}** · \`${l.guildId}\` · Besitzer ${l.ownerName ?? l.ownerRobloxId} · ${l.teamLock ? '🔐 Teamsperre' : '🔓 frei'} · ${l.grantedPeople ?? 0} mit Rechten · ${l.serversOnline ?? 0} Server online`,
      );
      return reply(
        interaction,
        embed()
          .setTitle(`🔒 Privatserver-Discords (${res.items.length})`)
          .setDescription(trunc(lines.join('\n') || 'Noch keine verknüpft.', 4000)),
      );
    }
    if (sub === 'link') {
      const owner = o.getString('besitzer', true).trim();
      const link = await api.post<Link>('/api/v1/private-servers', {
        link: {
          guildId: o.getString('discord_id', true).trim(),
          name: o.getString('name', true),
          ...(/^\d+$/.test(owner) ? { ownerRobloxId: Number(owner) } : { ownerUsername: owner }),
        },
        reason: o.getString('grund', true),
      });
      return reply(
        interaction,
        `✅ **${link.name}** verknüpft (Besitzer ${link.ownerName ?? link.ownerRobloxId}). Ist der Bot dort Mitglied, erscheint \`/ps\` innerhalb einer Minute.`,
      );
    }
    let link: Link;
    try {
      link = await byGuild(o.getString('discord_id', true));
    } catch {
      return reply(interaction, '❌ Kein aktiver Privatserver-Discord mit dieser ID.');
    }
    if (sub === 'unlink') {
      await api.post(`/api/v1/private-servers/${link.id}/unlink`, { reason: o.getString('grund', true) });
      return reply(
        interaction,
        `🗑️ Verknüpfung mit **${link.name}** entfernt. Alle Spielrechte dieses Discords sind entfallen.`,
      );
    }
    const d = await api.get<{
      link: Link;
      rightRoles: Array<{ right: string }>;
      grants: Grant[];
      servers: ServerInfo[];
    }>(`/api/v1/private-servers/${link.id}`);
    return reply(
      interaction,
      embed()
        .setTitle(`🔒 ${d.link.name}`)
        .addFields(
          { name: 'Besitzer', value: `${d.link.ownerName ?? '—'} (\`${d.link.ownerRobloxId}\`)`, inline: true },
          { name: 'Teamsperre', value: d.link.teamLock ? '🔐 an' : '🔓 aus', inline: true },
          { name: 'Letzter Abgleich', value: ts(d.link.syncedAt, 'R'), inline: true },
          { name: 'Rechte mit Rolle', value: d.rightRoles.map((r) => r.right).join(', ') || '—' },
          {
            name: `Spielrechte (${d.grants.length})`,
            value: trunc(d.grants.map((g) => `${g.username ?? g.robloxUserId} → ${g.right}`).join('\n') || '—', 1024),
          },
          {
            name: 'Server online',
            value:
              d.servers.map((s) => `\`${s.server.jobId.slice(0, 8)}\` · ${s.players.length} Spieler`).join('\n') || '—',
          },
        ),
    );
  },
});

// ---------------------------------------------------------------------------
// Privatserver-Discord: /ps
// ---------------------------------------------------------------------------

const ACTIONS = [
  { name: 'Kick (nur vom Privatserver)', value: 'kick' },
  { name: 'Heilen', value: 'heal' },
  { name: 'Respawn', value: 'respawn' },
  { name: 'Töten', value: 'kill' },
  { name: 'Gefängnis (minuten)', value: 'jail' },
  { name: 'Entlassen', value: 'unjail' },
  { name: 'Fahndungsstufe (stufe)', value: 'wanted' },
  { name: 'Team wechseln (team)', value: 'team' },
];

const player = <T extends SlashCommandSubcommandBuilder>(s: T) =>
  s.addStringOption((o) =>
    o
      .setName('spieler')
      .setDescription('Roblox-Name oder -ID (auf eurem Privatserver)')
      .setRequired(true)
      .setMaxLength(20),
  );

async function findPlayer(api: ApiClient, query: string) {
  const status = await api.get<{ servers: ServerInfo[] }>('/api/v1/private-servers/guild/status');
  const q = query.trim().toLowerCase();
  const all = status.servers.flatMap((s) => s.players);
  return (
    all.find((p) => String(p.userId) === q || p.username.toLowerCase() === q) ??
    (all.filter((p) => p.username.toLowerCase().includes(q)).length === 1
      ? all.find((p) => p.username.toLowerCase().includes(q))
      : undefined)
  );
}

export const ps = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ps')
    .setDescription('Eure Privatserver im Spiel')
    .addSubcommand((s) => s.setName('status').setDescription('Laufende Privatserver, Spieler, Teamsperre und Rollen'))
    .addSubcommand((s) =>
      player(s.setName('aktion').setDescription('Aktion an einem Spieler auf eurem Privatserver'))
        .addStringOption((o) =>
          o
            .setName('aktion')
            .setDescription('Was soll passieren?')
            .setRequired(true)
            .addChoices(...ACTIONS),
        )
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMaxLength(300))
        .addIntegerOption((o) =>
          o.setName('minuten').setDescription('Gefängnis: Dauer').setMinValue(1).setMaxValue(240),
        )
        .addIntegerOption((o) => o.setName('stufe').setDescription('Fahndungsstufe 0–5').setMinValue(0).setMaxValue(5))
        .addStringOption((o) => o.setName('team').setDescription('Team-Name im Spiel').setMaxLength(40)),
    )
    .addSubcommand((s) =>
      s
        .setName('teamsperre')
        .setDescription('Teamsperre ein/aus: nur Spieler mit Spielrecht dürfen in gesperrte Teams')
        .addBooleanOption((o) => o.setName('aktiv').setDescription('An oder aus').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('spielrecht')
        .setDescription('Discord-Rolle für ein Spielrecht festlegen (ohne Rolle = entfernen)')
        .addStringOption((o) =>
          o
            .setName('recht')
            .setDescription('z. B. polizei, sek, flugstaffel, ausbilder')
            .setRequired(true)
            .setMaxLength(30),
        )
        .addRoleOption((o) => o.setName('rolle').setDescription('Wer diese Rolle hat, bekommt das Recht')),
    )
    .addSubcommand((s) =>
      s
        .setName('teamrolle')
        .setDescription('Rolle, die /ps aktion nutzen darf (ohne Rolle = nur „Server verwalten“)')
        .addRoleOption((o) => o.setName('rolle').setDescription('Team-Rolle')),
    )
    .addSubcommand((s) =>
      s
        .setName('logkanal')
        .setDescription('Kanal für Aktionen und Rechte-Änderungen (ohne Kanal = aus)')
        .addChannelOption((o) => o.setName('kanal').setDescription('Textkanal').addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) => s.setName('rechte').setDescription('Wer hat welches Spielrecht?'))
    .addSubcommand((s) => s.setName('abgleichen').setDescription('Spielrechte jetzt mit den Rollen abgleichen')),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    switch (sub) {
      case 'status': {
        const d = await api.get<{
          link: Link;
          rightRoles: Array<{ right: string; discordRoleId: string }>;
          rights: string[];
          teamRights: Record<string, string>;
          servers: ServerInfo[];
        }>('/api/v1/private-servers/guild/status');
        const e = embed()
          .setTitle(`🔒 ${d.link.name}`)
          .setDescription(
            d.servers.length
              ? d.servers
                  .map(
                    (s) =>
                      `**Server \`${s.server.jobId.slice(0, 8)}\`** · ${s.players.length}${s.server.maxPlayers ? `/${s.server.maxPlayers}` : ''} Spieler\n${trunc(
                        s.players
                          .map(
                            (p) =>
                              `${p.username} · ${p.team ?? 'ohne Team'}${p.wanted ? ` · ⭐${p.wanted}` : ''}${p.jailed ? ' · 🔒' : ''}`,
                          )
                          .join('\n') || '—',
                        900,
                      )}`,
                  )
                  .join('\n\n')
              : 'Gerade läuft kein Privatserver von euch.',
          )
          .addFields(
            {
              name: 'Teamsperre',
              value: d.link.teamLock
                ? `🔐 an · ${Object.entries(d.teamRights)
                    .map(([team, right]) => `${team} → ${right}`)
                    .join(', ')}`
                : '🔓 aus (jeder darf in jedes Team)',
            },
            {
              name: 'Spielrechte ↔ Rollen',
              value:
                d.rights
                  .map((r) => {
                    const role = d.rightRoles.find((x) => x.right === r);
                    return `${r}: ${role ? `<@&${role.discordRoleId}>` : '—'}`;
                  })
                  .join('\n') || '—',
              inline: true,
            },
            {
              name: 'Team-Rolle / Log',
              value: `${d.link.teamRoleId ? `<@&${d.link.teamRoleId}>` : 'nur „Server verwalten“'}\n${d.link.logChannelId ? `<#${d.link.logChannelId}>` : 'kein Log-Kanal'}`,
              inline: true,
            },
          );
        return reply(interaction, e);
      }
      case 'aktion': {
        const target = await findPlayer(api, o.getString('spieler', true));
        if (!target)
          return reply(
            interaction,
            '❌ Spieler ist auf keinem eurer Privatserver (oder der Name ist nicht eindeutig).',
          );
        const action = o.getString('aktion', true);
        const command =
          action === 'jail'
            ? { action, minutes: o.getInteger('minuten') ?? 5 }
            : action === 'wanted'
              ? { action, level: o.getInteger('stufe') ?? 0 }
              : action === 'team'
                ? { action, team: o.getString('team') ?? '' }
                : { action };
        if (action === 'team' && !o.getString('team')) return reply(interaction, '❌ Bitte `team` angeben.');
        await api.post(`/api/v1/private-servers/guild/players/${target.userId}/actions`, {
          command,
          reason: o.getString('grund', true),
        });
        return reply(
          interaction,
          `✅ **${action}** für **${target.username}** gesendet – der Server führt es in wenigen Sekunden aus.`,
        );
      }
      case 'teamsperre': {
        const l = await api.patch<Link>('/api/v1/private-servers/guild/settings', {
          teamLock: o.getBoolean('aktiv', true),
        });
        return reply(
          interaction,
          l.teamLock
            ? '🔐 Teamsperre an. Gesperrte Teams sind nur noch mit Spielrecht wählbar (wirkt in ≤ 30 s).'
            : '🔓 Teamsperre aus. Jeder darf wieder in jedes Team.',
        );
      }
      case 'spielrecht': {
        const right = o.getString('recht', true).trim().toLowerCase();
        const role = o.getRole('rolle');
        await api.put(`/api/v1/private-servers/guild/rights/${encodeURIComponent(right)}`, {
          roleId: role?.id ?? null,
        });
        return reply(
          interaction,
          role
            ? `✅ Wer <@&${role.id}> hat, bekommt das Spielrecht **${right}** (Konto über /verify nötig). Abgleich läuft gleich automatisch.`
            : `🗑️ Spielrecht **${right}** wird über keine Rolle mehr vergeben.`,
        );
      }
      case 'teamrolle': {
        const role = o.getRole('rolle');
        await api.patch('/api/v1/private-servers/guild/settings', { teamRoleId: role?.id ?? null });
        return reply(
          interaction,
          role
            ? `✅ <@&${role.id}> darf jetzt \`/ps aktion\` nutzen.`
            : '✅ Nur noch „Server verwalten“ darf Aktionen ausführen.',
        );
      }
      case 'logkanal': {
        const channel = o.getChannel('kanal');
        await api.patch('/api/v1/private-servers/guild/settings', { logChannelId: channel?.id ?? null });
        return reply(interaction, channel ? `✅ Log in <#${channel.id}>.` : '✅ Log-Kanal entfernt.');
      }
      case 'rechte': {
        const d = await api.get<{ items: Grant[]; syncedAt: string | null }>('/api/v1/private-servers/guild/grants');
        const byRight = new Map<string, string[]>();
        for (const g of d.items)
          byRight.set(g.right, [
            ...(byRight.get(g.right) ?? []),
            `${user(g.discordUserId)} (${g.username ?? g.robloxUserId})`,
          ]);
        return reply(
          interaction,
          embed()
            .setTitle('🎮 Spielrechte')
            .setDescription(
              trunc(
                [...byRight.entries()].map(([r, people]) => `**${r}**\n${people.join('\n')}`).join('\n\n') ||
                  'Noch niemand hat ein Spielrecht.',
                3800,
              ),
            )
            .setFooter({
              text: `Letzter vollständiger Abgleich: ${d.syncedAt ? new Date(d.syncedAt).toLocaleString('de-DE') : 'noch nie'}`,
            }),
        );
      }
      case 'abgleichen':
        // Wird vom Bot selbst erledigt (main.ts → syncGuild), hier nur bestätigen.
        return reply(interaction, '🔄 Abgleich gestartet – Änderungen erscheinen im Log-Kanal.');
      default:
        return reply(interaction, 'Unbekannter Unterbefehl.');
    }
  },
});

/** Befehle, die nur in verknüpften Privatserver-Discords registriert werden. */
export const PRIVATE_SERVER_COMMANDS = [ps];
