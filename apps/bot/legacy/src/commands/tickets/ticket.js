const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { base } = require('../../lib/settings');
const tickets = require('../../lib/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket-System')
    .addSubcommand((s) => s.setName('panel').setDescription('Postet das Ticket-Panel in diesem Kanal (nur Admins).'))
    .addSubcommand((s) => s.setName('schliessen').setDescription('Schließt das aktuelle Ticket.'))
    .addSubcommand((s) =>
      s
        .setName('fuer')
        .setDescription('Öffnet ein Ticket im Auftrag eines Mitglieds (nur Team).')
        .addUserOption((o) => o.setName('user').setDescription('Für wen?').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('kategorie')
            .setDescription('Ticket-Kategorie')
            .setRequired(true)
            .addChoices(...base.tickets.types.slice(0, 25).map((t) => ({ name: t.label, value: t.id }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('hinzufuegen')
        .setDescription('Fügt jemanden zum Ticket hinzu (als Ersteller: Anfrage ans Team).')
        .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('entfernen')
        .setDescription('Entfernt jemanden aus dem aktuellen Ticket.')
        .addUserOption((o) => o.setName('user').setDescription('Nutzer').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return replyPrivate(interaction, 'Dafür brauchst du die Berechtigung „Server verwalten“.');
      }
      await tickets.postPanel(interaction.channel);
      return replyPrivate(interaction, '✅ Ticket-Panel gepostet. Die Auslastung aktualisiert sich automatisch.');
    }

    if (sub === 'schliessen') return tickets.closeFromInteraction(interaction);
    if (sub === 'fuer') return tickets.openOnBehalf(interaction, interaction.options.getString('kategorie'), interaction.options.getMember('user'));

    const ticket = tickets.ticketsOf(interaction.guildId)[interaction.channelId];
    if (!ticket) return replyPrivate(interaction, 'Das hier ist kein Ticket-Kanal.');
    const user = interaction.options.getUser('user');

    if (sub === 'hinzufuegen') return tickets.requestAddUser(interaction, ticket, user);

    if (!tickets.isTicketTeam(interaction.member, ticket)) return replyPrivate(interaction, 'Nur das Team kann Personen entfernen.');
    if (user.id === ticket.owner) return replyPrivate(interaction, 'Der Ersteller kann nicht entfernt werden.');
    await interaction.channel.permissionOverwrites.delete(user);
    await interaction.reply(`➖ ${user} wurde aus dem Ticket entfernt.`);
    return tickets.logActivity(interaction.guild, 'danger', `➖ ${interaction.user} hat ${user} aus <#${interaction.channelId}> entfernt.`);
  },

  components: {
    async ticket(interaction, [action, userId]) {
      switch (action) {
        case 'open': {
          const result = tickets.openTicket(interaction, interaction.values[0]);
          // Auswahl im Panel zurücksetzen, damit dieselbe Kategorie erneut gewählt werden kann.
          await tickets.refreshPanels(interaction.guild);
          return result;
        }
        case 'close':
          return tickets.closeFromInteraction(interaction);
        case 'closeyes':
        case 'closereason':
        case 'closemodal':
        case 'closeform':
        case 'closeformmodal':
        case 'closeaccept':
        case 'closedeny':
        case 'closeno':
          return tickets.confirmClose(interaction, action);
        case 'claim':
          return tickets.claim(interaction);
        case 'unclaim':
          return tickets.unclaim(interaction);
        case 'addok':
          return tickets.answerAddRequest(interaction, userId, true);
        case 'addno':
          return tickets.answerAddRequest(interaction, userId, false);
      }
    },
  },
};
