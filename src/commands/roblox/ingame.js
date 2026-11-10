// /ingame – Aktionen im Spiel: Ansage, PM, Kick, Bann, Jail, Heal, Kill, Respawn, Wanted, Team, Neustart, freie Befehle.
// Alles läuft über den Befehls-Manager (src/lib/game/commands.js): Berechtigung, Prüfung, Rückfrage, Verlauf, Audit-Log.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const commands = require('../../lib/game/commands');
const permissions = require('../../lib/game/permissions');
const bans = require('../../lib/game/bans');
const outbox = require('../../lib/game/outbox');
const live = require('../../lib/game/live');
const links = require('../../lib/roblox/links');
const cloud = require('../../lib/roblox/openCloud');
const { profileUrl } = require('../../lib/applications/roblox');
const { embed, replyPrivate, truncate } = require('../../lib/util');

const player = (o, description = 'Spieler (Name, Anzeigename oder @verifizierte Person)') =>
  o.setName('spieler').setDescription(description).setRequired(true).setAutocomplete(true).setMaxLength(40);
const reason = (o, required = false) => o.setName('grund').setDescription('Grund').setRequired(required).setMaxLength(200);

const builder = new SlashCommandBuilder()
  .setName('ingame')
  .setDescription('Aktionen im Spiel (Team).')
  .addSubcommand((s) =>
    s.setName('ansage').setDescription('Banner-Ansage auf euren Servern (Admin).').addStringOption((o) => o.setName('text').setDescription('Text').setRequired(true).setMaxLength(400)),
  )
  .addSubcommand((s) =>
    s
      .setName('pm')
      .setDescription('Privatnachricht an einen Spieler.')
      .addStringOption((o) => player(o))
      .addStringOption((o) => o.setName('text').setDescription('Nachricht').setRequired(true).setMaxLength(300)),
  )
  .addSubcommand((s) => s.setName('kick').setDescription('Spieler kicken.').addStringOption((o) => player(o)).addStringOption((o) => reason(o)))
  .addSubcommand((s) =>
    s
      .setName('ban')
      .setDescription('Spieler bannen (Admin).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @verifizierte Person (auch offline)').setRequired(true).setMaxLength(40))
      .addStringOption((o) => o.setName('dauer').setDescription('z. B. 30m, 12h, 7d, 2w oder perm').setRequired(true).setMaxLength(10))
      .addStringOption((o) => reason(o, true))
      .addStringOption((o) => o.setName('notiz').setDescription('Nur fürs Team').setMaxLength(500))
      .addBooleanOption((o) => o.setName('zweitaccounts').setDescription('Roblox-Ban-API: auch Zweitaccounts (Standard: ja)')),
  )
  .addSubcommand((s) =>
    s
      .setName('unban')
      .setDescription('Bann aufheben (Admin).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @verifizierte Person').setRequired(true).setMaxLength(40)),
  )
  .addSubcommand((s) =>
    s
      .setName('bann-pruefen')
      .setDescription('Ist ein Spieler gebannt?')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @verifizierte Person').setRequired(true).setMaxLength(40)),
  )
  .addSubcommand((s) => s.setName('banns').setDescription('Alle Banns eures Bereichs.'))
  .addSubcommand((s) =>
    s
      .setName('jail')
      .setDescription('Spieler ins Gefängnis.')
      .addStringOption((o) => player(o))
      .addIntegerOption((o) => o.setName('minuten').setDescription('Dauer (0 = bis Unjail, Standard 10)').setMinValue(0).setMaxValue(1440))
      .addStringOption((o) => reason(o)),
  )
  .addSubcommand((s) => s.setName('unjail').setDescription('Spieler freilassen.').addStringOption((o) => player(o)))
  .addSubcommand((s) => s.setName('heal').setDescription('Spieler heilen.').addStringOption((o) => player(o)))
  .addSubcommand((s) => s.setName('kill').setDescription('Spieler töten.').addStringOption((o) => player(o)).addStringOption((o) => reason(o)))
  .addSubcommand((s) => s.setName('respawn').setDescription('Spieler neu spawnen.').addStringOption((o) => player(o)))
  .addSubcommand((s) =>
    s
      .setName('wanted')
      .setDescription('Fahndungsstufe setzen (0 = aufheben).')
      .addStringOption((o) => player(o))
      .addIntegerOption((o) => o.setName('sterne').setDescription('0–5').setRequired(true).setMinValue(0).setMaxValue(5))
      .addStringOption((o) => reason(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('team')
      .setDescription('Team eines Spielers setzen.')
      .addStringOption((o) => player(o))
      .addStringOption((o) => o.setName('team').setDescription('Team im Spiel').setRequired(true).setAutocomplete(true).setMaxLength(40)),
  )
  .addSubcommand((s) => s.setName('neustart').setDescription('Alle Spieler rauswerfen, z. B. nach einem Update (Admin).').addStringOption((o) => reason(o)))
  .addSubcommand((s) =>
    s
      .setName('befehl')
      .setDescription('Befehl als Text, z. B. „:jail Max 10 Raub“.')
      .addStringOption((o) => o.setName('text').setDescription(':ansage :pm :kick :jail :unjail :heal :kill :respawn :wanted :unwanted :team :neustart').setRequired(true).setMaxLength(400)),
  )
  .addSubcommand((s) =>
    s
      .setName('verlauf')
      .setDescription('Befehls-Historie.')
      .addStringOption((o) => o.setName('spieler').setDescription('Nur für diesen Spieler (Roblox-Name)').setMaxLength(40))
      .addStringOption((o) =>
        o
          .setName('befehl')
          .setDescription('Nur diesen Befehl')
          .addChoices(...[...Object.keys(commands.COMMANDS), 'ban', 'unban'].slice(0, 25).map((name) => ({ name, value: name }))),
      ),
  );

const scopeLabel = (scope) => (scope.type === 'main' ? 'ganzes Spiel' : `Privatserver „${scope.name}“`);

// ---------- Bann (Bot-Bannliste, global zusätzlich Roblox-Ban-API) ----------

async function ban(interaction, scope) {
  if (!permissions.can(interaction.member, 'admin')) return replyPrivate(interaction, permissions.deny('admin'));
  const o = interaction.options;
  let target;
  let seconds;
  try {
    target = await commands.resolveAnyPlayer(o.getString('spieler'));
    seconds = cloud.parseDuration(o.getString('dauer'));
  } catch (err) {
    return replyPrivate(interaction, `❌ ${err.message}`);
  }
  if (scope.type === 'private' && target.id === scope.ownerId) return replyPrivate(interaction, '❌ Der Besitzer der Privatserver kann dort nicht gebannt werden.');
  const reasonText = o.getString('grund').trim();
  const note = o.getString('notiz')?.trim() ?? '';
  const scopeKey = bans.scopeKeyOf(scope);

  return commands.confirmCustom(interaction, {
    level: 'admin',
    title: 'Bann bestätigen',
    description: `**${target.name}** (${scopeLabel(scope)}) für **${cloud.formatDuration(seconds)}** bannen?\nGrund: ${reasonText}`,
    perform: async (i) => {
      commands.rateLimit(i.guildId, i.user.id);
      const by = `${i.user.tag} (${i.user.id})`;
      const result = await bans.add(scopeKey, target, { seconds, reason: reasonText, note, by, excludeAltAccounts: o.getBoolean('zweitaccounts') === false });
      // Ist der Spieler online, sofort rauswerfen
      const online = live.findPlayers(scope, target.id)[0];
      if (online) outbox.enqueue(`job:${online.server.job}`, 'kick', { userId: target.id, reason: `Gebannt: ${reasonText}`, cmd: `ban-${Date.now()}` });
      const mirror = scopeKey !== 'global' ? '' : result.mirrored ? '\n🛡️ Auch über die Roblox-Ban-API gebannt (inkl. Zweitaccount-Erkennung).' : result.mirrorError ? `\n⚠️ Roblox-Ban-API: ${result.mirrorError}` : '';
      const text = `🔨 **${target.name}** ist gebannt (${cloud.formatDuration(seconds)}, ${scopeLabel(scope)}).${online ? ' Wurde vom Server geworfen.' : ''}${mirror}`;
      commands.addHistory(i.guildId, { id: `ban-${Date.now()}`, at: Date.now(), by: i.user.id, command: 'ban', target, details: truncate(reasonText, 200), status: 'ok', result: text });
      await commands.audit(i.guild, { by: i.user.id, label: 'Bann', target: { ...target, server: online ? live.serverLabel(online.server) : null }, data: { reason: reasonText }, result: text, ok: true });
      return { ok: true, embed: embed('danger').setTitle('🔨 Bann').setDescription(text) };
    },
  });
}

async function unban(interaction, scope) {
  if (!permissions.can(interaction.member, 'admin')) return replyPrivate(interaction, permissions.deny('admin'));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let target;
  try {
    target = await commands.resolveAnyPlayer(interaction.options.getString('spieler'));
    commands.rateLimit(interaction.guildId, interaction.user.id);
  } catch (err) {
    return interaction.editReply(`❌ ${err.message}`);
  }
  const { existed, mirrorError } = await bans.remove(bans.scopeKeyOf(scope), target.id);
  const text = existed
    ? `✅ Bann von **${target.name}** aufgehoben (${scopeLabel(scope)}).${mirrorError ? `\n⚠️ Roblox-Ban-API: ${mirrorError}` : ''}`
    : `**${target.name}** war in der Bannliste nicht gebannt.${mirrorError ? '' : scope.type === 'main' && cloud.isConfigured() ? ' Ein Roblox-Bann wurde vorsorglich aufgehoben.' : ''}`;
  commands.addHistory(interaction.guildId, { id: `unban-${Date.now()}`, at: Date.now(), by: interaction.user.id, command: 'unban', target, details: '', status: existed ? 'ok' : 'nicht gebannt', result: text });
  if (existed) await commands.audit(interaction.guild, { by: interaction.user.id, label: 'Bann aufgehoben', target, data: {}, result: text, ok: true });
  return interaction.editReply(text);
}

async function checkBan(interaction, scope) {
  if (!permissions.can(interaction.member, 'moderation')) return replyPrivate(interaction, permissions.deny('moderation'));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let target;
  try {
    target = await commands.resolveAnyPlayer(interaction.options.getString('spieler'));
  } catch (err) {
    return interaction.editReply(`❌ ${err.message}`);
  }
  const keys = scope.type === 'main' ? ['global'] : ['global', bans.scopeKeyOf(scope)];
  const found = keys.map((key) => [key, bans.get(key, target.id)]).filter(([, b]) => b);
  const result = embed(found.length ? 'danger' : 'success').setTitle(`🔎 ${target.name}`).setURL(profileUrl(target.id));
  if (!found.length) result.setDescription('Nicht gebannt.');
  for (const [key, b] of found) {
    result.addFields({
      name: key === 'global' ? '⛔ Im ganzen Spiel gebannt' : '⛔ In euren Privatservern gebannt',
      value: truncate(`Bis: ${b.expires ? `<t:${b.expires}:f>` : 'dauerhaft'}\nGrund: ${b.reason}${b.note ? `\nNotiz: ${b.note}` : ''}\nVon: ${b.by}`, 1024),
    });
  }
  if (scope.type === 'main' && cloud.isConfigured()) {
    const robloxBan = await cloud.getBan(target.id).catch(() => null);
    if (robloxBan) result.addFields({ name: '🛡️ Roblox-Ban-API', value: truncate(`Aktiv · ${robloxBan.displayReason || '—'}`, 1024) });
  }
  return interaction.editReply({ embeds: [result] });
}

async function listBans(interaction, scope) {
  if (!permissions.can(interaction.member, 'moderation')) return replyPrivate(interaction, permissions.deny('moderation'));
  const list = bans.list(bans.scopeKeyOf(scope)).sort((a, b) => b.at - a.at);
  const lines = list.map((b) => `• [${b.name ?? b.id}](${profileUrl(b.id)}) – ${truncate(b.reason, 70)} · ${b.expires ? `bis <t:${b.expires}:d>` : 'dauerhaft'}`);
  return replyPrivate(interaction, {
    embeds: [embed().setTitle(`⛔ Banns – ${scopeLabel(scope)} (${list.length})`).setDescription(lines.length ? truncate(lines.join('\n'), 4000) : 'Niemand gebannt.')],
  });
}

async function history(interaction) {
  if (!permissions.can(interaction.member, 'moderation')) return replyPrivate(interaction, permissions.deny('moderation'));
  const name = interaction.options.getString('spieler')?.toLowerCase();
  const command = interaction.options.getString('befehl');
  const entries = commands
    .findHistory(interaction.guildId, { command, limit: 200 })
    .filter((e) => !name || e.target?.name?.toLowerCase() === name)
    .slice(0, 15);
  const lines = entries.map(
    (e) => `<t:${Math.floor(e.at / 1000)}:R> **${e.command}**${e.target ? ` → ${e.target.name}` : ''} · ${e.status} · <@${e.by}>${e.details ? `\n  ${truncate(e.details, 90)}` : ''}`,
  );
  return replyPrivate(interaction, { embeds: [embed().setTitle(`📜 Befehls-Historie (${entries.length})`).setDescription(lines.join('\n') || 'Noch keine Befehle.')] });
}

module.exports = {
  data: builder,

  async execute(interaction) {
    const scope = links.scopeOf(interaction.guildId);
    if (scope.type === 'none') {
      return replyPrivate(interaction, 'Dieser Discord ist mit keinem Teil des Spiels verknüpft. Der Haupt-Discord verknüpft Privatserver mit `/spiel-admin privatserver verknuepfen`.');
    }
    const sub = interaction.options.getSubcommand();
    const o = interaction.options;
    switch (sub) {
      case 'ban':
        return ban(interaction, scope);
      case 'unban':
        return unban(interaction, scope);
      case 'bann-pruefen':
        return checkBan(interaction, scope);
      case 'banns':
        return listBans(interaction, scope);
      case 'verlauf':
        return history(interaction);
      case 'befehl': {
        if (!permissions.can(interaction.member, 'admin')) return replyPrivate(interaction, permissions.deny('admin'));
        let parsed;
        try {
          parsed = commands.parseFreeCommand(o.getString('text'));
        } catch (err) {
          return replyPrivate(interaction, `❌ ${err.message}`);
        }
        return commands.run(interaction, parsed.name, parsed.params);
      }
      case 'wanted':
        return commands.run(interaction, o.getInteger('sterne') === 0 ? 'unwanted' : 'wanted', { spieler: o.getString('spieler'), sterne: o.getInteger('sterne'), grund: o.getString('grund') });
      default:
        return commands.run(interaction, sub, {
          spieler: o.getString('spieler'),
          text: o.getString('text'),
          grund: o.getString('grund'),
          minuten: o.getInteger('minuten') ?? undefined,
          team: o.getString('team'),
        });
    }
  },

  // Vorschläge aus den Live-Daten: Spieler und Teams
  async autocomplete(interaction) {
    const scope = links.scopeOf(interaction.guildId);
    const focused = interaction.options.getFocused(true);
    const q = String(focused.value ?? '').toLowerCase();
    if (scope.type === 'none' || !permissions.can(interaction.member, 'view')) return interaction.respond([]);
    if (focused.name === 'team') {
      const teams = [...new Set(live.serversFor(scope).flatMap((s) => s.teams))].filter((t) => t.toLowerCase().includes(q));
      return interaction.respond(teams.slice(0, 25).map((t) => ({ name: t, value: t })));
    }
    const players = live
      .playersFor(scope)
      .filter(({ player }) => !q || player.name.toLowerCase().includes(q) || player.display.toLowerCase().includes(q))
      .slice(0, 25);
    return interaction.respond(players.map(({ player, server }) => ({ name: truncate(`${player.name} (${player.display}) · ${player.team ?? '—'} · ${live.serverLabel(server)}`, 100), value: player.name })));
  },

  components: {
    ingame: (interaction, args) => commands.handleConfirmButton(interaction, args),
  },
};
