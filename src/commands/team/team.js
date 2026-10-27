const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { bucket, save } = require('../../lib/db');
const { replyPrivate, embed, truncate } = require('../../lib/util');
const team = require('../../lib/team');
const { addWarning, activeOf, isActive, syncWarnRoles, postPublic } = require('../../lib/warnings');
const { warningLine } = require('../moderation/warnings');

const STORE = 'teamWarnings';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Teamverwaltung: Team-Verwarnungen und Rang-Änderungen.')
    .addSubcommand((s) =>
      s
        .setName('verwarnen')
        .setDescription('Verwarnt ein Teammitglied.')
        .addUserOption((o) => o.setName('user').setDescription('Teammitglied').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500).setRequired(true))
        .addIntegerOption((o) => o.setName('ablauf').setDescription('Läuft nach X Tagen ab (0 = nie, leer = Standard)').setMinValue(0).setMaxValue(3650)),
    )
    .addSubcommand((s) =>
      s
        .setName('verwarnungen')
        .setDescription('Zeigt die Team-Verwarnungen eines Mitglieds.')
        .addUserOption((o) => o.setName('user').setDescription('Teammitglied').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('verwarnung-entfernen')
        .setDescription('Entfernt eine oder alle Team-Verwarnungen.')
        .addUserOption((o) => o.setName('user').setDescription('Teammitglied').setRequired(true))
        .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer (leer = alle)').setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('rang')
        .setDescription('Befördert oder stuft ein Teammitglied zurück.')
        .addUserOption((o) => o.setName('user').setDescription('Teammitglied').setRequired(true))
        .addStringOption((o) =>
          o.setName('art').setDescription('Uprank oder Derank').setRequired(true).addChoices({ name: 'Uprank', value: 'up' }, { name: 'Derank', value: 'down' }),
        )
        .addRoleOption((o) => o.setName('neue_rolle').setDescription('Neuer Rang').setRequired(true))
        .addRoleOption((o) => o.setName('alte_rolle').setDescription('Bisheriger Rang (wird entfernt)'))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(500)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = forGuild(interaction.guildId).team;
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');

    if (sub === 'rang') {
      const denied = team.guard(interaction, 'rank');
      if (denied) return replyPrivate(interaction, denied);
      if (!member) return replyPrivate(interaction, 'Diese Person ist nicht auf dem Server.');
      const reason = interaction.options.getString('grund');
      if (cfg.rank.reasonRequired && !reason) return replyPrivate(interaction, 'Für Rang-Änderungen ist ein Grund erforderlich.');
      const newRole = interaction.options.getRole('neue_rolle');
      const oldRole = interaction.options.getRole('alte_rolle');
      const me = interaction.guild.members.me;
      if ([newRole, oldRole].some((r) => r && r.position >= me.roles.highest.position)) {
        return replyPrivate(interaction, 'Die Rolle liegt über meiner höchsten Rolle – ich kann sie nicht vergeben.');
      }
      if (interaction.user.id !== interaction.guild.ownerId && newRole.position >= interaction.member.roles.highest.position) {
        return replyPrivate(interaction, 'Du kannst keine Rolle vergeben, die gleich hoch oder höher ist als deine eigene.');
      }
      const change = { memberId: member.id, oldRoleId: oldRole?.id ?? null, newRoleId: newRole.id, reason, byId: interaction.user.id };
      const up = interaction.options.getString('art') === 'up';

      if (up && cfg.rank.offer.enabled) {
        try {
          await team.postRankOffer(interaction.guild, change);
        } catch (err) {
          return replyPrivate(interaction, `❌ ${err.message}`);
        }
        return replyPrivate(interaction, `📨 ${member} hat ein Beförderungs-Angebot für ${newRole} bekommen (${cfg.rank.offer.hours} Std. gültig).`);
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const caseNumber = await team.applyRankChange(interaction.guild, { ...change, member, up });
      return interaction.editReply(`${up ? '⬆️' : '⬇️'} ${member} ist jetzt ${newRole} (Fall #${caseNumber}).`);
    }

    // Team-Verwarnungen
    const denied = team.guard(interaction, 'warn');
    if (denied) return replyPrivate(interaction, denied);
    if (!cfg.warnings.enabled) return replyPrivate(interaction, 'Team-Verwarnungen sind deaktiviert.');
    const all = bucket(STORE, interaction.guildId);
    const list = all[user.id] ?? [];

    if (sub === 'verwarnungen') {
      if (!list.length) return replyPrivate(interaction, `${user} hat keine Team-Verwarnungen. ✅`);
      const active = list.filter((w) => isActive(w)).length;
      return replyPrivate(interaction, {
        embeds: [
          embed('warning')
            .setTitle(`Team-Verwarnungen von ${user.username} (${active} aktiv, ${list.length} gesamt)`)
            .setDescription(truncate(list.map(warningLine).join('\n\n'), 4000)),
        ],
      });
    }

    if (sub === 'verwarnung-entfernen') {
      const number = interaction.options.getInteger('nummer');
      if (!list.length) return replyPrivate(interaction, `${user} hat keine Team-Verwarnungen.`);
      if (number && number > list.length) return replyPrivate(interaction, `Es gibt nur ${list.length} Team-Verwarnung(en).`);
      if (number) list.splice(number - 1, 1);
      else list.length = 0;
      if (!list.length) delete all[user.id];
      save();
      await syncWarnRoles(member, cfg.warnings, STORE);
      const what = number ? `Team-Verwarnung #${number}` : 'Alle Team-Verwarnungen';
      await team.log(interaction.guild, { embeds: [embed('success').setDescription(`🗑️ ${interaction.user} hat ${what} von ${user} entfernt.`)] });
      return replyPrivate(interaction, `🗑️ ${what} von ${user} entfernt.`);
    }

    // verwarnen
    if (!member) return replyPrivate(interaction, 'Diese Person ist nicht auf dem Server.');
    if (!team.isTeam(member)) return replyPrivate(interaction, 'Diese Person gehört nicht zum Team.');
    if (member.id === interaction.user.id) return replyPrivate(interaction, 'Du kannst dich nicht selbst verwarnen.');
    const reason = interaction.options.getString('grund');
    const updated = addWarning(STORE, interaction.guildId, member.id, { reason, by: interaction.user.id, days: interaction.options.getInteger('ablauf') ?? undefined }, cfg.warnings);
    const active = activeOf(updated).length;
    await syncWarnRoles(member, cfg.warnings, STORE);
    await team.dm(member.user, interaction.guild, `⚠️ Du hast eine Team-Verwarnung bekommen.\n**Grund:** ${reason}`);
    await postPublic(interaction.guild, cfg.warnings, { title: '⚠️ Team-Verwarnung', user, moderator: interaction.user, reason, count: active });
    await team.log(interaction.guild, {
      embeds: [
        embed('warning')
          .setTitle('⚠️ Team-Verwarnung')
          .addFields(
            { name: 'Mitglied', value: `${member}`, inline: true },
            { name: 'Von', value: `${interaction.user}`, inline: true },
            { name: 'Aktiv', value: String(active), inline: true },
            { name: 'Grund', value: reason },
          ),
      ],
    });
    return replyPrivate(interaction, `⚠️ ${member} wurde verwarnt (${active} aktive Team-Verwarnung${active === 1 ? '' : 'en'}).`);
  },

  components: {
    async team(interaction, [action]) {
      if (action === 'offeryes' || action === 'offerno') return team.answerRankOffer(interaction, action === 'offeryes');
    },
  },
};
