// Ingame-Befehls-Manager: führt Befehle aus Discord im Spiel aus.
// Ablauf: Bereich prüfen → Berechtigung → Rate-Limit → Eingaben prüfen → (kritisch: Rückfrage) → an das Spiel senden
//         → auf Bestätigung („ack“) warten → Ergebnis anzeigen → Verlauf + Audit-Log.
const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../db');
const cloud = require('../roblox/openCloud');
const auth = require('../web/auth');
const links = require('../roblox/links');
const { forGuild } = require('../settings');
const { embed, sendTo, getChannel, truncate, replyPrivate } = require('../util');
const { findRobloxUser, profileUrl } = require('../applications/roblox');
const permissions = require('./permissions');
const live = require('./live');
const events = require('./events');
const outbox = require('./outbox');

// Alle Befehle, die das Spiel-Skript versteht. player: braucht einen Spieler, der gerade online ist.
const COMMANDS = {
  ansage: { label: 'Ansage', action: 'announce', level: 'admin', broadcast: true, aliases: ['h', 'm', 'announce'] },
  pm: { label: 'Privatnachricht', action: 'pm', level: 'moderation', player: true, aliases: ['pm'] },
  kick: { label: 'Kick', action: 'kick', level: 'moderation', player: true, critical: true, aliases: ['kick'] },
  jail: { label: 'Jail', action: 'jail', level: 'moderation', player: true, aliases: ['jail'] },
  unjail: { label: 'Unjail', action: 'unjail', level: 'moderation', player: true, aliases: ['unjail'] },
  heal: { label: 'Heilen', action: 'heal', level: 'moderation', player: true, aliases: ['heal'] },
  kill: { label: 'Töten', action: 'kill', level: 'moderation', player: true, critical: true, aliases: ['kill'] },
  respawn: { label: 'Respawn', action: 'respawn', level: 'moderation', player: true, aliases: ['respawn', 're', 'load'] },
  wanted: { label: 'Wanted', action: 'wanted', level: 'moderation', player: true, aliases: ['wanted'] },
  unwanted: { label: 'Wanted aufheben', action: 'wanted', level: 'moderation', player: true, aliases: ['unwanted'] },
  team: { label: 'Team setzen', action: 'team', level: 'moderation', player: true, aliases: ['team'] },
  neustart: { label: 'Server-Neustart', action: 'shutdown', level: 'admin', broadcast: true, critical: true, aliases: ['shutdown', 'restart'] },
};

const RATE = { perUser: 6, perGuild: 25, windowMs: 60_000 };
const ACK_TIMEOUT_MS = 12_000;
const BROADCAST_WAIT_MS = 6000;
const CONFIRM_MS = 60_000;
const HISTORY_LIMIT = 500;

class CommandError extends Error {}

// ---------- Rate-Limits (Schutz vor Spam) ----------

const usage = new Map(); // Schlüssel → Zeitstempel
function rateLimit(guildId, userId) {
  const now = Date.now();
  for (const [key, limit] of [[`u:${guildId}:${userId}`, RATE.perUser], [`g:${guildId}`, RATE.perGuild]]) {
    const list = (usage.get(key) ?? []).filter((at) => now - at < RATE.windowMs);
    if (list.length >= limit) {
      const wait = Math.ceil((RATE.windowMs - (now - list[0])) / 1000);
      throw new CommandError(`⏳ Zu viele Befehle. Bitte warte ${wait} Sekunden.`);
    }
    usage.set(key, list);
  }
  for (const key of [`u:${guildId}:${userId}`, `g:${guildId}`]) usage.get(key).push(now);
}

// ---------- Verlauf ----------

const historyOf = (guildId) => {
  const bucket = db.bucket('gameCommands', guildId);
  return (bucket.list ??= []);
};

function addHistory(guildId, entry) {
  const list = historyOf(guildId);
  list.push(entry);
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
  db.save();
  return entry;
}

function findHistory(guildId, { userId = null, command = null, limit = 15 } = {}) {
  return historyOf(guildId)
    .filter((e) => (!userId || e.target?.id === userId) && (!command || e.command === command))
    .slice(-limit)
    .reverse();
}

// ---------- Bestätigungen aus dem Spiel ----------

const pending = new Map(); // Befehls-ID → { acks, resolve, mode }

events.on('ack', (event) => {
  const entry = pending.get(event.commandId);
  if (!entry) return;
  entry.acks.push({ ok: event.ok, message: event.message, job: event.job });
  if (entry.mode === 'first') entry.resolve();
});

function waitForAcks(commandId, mode) {
  return new Promise((resolve) => {
    const entry = { acks: [], mode, resolve: () => {} };
    const timer = setTimeout(() => done(), mode === 'first' ? ACK_TIMEOUT_MS : BROADCAST_WAIT_MS);
    const done = () => {
      clearTimeout(timer);
      pending.delete(commandId);
      resolve(entry.acks);
    };
    entry.resolve = done;
    pending.set(commandId, entry);
  });
}

// ---------- Eingaben ----------

const scopeTarget = (scope) => (scope.type === 'main' ? 'all' : `owner:${scope.ownerId}`);

// Online-Spieler aus den Live-Daten (Name, Anzeigename, ID oder verifizierte @Erwähnung)
function resolveOnlinePlayer(scope, input) {
  const text = String(input ?? '').trim();
  const mention = text.match(/^<@!?(\d+)>$/);
  let query = text;
  if (mention) {
    const account = links.getAccount(mention[1]);
    if (!account) throw new CommandError('Diese Person hat ihr Roblox-Konto nicht verknüpft (`/verifizieren`).');
    query = account.id;
  }
  if (!query || query.length > 40) throw new CommandError('Bitte gib einen Spieler an.');
  const matches = live.findPlayers(scope, query);
  if (!matches.length) {
    const st = live.status();
    throw new CommandError(
      st.lastOkAt ? `„${truncate(text, 40)}“ ist gerade auf keinem eurer Server online.` : 'Keine Live-Daten vom Spiel. Läuft das Spiel-Skript (siehe /spiel-admin uebersicht)?',
    );
  }
  if (matches.length > 1) {
    const names = matches.slice(0, 5).map(({ player }) => `${player.name} (${player.display})`).join(', ');
    throw new CommandError(`Mehrere Treffer: ${names}. Bitte genauer.`);
  }
  return matches[0];
}

// Roblox-Konto (auch offline) für Bann/Unbann
async function resolveAnyPlayer(input) {
  const text = String(input ?? '').trim().replace(/^@/, '');
  const mention = text.match(/^<@!?(\d+)>$/);
  if (mention) {
    const account = links.getAccount(mention[1]);
    if (!account) throw new CommandError('Diese Person hat ihr Roblox-Konto nicht verknüpft (`/verifizieren`).');
    return { id: account.id, name: account.name };
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(text)) throw new CommandError(`„${truncate(text, 40)}“ ist kein gültiger Roblox-Name.`);
  const user = await findRobloxUser(text).catch(() => {
    throw new CommandError('Roblox ist gerade nicht erreichbar.');
  });
  if (!user) throw new CommandError(`Es gibt kein Roblox-Konto „${text}“.`);
  return { id: user.id, name: user.name };
}

const cleanText = (text, max, label) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) throw new CommandError(`${label} fehlt.`);
  if (value.length > max) throw new CommandError(`${label} ist zu lang (max. ${max} Zeichen).`);
  return value;
};

// Prüft die Parameter eines Befehls und baut die Nachricht ans Spiel. params: { spieler, text, grund, minuten, sterne, team }
function prepare(scope, name, params) {
  const def = COMMANDS[name];
  if (!def) throw new CommandError(`Unbekannter Befehl „${name}“.`);
  const data = {};
  let target = null;
  if (def.player) {
    const found = resolveOnlinePlayer(scope, params.spieler);
    target = { id: found.player.id, name: found.player.name, server: live.serverLabel(found.server), job: found.server.job, teams: found.server.teams };
    if (scope.type === 'private' && target.id === scope.ownerId && ['kick', 'kill', 'jail', 'wanted', 'team'].includes(name)) {
      throw new CommandError('Der Besitzer der Privatserver ist dort geschützt.');
    }
    data.userId = target.id;
  }
  switch (name) {
    case 'ansage':
      data.text = cleanText(params.text, 400, 'Der Text');
      break;
    case 'pm':
      data.text = cleanText(params.text, 300, 'Die Nachricht');
      break;
    case 'kick':
    case 'kill':
    case 'neustart':
      data.reason = params.grund ? cleanText(params.grund, 200, 'Der Grund') : name === 'neustart' ? 'Neustart' : 'Kein Grund angegeben';
      break;
    case 'jail': {
      const minutes = Number(params.minuten ?? 10);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new CommandError('Minuten: 0–1440 (0 = bis Unjail).');
      data.minutes = minutes;
      data.reason = params.grund ? cleanText(params.grund, 200, 'Der Grund') : 'Kein Grund angegeben';
      break;
    }
    case 'wanted': {
      const stars = Number(params.sterne ?? 1);
      if (!Number.isInteger(stars) || stars < 0 || stars > 5) throw new CommandError('Sterne: 0–5.');
      data.stars = stars;
      data.reason = params.grund ? cleanText(params.grund, 200, 'Der Grund') : '';
      break;
    }
    case 'unwanted':
      data.stars = 0;
      data.reason = '';
      break;
    case 'team': {
      const team = cleanText(params.team, 40, 'Das Team');
      if (target.teams.length && !target.teams.some((t) => t.toLowerCase() === team.toLowerCase())) {
        throw new CommandError(`Team „${team}“ gibt es nicht. Vorhanden: ${target.teams.join(', ')}`);
      }
      data.team = target.teams.find((t) => t.toLowerCase() === team.toLowerCase()) ?? team;
      break;
    }
    default:
      break;
  }
  return { def, data, target };
}

// „:jail Name 10 Grund“ → { name, params }
function parseFreeCommand(text) {
  const parts = String(text ?? '').trim().replace(/^[:;/]/, '').split(/\s+/);
  const alias = (parts.shift() ?? '').toLowerCase();
  const name = Object.keys(COMMANDS).find((key) => key === alias || COMMANDS[key].aliases.includes(alias));
  if (!name) throw new CommandError(`Unbekannter Befehl „${truncate(alias, 20)}“. Erlaubt: ${Object.keys(COMMANDS).join(', ')}`);
  const def = COMMANDS[name];
  const params = {};
  if (def.player) params.spieler = parts.shift();
  switch (name) {
    case 'ansage':
    case 'pm':
      params.text = parts.join(' ');
      break;
    case 'jail':
      if (/^\d+$/.test(parts[0] ?? '')) params.minuten = Number(parts.shift());
      params.grund = parts.join(' ') || undefined;
      break;
    case 'wanted':
      if (/^\d+$/.test(parts[0] ?? '')) params.sterne = Number(parts.shift());
      params.grund = parts.join(' ') || undefined;
      break;
    case 'team':
      params.team = parts.join(' ');
      break;
    default:
      params.grund = parts.join(' ') || undefined;
  }
  return { name, params };
}

// ---------- Audit-Log ----------

async function audit(guild, { by, label, target, data, result, ok }) {
  const scope = links.scopeOf(guild.id);
  const fields = [
    ...(target ? [{ name: 'Spieler', value: `[${target.name}](${profileUrl(target.id)}) (\`${target.id}\`)${target.server ? `\n${target.server}` : ''}`, inline: true }] : []),
    { name: 'Von', value: `<@${by}>`, inline: true },
    { name: 'Ergebnis', value: truncate(result, 1024) },
  ];
  const details = [data.text, data.reason, data.minutes !== undefined ? `${data.minutes} Min.` : null, data.stars !== undefined ? `${data.stars} ★` : null, data.team]
    .filter((x) => x !== undefined && x !== null && x !== '')
    .join(' · ');
  if (details) fields.splice(1, 0, { name: 'Details', value: truncate(details, 1024) });
  const entry = embed(ok ? 'success' : 'danger').setTitle(`🎮 ${label}`).addFields(fields);
  await sendTo(guild, 'modLog', { embeds: [entry] });
  const channelId = forGuild(guild.id).game.logs.actions;
  if (channelId) {
    const channel = await getChannel(guild, channelId);
    await channel?.send({ embeds: [entry] }).catch(() => {});
  }
  // Privatserver-Aktionen zur Kontrolle auch im Haupt-Discord
  if (scope.type === 'private') {
    for (const id of links.mainGuildIds()) {
      const main = guild.client.guilds.cache.get(id);
      if (main) await sendTo(main, 'modLog', { embeds: [embed(ok ? 'success' : 'danger').setTitle(`🎮 ${label} · ${scope.name}`).addFields(fields)] });
    }
  }
}

// ---------- Ausführen ----------

async function execute(guild, userId, scope, name, prepared) {
  const { def, data, target } = prepared;
  const commandId = crypto.randomUUID();
  const entry = addHistory(guild.id, {
    id: commandId,
    at: Date.now(),
    by: userId,
    command: name,
    target: target ? { id: target.id, name: target.name } : null,
    details: truncate([data.text, data.reason, data.minutes, data.stars, data.team].filter((x) => x !== undefined && x !== '').join(' · '), 200),
    status: 'gesendet',
  });

  const acksPromise = waitForAcks(commandId, def.broadcast ? 'collect' : 'first');
  try {
    // Spieler-Befehle gehen direkt an den Server, auf dem der Spieler gerade ist
    outbox.enqueue(target?.job ? `job:${target.job}` : scopeTarget(scope), def.action, { ...data, cmd: commandId });
  } catch (err) {
    pending.get(commandId)?.resolve();
    entry.status = 'fehler';
    entry.result = err.message;
    db.save();
    await audit(guild, { by: userId, label: def.label, target, data, result: `❌ ${err.message}`, ok: false });
    return { ok: false, text: `❌ ${err.message}` };
  }

  const acks = await acksPromise;
  let ok;
  let text;
  if (def.broadcast) {
    ok = acks.some((a) => a.ok);
    text = acks.length ? `✅ Von ${acks.filter((a) => a.ok).length} Server(n) bestätigt.` : '⚠️ Gesendet, aber kein Server hat bestätigt (keine Server online oder altes Spiel-Skript).';
  } else {
    const ack = acks.find((a) => a.ok) ?? acks[0];
    ok = Boolean(ack?.ok);
    text = ack ? `${ack.ok ? '✅' : '❌'} ${ack.message || (ack.ok ? 'Ausgeführt.' : 'Fehlgeschlagen.')}` : '⚠️ Keine Bestätigung vom Spiel (Spieler inzwischen offline oder Spiel-Skript veraltet).';
  }
  entry.status = acks.length ? (ok ? 'ok' : 'fehlgeschlagen') : 'keine Bestätigung';
  entry.result = text;
  db.save();
  await audit(guild, { by: userId, label: def.label, target, data, result: text, ok });
  return { ok, text };
}

function resultEmbed(def, target, result) {
  return embed(result.ok ? 'success' : 'warning')
    .setTitle(`🎮 ${def.label}`)
    .setDescription(`${target ? `**${target.name}** · ${target.server}\n` : ''}${result.text}`);
}

// ---------- Rückfrage bei kritischen Befehlen ----------

const confirmations = new Map(); // ID → { userId, guildId, name, prepared, expires }

async function run(interaction, name, params) {
  const scope = links.scopeOf(interaction.guildId);
  try {
    if (scope.type === 'none') throw new CommandError('Dieser Discord ist mit keinem Teil des Spiels verknüpft.');
    if (!auth.bridgeSecret()) throw new CommandError('Die Spiel-Verbindung ist nicht eingerichtet (siehe `/spiel-admin uebersicht`).');
    const def = COMMANDS[name];
    if (!def) throw new CommandError(`Unbekannter Befehl „${name}“.`);
    if (!permissions.can(interaction.member, def.level)) throw new CommandError(permissions.deny(def.level));
    const prepared = prepare(scope, name, params);

    if (def.critical) {
      const id = crypto.randomUUID().slice(0, 12);
      confirmations.set(id, { userId: interaction.user.id, guildId: interaction.guildId, name, prepared, expires: Date.now() + CONFIRM_MS });
      const what = prepared.target ? `**${def.label}** für **${prepared.target.name}** (${prepared.target.server})` : `**${def.label}** auf allen eurer Server`;
      return replyPrivate(interaction, {
        embeds: [embed('warning').setTitle('⚠️ Bitte bestätigen').setDescription(`${what}\n${prepared.data.reason ? `Grund: ${prepared.data.reason}\n` : ''}Gilt 60 Sekunden.`)],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ingame:confirm:${id}`).setLabel('Ausführen').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ingame:cancel:${id}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
    }

    rateLimit(interaction.guildId, interaction.user.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await execute(interaction.guild, interaction.user.id, scope, name, prepared);
    return interaction.editReply({ embeds: [resultEmbed(def, prepared.target, result)] });
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
    if (interaction.deferred) return interaction.editReply({ content: err.message, embeds: [] });
    return replyPrivate(interaction, err.message);
  }
}

// Rückfrage für Aktionen außerhalb der Befehlsliste (z. B. Bann über die Roblox-Ban-API).
// perform(interaction) muss { ok, text, embed? } liefern.
function confirmCustom(interaction, { level, title, description, perform }) {
  const id = crypto.randomUUID().slice(0, 12);
  confirmations.set(id, { userId: interaction.user.id, guildId: interaction.guildId, level, perform, expires: Date.now() + CONFIRM_MS });
  return replyPrivate(interaction, {
    embeds: [embed('warning').setTitle(`⚠️ ${title}`).setDescription(`${description}\nGilt 60 Sekunden.`)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ingame:confirm:${id}`).setLabel('Ausführen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ingame:cancel:${id}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleConfirmButton(interaction, [action, id]) {
  const entry = confirmations.get(id);
  if (!entry || entry.expires < Date.now()) {
    confirmations.delete(id);
    return interaction.update({ content: '⌛ Abgelaufen. Bitte den Befehl neu ausführen.', embeds: [], components: [] });
  }
  if (entry.userId !== interaction.user.id) return replyPrivate(interaction, 'Das darf nur die Person bestätigen, die den Befehl gestartet hat.');
  confirmations.delete(id);
  if (action === 'cancel') return interaction.update({ content: 'Abgebrochen.', embeds: [], components: [] });

  if (entry.perform) {
    if (!permissions.can(interaction.member, entry.level)) return interaction.update({ content: permissions.deny(entry.level), embeds: [], components: [] });
    await interaction.update({ content: '⏳ Wird ausgeführt …', embeds: [], components: [] });
    try {
      const result = await entry.perform(interaction);
      return interaction.editReply({ content: result.embed ? '' : result.text, embeds: result.embed ? [result.embed] : [] });
    } catch (err) {
      if (!(err instanceof CommandError) && !(err instanceof cloud.RobloxError)) throw err;
      return interaction.editReply({ content: `❌ ${err.message}`, embeds: [] });
    }
  }

  const def = COMMANDS[entry.name];
  // Berechtigung und Bereich erneut prüfen – könnten sich in der Zwischenzeit geändert haben
  if (!permissions.can(interaction.member, def.level)) return interaction.update({ content: permissions.deny(def.level), embeds: [], components: [] });
  const scope = links.scopeOf(interaction.guildId);
  try {
    rateLimit(interaction.guildId, interaction.user.id);
  } catch (err) {
    return interaction.update({ content: err.message, embeds: [], components: [] });
  }
  await interaction.update({ content: '⏳ Wird ausgeführt …', embeds: [], components: [] });
  const result = await execute(interaction.guild, interaction.user.id, scope, entry.name, entry.prepared);
  return interaction.editReply({ content: '', embeds: [resultEmbed(def, entry.prepared.target, result)] });
}

// Für andere Module (z. B. CAD: „Einheit unterwegs“ an den Anrufer) – ohne Rückfrage, ohne Warten.
async function notifyPlayer(ownerId, userId, text) {
  outbox.enqueue(ownerId ? `owner:${ownerId}` : 'all', 'pm', { userId: String(userId), text: truncate(text, 300), cmd: crypto.randomUUID() });
}

module.exports = {
  COMMANDS,
  CommandError,
  RATE,
  run,
  prepare,
  parseFreeCommand,
  resolveAnyPlayer,
  resolveOnlinePlayer,
  execute,
  audit,
  rateLimit,
  findHistory,
  addHistory,
  handleConfirmButton,
  confirmCustom,
  notifyPlayer,
  scopeTarget,
};
