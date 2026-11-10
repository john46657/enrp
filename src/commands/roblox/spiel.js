// /spiel – Verbindung zum eigenen Roblox-Spiel.
// Was ein Discord darf, hängt von seinem Bereich ab (src/lib/roblox/links.js):
//   Haupt-Discord      → ganzes Spiel
//   Privatserver-Discord → nur die Privatserver des verknüpften Besitzers
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cloud = require('../../lib/roblox/openCloud');
const links = require('../../lib/roblox/links');
const { statusMessage } = require('../../lib/roblox/status');
const { findRobloxUser, profileUrl } = require('../../lib/applications/roblox');
const { embed, replyPrivate, sendTo, isStaff, truncate } = require('../../lib/util');

const builder = new SlashCommandBuilder()
  .setName('spiel')
  .setDescription('Unser Roblox-Spiel: Status, Ansagen und Moderation.')
  .addSubcommand((s) => s.setName('status').setDescription('Zeigt Spieler online, Besuche und Favoriten.'))
  .addSubcommand((s) =>
    s
      .setName('ansage')
      .setDescription('Zeigt eine Ansage als Banner im Spiel an (Team).')
      .addStringOption((o) => o.setName('text').setDescription('Text der Ansage').setRequired(true).setMaxLength(400)),
  )
  .addSubcommand((s) =>
    s
      .setName('kick')
      .setDescription('Wirft einen Spieler aus dem Spiel (Team).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @Discord-Nutzer (verifiziert)').setRequired(true))
      .addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(200)),
  )
  .addSubcommand((s) =>
    s
      .setName('ban')
      .setDescription('Bannt einen Spieler (Team).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @Discord-Nutzer (verifiziert)').setRequired(true))
      .addStringOption((o) => o.setName('dauer').setDescription('z. B. 30m, 12h, 7d, 2w oder perm').setRequired(true))
      .addStringOption((o) => o.setName('grund').setDescription('Wird dem Spieler angezeigt').setRequired(true).setMaxLength(300))
      .addStringOption((o) => o.setName('notiz').setDescription('Nur fürs Team sichtbar').setMaxLength(500))
      .addBooleanOption((o) => o.setName('zweitaccounts').setDescription('Auch vermutete Zweitaccounts bannen (nur Haupt-Discord, Standard: ja)')),
  )
  .addSubcommand((s) =>
    s
      .setName('unban')
      .setDescription('Hebt einen Bann auf (Team).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @Discord-Nutzer (verifiziert)').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('bann-pruefen')
      .setDescription('Zeigt, ob ein Spieler gebannt ist (Team).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @Discord-Nutzer (verifiziert)').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('banns').setDescription('Listet die Banns eurer Privatserver (Team).'))
  .addSubcommand((s) =>
    s
      .setName('neustart')
      .setDescription('Wirft alle Spieler raus, damit neue Server mit dem neuesten Update starten (Team).')
      .addStringOption((o) => o.setName('grund').setDescription('z. B. Update').setMaxLength(200))
      .addBooleanOption((o) => o.setName('bestaetigen').setDescription('Wirklich alle Spieler rauswerfen?').setRequired(true)),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('privatserver')
      .setDescription('Privatserver-Discords verwalten (nur Haupt-Discord).')
      .addSubcommand((s) =>
        s
          .setName('verknuepfen')
          .setDescription('Gibt einem Discord die Rechte für die Privatserver eines Besitzers.')
          .addStringOption((o) => o.setName('discord_server_id').setDescription('ID des Privatserver-Discords (Bot muss dort sein)').setRequired(true))
          .addStringOption((o) => o.setName('besitzer').setDescription('Roblox-Name des Privatserver-Besitzers').setRequired(true))
          .addStringOption((o) => o.setName('name').setDescription('Anzeigename, z. B. „Polizei-RP Nord“').setRequired(true).setMaxLength(60)),
      )
      .addSubcommand((s) =>
        s
          .setName('entfernen')
          .setDescription('Nimmt einem Discord die Privatserver-Rechte.')
          .addStringOption((o) => o.setName('discord_server_id').setDescription('ID des Discord-Servers').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('liste').setDescription('Zeigt alle verknüpften Privatserver-Discords.')),
  );

const SCOPE_LABEL = {
  main: 'Ganzes Spiel',
  private: (scope) => `Privatserver „${scope.name}“`,
};
const scopeLabel = (scope) => (typeof SCOPE_LABEL[scope.type] === 'function' ? SCOPE_LABEL[scope.type](scope) : SCOPE_LABEL[scope.type]);
const target = (scope) => (scope.type === 'main' ? 'all' : cloud.privateTarget(scope.ownerId));
// Verifiziertes Roblox-Konto des Absenders: Das Spiel filtert Texte aus Discord in seinem Namen.
const sender = (interaction) => links.getAccount(interaction.user.id)?.id ?? null;

// Roblox-Name oder Discord-Erwähnung eines verifizierten Nutzers → { id, name }
async function resolvePlayer(input) {
  const text = input.trim();
  const mention = text.match(/^<@!?(\d+)>$/);
  if (mention) {
    const account = links.getAccount(mention[1]);
    if (!account) throw new cloud.RobloxError('Diese Person hat ihr Roblox-Konto noch nicht verknüpft (`/verifizieren start`).');
    return { id: account.id, name: account.name };
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(text)) throw new cloud.RobloxError(`„${truncate(text, 40)}“ ist kein gültiger Roblox-Name.`);
  const user = await findRobloxUser(text);
  if (!user) throw new cloud.RobloxError(`Es gibt kein Roblox-Konto „${text}“.`);
  return user;
}

function playerField(player) {
  const discordId = links.discordIdForRoblox(player.id);
  return {
    name: 'Spieler',
    value: `[${player.name}](${profileUrl(player.id)}) (\`${player.id}\`)${discordId ? `\nDiscord: <@${discordId}>` : ''}`,
    inline: true,
  };
}

// Mod-Log dieses Discords; Aktionen eines Privatserver-Discords landen zur Kontrolle auch im Haupt-Discord.
async function logGame(interaction, title, fields, color = 'danger') {
  const scope = links.scopeOf(interaction.guildId);
  const entry = embed(color)
    .setTitle(`🎮 ${title}`)
    .addFields(...fields, { name: 'Von', value: `${interaction.user}`, inline: true }, { name: 'Bereich', value: scopeLabel(scope), inline: true });
  await sendTo(interaction.guild, 'modLog', { embeds: [entry] });
  if (scope.type !== 'private') return;
  for (const id of links.mainGuildIds()) {
    const guild = interaction.client.guilds.cache.get(id);
    if (guild) await sendTo(guild, 'modLog', { embeds: [EmbedBuilder.from(entry).setTitle(`🎮 ${title} · ${scope.name}`)] });
  }
}

const formatTime = (unix) => `<t:${unix}:f> (<t:${unix}:R>)`;

// Nach deferReply die (private) Antwort ersetzen, sonst normal privat antworten.
function respond(interaction, content) {
  const payload = typeof content === 'string' ? { content } : content;
  return interaction.deferred && !interaction.replied ? interaction.editReply(payload) : replyPrivate(interaction, payload);
}

const handlers = {
  async ansage(interaction, scope) {
    const text = interaction.options.getString('text');
    await cloud.publish('announce', target(scope), { text, by: sender(interaction) });
    await respond(interaction, `📢 Ansage gesendet an: **${scopeLabel(scope)}**`);
    await logGame(interaction, 'Ansage im Spiel', [{ name: 'Text', value: text }], 'primary');
  },

  async kick(interaction, scope) {
    const player = await resolvePlayer(interaction.options.getString('spieler'));
    const reason = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
    if (scope.type === 'private' && player.id === scope.ownerId) throw new cloud.RobloxError('Der Besitzer der Privatserver kann dort nicht gekickt werden.');
    await cloud.publish('kick', target(scope), { userId: player.id, reason, by: sender(interaction) });
    await respond(interaction, `👢 **${player.name}** wird gekickt, falls er gerade spielt (${scopeLabel(scope)}).`);
    await logGame(interaction, 'Kick im Spiel', [playerField(player), { name: 'Grund', value: reason }], 'warning');
  },

  async ban(interaction, scope) {
    const player = await resolvePlayer(interaction.options.getString('spieler'));
    const seconds = cloud.parseDuration(interaction.options.getString('dauer'));
    const reason = interaction.options.getString('grund');
    const note = interaction.options.getString('notiz') ?? '';
    const by = `${interaction.user.tag} (${interaction.user.id}) über Discord`;

    if (scope.type === 'main') {
      await cloud.banUser(player.id, {
        seconds,
        displayReason: reason,
        privateReason: [note, by].filter(Boolean).join(' · '),
        excludeAltAccounts: interaction.options.getBoolean('zweitaccounts') === false,
      });
    } else {
      if (player.id === scope.ownerId) throw new cloud.RobloxError('Der Besitzer der Privatserver kann dort nicht gebannt werden.');
      const expires = seconds ? Math.floor(Date.now() / 1000) + seconds : 0;
      await cloud.updatePrivateBans(scope.ownerId, (bans) => {
        bans[player.id] = { name: player.name, reason, note, expires, by };
      });
      await cloud.publish('ban', target(scope), { userId: player.id, reason, by: sender(interaction) });
    }

    await respond(interaction, `🔨 **${player.name}** ist gebannt (${cloud.formatDuration(seconds)}, ${scopeLabel(scope)}).`);
    await logGame(interaction, 'Bann im Spiel', [
      playerField(player),
      { name: 'Dauer', value: cloud.formatDuration(seconds), inline: true },
      { name: 'Grund', value: reason },
      ...(note ? [{ name: 'Notiz', value: note }] : []),
    ]);
  },

  async unban(interaction, scope) {
    const player = await resolvePlayer(interaction.options.getString('spieler'));
    if (scope.type === 'main') {
      await cloud.unbanUser(player.id);
    } else {
      let existed = false;
      await cloud.updatePrivateBans(scope.ownerId, (bans) => {
        existed = player.id in bans;
        delete bans[player.id];
      });
      if (!existed) return respond(interaction, `**${player.name}** ist in euren Privatservern nicht gebannt.`);
      await cloud.publish('refresh', target(scope));
    }
    await respond(interaction, `✅ Bann von **${player.name}** aufgehoben (${scopeLabel(scope)}).`);
    await logGame(interaction, 'Bann im Spiel aufgehoben', [playerField(player)], 'success');
  },

  async 'bann-pruefen'(interaction, scope) {
    const player = await resolvePlayer(interaction.options.getString('spieler'));
    const result = embed().setTitle(`🔎 ${player.name}`).setURL(profileUrl(player.id)).addFields(playerField(player));

    if (scope.type === 'main') {
      const ban = await cloud.getBan(player.id);
      if (!ban) result.setColor('#57F287').setDescription('Nicht im Spiel gebannt.');
      else {
        const seconds = ban.duration ? parseInt(ban.duration, 10) : null;
        result.setColor('#ED4245').setDescription('⛔ Im ganzen Spiel gebannt.').addFields(
          { name: 'Dauer', value: cloud.formatDuration(seconds), inline: true },
          ...(ban.startTime ? [{ name: 'Seit', value: formatTime(Math.floor(Date.parse(ban.startTime) / 1000)), inline: true }] : []),
          { name: 'Grund (für Spieler)', value: ban.displayReason || '—' },
          { name: 'Notiz (Team)', value: ban.privateReason || '—' },
        );
        if (ban.inherited) result.addFields({ name: 'Hinweis', value: 'Bann wurde von einem anderen Konto übernommen (vermuteter Zweitaccount).' });
      }
    } else {
      const ban = (await cloud.getPrivateBans(scope.ownerId))[player.id];
      if (!ban) result.setColor('#57F287').setDescription('In euren Privatservern nicht gebannt.');
      else {
        result.setColor('#ED4245').setDescription('⛔ In euren Privatservern gebannt.').addFields(
          { name: 'Bis', value: ban.expires ? formatTime(ban.expires) : 'dauerhaft', inline: true },
          { name: 'Grund', value: ban.reason || '—' },
          ...(ban.note ? [{ name: 'Notiz', value: ban.note }] : []),
          { name: 'Von', value: ban.by || '—' },
        );
      }
    }
    await respond(interaction, { embeds: [result] });
  },

  async banns(interaction, scope) {
    if (scope.type === 'main') {
      return respond(interaction, 'Alle Banns des ganzen Spiels findest du im Creator Hub unter **Moderation → Bans**. Einzelne Spieler prüfst du mit `/spiel bann-pruefen`.');
    }
    const bans = Object.entries(await cloud.getPrivateBans(scope.ownerId));
    const lines = bans.map(
      ([id, ban]) => `• [${ban.name ?? id}](${profileUrl(id)}) – ${truncate(ban.reason ?? '', 80)} · ${ban.expires ? `bis <t:${ban.expires}:d>` : 'dauerhaft'}`,
    );
    await respond(interaction, {
      embeds: [
        embed()
          .setTitle(`⛔ Banns – ${scope.name} (${bans.length})`)
          .setDescription(lines.length ? truncate(lines.join('\n'), 4000) : 'Niemand gebannt.'),
      ],
    });
  },

  async neustart(interaction, scope) {
    if (!interaction.options.getBoolean('bestaetigen')) return respond(interaction, 'Abgebrochen.');
    const reason = interaction.options.getString('grund') ?? 'Neustart';
    await cloud.publish('shutdown', target(scope), { reason, by: sender(interaction) });
    await respond(interaction, `♻️ Neustart gesendet an: **${scopeLabel(scope)}**. Alle Spieler werden rausgeworfen und können sofort wieder joinen.`);
    await logGame(interaction, 'Server-Neustart', [{ name: 'Grund', value: reason }], 'warning');
  },
};

const privateServerHandlers = {
  async verknuepfen(interaction) {
    const guildId = interaction.options.getString('discord_server_id').trim();
    const guild = interaction.client.guilds.cache.get(guildId);
    if (!guild) return respond(interaction, '❌ Der Bot ist nicht auf diesem Discord-Server. Lade ihn zuerst dort ein und prüfe die ID.');
    const owner = await resolvePlayer(interaction.options.getString('besitzer'));
    const name = interaction.options.getString('name').trim();
    try {
      links.linkPrivateServer(guildId, { ownerId: owner.id, ownerName: owner.name, name, linkedBy: interaction.user.id });
    } catch (err) {
      throw new cloud.RobloxError(err.message);
    }

    await respond(interaction, `✅ **${guild.name}** darf jetzt die Privatserver von **${owner.name}** verwalten („${name}“).`);
    await sendTo(guild, 'modLog', {
      embeds: [
        embed('success')
          .setTitle('🎮 Mit dem Spiel verknüpft')
          .setDescription(
            `Dieser Discord ist jetzt mit den Privatservern von **${owner.name}** verknüpft („${name}“).\n` +
              'Das Team kann dort mit `/spiel` Ansagen machen, kicken, bannen und neu starten.',
          ),
      ],
    });
    await logGame(interaction, 'Privatserver verknüpft', [
      { name: 'Discord', value: `${guild.name} (\`${guild.id}\`)` },
      { name: 'Besitzer', value: `[${owner.name}](${profileUrl(owner.id)})`, inline: true },
      { name: 'Name', value: name, inline: true },
    ], 'success');
  },

  async entfernen(interaction) {
    const guildId = interaction.options.getString('discord_server_id').trim();
    if (!links.unlinkPrivateServer(guildId)) return respond(interaction, 'Dieser Discord-Server ist mit keinem Privatserver verknüpft.');
    await respond(interaction, `✅ Verknüpfung von \`${guildId}\` entfernt.`);
    const guild = interaction.client.guilds.cache.get(guildId);
    if (guild) await sendTo(guild, 'modLog', { embeds: [embed('danger').setTitle('🎮 Verknüpfung mit dem Spiel entfernt')] });
  },

  async liste(interaction) {
    const lines = links.listPrivateServers().map((link) => {
      const guild = interaction.client.guilds.cache.get(link.guildId);
      return `• **${link.name}** – ${guild ? guild.name : 'Bot nicht mehr dort'} (\`${link.guildId}\`) · Besitzer [${link.ownerName}](${profileUrl(link.ownerId)})`;
    });
    await respond(interaction, {
      embeds: [embed().setTitle('🎮 Privatserver-Discords').setDescription(lines.length ? truncate(lines.join('\n'), 4000) : 'Noch keine verknüpft.')],
    });
  },
};

module.exports = {
  data: builder,
  resolvePlayer,

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      await interaction.deferReply();
      return interaction.editReply(await statusMessage(interaction.guildId));
    }

    if (!isStaff(interaction.member)) return replyPrivate(interaction, 'Das darf nur das Team (Staff-Rolle oder „Server verwalten“).');
    if (!cloud.isConfigured()) {
      return replyPrivate(interaction, 'Das Spiel ist noch nicht verbunden: In der `.env` fehlen `ROBLOX_UNIVERSE_ID` und `ROBLOX_API_KEY` (siehe docs/roblox.md).');
    }

    const scope = links.scopeOf(interaction.guildId);
    if (group === 'privatserver' && scope.type !== 'main') return replyPrivate(interaction, 'Privatserver verwaltet nur der Haupt-Discord.');
    if (scope.type === 'none') {
      return replyPrivate(
        interaction,
        'Dieser Discord ist mit keinem Teil des Spiels verknüpft. Das Team des Haupt-Discords kann ihn mit `/spiel privatserver verknuepfen` mit euren Privatservern verbinden.',
      );
    }

    // Roblox antwortet nicht immer innerhalb der 3 Sekunden, die Discord für eine Antwort lässt.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (group === 'privatserver') await privateServerHandlers[sub](interaction);
      else await handlers[sub](interaction, scope);
    } catch (err) {
      if (!(err instanceof cloud.RobloxError)) {
        console.error(`[/spiel ${sub}]`, err);
        return respond(interaction, '❌ Da ist etwas schiefgelaufen. Details stehen in der Konsole.');
      }
      await respond(interaction, `❌ ${err.message}`);
    }
  },
};
