const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../../../config.json');
const { embed, replyPrivate, sendTo, isStaff, truncate } = require('../../lib/util');
const { bucket, save } = require('../../lib/db');

const questions = config.whitelist.questions.slice(0, 5); // Discord erlaubt max. 5 Felder pro Formular

function decisionRow(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wl:accept:${userId}`).setLabel('Annehmen').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`wl:deny:${userId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(disabled),
  );
}

// Übernimmt das Bewerbungs-Embed und ergänzt die Entscheidung.
function decidedEmbed(message, color, text) {
  return embed(color)
    .setTitle(message.embeds[0].title)
    .setThumbnail(message.embeds[0].thumbnail?.url ?? null)
    .setFields(...message.embeds[0].fields, { name: 'Entscheidung', value: text });
}

const components = {
  async wl(interaction, [action, userId]) {
    const applications = bucket('applications', interaction.guildId);

    if (action === 'apply') {
      if (config.roles.whitelisted && interaction.member.roles.cache.has(config.roles.whitelisted)) {
        return replyPrivate(interaction, 'Du bist bereits gewhitelistet. ✅');
      }
      if (applications[interaction.user.id]?.status === 'offen') {
        return replyPrivate(interaction, 'Deine Bewerbung wird noch geprüft. Bitte hab etwas Geduld. ⏳');
      }
      const modal = new ModalBuilder().setCustomId('wl:submit').setTitle('Whitelist-Bewerbung');
      for (const q of questions) {
        const input = new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label.slice(0, 45))
          .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(q.required !== false)
          .setMaxLength(q.style === 'paragraph' ? 1000 : 100);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }
      return interaction.showModal(modal);
    }

    if (action === 'submit') {
      const answers = questions.map((q) => ({
        name: q.label,
        value: truncate(interaction.fields.getTextInputValue(q.id) || '—', 1024),
      }));
      const sent = await sendTo(interaction.guild, 'whitelistReview', {
        content: config.roles.staff ? `<@&${config.roles.staff}>` : undefined,
        embeds: [
          embed('primary')
            .setTitle(`📝 Bewerbung von ${interaction.user.username}`)
            .setThumbnail(interaction.user.displayAvatarURL())
            .addFields({ name: 'Bewerber', value: `${interaction.user} (\`${interaction.user.id}\`)` }, ...answers),
        ],
        components: [decisionRow(interaction.user.id)],
      });
      if (!sent) return replyPrivate(interaction, '❌ Bewerbungen sind gerade nicht möglich (Review-Kanal fehlt). Bitte melde dich beim Team.');

      applications[interaction.user.id] = { status: 'offen', at: Date.now() };
      save();
      return replyPrivate(interaction, '✅ Deine Bewerbung wurde abgeschickt! Du bekommst eine Nachricht, sobald sie bearbeitet wurde.');
    }

    // Ab hier: Entscheidungen durch das Team
    if (!isStaff(interaction.member)) return replyPrivate(interaction, 'Nur das Team kann Bewerbungen bearbeiten.');

    if (action === 'accept') {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) return replyPrivate(interaction, 'Der Bewerber ist nicht mehr auf dem Server.');
      if (config.roles.whitelisted) await member.roles.add(config.roles.whitelisted, `Whitelist angenommen von ${interaction.user.tag}`);

      applications[userId] = { status: 'angenommen', at: Date.now(), by: interaction.user.id };
      save();
      await member
        .send({ embeds: [embed('success').setTitle('🎉 Whitelist angenommen!').setDescription(`Willkommen auf **${interaction.guild.name}**! Viel Spaß beim Spielen.`)] })
        .catch(() => {});
      return interaction.update({
        embeds: [decidedEmbed(interaction.message, 'success', `✅ Angenommen von ${interaction.user}`)],
        components: [decisionRow(userId, true)],
      });
    }

    if (action === 'deny') {
      const modal = new ModalBuilder()
        .setCustomId(`wl:denied:${userId}`)
        .setTitle('Bewerbung ablehnen')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel('Grund (bekommt der Bewerber per DM)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000),
          ),
        );
      return interaction.showModal(modal);
    }

    if (action === 'denied') {
      const reason = interaction.fields.getTextInputValue('reason');
      applications[userId] = { status: 'abgelehnt', at: Date.now(), by: interaction.user.id };
      save();
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      await user
        ?.send({
          embeds: [
            embed('danger')
              .setTitle('Whitelist-Bewerbung abgelehnt')
              .setDescription(`Deine Bewerbung auf **${interaction.guild.name}** wurde leider abgelehnt.\n**Grund:** ${reason}\n\nDu kannst dich erneut bewerben.`),
          ],
        })
        .catch(() => {});
      return interaction.update({
        embeds: [decidedEmbed(interaction.message, 'danger', `❌ Abgelehnt von ${interaction.user}\n**Grund:** ${reason}`)],
        components: [decisionRow(userId, true)],
      });
    }
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whitelist-panel')
    .setDescription('Postet das Whitelist-Bewerbungspanel in diesem Kanal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.channel.send({
      embeds: [
        embed()
          .setTitle(`📋 Whitelist – ${config.serverName}`)
          .setDescription(
            'Du möchtest bei uns mitspielen? Klicke auf **Jetzt bewerben** und fülle das Formular aus.\n\n' +
              'Lies vorher bitte unser Regelwerk. Das Team meldet sich per Direktnachricht bei dir – lass deine DMs offen!',
          ),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('wl:apply').setLabel('Jetzt bewerben').setStyle(ButtonStyle.Primary).setEmoji('📝'),
        ),
      ],
    });
    await replyPrivate(interaction, '✅ Whitelist-Panel gepostet.');
  },

  components,
};
