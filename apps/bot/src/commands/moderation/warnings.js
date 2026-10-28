const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate, embed, truncate } = require('../../lib/util');
const { bucket, save } = require('../../lib/db');
const { logAction } = require('../../lib/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verwarnungen')
    .setDescription('Verwarnungen anzeigen oder löschen.')
    .addSubcommand((s) =>
      s
        .setName('anzeigen')
        .setDescription('Zeigt alle Verwarnungen eines Nutzers.')
        .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('loeschen')
        .setDescription('Löscht eine oder alle Verwarnungen eines Nutzers.')
        .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true))
        .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer der Verwarnung (leer = alle)').setMinValue(1)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const warnings = bucket('warnings', interaction.guildId);
    const list = warnings[user.id] ?? [];

    if (interaction.options.getSubcommand() === 'anzeigen') {
      if (!list.length) return replyPrivate(interaction, `${user} hat keine Verwarnungen. ✅`);
      const lines = list.map((w, i) => `**#${i + 1}** – <t:${Math.floor(w.at / 1000)}:d> von <@${w.by}>\n${w.reason}`);
      return replyPrivate(interaction, {
        embeds: [embed('warning').setTitle(`Verwarnungen von ${user.username} (${list.length})`).setDescription(truncate(lines.join('\n\n'), 4000))],
      });
    }

    const number = interaction.options.getInteger('nummer');
    if (!list.length) return replyPrivate(interaction, `${user} hat keine Verwarnungen.`);
    if (number && number > list.length) return replyPrivate(interaction, `Es gibt nur ${list.length} Verwarnung(en).`);

    if (number) list.splice(number - 1, 1);
    else list.length = 0;
    if (!list.length) delete warnings[user.id];
    save();

    const what = number ? `Verwarnung #${number}` : 'Alle Verwarnungen';
    await replyPrivate(interaction, `🗑️ ${what} von ${user} gelöscht.`);
    await logAction(interaction.guild, { action: `${what} gelöscht`, target: user, moderator: interaction.user, reason: '—', color: 'success' });
  },
};
