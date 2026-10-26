const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { embed, replyPrivate, sendTo, truncate } = require('../../lib/util');
const { save, nextNumber } = require('../../lib/db');
const store = require('../../lib/applications/store');
const { findRobloxUser } = require('../../lib/applications/roblox');

const scopeName = (scope) => (scope === '*' ? 'Alle Bewerbungen' : scope === 'police' ? 'Polizei-Bewerbung' : (store.typeById(scope)?.name ?? scope));

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
        .addStringOption((o) =>
          o
            .setName('bereich')
            .setDescription('Wofür gilt die Sperre? (Standard: alle)')
            .addChoices(
              { name: 'Alle Bewerbungen', value: '*' },
              { name: 'Polizei-Bewerbung', value: 'police' },
              ...store
                .types()
                .filter((t) => t.workflow !== 'police')
                .slice(0, 23)
                .map((t) => ({ name: t.name, value: t.id })),
            ),
        )
        .addIntegerOption((o) => o.setName('tage').setDescription('Dauer in Tagen (leer = unbegrenzt)').setMinValue(1).setMaxValue(3650)),
    )
    .addSubcommand((s) =>
      s
        .setName('aufheben')
        .setDescription('Hebt eine Sperre auf.')
        .addStringOption((o) => o.setName('id').setDescription('ID der Sperre, z. B. B-0001').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Zeigt alle aktiven Sperren.')),

  async execute(interaction) {
    if (!store.managesAny(interaction.member)) return replyPrivate(interaction, 'Nur das Bewerbungsteam kann Sperren verwalten.');
    const bans = store.bansOf(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const now = Date.now();
      const active = Object.values(bans).filter((b) => !b.liftedAt && (!b.expiresAt || b.expiresAt > now));
      if (!active.length) return replyPrivate(interaction, 'Es gibt keine aktiven Sperren.');
      const lines = active.map(
        (b) =>
          `**${b.id}** ${[b.discordId && `<@${b.discordId}>`, b.robloxName && `Roblox ${b.robloxName}`].filter(Boolean).join(' · ')}\n` +
          `${b.scopes.map(scopeName).join(', ')} · ${b.expiresAt ? `bis <t:${Math.floor(b.expiresAt / 1000)}:d>` : 'unbegrenzt'} · ${b.reason}`,
      );
      return replyPrivate(interaction, { embeds: [embed('danger').setTitle(`🚫 Bewerbungssperren (${active.length})`).setDescription(truncate(lines.join('\n\n'), 4000))] });
    }

    if (sub === 'aufheben') {
      const ban = bans[interaction.options.getString('id').trim().toUpperCase()];
      if (!ban || ban.liftedAt) return replyPrivate(interaction, 'Diese Sperre gibt es nicht oder sie ist schon aufgehoben.');
      ban.liftedAt = Date.now();
      ban.liftedBy = interaction.user.id;
      save();
      await replyPrivate(interaction, `✅ Sperre ${ban.id} aufgehoben.`);
      return sendTo(interaction.guild, 'modLog', { embeds: [embed('success').setDescription(`✅ ${interaction.user} hat die Bewerbungssperre **${ban.id}** aufgehoben.`)] });
    }

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
    const id = `B-${String(nextNumber('appBan', interaction.guildId)).padStart(4, '0')}`;
    const ban = {
      id,
      discordId: user?.id ?? null,
      robloxId: roblox?.id ?? null,
      robloxName: roblox?.name ?? null,
      scopes: [interaction.options.getString('bereich') ?? '*'],
      reason: interaction.options.getString('grund'),
      expiresAt: days ? Date.now() + days * 86_400_000 : null,
      createdBy: interaction.user.id,
      createdAt: Date.now(),
    };
    bans[id] = ban;
    save();

    const text = `🚫 Sperre **${id}** angelegt: ${[user && `${user}`, roblox && `Roblox ${roblox.name}`].filter(Boolean).join(' · ')} – ${scopeName(ban.scopes[0])}, ${days ? `${days} Tage` : 'unbegrenzt'}.`;
    await (interaction.deferred ? interaction.editReply(text) : replyPrivate(interaction, text));
    return sendTo(interaction.guild, 'modLog', { embeds: [embed('danger').setDescription(`${text}\n**Grund:** ${ban.reason}\nvon ${interaction.user}`)], allowedMentions: { parse: [] } });
  },
};
