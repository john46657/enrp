import { SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../command';
import { embed, reply } from '../ui';

const SECTIONS: Array<[string, string]> = [
  ['🔗 Konto', '`/verify start|status|unlink` · `/profile me|view|history` · `/rules show|accept`'],
  [
    '🎮 Spielwelt',
    '`/status` · `/leaderboard playtime|duty` · `/faction …` · `/duty status|stats|sessions` · `/vehicle list|info`',
  ],
  ['🎫 Support', 'Ticketpanel im Support-Kanal · `/report create` · `/appeal create` · `/suggest create`'],
  [
    '🛡️ Moderation',
    '`/mod warn|timeout|kick|ban|unban|history|revoke` · `/report list|resolve` · `/appeal review` · `/clear`',
  ],
  ['🎉 Community', '`/poll` · `/giveaway` · `/announce create` · `/rollenpanel` · `/rang` · `/bestenliste`'],
  ['📋 Bewerbungen', '`/bewerbung` · `/bewerbungen` · `/bewerbungspanel` · `/qualipanel` · `/bewerbungssperre`'],
  ['⚙️ Verwaltung', '`/permissions …` · `/approval …` · `/feature …` · `/killswitch …` · `/einstellungen`'],
  [
    '🖥️ Betrieb',
    '`/ops health|metrics|dependencies|queue|alerts` · `/incident …` · `/deploy …` · `/env …` · `/backup …` · `/automation …`',
  ],
  [
    '🔒 Sicherheit',
    '`/audit search|diff|export|verify|retention` · `/data inspect|export|deletion-request|retention|cleanup-preview`',
  ],
];

export const help = defineCommand({
  data: new SlashCommandBuilder().setName('hilfe').setDescription('Übersicht aller Befehle'),
  defer: false,
  async execute(interaction) {
    return reply(
      interaction,
      embed()
        .setTitle('📖 Befehlsübersicht')
        .setDescription(
          'Welche Befehle du nutzen darfst, hängt von deinen Rollen ab. Die Plattform prüft jede Aktion serverseitig.',
        )
        .addFields(SECTIONS.map(([name, value]) => ({ name, value }))),
    );
  },
});
