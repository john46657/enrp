// Geleistete Arbeit je Teammitglied (für den Rang-Aufstieg): bearbeitete Tickets und Moderationsaktionen.
// data/db.json → teamActivity.<guildId>.<userId> = [{ type: 'ticket' | 'mod', at }]
const { bucket, save } = require('./db');

const MAX_PER_USER = 2000;

function record(guildId, userId, type, at = Date.now()) {
  if (!userId) return;
  const list = (bucket('teamActivity', guildId)[userId] ??= []);
  list.push({ type, at });
  if (list.length > MAX_PER_USER) list.splice(0, list.length - MAX_PER_USER);
  save();
}

// Anzahl je Art seit einem Zeitpunkt: { ticket, mod }
function countSince(guildId, userId, since = 0) {
  const counts = { ticket: 0, mod: 0 };
  for (const e of bucket('teamActivity', guildId)[userId] ?? []) if (e.at >= since && e.type in counts) counts[e.type]++;
  return counts;
}

module.exports = { record, countSince };
