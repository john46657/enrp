const { SlashCommandBuilder } = require('discord.js');
const { embed, replyPrivate, sendTo, truncate, isStaff } = require('../../lib/util');
const { save } = require('../../lib/db');
const store = require('../../lib/applications/store');
const { buildTeamMessage, answersFile } = require('../../lib/applications/messages');
const { buildStats } = require('../../lib/applications/stats');

const typeChoices = () => store.baseTypes().slice(0, 25).map((t) => ({ name: t.name, value: t.id }));
const link = (r) => (r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungen')
    .setDescription('Bewerbungen fürs Team: Listen, Details, Statistik.')
    .addSubcommand((s) =>
      s
        .setName('offen')
        .setDescription('Alle offenen Bewerbungen.')
        .addStringOption((o) => o.setName('art').setDescription('Nur diese Art').addChoices(...typeChoices())),
    )
    .addSubcommand((s) => s.setName('in-bearbeitung').setDescription('Bewerbungen, die gerade per DM ausgefüllt werden.'))
    .addSubcommand((s) =>
      s
        .setName('anzeigen')
        .setDescription('Zeigt eine Bewerbung mit allen Antworten.')
        .addStringOption((o) => o.setName('nummer').setDescription('z. B. APP-0001').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('verlauf')
        .setDescription('Alle Bewerbungen einer Person.')
        .addUserOption((o) => o.setName('user').setDescription('Person').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('loeschen')
        .setDescription('Löscht eine Bewerbung (nur Staff).')
        .addStringOption((o) => o.setName('nummer').setDescription('z. B. APP-0001').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('statistik')
        .setDescription('Kennzahlen, Verlauf, Prüfer und Heatmap.')
        .addIntegerOption((o) => o.setName('tage').setDescription('Zeitraum (7–365, Standard 30)').setMinValue(7).setMaxValue(365))
        .addStringOption((o) => o.setName('art').setDescription('Nur diese Art').addChoices(...typeChoices()))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Nur dieser Status')
            .addChoices(
              { name: 'Offen', value: 'OPEN' },
              { name: 'Angenommen', value: 'ACCEPTED' },
              { name: 'Abgelehnt', value: 'REJECTED' },
              { name: 'Zurückgezogen', value: 'WITHDRAWN' },
            ),
        )
        .addUserOption((o) => o.setName('pruefer').setDescription('Nur Entscheidungen dieser Person')),
    ),

  async execute(interaction) {
    if (!store.managesAny(interaction.member)) return replyPrivate(interaction, 'Nur das Bewerbungsteam kann das sehen.');
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'offen') {
      const typeId = interaction.options.getString('art');
      const open = store.openOf(guildId, (r) => !typeId || r.type === typeId).sort((a, b) => a.createdAt - b.createdAt);
      if (!open.length) return replyPrivate(interaction, 'Keine offenen Bewerbungen. 🎉');
      const lines = open.map((r) => {
        const type = store.typeById(guildId, r.type);
        const url = link(r);
        return `${url ? `[**${r.number}**](${url})` : `**${r.number}**`} ${type?.emoji ?? ''} <@${r.userId}> – ${store.STATUS[r.status]} · <t:${Math.floor(r.createdAt / 1000)}:R>${r.ai?.level === 'hoch' ? ' · 🔴 KI' : ''}`;
      });
      return replyPrivate(interaction, { embeds: [embed().setTitle(`📥 Offene Bewerbungen (${open.length})`).setDescription(truncate(lines.join('\n'), 4000))] });
    }

    if (sub === 'in-bearbeitung') {
      const list = Object.values(store.progressOf(guildId)).filter((p) => p.expiresAt > Date.now());
      if (!list.length) return replyPrivate(interaction, 'Gerade füllt niemand eine Bewerbung aus.');
      const lines = list.map(
        (p) => `<@${p.userId}> – ${store.typeById(guildId, p.typeId)?.name ?? p.typeId} · Frage ${p.step + 1}/${p.total} · gestartet <t:${Math.floor(p.startedAt / 1000)}:R>`,
      );
      return replyPrivate(interaction, { embeds: [embed().setTitle(`✍️ In Bearbeitung (${list.length})`).setDescription(lines.join('\n'))] });
    }

    if (sub === 'verlauf') {
      const user = interaction.options.getUser('user');
      const list = store.historyOf(guildId, user.id);
      if (!list.length) return replyPrivate(interaction, `${user} hat noch keine Bewerbungen.`);
      const lines = list.map((r) => `**${r.number}** ${store.typeById(guildId, r.type)?.name ?? r.type} – ${store.STATUS[r.status]} <t:${Math.floor(r.createdAt / 1000)}:R>`);
      return replyPrivate(interaction, { embeds: [embed().setTitle(`📜 Verlauf von ${user.username}`).setDescription(truncate(lines.join('\n'), 4000))] });
    }

    if (sub === 'statistik') {
      return replyPrivate(interaction, {
        embeds: [
          buildStats(guildId, interaction.options.getInteger('tage') ?? 30, {
            typeId: interaction.options.getString('art'),
            status: interaction.options.getString('status'),
            reviewerId: interaction.options.getUser('pruefer')?.id,
          }),
        ],
      });
    }

    const number = interaction.options.getString('nummer').trim().toUpperCase();
    const record = store.getRecord(guildId, number);
    const type = record && store.typeById(guildId, record.type);
    if (!record || !type) return replyPrivate(interaction, `Bewerbung ${number} nicht gefunden.`);

    if (sub === 'anzeigen') {
      const message = buildTeamMessage(record, type, { components: false });
      return replyPrivate(interaction, { ...message, files: [answersFile(record, type)], content: link(record) ? `Zur Nachricht: ${link(record)}` : undefined });
    }

    // loeschen
    if (!isStaff(interaction.member)) return replyPrivate(interaction, 'Nur Staff kann Bewerbungen löschen.');
    if (record.messageId) {
      const channel = await interaction.guild.channels.fetch(record.channelId).catch(() => null);
      await channel?.messages.delete(record.messageId).catch(() => {});
    }
    delete store.recordsOf(guildId)[number];
    save();
    await replyPrivate(interaction, `🗑️ Bewerbung ${number} gelöscht.`);
    return sendTo(interaction.guild, 'modLog', {
      embeds: [embed('danger').setDescription(`🗑️ ${interaction.user} hat die Bewerbung **${number}** (${type.name}, <@${record.userId}>) gelöscht.`)],
      allowedMentions: { parse: [] },
    });
  },
};
