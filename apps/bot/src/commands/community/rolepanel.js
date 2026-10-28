const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed, replyPrivate } = require('../../lib/util');

const builder = new SlashCommandBuilder()
  .setName('rollenpanel')
  .setDescription('Erstellt ein Panel, über das sich Mitglieder Rollen per Knopfdruck geben können.')
  .addStringOption((o) => o.setName('titel').setDescription('Überschrift des Panels').setMaxLength(256).setRequired(true))
  .addRoleOption((o) => o.setName('rolle1').setDescription('Rolle 1').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
for (let i = 2; i <= 10; i++) builder.addRoleOption((o) => o.setName(`rolle${i}`).setDescription(`Rolle ${i}`));
builder.addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel').setMaxLength(2000));

module.exports = {
  data: builder,

  async execute(interaction) {
    const roles = [];
    for (let i = 1; i <= 10; i++) {
      const role = interaction.options.getRole(`rolle${i}`);
      if (role && !roles.some((r) => r.id === role.id)) roles.push(role);
    }

    const blocked = roles.filter((r) => r.managed || r.id === interaction.guild.id || !interaction.guild.roles.cache.get(r.id)?.editable);
    if (blocked.length) {
      return replyPrivate(interaction, `Diese Rollen kann ich nicht vergeben (zu hoch oder von einer Integration verwaltet): ${blocked.join(', ')}`);
    }

    const buttons = roles.map((r) => new ButtonBuilder().setCustomId(`role:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

    await interaction.channel.send({
      embeds: [
        embed()
          .setTitle(interaction.options.getString('titel'))
          .setDescription(interaction.options.getString('beschreibung') ?? 'Klicke auf einen Knopf, um die Rolle zu erhalten oder wieder abzugeben.'),
      ],
      components: rows,
    });
    await replyPrivate(interaction, '✅ Rollen-Panel gepostet.');
  },

  components: {
    async role(interaction, [roleId]) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return replyPrivate(interaction, 'Diese Rolle existiert nicht mehr.');
      if (interaction.member.roles.cache.has(roleId)) {
        await interaction.member.roles.remove(roleId, 'Rollen-Panel');
        return replyPrivate(interaction, `➖ Rolle ${role} entfernt.`);
      }
      await interaction.member.roles.add(roleId, 'Rollen-Panel');
      return replyPrivate(interaction, `➕ Rolle ${role} erhalten.`);
    },
  },
};
