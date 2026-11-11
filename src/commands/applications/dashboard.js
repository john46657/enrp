const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const store = require('../../lib/applications/store');
const web = require('../../lib/web');

module.exports = {
  data: new SlashCommandBuilder().setName('dashboard').setDescription('Öffnet das Bewerbungs-Dashboard im Browser (nur Team).'),

  async execute(interaction) {
    if (!store.managesAny(interaction.member)) return replyPrivate(interaction, 'Nur das Bewerbungsteam kann das Dashboard öffnen.');
    if (!web.enabled()) {
      return replyPrivate(
        interaction,
        'Das Dashboard ist nicht eingerichtet. Trage in der `.env` die öffentliche Adresse des Bots ein (`WEB_URL=https://…`, dazu `WEB_PORT`) und starte neu. Bis dahin: `/bewerbungen`, `/bewerbungssperre` und `/einstellungen`.',
      );
    }
    return replyPrivate(interaction, {
      content: '🖥️ Dein persönlicher Zugang zum Dashboard. Der Link gilt 10 Minuten und nur für dich – gib ihn nicht weiter.',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Dashboard öffnen').setStyle(ButtonStyle.Link).setURL(web.loginUrl({ guildId: interaction.guildId, userId: interaction.user.id })),
        ),
      ],
    });
  },
};
