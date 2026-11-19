// Werkzeuge für Bot-Admins (Admin-Bereich im Dashboard): Fehler-Log, Audit-Log, gesperrte Server,
// Systemstatus und Backup der Datenbank. Gespeichert in data/db.json unter botAdmin.all.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { data, bucket, save, flush } = require('./db');

const MAX_ERRORS = 300;
const MAX_AUDIT = 1000;
const MAX_TEXT = 4000; // Fehlertext inkl. Stack
const MAX_VALUE = 500; // Vorher/Nachher im Audit-Log
// Nie ins Backup und nie überschreiben: geheime Sitzungs-IDs (stecken in den Login-Cookies).
const SECRET_KEYS = ['dashboardSessions'];

const store = () => bucket('botAdmin', 'all');
const errors = () => (store().errors ??= []);
const audit = () => (store().audit ??= []);
const blocked = () => (store().blockedGuilds ??= {});

// ---------- Fehler-Log ----------

function formatArg(arg) {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

// Einen Fehler aufzeichnen. Gleiche Meldungen direkt hintereinander werden zusammengefasst (count).
function recordError(args, source = 'console') {
  const text = args.map(formatArg).join(' ').slice(0, MAX_TEXT);
  if (!text.trim()) return;
  const label = /^\[([^\]]{1,60})\]/.exec(text)?.[1] ?? null; // z. B. „[event:messageCreate]“
  const list = errors();
  const last = list[0];
  if (last && last.text === text && Date.now() - last.at < 10 * 60_000) {
    last.count = (last.count ?? 1) + 1;
    last.at = Date.now();
  } else {
    list.unshift({ at: Date.now(), source, label, text, count: 1 });
    if (list.length > MAX_ERRORS) list.length = MAX_ERRORS;
  }
  save();
}

let captured = false;
// console.error mitschreiben (Ausgabe in der Konsole bleibt). Einmal beim Start aufrufen.
function captureErrors() {
  if (captured) return;
  captured = true;
  const original = console.error.bind(console);
  console.error = (...args) => {
    original(...args);
    try {
      recordError(args);
    } catch {
      // Fehler-Log darf den Bot nie stören.
    }
  };
}

const errorList = ({ limit = 200 } = {}) => errors().slice(0, Math.min(Math.max(limit, 1), MAX_ERRORS));
function clearErrors() {
  errors().length = 0;
  save();
}

// ---------- Audit-Log ----------

function short(value) {
  if (value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

// Wert an einem Einstellungs-Pfad lesen (Listen-Einträge über ihre id, wie im Dashboard).
function valueAt(obj, pathname) {
  return pathname.split('.').reduce((o, key) => (Array.isArray(o) ? o.find((e) => e?.id === key) : o?.[key]), obj);
}

// Wer hat was wo geändert. actor: { id, username, botAdmin, member }, guild: { id, name } oder null.
function recordAudit({ actor, guild = null, type, details = {}, changes = [] }) {
  const list = audit();
  list.unshift({
    at: Date.now(),
    type,
    actor: { id: actor.id, username: actor.username, botAdmin: Boolean(actor.botAdmin), member: actor.member ?? null },
    guild: guild ? { id: guild.id, name: guild.name } : null,
    changes: changes.slice(0, 100).map((c) => ({ path: c.path, before: short(c.before), after: short(c.after) })),
    details,
  });
  if (list.length > MAX_AUDIT) list.length = MAX_AUDIT;
  save();
}

function auditList({ limit = 300, guildId, onlyBotAdmins = false } = {}) {
  return audit()
    .filter((e) => (!guildId || e.guild?.id === guildId) && (!onlyBotAdmins || e.actor.botAdmin))
    .slice(0, Math.min(Math.max(limit, 1), MAX_AUDIT));
}

// ---------- Gesperrte Server ----------

const isBlocked = (guildId) => Boolean(blocked()[guildId]);
const blockedList = () => Object.entries(blocked()).map(([id, b]) => ({ id, ...b })).sort((a, b) => b.at - a.at);
function block(guild, by, reason = '') {
  blocked()[guild.id] = { name: guild.name ?? null, reason: String(reason).slice(0, 300), at: Date.now(), by: { id: by.id, username: by.username } };
  save();
}
function unblock(guildId) {
  if (!blocked()[guildId]) return false;
  delete blocked()[guildId];
  save();
  return true;
}

// Gesperrten Server verlassen. Gibt true zurück, wenn der Bot gegangen ist.
async function leaveIfBlocked(guild) {
  if (!isBlocked(guild.id)) return false;
  console.log(`⛔ „${guild.name}“ (${guild.id}) ist gesperrt – Bot verlässt den Server`);
  await guild.leave().catch((err) => console.error(`[botAdmin] Gesperrten Server verlassen: ${err.message}`));
  return true;
}

// ---------- Systemstatus ----------

let commit; // einmal ermitteln
function gitCommit() {
  if (commit !== undefined) return commit;
  commit = process.env.GIT_COMMIT || process.env.SOURCE_COMMIT || null;
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim() || null;
    } catch {
      commit = null;
    }
  }
  return commit;
}

function dbFile() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  return path.join(dir, 'db.json');
}

function systemStatus(client) {
  const mem = process.memoryUsage();
  let dbBytes = null;
  try {
    dbBytes = fs.statSync(dbFile()).size;
  } catch {
    // noch keine Datei
  }
  return {
    bot: { name: client.user?.username ?? null, id: client.user?.id ?? null, ping: client.ws?.ping ?? null, guilds: client.guilds?.cache?.size ?? 0 },
    process: {
      uptime: Math.round(process.uptime()),
      node: process.version,
      pid: process.pid,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      startedAt: Date.now() - Math.round(process.uptime() * 1000),
    },
    host: {
      platform: `${os.type()} ${os.release()}`,
      cpus: os.cpus().length,
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      memory: { total: os.totalmem(), free: os.freemem() },
    },
    db: { bytes: dbBytes, sections: Object.keys(data).length },
    version: { commit: gitCommit(), discordJs: require('discord.js').version },
    errors: { total: errors().length, lastAt: errors()[0]?.at ?? null },
  };
}

// ---------- Backup ----------

// Kopie der Datenbank ohne geheime Sitzungen.
function exportBackup() {
  const copy = structuredClone(data);
  for (const key of SECRET_KEYS) delete copy[key];
  return copy;
}

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// Backup einspielen: ersetzt alle Bereiche außer den Sitzungen. Vorher wird der aktuelle Stand als Datei gesichert.
// Bereiche werden „an Ort und Stelle“ ersetzt, damit Module, die einen Bereich zwischenspeichern, den neuen Stand sehen.
function restoreBackup(backup) {
  if (!isPlainObject(backup)) throw new Error('Das Backup muss ein JSON-Objekt sein (Inhalt einer db.json).');
  const keys = Object.keys(backup).filter((k) => !SECRET_KEYS.includes(k));
  if (!keys.length) throw new Error('Das Backup ist leer.');
  if (keys.some((k) => ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error('Ungültiges Backup.');

  flush();
  const file = dbFile();
  const safety = `${file}.vor-wiederherstellung-${Date.now()}`;
  if (fs.existsSync(file)) fs.copyFileSync(file, safety);

  for (const key of Object.keys(data)) {
    if (SECRET_KEYS.includes(key) || key in backup) continue;
    if (isPlainObject(data[key])) for (const k of Object.keys(data[key])) delete data[key][k];
    else delete data[key];
  }
  for (const key of keys) {
    const value = structuredClone(backup[key]);
    if (isPlainObject(data[key]) && isPlainObject(value)) {
      for (const k of Object.keys(data[key])) delete data[key][k];
      Object.assign(data[key], value);
    } else data[key] = value;
  }
  flush();
  return { sections: keys.length, safety: path.basename(safety) };
}

module.exports = {
  captureErrors,
  recordError,
  errorList,
  clearErrors,
  recordAudit,
  auditList,
  valueAt,
  isBlocked,
  blockedList,
  block,
  unblock,
  leaveIfBlocked,
  systemStatus,
  exportBackup,
  restoreBackup,
  SECRET_KEYS,
};
