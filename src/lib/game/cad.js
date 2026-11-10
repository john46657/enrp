// Discord-CAD: Einsätze, Einheiten, Zuweisung, Status, Notizen, Berichte, Statistik.
// Quellen:
//   ingame  – echter Notruf aus dem Spiel (Ereignis „call“), automatisch angelegt
//   discord – eigener Einsatz von EN | POLIZEI (/cad neu), gehört nicht zum Spiel
// Jeder Discord hat seine eigenen Einsätze und Einheiten.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');
const db = require('../db');
const links = require('../roblox/links');
const { forGuild } = require('../settings');
const { getChannel, truncate, replyPrivate } = require('../util');
const { profileUrl } = require('../applications/roblox');
const permissions = require('./permissions');
const live = require('./live');
const events = require('./events');

const STATUS = {
  offen: { label: 'Offen', emoji: '🟥', color: 0xed4245 },
  zugewiesen: { label: 'Zugewiesen', emoji: '🟧', color: 0xf0883e },
  anfahrt: { label: 'Anfahrt', emoji: '🟨', color: 0xfee75c },
  vor_ort: { label: 'Vor Ort', emoji: '🟩', color: 0x57f287 },
  abgeschlossen: { label: 'Abgeschlossen', emoji: '⬛', color: 0x4f545c },
};
const PRIORITY = { 1: '🔴 P1 · Hoch', 2: '🟠 P2 · Mittel', 3: '🟢 P3 · Niedrig' };
const UNIT_STATUS = {
  verfuegbar: 'Status 2 · Einsatzbereit',
  anfahrt: 'Status 3 · Anfahrt',
  vor_ort: 'Status 4 · Am Einsatzort',
  beschaeftigt: 'Status 5 · Beschäftigt',
  ausser_dienst: 'Status 6 · Außer Dienst',
};
const OPEN = ['offen', 'zugewiesen', 'anfahrt', 'vor_ort'];

class CadError extends Error {}

const data = (guildId) => {
  const bucket = db.bucket('cad', guildId);
  bucket.incidents ??= {};
  bucket.units ??= {};
  return bucket;
};
const incidents = (guildId) => data(guildId).incidents;
const units = (guildId) => data(guildId).units;
const brand = (guildId) => forGuild(guildId).game.brand;

function getIncident(guildId, number) {
  const key = String(number ?? '').trim().toUpperCase();
  const normalized = /^\d+$/.test(key) ? `E-${key.padStart(4, '0')}` : key;
  const incident = incidents(guildId)[normalized];
  if (!incident) throw new CadError(`Einsatz „${truncate(String(number), 20)}“ gibt es nicht.`);
  return incident;
}

function log(incident, by, text) {
  incident.history.push({ at: Date.now(), by, text });
  incident.updatedAt = Date.now();
}

function createIncident(guildId, fields, by) {
  const number = `E-${String(db.nextNumber('cad', guildId)).padStart(4, '0')}`;
  const incident = {
    number,
    source: 'discord',
    title: '',
    description: '',
    location: '',
    priority: 2,
    team: forGuild(guildId).game.cadTeams[0] ?? 'Polizei',
    status: 'offen',
    units: [],
    notes: [],
    history: [],
    createdAt: Date.now(),
    createdBy: by,
    updatedAt: Date.now(),
    ...fields,
  };
  log(incident, by, incident.source === 'ingame' ? 'Notruf aus dem Spiel eingegangen' : 'Einsatz angelegt');
  incidents(guildId)[number] = incident;
  db.save();
  return incident;
}

// ---------- Einheiten ----------

function unitOf(guildId, userId) {
  return (units(guildId)[userId] ??= { callsign: null, status: 'ausser_dienst', incident: null, updatedAt: Date.now() });
}

const unitName = (guildId, userId) => {
  const unit = units(guildId)[userId];
  return unit?.callsign ? `**${unit.callsign}** (<@${userId}>)` : `<@${userId}>`;
};

// Ist die Einheit gerade im Spiel? (über das verifizierte Roblox-Konto)
function inGame(guildId, userId) {
  const account = links.getAccount(userId);
  if (!account) return null;
  const [found] = live.findPlayers(links.scopeOf(guildId), account.id);
  return found ? `${found.player.team ?? 'ohne Team'} · ${live.serverLabel(found.server)}` : null;
}

function setUnitStatus(guildId, userId, status, callsign) {
  if (!(status in UNIT_STATUS)) throw new CadError('Unbekannter Status.');
  const unit = unitOf(guildId, userId);
  unit.status = status;
  if (callsign !== undefined && callsign !== null) unit.callsign = truncate(callsign.trim(), 20) || null;
  if (status === 'verfuegbar' || status === 'ausser_dienst') unit.incident = null;
  unit.updatedAt = Date.now();
  db.save();
  return unit;
}

// ---------- Aktionen ----------

let notifyCaller = async () => {}; // wird von commands.js gesetzt (vermeidet Kreis-Abhängigkeit)
const setNotifier = (fn) => {
  notifyCaller = fn;
};

async function assign(guild, incident, userId, by) {
  if (!OPEN.includes(incident.status)) throw new CadError('Der Einsatz ist bereits abgeschlossen.');
  if (!incident.units.includes(userId)) incident.units.push(userId);
  const unit = unitOf(guild.id, userId);
  unit.status = 'anfahrt';
  unit.incident = incident.number;
  unit.updatedAt = Date.now();
  const first = !incident.firstAssignedAt;
  if (first) incident.firstAssignedAt = Date.now();
  if (incident.status === 'offen') incident.status = 'zugewiesen';
  log(incident, by, `Einheit <@${userId}> zugewiesen`);
  db.save();
  if (first && incident.source === 'ingame' && incident.ingame?.caller?.id) {
    const name = unit.callsign ?? (await guild.members.fetch(userId).catch(() => null))?.displayName ?? 'Eine Einheit';
    await notifyCaller(incident.ingame.ownerId, incident.ingame.caller.id, `🚓 Dein Notruf wurde angenommen. ${name} ist unterwegs.`).catch(() => {});
  }
  await refreshMessage(guild, incident);
}

async function setStatus(guild, incident, status, by) {
  if (!(status in STATUS) || status === 'abgeschlossen') throw new CadError('Unbekannter Status (zum Abschließen: /cad abschliessen).');
  if (!OPEN.includes(incident.status)) throw new CadError('Der Einsatz ist bereits abgeschlossen.');
  incident.status = status;
  if (status === 'anfahrt' || status === 'vor_ort') {
    for (const userId of incident.units) Object.assign(unitOf(guild.id, userId), { status, updatedAt: Date.now() });
  }
  log(incident, by, `Status: ${STATUS[status].label}`);
  db.save();
  await refreshMessage(guild, incident);
}

async function addNote(guild, incident, text, by) {
  incident.notes.push({ at: Date.now(), by, text: truncate(text.trim(), 500) });
  log(incident, by, 'Notiz hinzugefügt');
  db.save();
  await refreshMessage(guild, incident);
}

async function close(guild, incident, report, by) {
  if (!OPEN.includes(incident.status)) throw new CadError('Der Einsatz ist bereits abgeschlossen.');
  incident.status = 'abgeschlossen';
  incident.closedAt = Date.now();
  incident.closedBy = by;
  incident.report = truncate((report ?? '').trim(), 1500) || null;
  for (const userId of incident.units) {
    const unit = unitOf(guild.id, userId);
    if (unit.incident === incident.number) Object.assign(unit, { incident: null, status: 'verfuegbar', updatedAt: Date.now() });
  }
  log(incident, by, 'Einsatz abgeschlossen');
  db.save();
  await refreshMessage(guild, incident);
}

// ---------- Darstellung ----------

function incidentEmbed(guildId, incident, { full = false } = {}) {
  const s = STATUS[incident.status];
  const source =
    incident.source === 'ingame'
      ? `🎮 **Ingame-Notruf #${incident.ingame.callNumber}** · ${incident.ingame.server ?? 'Spielserver'}`
      : `📝 **${brand(guildId)}-Einsatz** (eigene Daten, nicht aus dem Spiel)`;
  const e = new EmbedBuilder()
    .setColor(s.color)
    .setTitle(truncate(`🚨 ${incident.number} · ${incident.title || 'Einsatz'}`, 256))
    .setDescription(truncate(`${source}\n\n${incident.description || '—'}`, 4000))
    .addFields(
      { name: 'Status', value: `${s.emoji} ${s.label}`, inline: true },
      { name: 'Priorität', value: PRIORITY[incident.priority] ?? '—', inline: true },
      { name: 'Bereich', value: incident.team, inline: true },
      { name: 'Ort', value: truncate(incident.location || '—', 1024), inline: true },
      { name: 'Einheiten', value: truncate(incident.units.map((u) => unitName(guildId, u)).join('\n') || '—', 1024), inline: true },
      { name: 'Eingang', value: `<t:${Math.floor(incident.createdAt / 1000)}:t> (<t:${Math.floor(incident.createdAt / 1000)}:R>)`, inline: true },
    )
    .setFooter({ text: `${brand(guildId)} · CAD · ${incident.source === 'ingame' ? 'Quelle: Spiel' : 'Quelle: Discord'}` })
    .setTimestamp(incident.updatedAt);
  if (incident.source === 'ingame') {
    const caller = incident.ingame.caller;
    const [online] = caller?.id ? live.findPlayers(links.scopeOf(guildId), caller.id) : [];
    e.addFields({
      name: 'Anrufer',
      value: caller?.id ? `[${caller.name ?? caller.id}](${profileUrl(caller.id)})${online ? ` · 🟢 online (${online.player.team ?? 'ohne Team'})` : ' · ⚫ offline'}` : '—',
    });
  }
  const notes = full ? incident.notes : incident.notes.slice(-3);
  if (notes.length) {
    e.addFields({ name: `Notizen (${incident.notes.length})`, value: truncate(notes.map((n) => `<t:${Math.floor(n.at / 1000)}:t> <@${n.by}>: ${n.text}`).join('\n'), 1024) });
  }
  if (incident.report) e.addFields({ name: '📄 Einsatzbericht', value: truncate(incident.report, 1024) });
  if (full) {
    e.addFields({ name: 'Verlauf', value: truncate(incident.history.slice(-10).map((h) => `<t:${Math.floor(h.at / 1000)}:t> ${h.text}${h.by ? ` – <@${h.by}>` : ''}`).join('\n'), 1024) });
  }
  return e;
}

function incidentComponents(incident) {
  if (!OPEN.includes(incident.status)) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cad:take:${incident.number}`).setLabel('Übernehmen').setEmoji('🚓').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cad:close:${incident.number}`).setLabel('Abschließen').setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cad:status:${incident.number}`)
        .setPlaceholder('Status ändern …')
        .addOptions(
          OPEN.map((key) => ({ label: STATUS[key].label, value: key, emoji: STATUS[key].emoji, default: key === incident.status })),
        ),
    ),
  ];
}

const messagePayload = (guildId, incident) => ({ embeds: [incidentEmbed(guildId, incident)], components: incidentComponents(incident) });

async function postIncident(guild, incident) {
  const config = forGuild(guild.id).game;
  const channel = config.dispatchChannel && (await getChannel(guild, config.dispatchChannel));
  if (!channel?.isTextBased()) return;
  const ping = config.dispatchRole && incident.source === 'ingame' ? `<@&${config.dispatchRole}>` : undefined;
  const message = await channel
    .send({ content: ping, ...messagePayload(guild.id, incident), allowedMentions: { roles: config.dispatchRole ? [config.dispatchRole] : [] } })
    .catch((err) => console.error('[cad] Senden:', err.message));
  if (message) {
    incident.messageId = message.id;
    incident.channelId = channel.id;
    db.save();
  }
}

async function refreshMessage(guild, incident) {
  if (!incident.messageId) return;
  const channel = await getChannel(guild, incident.channelId);
  const message = await channel?.messages.fetch(incident.messageId).catch(() => null);
  await message?.edit(messagePayload(guild.id, incident)).catch(() => {});
}

// ---------- Suche, Liste, Statistik ----------

function list(guildId, { status = 'offen', source = null, team = null, limit = 15 } = {}) {
  return Object.values(incidents(guildId))
    .filter((i) => (status === 'alle' ? true : status === 'offen' ? OPEN.includes(i.status) : i.status === status))
    .filter((i) => (!source || i.source === source) && (!team || i.team === team))
    .sort((a, b) => (a.priority - b.priority) || (b.createdAt - a.createdAt))
    .slice(0, limit);
}

function search(guildId, query, limit = 15) {
  const q = query.toLowerCase();
  return Object.values(incidents(guildId))
    .filter((i) =>
      [i.number, i.title, i.description, i.location, i.report, i.ingame?.caller?.name, ...i.notes.map((n) => n.text)].some((x) => x?.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function stats(guildId, days = 7) {
  const since = Date.now() - days * 86_400_000;
  const recent = Object.values(incidents(guildId)).filter((i) => i.createdAt >= since);
  const avg = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length / 60_000) : null);
  const byUnit = {};
  for (const i of recent.filter((x) => x.status === 'abgeschlossen')) for (const u of i.units) byUnit[u] = (byUnit[u] ?? 0) + 1;
  return {
    total: recent.length,
    open: recent.filter((i) => OPEN.includes(i.status)).length,
    closed: recent.filter((i) => i.status === 'abgeschlossen').length,
    ingame: recent.filter((i) => i.source === 'ingame').length,
    discord: recent.filter((i) => i.source === 'discord').length,
    byTeam: recent.reduce((acc, i) => ({ ...acc, [i.team]: (acc[i.team] ?? 0) + 1 }), {}),
    avgAssignMinutes: avg(recent.filter((i) => i.firstAssignedAt).map((i) => i.firstAssignedAt - i.createdAt)),
    avgDurationMinutes: avg(recent.filter((i) => i.closedAt).map((i) => i.closedAt - i.createdAt)),
    topUnits: Object.entries(byUnit).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

const lineOf = (i) =>
  `${STATUS[i.status].emoji} **${i.number}** ${i.source === 'ingame' ? '🎮' : '📝'} ${truncate(i.title || '—', 50)} · ${PRIORITY[i.priority].split(' ')[0]} · ${i.team} · <t:${Math.floor(i.createdAt / 1000)}:R>${i.units.length ? ` · ${i.units.length} Einh.` : ''}`;

// ---------- Ingame-Notrufe ----------

events.on('call', async (event, { client }) => {
  if (event.stale) return;
  for (const guild of events.responsibleGuilds(client, event.ownerId)) {
    // Gleicher Notruf nicht doppelt anlegen (z. B. nach Wiederholung)
    if (Object.values(incidents(guild.id)).some((i) => i.ingame?.eventId === event.id)) continue;
    const snapshot = live.serversFor(links.scopeOf(guild.id)).find((s) => s.job === event.job);
    const incident = createIncident(
      guild.id,
      {
        source: 'ingame',
        title: `Notruf: ${truncate(event.text || 'ohne Beschreibung', 60)}`,
        description: event.text || 'Ohne Beschreibung',
        location: [event.location, event.position ? `X ${event.position.x} · Z ${event.position.z}` : null].filter(Boolean).join(' · '),
        team: forGuild(guild.id).game.cadTeams.find((t) => t.toLowerCase() === event.team.toLowerCase()) ?? event.team,
        priority: 2,
        ingame: {
          eventId: event.id,
          callNumber: event.callNumber,
          job: event.job,
          ownerId: event.ownerId,
          server: snapshot ? live.serverLabel(snapshot) : event.ownerId ? 'Privatserver' : 'Öffentlicher Server',
          caller: { id: event.userId, name: event.name },
          position: event.position,
        },
      },
      null,
    );
    await postIncident(guild, incident);
  }
});

// ---------- Discord-Komponenten (Buttons/Menüs/Formular) ----------

async function handleComponent(interaction, [action, number]) {
  let incident;
  try {
    incident = getIncident(interaction.guildId, number);
  } catch (err) {
    return replyPrivate(interaction, err.message);
  }
  if (!permissions.can(interaction.member, 'dispatch')) return replyPrivate(interaction, permissions.deny('dispatch'));
  try {
    if (action === 'take') {
      await assign(interaction.guild, incident, interaction.user.id, interaction.user.id);
      return replyPrivate(interaction, `🚓 Du bist bei **${incident.number}** eingeteilt (Status 3 · Anfahrt).`);
    }
    if (action === 'status') {
      await setStatus(interaction.guild, incident, interaction.values[0], interaction.user.id);
      return replyPrivate(interaction, `Status von **${incident.number}**: ${STATUS[incident.status].label}`);
    }
    if (action === 'close') {
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`cad:closesubmit:${incident.number}`)
          .setTitle(`${incident.number} abschließen`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('report').setLabel('Einsatzbericht').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500),
            ),
          ),
      );
    }
    if (action === 'closesubmit') {
      await close(interaction.guild, incident, interaction.fields.getTextInputValue('report'), interaction.user.id);
      return replyPrivate(interaction, `✅ **${incident.number}** abgeschlossen.`);
    }
  } catch (err) {
    if (!(err instanceof CadError)) throw err;
    return replyPrivate(interaction, `❌ ${err.message}`);
  }
  return null;
}

module.exports = {
  STATUS,
  PRIORITY,
  UNIT_STATUS,
  OPEN,
  CadError,
  incidents,
  units,
  getIncident,
  createIncident,
  unitOf,
  unitName,
  inGame,
  setUnitStatus,
  assign,
  setStatus,
  addNote,
  close,
  incidentEmbed,
  postIncident,
  refreshMessage,
  list,
  search,
  stats,
  lineOf,
  setNotifier,
  handleComponent,
};
