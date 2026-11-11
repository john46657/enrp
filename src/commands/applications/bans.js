const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { embed, replyPrivate, sendTo, truncate } = require('../../lib/util');
const store = require('../../lib/applications/store');
const { findRobloxUser } = require('../../lib/applications/roblox');
const { respondTypes, findType } = require('../../lib/applications/choices');

const FIXED_SCOPES = [
  { name: 'Alle Bewerbungen', value: '*' },
  { name: 'Polizei-Bewerbung (alle Arten mit Polizei-Ablauf)', value: 'police' },
];

const { scopeName } = store;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungssperre')
    .setDescription('Personen von Bewerbungen ausschließen.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('hinzufuegen')
        .setDescription('Sperrt eine Person per Discord und/oder Roblox.')
        .addStringOption((o) => o.setName('grund').setDescription('Grund (sieht die Person)').setMaxLength(500).setRequired(true))
        .addUserOption((o) => o.setName('user').setDescription('Discord-Nutzer'))
        .addStringOption((o) => o.setName('roblox').setDescription('Roblox-Benutzername'))
        .addStringOption((o) => o.setName('bereich').setDescription('Wofür gilt die Sperre? (Standard: alle)').setAutocomplete(true))
        .addIntegerOption((o) => o.setName('tage').setDescription('Dauer in Tagen (leer = unbegrenzt)').setMinValue(1).setMaxValue(3650)),
    )
    .addSubcommand((s) =>
      s
        .setName('aufheben')
        .setDescription('Hebt eine Sperre auf.')
        .addStringOption((o) => o.setName('id').setDescription('ID der Sperre, z. B. B-0001').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Zeigt alle aktiven Sperren.')),

  autocomplete: (interaction) => respondTypes(interaction, { extra: FIXED_SCOPES, filter: (t) => t.workflow !== 'police' }),

  async execute(interaction) {
    if (!store.managesAny(interaction.member)) return replyPrivate(interaction, 'Nur das Bewerbungsteam kann Sperren verwalten.');
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const active = store.activeBans(interaction.guildId);
      if (!active.length) return replyPrivate(interaction, 'Es gibt keine aktiven Sperren.');
      const lines = active.map(
        (b) =>
          `**${b.id}** ${[b.discordId && `<@${b.discordId}>`, b.robloxName && `Roblox ${b.robloxName}`].filter(Boolean).join(' · ')}\n` +
          `${b.scopes.map((s) => scopeName(interaction.guildId, s)).join(', ')} · ${b.expiresAt ? `bis <t:${Math.floor(b.expiresAt / 1000)}:d>` : 'unbegrenzt'} · ${b.reason}`,
      );
      return replyPrivate(interaction, { embeds: [embed('danger').setTitle(`🚫 Bewerbungssperren (${active.length})`).setDescription(truncate(lines.join('\n\n'), 4000))] });
    }

    if (sub === 'aufheben') {
      const ban = store.liftBan(interaction.guildId, interaction.options.getString('id').trim().toUpperCase(), interaction.user.id);
      if (!ban) return replyPrivate(interaction, 'Diese Sperre gibt es nicht oder sie ist schon aufgehoben.');
      await replyPrivate(interaction, `✅ Sperre ${ban.id} aufgehoben.`);
      return sendTo(interaction.guild, 'modLog', { embeds: [embed('success').setDescription(`✅ ${interaction.user} hat die Bewerbungssperre **${ban.id}** aufgehoben.`)] });
    }

    const wantedScope = interaction.options.getString('bereich')?.trim() ?? '*';
    const scope = ['*', 'police'].includes(wantedScope) ? wantedScope : findType(interaction.guildId, wantedScope)?.id;
    if (!scope) return replyPrivate(interaction, `Den Bereich „${wantedScope}“ gibt es nicht. Wähle einen Vorschlag aus der Liste.`);

    const user = interaction.options.getUser('user');
    const robloxName = interaction.options.getString('roblox')?.trim();
    if (!user && !robloxName) return replyPrivate(interaction, 'Gib einen Discord-Nutzer und/oder einen Roblox-Namen an.');

    let roblox = null;
    if (robloxName) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        roblox = await findRobloxUser(robloxName);
      } catch {
        return interaction.editReply('⚠️ Roblox ist gerade nicht erreichbar. Versuche es gleich noch einmal.');
      }
      if (!roblox) return interaction.editReply(`❌ Kein Roblox-Konto „${robloxName}“ gefunden.`);
    }

    const days = interaction.options.getInteger('tage');
    const ban = store.addBan(interaction.guildId, { discordId: user?.id ?? null, roblox, scope, reason: interaction.options.getString('grund'), days, createdBy: interaction.user.id });
    const { id } = ban;

    const text = `🚫 Sperre **${id}** angelegt: ${[user && `${user}`, roblox && `Roblox ${roblox.name}`].filter(Boolean).join(' · ')} – ${scopeName(interaction.guildId, ban.scopes[0])}, ${days ? `${days} Tage` : 'unbegrenzt'}.`;
    await (interaction.deferred ? interaction.editReply(text) : replyPrivate(interaction, text));
    return sendTo(interaction.guild, 'modLog', { embeds: [embed('danger').setDescription(`${text}\n**Grund:** ${ban.reason}\nvon ${interaction.user}`)], allowedMentions: { parse: [] } });
  },
};
