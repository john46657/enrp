import { GuildMember, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import { parseDuration } from '@enrp/shared';
import { defineCommand } from '../command';
import { embed, reply, table, trunc, ts, user } from '../ui';

interface ModAction {
  id: string;
  number: number;
  type: string;
  platform: string;
  status: string;
  reason: string;
  targetDiscordId: string | null;
  targetRobloxId: number | null;
  moderatorId: string;
  expiresAt: string | null;
  executionError: string | null;
  createdAt: string;
}

const STATUS: Record<string, string> = {
  active: 'aktiv',
  completed: 'ausgeführt',
  pending_execution: 'wartet auf Spielserver',
  failed: '⚠️ fehlgeschlagen',
  revoked: 'aufgehoben',
  expired: 'abgelaufen',
};

const target = (s: SlashCommandSubcommandBuilder, required = false) =>
  s
    .addUserOption((o) => o.setName('nutzer').setDescription('Discord-Nutzer').setRequired(required))
    .addStringOption((o) => o.setName('roblox').setDescription('Roblox-ID (für Roblox-Sanktionen)'));
const reasonOpt = (s: SlashCommandSubcommandBuilder) => s.addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(500));
const platformOpt = (s: SlashCommandSubcommandBuilder) =>
  s.addStringOption((o) => o.setName('plattform').setDescription('Discord (Standard) oder Roblox').addChoices({ name: 'Discord', value: 'discord' }, { name: 'Roblox', value: 'roblox' }));
const durationOpt = (s: SlashCommandSubcommandBuilder, required = false) => s.addStringOption((o) => o.setName('dauer').setDescription('z. B. 30m, 2h, 7d').setRequired(required));

/** Discord-Hierarchie: niemand darf Personen mit gleich hoher oder höherer Rolle sanktionieren. */
async function checkHierarchy(interaction: ChatInputCommandInteraction, targetId: string): Promise<string | null> {
  const guild = interaction.guild;
  if (!guild) return null;
  if (targetId === guild.ownerId) return 'Der Server-Owner kann nicht sanktioniert werden.';
  if (targetId === interaction.client.user.id) return 'Den Bot kannst du nicht sanktionieren.';
  const [mod, tgt] = await Promise.all([guild.members.fetch(interaction.user.id).catch(() => null), guild.members.fetch(targetId).catch(() => null)]);
  if (!tgt || !(mod instanceof GuildMember)) return null;
  if (interaction.user.id !== guild.ownerId && tgt.roles.highest.position >= mod.roles.highest.position) return 'Diese Person hat eine gleich hohe oder höhere Rolle als du.';
  const me = guild.members.me;
  if (me && tgt.roles.highest.position >= me.roles.highest.position) return 'Die Rolle der Person steht über der Bot-Rolle.';
  return null;
}

function actionEmbed(a: ModAction) {
  return embed(a.status === 'failed' ? 'warning' : 'danger')
    .setTitle(`🛡️ ${a.type.toUpperCase()} #${a.number}`)
    .setDescription(
      table([
        ['Ziel', [a.targetDiscordId ? user(a.targetDiscordId) : null, a.targetRobloxId ? `Roblox ${a.targetRobloxId}` : null].filter(Boolean).join(' · ')],
        ['Plattform', a.platform],
        ['Status', STATUS[a.status] ?? a.status],
        ['Grund', trunc(a.reason, 500)],
        ...(a.expiresAt ? [['Bis', ts(a.expiresAt)] as [string, string]] : []),
        ...(a.executionError ? [['Fehler', a.executionError] as [string, string]] : []),
      ]),
    );
}

export const mod = defineCommand({
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation')
    .addSubcommand((s) => reasonOpt(platformOpt(target(s.setName('warn').setDescription('Verwarnung aussprechen')))))
    .addSubcommand((s) => reasonOpt(durationOpt(target(s.setName('timeout').setDescription('Discord-Timeout (max. 28 Tage)'), true), true)))
    .addSubcommand((s) => reasonOpt(platformOpt(target(s.setName('kick').setDescription('Vom Server bzw. Spiel entfernen')))))
    .addSubcommand((s) => reasonOpt(durationOpt(platformOpt(target(s.setName('ban').setDescription('Bannen (ohne Dauer = permanent, Freigaberecht nötig)'))))))
    .addSubcommand((s) => reasonOpt(platformOpt(target(s.setName('unban').setDescription('Bann aufheben')))))
    .addSubcommand((s) => target(s.setName('history').setDescription('Moderationshistorie einer Person')))
    .addSubcommand((s) => reasonOpt(s.setName('revoke').setDescription('Aktion aufheben').addIntegerOption((o) => o.setName('nummer').setDescription('Aktionsnummer').setRequired(true)))),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    const discordUser = interaction.options.getUser('nutzer');
    const roblox = interaction.options.getString('roblox');
    const robloxId = roblox && /^\d+$/.test(roblox) ? Number(roblox) : undefined;
    const platform = (interaction.options.getString('plattform') ?? (robloxId && !discordUser ? 'roblox' : 'discord')) as 'discord' | 'roblox';
    const reason = interaction.options.getString('grund') ?? '';

    if (sub === 'history') {
      if (!discordUser && !robloxId) return reply(interaction, 'Bitte Nutzer oder Roblox-ID angeben.');
      const r = await api.get<{ items: ModAction[]; total: number }>('/api/v1/moderation/actions', { query: { targetDiscordId: discordUser?.id, targetRobloxId: robloxId, pageSize: 20 } });
      return reply(
        interaction,
        embed()
          .setTitle(`📋 Moderationshistorie (${r.total})`)
          .setDescription(r.items.map((a) => `#${a.number} ${ts(a.createdAt, 'd')} **${a.type}** (${a.platform}, ${STATUS[a.status] ?? a.status}) – ${trunc(a.reason, 80)} · ${user(a.moderatorId)}`).join('\n') || 'Keine Einträge.'),
      );
    }
    if (sub === 'revoke') {
      const a = await api.post<ModAction>(`/api/v1/moderation/actions/${interaction.options.getInteger('nummer', true)}/revoke`, { reason });
      return reply(interaction, `✅ Aktion #${a.number} wurde aufgehoben.`);
    }
    if (!discordUser && !robloxId) return reply(interaction, 'Bitte Nutzer oder Roblox-ID angeben.');
    if (sub === 'unban') {
      await api.post('/api/v1/moderation/unban', { platform, targetDiscordId: discordUser?.id, targetRobloxId: robloxId, reason });
      return reply(interaction, platform === 'roblox' ? '✅ Entbannung vorgemerkt – der nächste Spielserver hebt den Bann auf.' : '✅ Bann aufgehoben.');
    }
    if (platform === 'discord' && discordUser && sub !== 'warn') {
      const problem = await checkHierarchy(interaction, discordUser.id);
      if (problem) return reply(interaction, `❌ ${problem}`);
    }
    const durationText = interaction.options.getString('dauer');
    const durationSeconds = durationText ? parseDuration(durationText) : null;
    if (durationText && !durationSeconds) return reply(interaction, 'Ungültige Dauer. Beispiele: `30m`, `2h`, `7d`, `1w`.');
    const action = await api.post<ModAction>(
      '/api/v1/moderation/actions',
      { type: sub, platform, targetDiscordId: discordUser?.id, targetRobloxId: robloxId, reason, durationSeconds: durationSeconds ?? undefined },
      { idempotencyKey: `mod-${interaction.id}` },
    );
    return reply(interaction, actionEmbed(action));
  },
});

export const report = defineCommand({
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Spielerreports')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Regelverstoß melden')
        .addStringOption((o) => o.setName('beschreibung').setDescription('Was ist passiert? (Ort, Zeit, Beteiligte)').setRequired(true).setMinLength(10).setMaxLength(2000))
        .addUserOption((o) => o.setName('nutzer').setDescription('Gemeldete Person (Discord)'))
        .addStringOption((o) => o.setName('roblox').setDescription('Gemeldete Person (Roblox-ID)'))
        .addStringOption((o) => o.setName('regel').setDescription('Betroffene Regel, z. B. §4').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Offene Reports (Team)')
        .addStringOption((o) => o.setName('status').setDescription('Status').addChoices({ name: 'Offen', value: 'open' }, { name: 'In Prüfung', value: 'in_review' }, { name: 'Erledigt', value: 'resolved' }, { name: 'Abgelehnt', value: 'rejected' })),
    )
    .addSubcommand((s) =>
      s
        .setName('resolve')
        .setDescription('Report abschließen (Team)')
        .addIntegerOption((o) => o.setName('nummer').setDescription('Reportnummer').setRequired(true))
        .addStringOption((o) => o.setName('ergebnis').setDescription('Ergebnis').setRequired(true).addChoices({ name: 'Erledigt', value: 'resolved' }, { name: 'Abgelehnt', value: 'rejected' }))
        .addStringOption((o) => o.setName('begruendung').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(1000)),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const roblox = interaction.options.getString('roblox');
      const r = await api.post<{ number: number }>(
        '/api/v1/reports',
        {
          description: interaction.options.getString('beschreibung', true),
          reportedDiscordId: interaction.options.getUser('nutzer')?.id,
          reportedRobloxId: roblox && /^\d+$/.test(roblox) ? Number(roblox) : undefined,
          ruleReference: interaction.options.getString('regel') ?? undefined,
        },
        { idempotencyKey: `report-${interaction.id}` },
      );
      return reply(interaction, `✅ Danke! Dein Report **#${r.number}** ist beim Team eingegangen.`);
    }
    if (sub === 'list') {
      const status = interaction.options.getString('status') ?? 'open,in_review';
      const r = await api.get<{ items: Array<{ number: number; description: string; status: string; createdAt: string; ruleReference: string | null }>; total: number }>('/api/v1/reports', { query: { status, pageSize: 15 } });
      return reply(interaction, embed().setTitle(`🚩 Reports (${r.total})`).setDescription(r.items.map((i) => `#${i.number} ${ts(i.createdAt, 'R')} ${i.ruleReference ?? ''} – ${trunc(i.description, 80)} (${i.status})`).join('\n') || 'Keine Reports.'));
    }
    const r = await api.patch<{ number: number; status: string }>(`/api/v1/reports/${interaction.options.getInteger('nummer', true)}`, {
      status: interaction.options.getString('ergebnis', true),
      resolution: interaction.options.getString('begruendung', true),
    });
    return reply(interaction, `✅ Report #${r.number} ist jetzt **${r.status}**.`);
  },
});

export const appeal = defineCommand({
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Einsprüche gegen Moderationsaktionen')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Einspruch einlegen')
        .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer der Aktion (aus der DM)').setRequired(true))
        .addStringOption((o) => o.setName('begruendung').setDescription('Warum ist die Aktion falsch?').setRequired(true).setMinLength(20).setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName('review')
        .setDescription('Einspruch entscheiden (Team, nicht der ursprüngliche Moderator)')
        .addStringOption((o) => o.setName('id').setDescription('Einspruch-ID').setRequired(true))
        .addStringOption((o) => o.setName('entscheidung').setDescription('Entscheidung').setRequired(true).addChoices({ name: 'Annehmen (Aktion aufheben)', value: 'accept' }, { name: 'Ablehnen', value: 'reject' }))
        .addStringOption((o) => o.setName('begruendung').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(1000)),
    ),
  async execute(interaction, { api }) {
    if (interaction.options.getSubcommand() === 'create') {
      const action = await api.get<{ id: string }>(`/api/v1/moderation/actions/${interaction.options.getInteger('nummer', true)}`);
      await api.post('/api/v1/moderation/appeals', { actionId: action.id, statement: interaction.options.getString('begruendung', true) });
      return reply(interaction, '✅ Dein Einspruch wurde eingereicht. Eine unabhängige Person aus dem Team prüft ihn.');
    }
    const r = await api.post<{ status: string }>(`/api/v1/moderation/appeals/${interaction.options.getString('id', true)}/decide`, {
      decision: interaction.options.getString('entscheidung', true),
      reason: interaction.options.getString('begruendung', true),
    });
    return reply(interaction, `✅ Einspruch ist jetzt **${r.status}**.`);
  },
});
