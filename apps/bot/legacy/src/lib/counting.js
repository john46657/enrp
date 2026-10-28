// Zählen (counting in config.json): Mitglieder zählen in einem Kanal 1, 2, 3 … hoch. Richtige Zahlen bekommen ✅,
// eine falsche Zahl (oder zweimal hintereinander dieselbe Person) setzt je nach Einstellung auf 1 zurück oder wird
// gelöscht. Nachrichten, die nicht mit einer Zahl beginnen, werden ignoriert – im Kanal darf also auch geredet werden.
// Daten: data/db.json unter counting.<guildId>.
const { forGuild } = require('./settings');
const { bucket, save } = require('./db');
const { embed } = require('./util');

const settingsOf = (guildId) => forGuild(guildId).counting;

function stateOf(guildId) {
  const s = bucket('counting', guildId);
  s.current ??= 0;
  s.lastUserId ??= null;
  s.lastMessageId ??= null;
  s.record ??= 0;
  s.recordAt ??= null;
  s.users ??= {}; // userId → richtige Zahlen
  s.fails ??= {}; // userId → Fehler
  s.resets ??= 0;
  return s;
}

// „19“, „19 🎉“ oder „19 weiter so“ zählen als 19. „1.000“ und „1,5“ zählen nicht.
function parseNumber(content) {
  const match = /^\s*(\d{1,12})(?![\d.,])/.exec(content ?? '');
  return match ? Number(match[1]) : null;
}

// Prüft eine Zahl und aktualisiert den Stand. Liefert { result: 'ok' | 'wrong' | 'twice' | 'ignored', ... }.
function count(guildId, userId, messageId, content) {
  const cfg = settingsOf(guildId);
  const number = parseNumber(content);
  if (number === null) return { result: 'ignored' };
  const s = stateOf(guildId);
  const expected = s.current + 1;

  let result = 'ok';
  if (number !== expected) result = 'wrong';
  else if (!cfg.allowTwice && s.lastUserId === userId) result = 'twice';

  if (result === 'ok') {
    s.current = number;
    s.lastUserId = userId;
    s.lastMessageId = messageId;
    s.users[userId] = (s.users[userId] ?? 0) + 1;
    const record = number > s.record;
    if (record) {
      s.record = number;
      s.recordAt = Date.now();
    }
    save();
    return { result, number, record };
  }

  s.fails[userId] = (s.fails[userId] ?? 0) + 1;
  const reached = s.current;
  if (cfg.resetOnFail) {
    s.current = 0;
    s.lastUserId = null;
    s.lastMessageId = null;
    s.resets += 1;
  }
  save();
  return { result, number, expected, reached };
}

function setCurrent(guildId, number) {
  const s = stateOf(guildId);
  s.current = number;
  s.lastUserId = null;
  s.lastMessageId = null;
  save();
}

const topCounters = (guildId, limit = 10) =>
  Object.entries(stateOf(guildId).users)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

const REASONS = { wrong: (r) => `hat **${r.number}** geschrieben, richtig wäre **${r.expected}** gewesen`, twice: () => 'hat zweimal hintereinander gezählt' };

async function handleMessage(message) {
  const cfg = settingsOf(message.guildId);
  if (!cfg.enabled || !cfg.channel || message.channelId !== cfg.channel) return false;
  const r = count(message.guildId, message.author.id, message.id, message.content);
  if (r.result === 'ignored') return false;

  if (r.result === 'ok') {
    await message.react(r.record && r.number % 100 === 0 ? '🎉' : '✅').catch(() => {});
    return true;
  }

  if (!cfg.resetOnFail) {
    await message.delete().catch(() => {});
    return true;
  }
  await message.react('❌').catch(() => {});
  await message.channel
    .send({
      embeds: [embed('danger').setDescription(`❌ ${message.author} ${REASONS[r.result](r)}.\nGeschafft: **${r.reached}** · Rekord: **${stateOf(message.guildId).record}**\n\nEs geht wieder bei **1** los.`)],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  return true;
}

// Löscht jemand die letzte richtige Zahl, sagt der Bot, wie es weitergeht – sonst wüsste niemand mehr den Stand.
async function handleDelete(message) {
  if (!message.guildId) return;
  const cfg = settingsOf(message.guildId);
  if (!cfg.enabled || message.channelId !== cfg.channel) return;
  const s = stateOf(message.guildId);
  if (!s.lastMessageId || message.id !== s.lastMessageId) return;
  await message.channel
    .send({ embeds: [embed('warning').setDescription(`⚠️ <@${s.lastUserId}> hat die Zahl **${s.current}** gelöscht. Weiter geht's mit **${s.current + 1}**.`)], allowedMentions: { parse: [] } })
    .catch(() => {});
}

module.exports = { stateOf, parseNumber, count, setCurrent, topCounters, handleMessage, handleDelete };
