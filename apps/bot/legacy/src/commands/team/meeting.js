const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { replyPrivate, embed, truncate } = require('../../lib/util');
const team = require('../../lib/team');
const meetings = require('../../lib/meetings');

const unix = (ms) => Math.floor(ms / 1000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meeting')
    .setDescription('Team-Kalender: Meetings planen und Anwesenheit sehen.')
    .addSubcommand((s) =>
      s
        .setName('erstellen')
        .setDescription('Plant ein Meeting und kündigt es an.')
        .addStringOption((o) => o.setName('titel').setDescription('Titel').setRequired(true).setMaxLength(150))
        .addStringOption((o) => o.setName('datum').setDescription('TT.MM.JJJJ').setRequired(true).setMaxLength(10))
        .addStringOption((o) => o.setName('uhrzeit').setDescription('HH:MM (Zeitzone des Servers)').setRequired(true).setMaxLength(5))
        .addIntegerOption((o) => o.setName('dauer').setDescription('Dauer in Minuten (Standard 60)').setMinValue(5).setMaxValue(1440))
        .addStringOption((o) => o.setName('beschreibung').setDescription('Worum geht es?').setMaxLength(1000))
        .addRoleOption((o) => o.setName('rolle').setDescription('Diese Rolle einladen und erinnern'))
        .addChannelOption((o) => o.setName('sprachkanal').setDescription('Treffpunkt – hier wird die Anwesenheit erfasst').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Kommende Meetings.'))
    .addSubcommand((s) => s.setName('absagen').setDescription('Sagt ein Meeting ab.').addStringOption((o) => o.setName('id').setDescription('Meeting-ID (aus /meeting liste)').setRequired(true).setMaxLength(10)))
    .addSubcommand((s) =>
      s
        .setName('anwesenheit')
        .setDescription('Anwesenheit der letzten 90 Tage.')
        .addUserOption((o) => o.setName('user').setDescription('Teammitglied (leer = alle bzw. du selbst)')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = forGuild(interaction.guildId);
    if (!cfg.team.enabled || !cfg.team.meetings.enabled) return replyPrivate(interaction, 'Meetings sind auf diesem Server deaktiviert.');
    const o = interaction.options;
    try {
      switch (sub) {
        case 'erstellen': {
          if (!team.can(interaction.member, 'calendarCreate')) return replyPrivate(interaction, 'Dafür fehlt dir das Recht „Kalender-Einträge erstellen“.');
          const start = meetings.parseStart(o.getString('datum'), o.getString('uhrzeit'), cfg.timezone);
          if (!start) throw new Error('Ungültiges Datum oder Uhrzeit. Beispiel: 31.12.2026 und 18:30');
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const m = await meetings.createMeeting(interaction.guild, {
            title: o.getString('titel'),
            description: o.getString('beschreibung'),
            start,
            duration: o.getInteger('dauer') ?? 60,
            roles: o.getRole('rolle') ? [o.getRole('rolle').id] : [],
            voiceChannelId: o.getChannel('sprachkanal')?.id,
            createdBy: interaction.user.id,
          });
          return interaction.editReply(`📅 Meeting **${m.title}** angelegt (ID \`${m.id}\`) für <t:${unix(m.start)}:F>.`);
        }
        case 'absagen':
          if (!team.can(interaction.member, 'calendarCreate')) return replyPrivate(interaction, 'Dafür fehlt dir das Recht „Kalender-Einträge erstellen“.');
          await meetings.cancelMeeting(interaction.guild, o.getString('id').trim(), interaction.user.id);
          return replyPrivate(interaction, '🚫 Meeting abgesagt.');
        case 'liste': {
          if (!team.can(interaction.member, 'calendarView') && !team.can(interaction.member, 'calendarCreate')) return replyPrivate(interaction, 'Dafür fehlt dir das Recht „Kalender ansehen“.');
          const upcoming = Object.values(meetings.meetingsOf(interaction.guildId))
            .filter((m) => !m.cancelled && m.start + m.duration * 60_000 > Date.now())
            .sort((a, b) => a.start - b.start);
          if (!upcoming.length) return replyPrivate(interaction, 'Es sind keine Meetings geplant.');
          const lines = upcoming.map((m) => `\`${m.id}\` **${m.title}** – <t:${unix(m.start)}:F> (<t:${unix(m.start)}:R>) · ✅ ${Object.values(m.rsvp).filter((v) => v === 'yes').length}`);
          return replyPrivate(interaction, { embeds: [embed().setTitle('📅 Kommende Meetings').setDescription(truncate(lines.join('\n'), 4000))] });
        }
        case 'anwesenheit': {
          const target = o.getUser('user');
          const all = team.can(interaction.member, 'attendanceView');
          if (!all && !team.isTeam(interaction.member)) return replyPrivate(interaction, 'Nur für Teammitglieder.');
          if (!all && target && target.id !== interaction.user.id) return replyPrivate(interaction, 'Du darfst nur deine eigene Anwesenheit sehen.');
          const stats = meetings.attendanceStats(interaction.guildId);
          const ids = target || !all ? [(target ?? interaction.user).id] : Object.keys(stats);
          const lines = ids
            .map((id) => [id, stats[id] ?? { meetings: 0, yes: 0, maybe: 0, no: 0, present: 0 }])
            .sort(([, a], [, b]) => b.present - a.present)
            .map(([id, s]) => `<@${id}> – 🎙️ ${s.present} anwesend · ✅ ${s.yes} · ❔ ${s.maybe} · ❌ ${s.no}`);
          return replyPrivate(interaction, { embeds: [embed().setTitle('📊 Anwesenheit (90 Tage)').setDescription(truncate(lines.join('\n') || 'Noch keine Daten.', 4000))] });
        }
      }
    } catch (err) {
      return interaction.deferred ? interaction.editReply(`❌ ${err.message}`) : replyPrivate(interaction, `❌ ${err.message}`);
    }
  },

  components: {
    meeting: (interaction, [choice, id]) => meetings.answer(interaction, choice, id),
  },
};
