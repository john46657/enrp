const { SlashCommandBuilder } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { replyPrivate, embed } = require('../../lib/util');
const { guard, checkHierarchy, notifyUser, logAction, applyWarnLimit } = require('../../lib/moderation');
const { addWarning, activeOf, syncWarnRoles, postPublic } = require('../../lib/warnings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnt ein Mitglied.')
    .addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500).setRequired(true))
    .addIntegerOption((o) => o.setName('ablauf').setDescription('Läuft nach X Tagen ab (0 = nie, leer = Standard)').setMinValue(0).setMaxValue(3650)),

  async execute(interaction) {
    const denied = guard(interaction, 'warn');
    if (denied) return replyPrivate(interaction, denied);
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('grund');
    if (!member) return replyPrivate(interaction, 'Diese Person ist nicht auf dem Server.');

    const error = checkHierarchy(interaction, member);
    if (error) return replyPrivate(interaction, error);

    const cfg = forGuild(interaction.guildId).moderation.warnings;
    const list = addWarning('warnings', interaction.guildId, member.id, { reason, by: interaction.user.id, days: interaction.options.getInteger('ablauf') ?? undefined }, cfg);
    const active = activeOf(list).length;
    const expiresAt = list.at(-1).expiresAt;

    await notifyUser(member.user, interaction.guild, 'verwarnt', reason);
    await syncWarnRoles(member, cfg, 'warnings');
    await interaction.reply({
      embeds: [
        embed('warning').setDescription(
          `⚠️ ${member.user} wurde verwarnt (**${active}** aktive Verwarnung${active === 1 ? '' : 'en'}).\n**Grund:** ${reason}` +
            (expiresAt ? `\nLäuft ab <t:${Math.floor(expiresAt / 1000)}:R>.` : ''),
        ),
      ],
    });
    await postPublic(interaction.guild, cfg, { title: '⚠️ Verwarnung', user: member.user, moderator: interaction.user, reason, count: active });
    await logAction(interaction.guild, {
      action: 'Verwarnung',
      target: member.user,
      moderator: interaction.user,
      reason,
      color: 'warning',
      fields: [{ name: 'Aktive Verwarnungen', value: String(active) }],
    });

    const limit = await applyWarnLimit(member, active, interaction.user);
    if (limit) await interaction.followUp({ embeds: [embed('danger').setDescription(`🚫 Warn-Limit erreicht: ${member.user} wurde ${limit}.`)] });
  },
};
