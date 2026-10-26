import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../command';
import { dur, embed, reply, table, ts, user } from '../ui';

interface Profile {
  roblox: { id: number; username: string; displayName: string | null; lastSeenAt: string | null } | null;
  verified: boolean;
  verifiedAt: string | null;
  faction: { key: string; name: string; since: string } | null;
  playtimeSeconds: number;
  online: boolean;
  duty: { onDuty: { factionKey: string; since: string } | null; totalSeconds: number; sessions: number; weekSeconds: number; monthSeconds: number; perFaction: Array<{ factionName: string; seconds: number }> } | null;
  discord: { id: string; username: string } | null;
  private: { moderation: Array<{ number: number; type: string; status: string; reason: string; createdAt: string }>; reports: unknown[] } | null;
}

function profileEmbed(p: Profile) {
  const e = embed(p.verified ? 'success' : 'muted').setTitle(p.roblox ? `👤 ${p.roblox.displayName ?? p.roblox.username} (@${p.roblox.username})` : '👤 Spielerprofil');
  e.setDescription(
    table([
      ['Roblox-ID', p.roblox ? String(p.roblox.id) : '–'],
      ['Discord', p.discord ? `${user(p.discord.id)} (${p.discord.username})` : '–'],
      ['Verifiziert', p.verified ? `✅ seit ${ts(p.verifiedAt, 'd')}` : '❌ nein – /verify start'],
      ['Fraktion', p.faction ? `${p.faction.name} seit ${ts(p.faction.since, 'd')}` : 'keine'],
      ['Status', p.online ? '🟢 im Spiel' : `⚫ zuletzt ${ts(p.roblox?.lastSeenAt ?? null, 'R')}`],
      ['Spielzeit', dur(p.playtimeSeconds)],
    ]),
  );
  if (p.duty) {
    e.addFields({
      name: '🚓 Dienst',
      value: table([
        ['Aktuell', p.duty.onDuty ? `im Dienst seit ${ts(p.duty.onDuty.since, 'R')}` : 'nicht im Dienst'],
        ['Gesamt', `${dur(p.duty.totalSeconds)} (${p.duty.sessions} Sessions)`],
        ['7 Tage / 30 Tage', `${dur(p.duty.weekSeconds)} / ${dur(p.duty.monthSeconds)}`],
        ...p.duty.perFaction.map((f) => [f.factionName, dur(f.seconds)] as [string, string]),
      ]),
    });
  }
  if (p.private) {
    const mods = p.private.moderation.slice(0, 5).map((m) => `#${m.number} ${m.type} (${m.status}) – ${m.reason.slice(0, 60)}`);
    e.addFields({ name: '🔒 Intern: Moderation', value: mods.length ? mods.join('\n') : 'Keine Einträge' }, { name: '🔒 Intern: Reports', value: `${p.private.reports.length} Meldung(en)` });
  }
  return e;
}

export const verify = defineCommand({
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Roblox-Konto verknüpfen')
    .addSubcommand((s) => s.setName('start').setDescription('Verifizierung über Roblox starten'))
    .addSubcommand((s) => s.setName('status').setDescription('Eigenen Verifizierungsstatus anzeigen'))
    .addSubcommand((s) =>
      s
        .setName('unlink')
        .setDescription('Kontoverknüpfung aufheben')
        .addStringOption((o) => o.setName('grund').setDescription('Warum?').setRequired(true).setMinLength(3).setMaxLength(300)),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const { url, expiresAt } = await api.post<{ url: string; expiresAt: string }>('/api/v1/verification/start');
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Mit Roblox verifizieren'));
      return interaction.editReply({
        embeds: [
          embed()
            .setTitle('🔗 Roblox-Verifizierung')
            .setDescription(
              `Klicke auf den Button. Du bestätigst zuerst dein Discord-Konto und meldest dich dann bei **Roblox** an.\n\n• Der Link ist nur für dich und läuft ${ts(expiresAt, 'R')} ab.\n• Gib den Link nicht weiter.\n• Wir erhalten nur deine Roblox-ID und deinen Namen – kein Passwort.\n\nNach erfolgreicher Verifizierung erhältst du die Rolle **Verifiziert**. Fraktionsrollen vergibt das Team.`,
            ),
        ],
        components: [row],
      });
    }
    if (sub === 'status') {
      const s = await api.get<{ verified: boolean; roblox: { id: number; username: string } | null; verifiedAt: string | null; lastAttempt: { outcome: string; at: string; reason: string | null } | null }>('/api/v1/verification/status');
      return reply(
        interaction,
        embed(s.verified ? 'success' : 'muted')
          .setTitle('Verifizierungsstatus')
          .setDescription(
            s.verified
              ? `✅ Verknüpft mit **${s.roblox!.username}** (ID ${s.roblox!.id}) seit ${ts(s.verifiedAt)}`
              : `❌ Nicht verifiziert.${s.lastAttempt ? `\nLetzter Versuch ${ts(s.lastAttempt.at, 'R')}: ${s.lastAttempt.outcome}${s.lastAttempt.reason ? ` – ${s.lastAttempt.reason}` : ''}` : ''}\nStarte mit \`/verify start\`.`,
          ),
      );
    }
    await api.post('/api/v1/verification/unlink', { reason: interaction.options.getString('grund', true) });
    return reply(interaction, '✅ Die Verknüpfung wurde aufgehoben. Die Rolle „Verifiziert“ wird entfernt. Eine erneute Verifizierung ist erst nach der Wartezeit möglich.');
  },
});

export const profile = defineCommand({
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Spielerprofile')
    .addSubcommand((s) => s.setName('me').setDescription('Eigenes Profil anzeigen'))
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Profil einer Person anzeigen')
        .addUserOption((o) => o.setName('nutzer').setDescription('Discord-Nutzer'))
        .addStringOption((o) => o.setName('roblox').setDescription('Roblox-ID')),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Änderungshistorie anzeigen')
        .addUserOption((o) => o.setName('nutzer').setDescription('Discord-Nutzer (Standard: du)')),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'me') return reply(interaction, profileEmbed(await api.get<Profile>('/api/v1/players/me')));
    if (sub === 'view') {
      const target = interaction.options.getUser('nutzer');
      const roblox = interaction.options.getString('roblox');
      if (!target && !roblox) return reply(interaction, 'Bitte einen Nutzer oder eine Roblox-ID angeben.');
      const path = roblox ? `/api/v1/players/roblox/${encodeURIComponent(roblox)}` : `/api/v1/players/discord/${target!.id}`;
      return reply(interaction, profileEmbed(await api.get<Profile>(path)));
    }
    const target = interaction.options.getUser('nutzer') ?? interaction.user;
    const { items } = await api.get<{ items: Array<{ summary: string; createdAt: string; data: string | null }> }>('/api/v1/players/history', { query: { discordUserId: target.id } });
    return reply(
      interaction,
      embed()
        .setTitle(`📜 Historie von ${target.username}`)
        .setDescription(items.length ? items.slice(0, 15).map((i) => `${ts(i.createdAt, 'd')} – ${i.summary}${i.data ? ` (${i.data.slice(0, 80)})` : ''}`).join('\n') : 'Keine Einträge.'),
    );
  },
});

export const leaderboard = defineCommand({
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Ranglisten')
    .addSubcommand((s) => s.setName('playtime').setDescription('Top 10 nach Spielzeit'))
    .addSubcommand((s) =>
      s
        .setName('duty')
        .setDescription('Top 10 nach Dienstzeit')
        .addStringOption((o) => o.setName('zeitraum').setDescription('Zeitraum').addChoices({ name: 'Heute', value: 'day' }, { name: 'Woche', value: 'week' }, { name: 'Monat', value: 'month' }, { name: 'Gesamt', value: 'all' }))
        .addStringOption((o) => o.setName('fraktion').setDescription('Fraktion').addChoices({ name: 'Polizei', value: 'polizei' }, { name: 'Feuerwehr', value: 'feuerwehr' }, { name: 'Rettungsdienst', value: 'rettungsdienst' })),
    ),
  defer: 'public',
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    const medal = (r: number) => ['🥇', '🥈', '🥉'][r - 1] ?? `**${r}.**`;
    if (sub === 'playtime') {
      const { items } = await api.get<{ items: Array<{ rank: number; username: string; seconds: number }> }>('/api/v1/leaderboards/playtime');
      return interaction.editReply({ embeds: [embed().setTitle('🏆 Spielzeit').setDescription(items.map((i) => `${medal(i.rank)} ${i.username} – ${dur(i.seconds)}`).join('\n') || 'Noch keine Daten.')] });
    }
    const period = interaction.options.getString('zeitraum') ?? 'week';
    const faction = interaction.options.getString('fraktion') ?? undefined;
    const { items } = await api.get<{ items: Array<{ rank: number; username: string; seconds: number }> }>('/api/v1/leaderboards/duty', { query: { period, faction } });
    return interaction.editReply({ embeds: [embed().setTitle(`🚓 Dienstzeit (${period}${faction ? `, ${faction}` : ''})`).setDescription(items.map((i) => `${medal(i.rank)} ${i.username} – ${dur(i.seconds)}`).join('\n') || 'Noch keine Daten.')] });
  },
});
