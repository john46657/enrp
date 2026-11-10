// /spiel – Live-Daten aus dem eigenen Roblox-Spiel: Status, Server, Spieler, Fahrzeuge, Kennzeichen, Staff, Logs,
// Notrufe und Spielrechte (Privatserver). Aktionen im Spiel stehen unter /ingame, Verwaltung unter /spiel-admin.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const links = require('../../lib/roblox/links');
const rights = require('../../lib/roblox/rights');
const { statusMessage } = require('../../lib/roblox/status');
const { findRobloxUser, profileUrl } = require('../../lib/applications/roblox');
const live = require('../../lib/game/live');
const events = require('../../lib/game/events');
const permissions = require('../../lib/game/permissions');
const commands = require('../../lib/game/commands');
const cad = require('../../lib/game/cad');
const bolo = require('../../lib/game/bolo');
const bans = require('../../lib/game/bans');
const modcalls = require('../../lib/game/modcalls');
const { normalizePlate } = require('../../lib/game/protocol');
const { embed, replyPrivate, truncate } = require('../../lib/util');

const LOG_CHOICES = { alle: 'Alle', join: 'Beitritte & Verlassen', kill: 'Kills', command: 'Befehle', call: 'Notrufe', modcall: 'Mod-Calls', vehicle: 'Fahrzeuge', team: 'Teamwechsel' };

const builder = new SlashCommandBuilder()
  .setName('spiel')
  .setDescription('Live-Daten aus unserem Roblox-Spiel.')
  .addSubcommand((s) => s.setName('status').setDescription('Server, Spieler, Staff, Fahrzeuge, Notrufe und API-Status.'))
  .addSubcommand((s) =>
    s
      .setName('server')
      .setDescription('Laufende Server – oder Details zu einem Server.')
      .addStringOption((o) => o.setName('server').setDescription('Server aus der Liste').setAutocomplete(true).setMaxLength(64)),
  )
  .addSubcommand((s) =>
    s
      .setName('spieler')
      .setDescription('Live-Spielerliste.')
      .addStringOption((o) => o.setName('server').setDescription('Nur dieser Server').setAutocomplete(true).setMaxLength(64))
      .addStringOption((o) => o.setName('team').setDescription('Nur dieses Team').setAutocomplete(true).setMaxLength(40)),
  )
  .addSubcommand((s) =>
    s
      .setName('spieler-info')
      .setDescription('Alles zu einem Spieler: Status, Fahrzeuge, Logs, Notrufe, Banns.')
      .addStringOption((o) => o.setName('spieler').setDescription('Name, Anzeigename, ID oder @verifizierte Person').setRequired(true).setAutocomplete(true).setMaxLength(40)),
  )
  .addSubcommand((s) =>
    s
      .setName('fahrzeuge')
      .setDescription('Gespawnte Fahrzeuge.')
      .addStringOption((o) => o.setName('spieler').setDescription('Nur Fahrzeuge dieses Spielers').setAutocomplete(true).setMaxLength(40)),
  )
  .addSubcommand((s) =>
    s
      .setName('kennzeichen')
      .setDescription('Kennzeichen suchen (live, Verlauf und BOLO).')
      .addStringOption((o) => o.setName('kennzeichen').setDescription('Ganz oder teilweise').setRequired(true).setMaxLength(16)),
  )
  .addSubcommand((s) =>
    s
      .setName('staff')
      .setDescription('Staff online und Aktivität.')
      .addIntegerOption((o) => o.setName('tage').setDescription('Zeitraum für die Aktivität (Standard 7)').setMinValue(1).setMaxValue(60)),
  )
  .addSubcommand((s) =>
    s
      .setName('logs')
      .setDescription('Ereignisse aus dem Spiel durchsuchen.')
      .addStringOption((o) => o.setName('typ').setDescription('Art').addChoices(...Object.entries(LOG_CHOICES).map(([value, name]) => ({ name, value }))))
      .addStringOption((o) => o.setName('spieler').setDescription('Nur dieser Spieler (Name)').setMaxLength(40))
      .addStringOption((o) => o.setName('suche').setDescription('Text, z. B. Befehl oder Kennzeichen').setMaxLength(60))
      .addIntegerOption((o) => o.setName('anzahl').setDescription('Einträge (Standard 20)').setMinValue(1).setMaxValue(50)),
  )
  .addSubcommand((s) =>
    s
      .setName('notrufe')
      .setDescription('Notrufe aus dem Spiel.')
      .addStringOption((o) => o.setName('team').setDescription('Nur dieser Bereich, z. B. Polizei').setMaxLength(40))
      .addBooleanOption((o) => o.setName('alle').setDescription('Auch abgeschlossene')),
  )
  .addSubcommand((s) =>
    s
      .setName('rechte')
      .setDescription('Spielrechte in euren Privatservern (z. B. Polizei).')
      .addStringOption((o) => o.setName('spieler').setDescription('Roblox-Name oder @Person (nur Team; leer = du selbst)').setMaxLength(40)),
  )
  .addSubcommand((s) => s.setName('rechte-abgleichen').setDescription('Spielrechte aller Mitglieder mit ihren Rollen abgleichen (Admin).'));

const ts = (seconds, style = 'R') => `<t:${seconds}:${style}>`;
const flags = (p) => [p.staff && `🛡️ ${p.staff}`, p.wanted && `⭐${p.wanted}`, p.jailedUntil !== 0 && '🔒 Gefängnis', p.callsign && `📻 ${p.callsign}`].filter(Boolean).join(' · ');
const playerLine = (p) => `[${p.name}](${profileUrl(p.id)})${p.display && p.display !== p.name ? ` (${p.display})` : ''} · ${p.team ?? 'ohne Team'}${flags(p) ? ` · ${flags(p)}` : ''}`;
const noData = () => (live.status().lastContactAt ? 'Gerade ist kein Server online.' : 'Noch keine Live-Daten vom Spiel (siehe `/spiel-admin uebersicht`).');
const openIngameCalls = (guildId) => cad.list(guildId, { status: 'offen', source: 'ingame', limit: 1000 }).length;

// Lange Listen auf mehrere Embeds verteilen (max. 10 × ~4000 Zeichen)
function chunked(title, lines, color = 'primary') {
  const embeds = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > 3900 && current.length) {
      embeds.push(embed(color).setDescription(current.join('\n')));
      current = [];
      size = 0;
    }
    current.push(truncate(line, 1000));
    size += Math.min(line.length, 1000) + 1;
  }
  if (current.length) embeds.push(embed(color).setDescription(current.join('\n')));
  if (!embeds.length) embeds.push(embed(color).setDescription('—'));
  embeds[0].setTitle(title);
  return embeds.slice(0, 10);
}

const handlers = {
  async status(interaction) {
    await interaction.deferReply();
    return interaction.editReply(await statusMessage(interaction.guildId, { openCalls: openIngameCalls(interaction.guildId) }));
  },

  async server(interaction, scope) {
    const query = interaction.options.getString('server');
    if (!query) {
      const servers = live.serversFor(scope);
      const lines = servers.map(
        (s) =>
          `**${live.serverLabel(s)}** — ${s.players.length}/${s.maxPlayers} Spieler · ${s.players.filter((p) => p.staff).length} Staff · ${s.vehicles.length} 🚗` +
          `${s.startedAt ? ` · läuft seit ${ts(s.startedAt)}` : ''} · Version ${s.version} · Daten ${live.ageSeconds(s)} s alt`,
      );
      return replyPrivate(interaction, { embeds: chunked(`🖥️ Server (${servers.length})`, lines.length ? lines : [noData()]) });
    }
    const server = live.findServer(scope, query);
    if (!server) return replyPrivate(interaction, `Kein Server „${truncate(query, 30)}“. Liste: \`/spiel server\``);
    const byTeam = {};
    for (const p of server.players) (byTeam[p.team ?? 'ohne Team'] ??= []).push(p);
    const result = embed()
      .setTitle(`🖥️ ${live.serverLabel(server)}`)
      .setDescription(`JobId \`${server.job}\``)
      .addFields(
        { name: 'Spieler', value: `${server.players.length}/${server.maxPlayers}`, inline: true },
        { name: 'Staff', value: String(server.players.filter((p) => p.staff).length), inline: true },
        { name: 'Fahrzeuge', value: String(server.vehicles.length), inline: true },
        { name: 'Läuft seit', value: server.startedAt ? ts(server.startedAt) : '—', inline: true },
        { name: 'Spielversion', value: String(server.version), inline: true },
        { name: 'Daten', value: `vor ${live.ageSeconds(server)} s`, inline: true },
      );
    for (const [team, players] of Object.entries(byTeam).slice(0, 15)) {
      result.addFields({ name: `${team} (${players.length})`, value: truncate(players.map((p) => `${p.name}${flags(p) ? ` (${flags(p)})` : ''}`).join(', '), 1024) });
    }
    return replyPrivate(interaction, { embeds: [result] });
  },

  async spieler(interaction, scope) {
    const serverQuery = interaction.options.getString('server');
    const team = interaction.options.getString('team')?.toLowerCase();
    const servers = serverQuery ? [live.findServer(scope, serverQuery)].filter(Boolean) : live.serversFor(scope);
    if (serverQuery && !servers.length) return replyPrivate(interaction, `Kein Server „${truncate(serverQuery, 30)}“.`);
    const lines = [];
    let count = 0;
    for (const server of servers) {
      const players = server.players.filter((p) => !team || p.team?.toLowerCase() === team);
      if (!players.length) continue;
      lines.push(`__**${live.serverLabel(server)}** (${players.length})__`);
      for (const p of [...players].sort((a, b) => (a.team ?? '').localeCompare(b.team ?? '') || a.name.localeCompare(b.name))) lines.push(playerLine(p));
      count += players.length;
    }
    return replyPrivate(interaction, { embeds: chunked(`👥 Spieler online (${count})`, lines.length ? lines : [noData()]) });
  },

  async 'spieler-info'(interaction, scope) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const input = interaction.options.getString('spieler');
    let online = null;
    try {
      online = commands.resolveOnlinePlayer(scope, input);
    } catch {
      online = null;
    }
    let player = online?.player;
    if (!player) {
      const mention = input.match(/^<@!?(\d+)>$/);
      const account = mention ? links.getAccount(mention[1]) : null;
      const user = account ? { id: account.id, name: account.name } : /^[A-Za-z0-9_]{3,20}$/.test(input.trim()) ? await findRobloxUser(input.trim()).catch(() => null) : null;
      if (!user) return interaction.editReply(`Kein Spieler „${truncate(input, 40)}“ gefunden.`);
      player = { id: String(user.id), name: user.name, display: user.displayName ?? user.name };
    }
    const discordId = links.discordIdForRoblox(player.id);
    const result = embed(online ? 'success' : 'primary')
      .setTitle(`👤 ${player.name}${player.display && player.display !== player.name ? ` (${player.display})` : ''}`)
      .setURL(profileUrl(player.id))
      .addFields(
        { name: 'Roblox-ID', value: `\`${player.id}\``, inline: true },
        { name: 'Discord', value: discordId ? `<@${discordId}>` : 'nicht verknüpft', inline: true },
        {
          name: 'Status',
          value: online
            ? truncate(`🟢 online · ${live.serverLabel(online.server)}\nTeam: ${player.team ?? '—'}${flags(player) ? `\n${flags(player)}` : ''}${player.joinedAt ? `\nim Spiel seit ${ts(player.joinedAt)}` : ''}`, 1024)
            : '⚫ offline',
        },
      );
    const vehicles = live.findVehicles(scope, { ownerId: player.id });
    if (vehicles.length) result.addFields({ name: `Fahrzeuge (${vehicles.length})`, value: truncate(vehicles.map(({ vehicle: v }) => `🚗 ${v.model} [${v.plate ?? '—'}]${v.color ? ` · ${v.color}` : ''}`).join('\n'), 1024) });
    const history = events.historyFor(scope, { userId: player.id, limit: 8 });
    if (history.length) result.addFields({ name: 'Letzte Ereignisse', value: truncate(history.map((e) => events.logLine(e, { includeModcall: true })).filter(Boolean).join('\n'), 1024) });
    const calls = Object.values(cad.incidents(interaction.guildId))
      .filter((i) => i.ingame?.caller?.id === player.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
    if (calls.length) result.addFields({ name: 'Notrufe', value: truncate(calls.map(cad.lineOf).join('\n'), 1024) });
    if (permissions.can(interaction.member, 'moderation')) {
      const actions = commands.findHistory(interaction.guildId, { userId: player.id, limit: 5 });
      if (actions.length) result.addFields({ name: 'Aktionen aus Discord', value: truncate(actions.map((e) => `${ts(Math.floor(e.at / 1000))} ${e.command} · ${e.status} · <@${e.by}>`).join('\n'), 1024) });
      const banned = [...new Set(['global', bans.scopeKeyOf(scope)])].map((k) => bans.get(k, player.id)).filter(Boolean);
      if (banned.length) result.addFields({ name: '⛔ Gebannt', value: truncate(banned.map((b) => `${b.reason} · ${b.expires ? `bis ${ts(b.expires, 'd')}` : 'dauerhaft'}`).join('\n'), 1024) });
    }
    const wanted = bolo.list(interaction.guildId).filter((b) => b.type === 'person' && (b.robloxId === player.id || b.name?.toLowerCase() === player.name.toLowerCase()));
    if (wanted.length) result.addFields({ name: '📢 BOLO', value: truncate(wanted.map((b) => `**${b.id}** – ${truncate(b.reason, 100)}`).join('\n'), 1024) });
    return interaction.editReply({ embeds: [result] });
  },

  async fahrzeuge(interaction, scope) {
    const query = interaction.options.getString('spieler');
    let ownerId = null;
    if (query) {
      const match = live.findPlayers(scope, query)[0];
      if (!match) return replyPrivate(interaction, `„${truncate(query, 40)}“ ist gerade nicht online.`);
      ownerId = match.player.id;
    }
    const activePlates = new Set(bolo.list(interaction.guildId).filter((b) => b.plateKey).map((b) => b.plateKey));
    const list = live.findVehicles(scope, { ownerId });
    const lines = list.map(
      ({ vehicle: v, server }) =>
        `${activePlates.has(v.plateKey) ? '🚨 ' : ''}🚗 **${v.model}** [${v.plate ?? '—'}]${v.color ? ` · ${v.color}` : ''} · ${v.ownerName ?? 'ohne Besitzer'} · ${live.serverLabel(server)}`,
    );
    return replyPrivate(interaction, { embeds: chunked(`🚗 Fahrzeuge (${list.length})`, lines.length ? lines : [live.status().lastContactAt ? 'Keine Fahrzeuge.' : noData()]) });
  },

  async kennzeichen(interaction, scope) {
    const plate = interaction.options.getString('kennzeichen');
    const key = normalizePlate(plate);
    if (key.length < 2) return replyPrivate(interaction, 'Bitte mindestens 2 Zeichen.');
    const found = live.findVehicles(scope, { plate });
    const lines = found.map(
      ({ vehicle: v, server }) =>
        `🟢 **${v.plate}** · ${v.model}${v.color ? ` · ${v.color}` : ''} · Besitzer: ${v.ownerId ? `[${v.ownerName ?? v.ownerId}](${profileUrl(v.ownerId)})` : '—'} · ${live.serverLabel(server)}`,
    );
    const hits = bolo.search(interaction.guildId, plate).filter((b) => b.plateKey?.includes(key));
    const past = events.historyFor(scope, { types: ['vehicle'], limit: 500 }).filter((e) => e.vehicle?.plateKey?.includes(key)).slice(0, 10);
    const result = embed(hits.some((b) => b.status === 'aktiv') ? 'danger' : 'primary')
      .setTitle(`🔎 Kennzeichen „${truncate(plate.toUpperCase(), 16)}“`)
      .addFields(
        { name: `Jetzt im Spiel (${found.length})`, value: truncate(lines.join('\n') || 'Kein passendes Fahrzeug gespawnt.', 1024) },
        { name: 'BOLO', value: truncate(hits.map((b) => `${bolo.STATUS[b.status]} **${b.id}** – ${b.reason}`).join('\n') || 'Kein BOLO.', 1024) },
        { name: 'Verlauf', value: truncate(past.map((e) => events.logLine(e)).join('\n') || 'Keine Einträge.', 1024) },
      );
    return replyPrivate(interaction, { embeds: [result] });
  },

  async staff(interaction, scope) {
    const days = interaction.options.getInteger('tage') ?? 7;
    const sinceSeconds = Date.now() / 1000 - days * 86_400;
    const sinceMs = Date.now() - days * 86_400_000;
    const online = live.staffFor(scope).map(({ player, server }) => `🛡️ **${player.name}** · ${player.staff} · ${player.team ?? '—'} · ${live.serverLabel(server)}`);
    // Spielzeit aus „Verlassen“-Ereignissen von Staff
    const playtime = {};
    for (const e of events.historyFor(scope, { types: ['leave'], limit: 3000 })) {
      if (!e.staff || e.at < sinceSeconds) continue;
      const entry = (playtime[e.userId] ??= { name: e.name, rank: e.staff, seconds: 0, sessions: 0 });
      entry.seconds += e.duration ?? 0;
      entry.sessions++;
    }
    const top = Object.values(playtime).sort((a, b) => b.seconds - a.seconds).slice(0, 10);
    const taken = modcalls.takenCounts(interaction.guildId, sinceMs);
    const actions = {};
    for (const e of commands.findHistory(interaction.guildId, { limit: 500 })) if (e.at >= sinceMs) actions[e.by] = (actions[e.by] ?? 0) + 1;
    const score = (id) => (taken[id] ?? 0) + (actions[id] ?? 0);
    const discordIds = [...new Set([...Object.keys(taken), ...Object.keys(actions)])].sort((a, b) => score(b) - score(a)).slice(0, 10);
    const result = embed()
      .setTitle(`🛡️ Staff · letzte ${days} Tage`)
      .addFields(
        { name: `Jetzt online (${online.length})`, value: truncate(online.join('\n') || 'Niemand.', 1024) },
        { name: 'Spielzeit im Spiel', value: truncate(top.map((s) => `**${s.name}** (${s.rank}) · ${(s.seconds / 3600).toFixed(1)} Std. in ${s.sessions} Sitzung(en)`).join('\n') || 'Keine Daten.', 1024) },
        { name: 'Discord-Aktivität', value: truncate(discordIds.map((id) => `<@${id}> · ${taken[id] ?? 0} Mod-Calls · ${actions[id] ?? 0} Befehle`).join('\n') || 'Keine Daten.', 1024) },
      );
    return replyPrivate(interaction, { embeds: [result] });
  },

  async logs(interaction, scope) {
    const type = interaction.options.getString('typ') ?? 'alle';
    const name = interaction.options.getString('spieler');
    const limit = interaction.options.getInteger('anzahl') ?? 20;
    const types = type === 'alle' ? null : type === 'join' ? ['join', 'leave'] : [type];
    let userId = null;
    if (name) {
      const match = live.findPlayers(scope, name)[0] ?? null;
      const user = match ? { id: match.player.id } : /^[A-Za-z0-9_]{3,20}$/.test(name) ? await findRobloxUser(name).catch(() => null) : null;
      if (!user) return replyPrivate(interaction, `Spieler „${truncate(name, 40)}“ nicht gefunden.`);
      userId = String(user.id);
    }
    const list = events.historyFor(scope, { types, userId, query: interaction.options.getString('suche'), limit });
    const lines = list.map((e) => `${events.logLine(e, { includeModcall: true })} · ${ts(e.at, 'd')}`);
    return replyPrivate(interaction, { embeds: chunked(`📜 Logs · ${LOG_CHOICES[type]} (${list.length})`, lines.length ? lines : ['Keine Einträge.']) });
  },

  async notrufe(interaction) {
    const team = interaction.options.getString('team');
    const list = cad.list(interaction.guildId, { status: interaction.options.getBoolean('alle') ? 'alle' : 'offen', source: 'ingame', team, limit: 25 });
    return replyPrivate(interaction, { embeds: chunked(`🚨 Notrufe aus dem Spiel (${list.length})`, list.length ? list.map(cad.lineOf) : ['Keine Notrufe.']) });
  },

  async rechte(interaction, scope) {
    if (scope.type !== 'private') {
      return replyPrivate(interaction, 'Spielrechte gibt es nur für Privatserver. Jeder Privatserver-Discord stellt sie mit `/einstellungen spielrecht` ein.');
    }
    const input = interaction.options.getString('spieler');
    if (input && !permissions.can(interaction.member, 'moderation')) return replyPrivate(interaction, 'Die Rechte anderer sieht nur das Team.');
    let player;
    try {
      player = input ? await commands.resolveAnyPlayer(input) : rights.accountFor(interaction.guildId, interaction.user.id);
    } catch (err) {
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
    if (!player) return replyPrivate(interaction, 'Du hast noch kein Roblox-Konto verknüpft. Nutze `/verifizieren start`.');
    const current = rights.getRights(scope.ownerId, player.id);
    const names = Object.fromEntries(rights.availableRights(interaction.guildId).map((r) => [r.id, r.name]));
    const howTo = Object.entries(rights.rightRoles(interaction.guildId)).map(([right, roleId]) => `${names[right] ?? right}: <@&${roleId}>`);
    return replyPrivate(interaction, {
      embeds: [
        embed(current.length ? 'success' : 'primary')
          .setTitle(`🔑 Spielrechte – ${player.name}`)
          .setURL(profileUrl(player.id))
          .setDescription(`In den Privatservern **${scope.name}**:\n` + (current.length ? current.map((r) => `✅ ${names[r] ?? r}`).join('\n') : 'Keine besonderen Rechte.'))
          .addFields({ name: 'Welche Rolle gibt welches Recht?', value: howTo.join('\n') || 'Noch nicht eingestellt (`/einstellungen spielrecht`).' }),
      ],
    });
  },

  async 'rechte-abgleichen'(interaction, scope) {
    if (scope.type !== 'private') return replyPrivate(interaction, 'Spielrechte gibt es nur für Privatserver-Discords.');
    if (!permissions.can(interaction.member, 'admin')) return replyPrivate(interaction, permissions.deny('admin'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const count = await rights.syncGuild(interaction.guild, { log: true });
    return interaction.editReply(`🔄 ${count} Person(en) abgeglichen. Änderungen stehen im Mod-Log.`);
  },
};

module.exports = {
  data: builder,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const scope = links.scopeOf(interaction.guildId);
    if (sub === 'status') return handlers.status(interaction, scope);
    if (scope.type === 'none') {
      return replyPrivate(interaction, 'Dieser Discord ist mit keinem Teil des Spiels verknüpft. Hier gibt es nur `/spiel status`.');
    }
    if (sub !== 'rechte' && !permissions.can(interaction.member, 'view')) return replyPrivate(interaction, permissions.deny('view'));
    return handlers[sub](interaction, scope);
  },

  async autocomplete(interaction) {
    const scope = links.scopeOf(interaction.guildId);
    if (scope.type === 'none' || !permissions.can(interaction.member, 'view')) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    const q = String(focused.value ?? '').toLowerCase();
    if (focused.name === 'server') {
      return interaction.respond(
        live
          .serversFor(scope)
          .filter((s) => !q || live.serverLabel(s).toLowerCase().includes(q))
          .slice(0, 25)
          .map((s) => ({ name: truncate(`${live.serverLabel(s)} — ${s.players.length}/${s.maxPlayers}`, 100), value: s.job.slice(0, 64) })),
      );
    }
    if (focused.name === 'team') {
      const teams = [...new Set(live.serversFor(scope).flatMap((s) => s.teams))].filter((t) => t.toLowerCase().includes(q));
      return interaction.respond(teams.slice(0, 25).map((t) => ({ name: t, value: t })));
    }
    const players = live.playersFor(scope).filter(({ player }) => !q || player.name.toLowerCase().includes(q) || player.display.toLowerCase().includes(q));
    return interaction.respond(players.slice(0, 25).map(({ player, server }) => ({ name: truncate(`${player.name} (${player.display}) · ${live.serverLabel(server)}`, 100), value: player.name })));
  },
};
