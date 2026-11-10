// /verifizieren – Discord-Konto mit dem Roblox-Konto verknüpfen.
// Beweis: Der Nutzer schreibt ein paar zufällige Wörter in seine Roblox-Profilbeschreibung, der Bot liest sie über die
// öffentliche Roblox-API. Die Verknüpfung gilt auf allen Discord-Servern des Bots (Haupt-Discord, Privatserver, andere).
const crypto = require('node:crypto');
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { findRobloxUser, fetchRobloxDescription, profileUrl } = require('../../lib/applications/roblox');
const links = require('../../lib/roblox/links');
const { applyVerification } = require('../../lib/roblox/verify');
const { embed, replyPrivate, isStaff } = require('../../lib/util');

// Wörter statt Zahlen: Roblox zensiert Zahlenfolgen in Profilen gern als ####.
const WORDS = [
  'apfel', 'banane', 'blitz', 'delfin', 'eiche', 'falke', 'fluss', 'garten', 'gitarre', 'hafen',
  'insel', 'kaktus', 'kiwi', 'komet', 'laterne', 'mond', 'nebel', 'ozean', 'palme', 'pinguin',
  'planet', 'rakete', 'regen', 'sonne', 'stern', 'tiger', 'tulpe', 'vulkan', 'wolke', 'zebra',
  'zitrone', 'adler', 'biber', 'drache', 'feder', 'honig', 'koala', 'muschel', 'kompass', 'wald',
];
const CODE_MINUTES = 20;
const pending = new Map(); // discordId → { id, name, code, expires }

const makeCode = () => Array.from({ length: 5 }, () => WORDS[crypto.randomInt(WORDS.length)]).join(' ');
const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ');

// Rolle und Nickname auf allen Discord-Servern anpassen, auf denen die Person ist. Gibt Probleme dieses Servers zurück.
async function syncEverywhere(client, userId, currentGuildId) {
  let problems = [];
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const result = await applyVerification(member);
    if (guild.id === currentGuildId) problems = result;
  }
  return problems;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifizieren')
    .setDescription('Verknüpft dein Discord-Konto mit deinem Roblox-Konto.')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Startet die Verifizierung.')
        .addStringOption((o) => o.setName('roblox_name').setDescription('Dein Roblox-Benutzername (nicht der Anzeigename)').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('anzeigen')
        .setDescription('Zeigt das verknüpfte Roblox-Konto.')
        .addUserOption((o) => o.setName('nutzer').setDescription('Andere Person (nur Team)')),
    )
    .addSubcommand((s) => s.setName('entfernen').setDescription('Hebt die Verknüpfung mit deinem Roblox-Konto auf.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'anzeigen') {
      const user = interaction.options.getUser('nutzer') ?? interaction.user;
      if (user.id !== interaction.user.id && !isStaff(interaction.member)) return replyPrivate(interaction, 'Andere Personen nachschlagen darf nur das Team.');
      const account = links.getAccount(user.id);
      if (!account) return replyPrivate(interaction, `${user} hat kein Roblox-Konto verknüpft.`);
      return replyPrivate(interaction, {
        embeds: [
          embed('success')
            .setTitle('🔗 Roblox-Konto')
            .setDescription(`${user} ↔ [${account.name}](${profileUrl(account.id)}) (\`${account.id}\`)\nVerifiziert <t:${Math.floor(account.verifiedAt / 1000)}:R>`),
        ],
      });
    }

    if (sub === 'entfernen') {
      if (!links.removeAccount(interaction.user.id)) return replyPrivate(interaction, 'Du hast kein Roblox-Konto verknüpft.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await syncEverywhere(interaction.client, interaction.user.id, interaction.guildId);
      return interaction.editReply('✅ Verknüpfung aufgehoben. Die Verifiziert-Rolle wurde entfernt.');
    }

    // start
    const name = interaction.options.getString('roblox_name').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return replyPrivate(interaction, '❌ Das ist kein gültiger Roblox-Benutzername.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let user;
    try {
      user = await findRobloxUser(name);
    } catch {
      return interaction.editReply('❌ Roblox ist gerade nicht erreichbar. Versuche es gleich noch einmal.');
    }
    if (!user) return interaction.editReply(`❌ Es gibt kein Roblox-Konto „${name}“. Achte auf den Benutzernamen, nicht den Anzeigenamen.`);

    const code = makeCode();
    pending.set(interaction.user.id, { id: user.id, name: user.name, code, expires: Date.now() + CODE_MINUTES * 60_000 });
    const info = embed()
      .setTitle('🔗 Roblox-Konto verifizieren')
      .setDescription(
        `Konto: **[${user.name}](${profileUrl(user.id)})**\n\n` +
          '1. Öffne auf Roblox dein Profil → **Info** bearbeiten.\n' +
          `2. Schreibe diese Wörter in deine **Beschreibung** und speichere:\n\`\`\`${code}\`\`\`\n` +
          '3. Klicke hier auf **Prüfen**.\n\n' +
          `Danach kannst du die Wörter wieder löschen. Der Code gilt ${CODE_MINUTES} Minuten.`,
      );
    if (user.avatarUrl) info.setThumbnail(user.avatarUrl);
    return interaction.editReply({
      embeds: [info],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('verify:check').setLabel('Prüfen').setEmoji('✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setLabel('Roblox-Profil').setStyle(ButtonStyle.Link).setURL(profileUrl(user.id)),
        ),
      ],
    });
  },

  components: {
    async verify(interaction) {
      const entry = pending.get(interaction.user.id);
      if (!entry || entry.expires < Date.now()) {
        pending.delete(interaction.user.id);
        return replyPrivate(interaction, '⌛ Der Code ist abgelaufen. Starte neu mit `/verifizieren start`.');
      }
      await interaction.deferUpdate();
      let description;
      try {
        description = await fetchRobloxDescription(entry.id);
      } catch {
        return replyPrivate(interaction, '❌ Roblox ist gerade nicht erreichbar. Versuche es gleich noch einmal.');
      }
      if (!normalize(description).includes(entry.code)) {
        return replyPrivate(
          interaction,
          '❌ Die Wörter stehen noch nicht in deiner Profilbeschreibung. Hast du gespeichert? Roblox braucht manchmal eine Minute, bis die Änderung sichtbar ist.',
        );
      }

      pending.delete(interaction.user.id);
      links.setAccount(interaction.user.id, entry);
      const problems = await syncEverywhere(interaction.client, interaction.user.id, interaction.guildId);
      await interaction.editReply({
        embeds: [
          embed('success')
            .setTitle('✅ Verifiziert')
            .setDescription(
              `Dein Discord-Konto ist jetzt mit **[${entry.name}](${profileUrl(entry.id)})** verknüpft – auf allen unseren Discord-Servern.\n` +
                'Du kannst die Wörter jetzt aus deiner Beschreibung löschen.' +
                (problems.length ? `\n\n⚠️ ${problems.join('\n⚠️ ')}` : ''),
            ),
        ],
        components: [],
      });
    },
  },
};
