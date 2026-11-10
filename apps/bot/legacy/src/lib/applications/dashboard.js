// Bewerbungen im Web-Dashboard: Live-Daten (Liste, Sperren, „in Bearbeitung“, Statistik) und Aktionen
// (entscheiden, Statusschritte, Notizen, löschen, Sperren, Panels). Gleiche Regeln wie die Discord-Buttons.
const { embed, sendTo } = require('../util');
const { save, nextNumber } = require('../db');
const { forGuild } = require('../settings');
const { zonedParts } = require('../time');
const store = require('./store');
const { validateType, QUESTION_TYPES } = require('./forms');
const { findRobloxUser } = require('./roblox');
const { sessions } = require('./flow');

const DAY = 86_400_000;
const WEEKDAY_INDEX = { mo: 0, di: 1, mi: 2, do: 3, fr: 4, sa: 5, so: 6 };
const MAX_LIST = 500;
const MAX_NOTES = 50;

const nameOf = (guild, id) => (id ? (guild.members.cache.get(id)?.user.username ?? null) : null);

function getRecordOrThrow(guild, number) {
  const record = store.getRecord(guild.id, String(number ?? ''));
  const type = record && store.typeById(guild.id, record.type);
  if (!record || !type) throw new Error('Diese Bewerbung gibt es nicht mehr.');
  return { record, type };
}

// ---------- Live-Daten ----------

// Alle offenen und die neuesten entschiedenen Bewerbungen (höchstens 500), neueste zuerst.
function list(guild) {
  const all = Object.values(store.recordsOf(guild.id)).sort((a, b) => b.createdAt - a.createdAt);
  const open = all.filter((r) => store.isOpenStatus(r.status));
  const done = all.filter((r) => !store.isOpenStatus(r.status)).slice(0, Math.max(0, MAX_LIST - open.length));
  const records = [...open, ...done]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      ...r,
      userName: nameOf(guild, r.userId) ?? r.userTag,
      decidedByName: nameOf(guild, r.decidedBy),
      history: r.history.map((h) => ({ ...h, byName: nameOf(guild, h.by) })),
      notes: (r.notes ?? []).map((n) => ({ ...n, byName: nameOf(guild, n.by) })),
      link: r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null,
      transitions:
        store.typeById(guild.id, r.type)?.workflow === 'police' ? (store.POLICE_TRANSITIONS[r.status] ?? []) : [],
    }));
  return { records, total: all.length, status: store.STATUS, final: store.FINAL };
}

function progress(guild) {
  const now = Date.now();
  return [...sessions.values()]
    .filter((s) => s.guildId === guild.id)
    .map((s) => {
      const type = store.typeById(guild.id, s.typeId);
      return {
        userId: s.userId,
        userName: nameOf(guild, s.userId) ?? s.userId,
        type: s.typeId,
        step: s.step,
        questions: type?.questions.length ?? 0,
        startedAt: s.startedAt,
        minutes: Math.round((now - s.startedAt) / 60_000),
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

function bans(guild) {
  const now = Date.now();
  return Object.values(store.bansOf(guild.id))
    .map((b) => ({
      ...b,
      active: !b.liftedAt && (!b.expiresAt || b.expiresAt > now),
      userName: nameOf(guild, b.discordId),
      createdByName: nameOf(guild, b.createdBy),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function metrics(records) {
  const accepted = records.filter((r) => r.status === 'ACCEPTED').length;
  const rejected = records.filter((r) => r.status === 'REJECTED').length;
  const open = records.filter((r) => store.isOpenStatus(r.status)).length;
  const durations = records
    .filter((r) => r.decidedAt && r.status !== 'WITHDRAWN')
    .map((r) => r.decidedAt - r.createdAt);
  return {
    count: records.length,
    accepted,
    rejected,
    open,
    withdrawn: records.filter((r) => r.status === 'WITHDRAWN').length,
    acceptRate: accepted + rejected ? accepted / (accepted + rejected) : null,
    avgMs: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
  };
}

// Kennzahlen für 7, 30 und 90 Tage jeweils mit dem Zeitraum davor; Verlauf, Arten, Prüfer und Heatmap für 90 Tage.
function stats(guild) {
  const now = Date.now();
  const all = Object.values(store.recordsOf(guild.id));
  const within = (from, to) => all.filter((r) => r.createdAt >= from && r.createdAt < to);
  const periods = Object.fromEntries(
    [7, 30, 90].map((days) => [
      days,
      {
        current: metrics(within(now - days * DAY, now + 1)),
        previous: metrics(within(now - 2 * days * DAY, now - days * DAY)),
      },
    ]),
  );

  const recent = within(now - 90 * DAY, now + 1);
  const perDay = Array.from({ length: 90 }, (_, i) => {
    const start = now - (90 - i) * DAY;
    return recent.filter((r) => r.createdAt >= start && r.createdAt < start + DAY).length;
  });
  const perType = store
    .types(guild.id)
    .map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, ...metrics(recent.filter((r) => r.type === t.id)) }));
  const reviewers = {};
  for (const r of recent)
    if (r.decidedBy && r.status !== 'WITHDRAWN') reviewers[r.decidedBy] = (reviewers[r.decidedBy] ?? 0) + 1;
  const topReviewers = Object.entries(reviewers)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id, count]) => ({ id, name: nameOf(guild, id) ?? id, count }));
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
  const { timezone } = forGuild(guild.id);
  for (const r of recent) {
    const parts = zonedParts(new Date(r.createdAt), timezone);
    heatmap[WEEKDAY_INDEX[parts.weekday]][parts.hour]++;
  }
  return { periods, perDay, perType, topReviewers, heatmap, total: all.length };
}

// ---------- Aktionen ----------

// Annehmen/Ablehnen wie per Button: Status, Team-Nachricht, DM, Rollen, Archiv.
async function decide(guild, { number, action, reason }, member) {
  const { record, type } = getRecordOrThrow(guild, number);
  if (!['accept', 'reject'].includes(action)) throw new Error('Unbekannte Entscheidung.');
  if (record.userId === member.id) throw new Error('Über deine eigene Bewerbung kannst du nicht entscheiden.');
  const text = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
  if (!store.setStatus(record, action === 'accept' ? 'ACCEPTED' : 'REJECTED', member.id, { reason: text || null })) {
    throw new Error(`Diese Bewerbung wurde bereits entschieden: ${store.STATUS[record.status]}.`);
  }
  const { updateTeamMessage, afterDecision } = require('./decide');
  await updateTeamMessage(guild, record, type);
  await afterDecision(guild, record, type, member.user);
}

// Polizei-Workflow: nächster Prüfschritt oder Zurückziehen.
async function changeStatus(guild, { number, status }, member) {
  const { record, type } = getRecordOrThrow(guild, number);
  if (record.userId === member.id) throw new Error('Über deine eigene Bewerbung kannst du nicht entscheiden.');
  if (!(store.POLICE_TRANSITIONS[record.status] ?? []).includes(status))
    throw new Error(`Von „${store.STATUS[record.status]}“ geht es nicht nach „${store.STATUS[status] ?? status}“.`);
  const reason = status === 'WITHDRAWN' ? 'Vom Team zurückgezogen.' : undefined;
  if (!store.setStatus(record, status, member.id, { reason }))
    throw new Error('Diese Bewerbung wurde bereits entschieden.');
  const { updateTeamMessage, afterDecision } = require('./decide');
  await updateTeamMessage(guild, record, type);
  if (status === 'WITHDRAWN') await afterDecision(guild, record, type, member.user);
}

// Interne Notiz – nur im Dashboard sichtbar, nicht für den Bewerber.
function addNote(guild, { number, text }, member) {
  const { record } = getRecordOrThrow(guild, number);
  const note = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
  if (!note) throw new Error('Die Notiz ist leer.');
  record.notes ??= [];
  record.notes.push({ by: member.id, at: Date.now(), text: note });
  record.notes = record.notes.slice(-MAX_NOTES);
  save();
}

async function remove(guild, { number }, member) {
  const { record, type } = getRecordOrThrow(guild, number);
  if (record.messageId) {
    const channel = await guild.channels.fetch(record.channelId).catch(() => null);
    await channel?.messages.delete(record.messageId).catch(() => {});
  }
  delete store.recordsOf(guild.id)[record.number];
  save();
  await sendTo(guild, 'modLog', {
    embeds: [
      embed('danger').setDescription(
        `🗑️ ${member.user} hat die Bewerbung **${record.number}** (${type.name}, <@${record.userId}>) im Dashboard gelöscht.`,
      ),
    ],
    allowedMentions: { parse: [] },
  });
}

const validScope = (guildId, scope) => scope === '*' || scope === 'police' || Boolean(store.typeById(guildId, scope));

async function addBan(guild, { discordId, robloxName, scope = '*', reason, days }, member) {
  const id = typeof discordId === 'string' && /^\d{17,20}$/.test(discordId.trim()) ? discordId.trim() : null;
  if (discordId && !id) throw new Error('Ungültige Discord-ID (17–20 Ziffern).');
  const name = typeof robloxName === 'string' ? robloxName.trim() : '';
  if (!id && !name) throw new Error('Gib eine Discord-ID und/oder einen Roblox-Namen an.');
  const text = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  if (!text) throw new Error('Ein Grund ist nötig.');
  if (!validScope(guild.id, scope)) throw new Error('Unbekannter Bereich.');
  const length = days ? Number(days) : 0;
  if (!Number.isInteger(length) || length < 0 || length > 3650) throw new Error('Tage: 0 (unbegrenzt) bis 3650.');
  let roblox = null;
  if (name) {
    try {
      roblox = await findRobloxUser(name);
    } catch {
      throw new Error('Roblox ist gerade nicht erreichbar. Versuche es gleich noch einmal.');
    }
    if (!roblox) throw new Error(`Kein Roblox-Konto „${name}“ gefunden.`);
  }
  const banId = `B-${String(nextNumber('appBan', guild.id)).padStart(4, '0')}`;
  const ban = {
    id: banId,
    discordId: id,
    robloxId: roblox?.id ?? null,
    robloxName: roblox?.name ?? null,
    scopes: [scope],
    reason: text,
    expiresAt: length ? Date.now() + length * DAY : null,
    createdBy: member.id,
    createdAt: Date.now(),
  };
  store.bansOf(guild.id)[banId] = ban;
  save();
  const who = [id && `<@${id}>`, roblox && `Roblox ${roblox.name}`].filter(Boolean).join(' · ');
  await sendTo(guild, 'modLog', {
    embeds: [
      embed('danger').setDescription(
        `🚫 ${member.user} hat im Dashboard die Bewerbungssperre **${banId}** angelegt: ${who} – ${length ? `${length} Tage` : 'unbegrenzt'}.\n**Grund:** ${text}`,
      ),
    ],
    allowedMentions: { parse: [] },
  });
  return ban;
}

async function liftBan(guild, { id }, member) {
  const ban = store.bansOf(guild.id)[String(id ?? '')];
  if (!ban || ban.liftedAt) throw new Error('Diese Sperre gibt es nicht oder sie ist schon aufgehoben.');
  ban.liftedAt = Date.now();
  ban.liftedBy = member.id;
  save();
  await sendTo(guild, 'modLog', {
    embeds: [
      embed('success').setDescription(
        `✅ ${member.user} hat im Dashboard die Bewerbungssperre **${ban.id}** aufgehoben.`,
      ),
    ],
  });
}

async function postPanel(guild, { kind, channelId }) {
  if (!['apply', 'quali'].includes(kind)) throw new Error('Unbekanntes Panel.');
  const channel = await guild.channels.fetch(String(channelId ?? '')).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Bitte einen Textkanal wählen.');
  if (!store.types(guild.id).some((t) => t.panel === kind && t.enabled))
    throw new Error('Keine aktive Bewerbungsart für dieses Panel.');
  await require('./messages').postPanel(channel, kind);
}

// ---------- Prüfung der Einstellungen vor dem Speichern ----------

// Gibt eine Fehlermeldung zurück oder null. Wird mit der Vorschau der neuen Einstellungen aufgerufen.
function checkConfig(config) {
  const types = config.applications?.types;
  if (!Array.isArray(types)) return null;
  if (!types.length) return 'Mindestens eine Bewerbungsart ist nötig.';
  if (types.length > 25) return 'Höchstens 25 Bewerbungsarten.';
  if (new Set(types.map((t) => t.id)).size !== types.length)
    return 'Die Schlüssel der Bewerbungsarten müssen eindeutig sein.';
  for (const t of types) {
    if (!t.name?.trim()) return `Bewerbungsart „${t.id}“: Name fehlt.`;
    if (!/^[A-Z0-9]{1,6}$/.test(t.numberPrefix ?? ''))
      return `${t.name}: Nummern-Kürzel muss 1–6 Großbuchstaben/Ziffern haben.`;
    const problem = validateType(t)[0];
    if (problem) return `Bewerbung ${problem}`;
  }
  return null;
}

module.exports = {
  list,
  progress,
  bans,
  stats,
  decide,
  changeStatus,
  addNote,
  remove,
  addBan,
  liftBan,
  postPanel,
  checkConfig,
  QUESTION_TYPES,
};
