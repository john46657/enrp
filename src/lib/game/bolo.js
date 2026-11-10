// BOLO („Be On the Look-Out“) – Fahndungen von EN | POLIZEI. Eigene Daten des Discords, nicht aus dem Spiel.
// Personen-BOLO (Roblox-Konto) und Fahrzeug-BOLO (Kennzeichen). Taucht ein gesuchter Spieler oder ein gesuchtes
// Kennzeichen in den Live-Daten auf, gibt es einen Treffer-Alarm im BOLO-Kanal (je BOLO höchstens alle 30 Minuten).
const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const links = require('../roblox/links');
const { forGuild } = require('../settings');
const { getChannel, truncate } = require('../util');
const { profileUrl } = require('../applications/roblox');
const { normalizePlate, inScope } = require('./protocol');
const live = require('./live');
const events = require('./events');

const HIT_COOLDOWN_MS = 30 * 60_000;
const STATUS = { aktiv: '🟢 Aktiv', aufgehoben: '⚪ Aufgehoben', abgelaufen: '⌛ Abgelaufen' };

class BoloError extends Error {}

const store = (guildId) => db.bucket('bolos', guildId);
const brand = (guildId) => forGuild(guildId).game.brand;

function getBolo(guildId, id) {
  const key = String(id ?? '').trim().toUpperCase();
  const normalized = /^\d+$/.test(key) ? `B-${key.padStart(4, '0')}` : key;
  const bolo = store(guildId)[normalized];
  if (!bolo) throw new BoloError(`BOLO „${truncate(String(id), 20)}“ gibt es nicht.`);
  return bolo;
}

function expire(guildId, now = Date.now()) {
  const changed = [];
  for (const bolo of Object.values(store(guildId))) {
    if (bolo.status === 'aktiv' && bolo.expiresAt && bolo.expiresAt <= now) {
      bolo.status = 'abgelaufen';
      bolo.history.push({ at: now, by: null, text: 'Abgelaufen' });
      changed.push(bolo);
    }
  }
  if (changed.length) db.save();
  return changed;
}

function create(guildId, fields, by) {
  const id = `B-${String(db.nextNumber('bolo', guildId)).padStart(4, '0')}`;
  const bolo = {
    id,
    type: 'person',
    status: 'aktiv',
    createdAt: Date.now(),
    createdBy: by,
    expiresAt: null,
    hits: [],
    history: [{ at: Date.now(), by, text: 'Angelegt' }],
    ...fields,
  };
  if (bolo.plate) bolo.plateKey = normalizePlate(bolo.plate);
  store(guildId)[id] = bolo;
  db.save();
  return bolo;
}

const EDITABLE = { reason: 'Grund', description: 'Beschreibung', expiresAt: 'Ablauf', model: 'Modell', color: 'Farbe' };

function edit(guildId, bolo, changes, by) {
  if (bolo.status !== 'aktiv') throw new BoloError('Nur aktive BOLOs lassen sich bearbeiten.');
  const done = [];
  for (const [field, value] of Object.entries(changes)) {
    if (!(field in EDITABLE) || value === undefined) continue;
    bolo[field] = value;
    done.push(EDITABLE[field]);
  }
  if (!done.length) throw new BoloError('Keine Änderung angegeben.');
  bolo.history.push({ at: Date.now(), by, text: `Bearbeitet: ${done.join(', ')}` });
  db.save();
  return done;
}

function cancel(guildId, bolo, reason, by) {
  if (bolo.status !== 'aktiv') throw new BoloError('Dieser BOLO ist nicht mehr aktiv.');
  bolo.status = 'aufgehoben';
  bolo.closedAt = Date.now();
  bolo.closedBy = by;
  bolo.closeReason = truncate(reason, 300);
  bolo.history.push({ at: Date.now(), by, text: `Aufgehoben: ${bolo.closeReason}` });
  db.save();
}

function list(guildId, { status = 'aktiv', type = null } = {}) {
  expire(guildId);
  return Object.values(store(guildId))
    .filter((b) => (status === 'alle' || b.status === status) && (!type || b.type === type))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function search(guildId, query) {
  const q = query.toLowerCase();
  const key = normalizePlate(query);
  return Object.values(store(guildId))
    .filter(
      (b) =>
        [b.id, b.name, b.robloxName, b.reason, b.description, b.model, b.color].some((x) => x?.toLowerCase().includes(q)) ||
        (key && b.plateKey?.includes(key)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);
}

const label = (b) => (b.type === 'person' ? `👤 ${b.robloxName ?? b.name}` : `🚗 ${b.plate}${b.model ? ` (${b.model})` : ''}`);

function embedOf(guildId, b, { full = false } = {}) {
  const e = new EmbedBuilder()
    .setColor(b.status === 'aktiv' ? 0xed4245 : 0x4f545c)
    .setTitle(truncate(`📢 BOLO ${b.id} · ${label(b)}`, 256))
    .setDescription(truncate(`**Grund:** ${b.reason}\n${b.description ? `\n${b.description}` : ''}`, 4000))
    .addFields(
      { name: 'Status', value: STATUS[b.status], inline: true },
      { name: 'Ablauf', value: b.expiresAt ? `<t:${Math.floor(b.expiresAt / 1000)}:R>` : 'unbefristet', inline: true },
      { name: 'Erstellt', value: `<@${b.createdBy}> <t:${Math.floor(b.createdAt / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `${brand(guildId)} · eigene BOLO-Daten (nicht aus dem Spiel)` });
  if (b.type === 'person' && b.robloxId) e.addFields({ name: 'Roblox', value: `[${b.robloxName}](${profileUrl(b.robloxId)}) (\`${b.robloxId}\`)`, inline: true });
  if (b.type === 'fahrzeug') {
    e.addFields({ name: 'Fahrzeug', value: [b.plate && `Kennzeichen **${b.plate}**`, b.model, b.color].filter(Boolean).join(' · ') || '—', inline: true });
  }
  if (b.hits.length) {
    const last = b.hits.at(-1);
    e.addFields({ name: `Treffer (${b.hits.length})`, value: `Zuletzt <t:${Math.floor(last.at / 1000)}:R>: ${truncate(last.where, 200)}` });
  }
  if (b.status === 'aufgehoben') e.addFields({ name: 'Aufgehoben', value: `<@${b.closedBy}>: ${b.closeReason}` });
  if (full) e.addFields({ name: 'Verlauf', value: truncate(b.history.slice(-8).map((h) => `<t:${Math.floor(h.at / 1000)}:d> ${h.text}${h.by ? ` – <@${h.by}>` : ''}`).join('\n'), 1024) });
  return e;
}

async function announce(guild, bolo, text) {
  const config = forGuild(guild.id).game;
  const channelId = config.boloChannel || config.logs.bolo;
  const channel = channelId && (await getChannel(guild, channelId));
  if (!channel?.isTextBased()) return;
  await channel.send({ content: text, embeds: [embedOf(guild.id, bolo)], allowedMentions: { parse: [] } }).catch((err) => console.error('[bolo]', err.message));
}

// ---------- Treffer in den Live-Daten ----------

async function hit(guild, bolo, where) {
  const last = bolo.hits.at(-1);
  if (last && Date.now() - last.at < HIT_COOLDOWN_MS) return;
  bolo.hits.push({ at: Date.now(), where });
  if (bolo.hits.length > 50) bolo.hits.splice(0, bolo.hits.length - 50);
  db.save();
  const config = forGuild(guild.id).game;
  const ping = config.dispatchRole ? `<@&${config.dispatchRole}> ` : '';
  const channelId = config.boloChannel || config.logs.bolo;
  const channel = channelId && (await getChannel(guild, channelId));
  await channel
    ?.send({
      content: `${ping}🚨 **BOLO-Treffer ${bolo.id}** · ${label(bolo)}\n${where}`,
      allowedMentions: { roles: config.dispatchRole ? [config.dispatchRole] : [] },
    })
    .catch((err) => console.error('[bolo]', err.message));
}

function guildsWithBolos(client) {
  return [...client.guilds.cache.values()].filter((g) => links.scopeOf(g.id).type !== 'none' && Object.keys(store(g.id)).length);
}

let clientRef = null;
const start = (client) => {
  clientRef = client;
};

// Jeder neue Snapshot: gesuchte Spieler und Kennzeichen prüfen
live.onUpdate(async (snapshot) => {
  if (!clientRef) return;
  for (const guild of guildsWithBolos(clientRef)) {
    if (!inScope(links.scopeOf(guild.id), snapshot.ownerId)) continue;
    expire(guild.id);
    const server = live.serverLabel(snapshot);
    for (const bolo of Object.values(store(guild.id)).filter((b) => b.status === 'aktiv')) {
      if (bolo.type === 'person') {
        const player = snapshot.players.find((p) => (bolo.robloxId ? p.id === bolo.robloxId : p.name.toLowerCase() === bolo.name.toLowerCase()));
        if (player) await hit(guild, bolo, `Spieler **${player.name}** ist online · ${server}${player.team ? ` · Team ${player.team}` : ''}`);
      } else if (bolo.plateKey) {
        const vehicle = snapshot.vehicles.find((v) => v.plateKey === bolo.plateKey);
        if (vehicle) await hit(guild, bolo, `Fahrzeug **${vehicle.model}** [${vehicle.plate}] von ${vehicle.ownerName ?? 'unbekannt'} · ${server}`);
      }
    }
  }
});

// Fahrzeug gespawnt → sofort prüfen (nicht erst beim nächsten Snapshot)
events.on('vehicle', async (event, { client }) => {
  if (event.stale || event.action !== 'spawn' || !event.vehicle?.plateKey) return;
  for (const guild of events.guildsFor(client, event.ownerId)) {
    const bolo = Object.values(store(guild.id)).find((b) => b.status === 'aktiv' && b.plateKey === event.vehicle.plateKey);
    if (bolo) await hit(guild, bolo, `Fahrzeug **${event.vehicle.model}** [${event.vehicle.plate}] wurde von ${event.name ?? 'unbekannt'} gespawnt`);
  }
});

module.exports = { STATUS, BoloError, getBolo, create, edit, cancel, list, search, expire, embedOf, announce, label, start };
