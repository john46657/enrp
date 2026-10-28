const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const settings = require('../../lib/settings');
const { replyPrivate, embed, truncate } = require('../../lib/util');
const gw = require('../../lib/giveaways');

// Giveaway per Nachrichten-ID oder Link finden.
function findGiveaway(guildId, input) {
  const id = String(input ?? '').trim().split('/').pop();
  const g = gw.giveawaysOf(guildId)[id];
  if (!g) throw new Error('Kein Giveaway mit dieser Nachrichten-ID gefunden.');
  return g;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaways starten und verwalten.')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Startet ein Giveaway.')
        .addStringOption((o) => o.setName('preis').setDescription('Was gibt es zu gewinnen?').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('dauer').setDescription('z. B. 30m, 2h, 1d, 1d12h, 1w').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('gewinner').setDescription('Anzahl Gewinner (1–20)').setMinValue(1).setMaxValue(20))
        .addChannelOption((o) => o.setName('kanal').setDescription('Kanal (leer = Standard-Kanal)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName('beschreibung').setDescription('Beschreibung').setMaxLength(1000))
        .addRoleOption((o) => o.setName('pflicht_rolle').setDescription('Nur mit dieser Rolle teilnehmen'))
        .addIntegerOption((o) => o.setName('min_tage_server').setDescription('Mindestens X Tage auf dem Server').setMinValue(0).setMaxValue(3650))
        .addIntegerOption((o) => o.setName('min_account_tage').setDescription('Account mindestens X Tage alt').setMinValue(0).setMaxValue(3650))
        .addStringOption((o) => o.setName('bild').setDescription('Bild-URL (https://…)')),
    )
    .addSubcommand((s) => s.setName('vorlage').setDescription('Startet ein Giveaway aus einer Vorlage.').addStringOption((o) => o.setName('name').setDescription('Name der Vorlage').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('ende').setDescription('Beendet ein Giveaway sofort.').addStringOption((o) => o.setName('nachricht').setDescription('Nachrichten-ID oder Link').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('neu-ziehen')
        .setDescription('Zieht weitere Gewinner.')
        .addStringOption((o) => o.setName('nachricht').setDescription('Nachrichten-ID oder Link').setRequired(true))
        .addIntegerOption((o) => o.setName('anzahl').setDescription('Wie viele (Standard 1)').setMinValue(1).setMaxValue(20)),
    )
    .addSubcommand((s) => s.setName('abbrechen').setDescription('Bricht ein Giveaway ohne Gewinner ab.').addStringOption((o) => o.setName('nachricht').setDescription('Nachrichten-ID oder Link').setRequired(true)))
    .addSubcommand((s) => s.setName('liste').setDescription('Zeigt laufende Giveaways.'))
    .addSubcommandGroup((g) =>
      g
        .setName('blacklist')
        .setDescription('Mitglieder von Giveaways ausschließen.')
        .addSubcommand((s) => s.setName('add').setDescription('Mitglied ausschließen.').addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Ausschluss aufheben.').addUserOption((o) => o.setName('user').setDescription('Mitglied').setRequired(true))),
    ),

  async execute(interaction) {
    if (!gw.isManager(interaction.member)) return replyPrivate(interaction, 'Dafür brauchst du eine Giveaway-Manager-Rolle oder „Server verwalten“.');
    const o = interaction.options;
    const group = o.getSubcommandGroup(false);
    const sub = o.getSubcommand();
    const cfg = settings.forGuild(interaction.guildId).giveaways;

    try {
      if (group === 'blacklist') {
        const user = o.getUser('user');
        const users = cfg.blacklist.users.filter((id) => id !== user.id);
        if (sub === 'add') users.push(user.id);
        settings.set(interaction.guildId, 'giveaways.blacklist.users', users);
        return replyPrivate(interaction, sub === 'add' ? `🚫 ${user} ist von Giveaways ausgeschlossen.` : `✅ ${user} darf wieder teilnehmen.`);
      }
      switch (sub) {
        case 'start': {
          const image = o.getString('bild')?.trim();
          if (image && !/^https:\/\/\S+$/.test(image)) throw new Error('Das Bild muss eine https-URL sein.');
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const g = await gw.startGiveaway(interaction.guild, {
            prize: o.getString('preis'),
            description: o.getString('beschreibung'),
            durationMs: gw.parseDuration(o.getString('dauer')),
            winners: o.getInteger('gewinner') ?? 1,
            channelId: o.getChannel('kanal')?.id,
            image,
            requiredRoles: o.getRole('pflicht_rolle') ? [o.getRole('pflicht_rolle').id] : [],
            minServerDays: o.getInteger('min_tage_server') ?? 0,
            minAccountDays: o.getInteger('min_account_tage') ?? 0,
            hostId: interaction.user.id,
          });
          return interaction.editReply(`🎉 Giveaway gestartet in <#${g.channelId}> (Nachrichten-ID \`${g.messageId}\`).`);
        }
        case 'vorlage': {
          const name = o.getString('name').trim().toLowerCase();
          const template = cfg.templates.find((t) => t.name.toLowerCase() === name);
          if (!template) throw new Error(`Keine Vorlage „${o.getString('name')}“. Vorhanden: ${cfg.templates.map((t) => t.name).join(', ') || 'keine (im Dashboard anlegen)'}`);
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const g = await gw.startFromTemplate(interaction.guild, template, interaction.user.id);
          return interaction.editReply(`🎉 Giveaway „${template.name}“ gestartet in <#${g.channelId}>.`);
        }
        case 'ende': {
          const g = findGiveaway(interaction.guildId, o.getString('nachricht'));
          if (g.ended) throw new Error('Dieses Giveaway ist bereits beendet.');
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await gw.endGiveaway(interaction.guild, g);
          return interaction.editReply('🏁 Giveaway beendet.');
        }
        case 'neu-ziehen': {
          const g = findGiveaway(interaction.guildId, o.getString('nachricht'));
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const fresh = await gw.reroll(interaction.guild, g, o.getInteger('anzahl') ?? 1);
          return interaction.editReply(fresh.length ? `🔁 Neu gezogen: ${fresh.map((id) => `<@${id}>`).join(', ')}` : 'Keine weiteren gültigen Teilnehmer.');
        }
        case 'abbrechen': {
          const g = findGiveaway(interaction.guildId, o.getString('nachricht'));
          if (g.ended) throw new Error('Dieses Giveaway ist bereits beendet.');
          await gw.cancelGiveaway(interaction.guild, g);
          return replyPrivate(interaction, '⛔ Giveaway abgebrochen.');
        }
        case 'liste': {
          const running = Object.values(gw.giveawaysOf(interaction.guildId)).filter((g) => !g.ended);
          if (!running.length) return replyPrivate(interaction, 'Gerade läuft kein Giveaway.');
          const lines = running.map((g) => `**${g.prize}** in <#${g.channelId}> – endet <t:${Math.floor(g.endsAt / 1000)}:R> · ${Object.keys(g.entries).length} Teilnehmer · ID \`${g.messageId}\``);
          return replyPrivate(interaction, { embeds: [embed().setTitle('🎉 Laufende Giveaways').setDescription(truncate(lines.join('\n'), 4000))] });
        }
      }
    } catch (err) {
      return interaction.deferred ? interaction.editReply(`❌ ${err.message}`) : replyPrivate(interaction, `❌ ${err.message}`);
    }
  },

  components: {
    async giveaway(interaction, [action, messageId]) {
      if (action === 'join') return gw.handleJoin(interaction);
      if (action === 'claim') return gw.handleClaim(interaction, messageId);
    },
  },
};
