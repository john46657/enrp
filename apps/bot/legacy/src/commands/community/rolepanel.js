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

// Postet ein Rollen-Panel (auch vom Dashboard genutzt). Wirft einen Fehler mit verständlicher Meldung.
async function postRolePanel(channel, { title, description, roles }) {
  const guild = channel.guild;
  const unique = roles.filter((r, i) => roles.findIndex((x) => x.id === r.id) === i);
  if (!unique.length) throw new Error('Wähle mindestens eine Rolle.');
  if (unique.length > 10) throw new Error('Höchstens 10 Rollen je Panel.');
  const blocked = unique.filter((r) => r.managed || r.id === guild.id || !guild.roles.cache.get(r.id)?.editable);
  if (blocked.length) {
    throw new Error(`Diese Rollen kann ich nicht vergeben (zu hoch oder von einer Integration verwaltet): ${blocked.map((r) => `@${r.name}`).join(', ')}`);
  }

  const buttons = unique.map((r) => new ButtonBuilder().setCustomId(`role:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

  return channel.send({
    embeds: [embed().setTitle(title).setDescription(description || 'Klicke auf einen Knopf, um die Rolle zu erhalten oder wieder abzugeben.')],
    components: rows,
  });
}

module.exports = {
  data: builder,
  postRolePanel,

  async execute(interaction) {
    const roles = [];
    for (let i = 1; i <= 10; i++) {
      const role = interaction.options.getRole(`rolle${i}`);
      if (role) roles.push(role);
    }
    try {
      await postRolePanel(interaction.channel, {
        title: interaction.options.getString('titel'),
        description: interaction.options.getString('beschreibung'),
        roles,
      });
    } catch (err) {
      if (err.code) throw err; // Discord-Fehler (z. B. fehlende Rechte im Kanal) wie bisher behandeln
      return replyPrivate(interaction, err.message);
    }
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
