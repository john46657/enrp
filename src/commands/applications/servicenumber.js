const { SlashCommandBuilder } = require('discord.js');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const store = require('../../lib/applications/store');
const serviceNumbers = require('../../lib/applications/serviceNumbers');
const { respondTypes, findType } = require('../../lib/applications/choices');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dienstnummer')
    .setDescription('Dienstnummern anzeigen und verwalten.')
    .addSubcommand((s) =>
      s
        .setName('anzeigen')
        .setDescription('Zeigt deine Dienstnummer oder die einer anderen Person.')
        .addUserOption((o) => o.setName('user').setDescription('Person (Standard: du)')),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Alle vergebenen Dienstnummern (nur Team).'))
    .addSubcommand((s) =>
      s
        .setName('setzen')
        .setDescription('Vergibt oder ändert eine Dienstnummer von Hand (nur Team).')
        .addUserOption((o) => o.setName('user').setDescription('Person').setRequired(true))
        .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer (ohne Angabe: nächste freie)').setMinValue(0).setMaxValue(999_999))
        .addStringOption((o) => o.setName('art').setDescription('Format dieser Bewerbungsart verwenden').setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('entfernen')
        .setDescription('Gibt eine Dienstnummer wieder frei (nur Team).')
        .addUserOption((o) => o.setName('user').setDescription('Person').setRequired(true)),
    ),

  autocomplete: (interaction) => respondTypes(interaction, { filter: (t) => t.serviceNumber?.enabled }),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'anzeigen') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const entry = serviceNumbers.getNumber(guildId, user.id);
      if (!entry) return replyPrivate(interaction, user.id === interaction.user.id ? 'Du hast noch keine Dienstnummer.' : `${user} hat keine Dienstnummer.`);
      return replyPrivate(interaction, { content: `🪪 ${user}: **${entry.value}** (seit <t:${Math.floor(entry.at / 1000)}:d>)`, allowedMentions: { parse: [] } });
    }

    if (!store.managesAny(interaction.member)) return replyPrivate(interaction, 'Nur das Bewerbungsteam kann Dienstnummern verwalten.');

    if (sub === 'liste') {
      const entries = Object.values(serviceNumbers.numbersOf(guildId)).sort((a, b) => a.value.localeCompare(b.value, 'de', { numeric: true }));
      if (!entries.length) return replyPrivate(interaction, 'Es sind noch keine Dienstnummern vergeben.');
      const lines = entries.map((e) => `**${e.value}** – <@${e.userId}>`);
      return replyPrivate(interaction, { embeds: [embed().setTitle(`🪪 Dienstnummern (${entries.length})`).setDescription(truncate(lines.join('\n'), 4000))] });
    }

    const user = interaction.options.getUser('user');
    if (sub === 'entfernen') {
      const entry = serviceNumbers.release(guildId, user.id);
      return replyPrivate(interaction, entry ? `✅ Dienstnummer **${entry.value}** von ${user} ist wieder frei.` : `${user} hat keine Dienstnummer.`);
    }

    // setzen
    const wanted = interaction.options.getString('art');
    const withNumbers = store.types(guildId).filter((t) => t.serviceNumber?.enabled);
    const type = wanted ? findType(guildId, wanted) : (store.typeById(guildId, serviceNumbers.getNumber(guildId, user.id)?.typeId) ?? withNumbers[0]);
    if (!type?.serviceNumber?.enabled) {
      return replyPrivate(interaction, 'Für diese Bewerbungsart ist die Dienstnummer-Automatik nicht aktiv. Schalte sie mit `/bewerbungsart dienstnummer` ein.');
    }
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return replyPrivate(interaction, `${user} ist nicht auf dem Server.`);
    const number = interaction.options.getInteger('nummer') ?? serviceNumbers.nextFree(guildId, type.serviceNumber);
    if (number === null) return replyPrivate(interaction, 'Es ist keine Dienstnummer mehr frei. Vergrößere den Bereich mit `/bewerbungsart dienstnummer`.');
    const roblox = store.historyOf(guildId, user.id).find((r) => r.roblox)?.roblox?.name;
    try {
      const entry = await serviceNumbers.setManual(interaction.guild, member, type, number, roblox);
      return replyPrivate(interaction, `✅ ${user} hat jetzt die Dienstnummer **${entry.value}**.`);
    } catch (err) {
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
  },
};
