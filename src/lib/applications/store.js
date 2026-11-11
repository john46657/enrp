// Datenhaltung für Bewerbungen, Sperren und „in Bearbeitung“ (alles in data/db.json).
const { base, forGuild } = require('../settings');
const { data, bucket, save, nextNumber } = require('../db');
const { isStaff } = require('../util');

const STATUS = {
  SUBMITTED: 'Eingereicht',
  SCREENING: 'In Prüfung',
  INTERVIEW: 'Gespräch',
  PENDING_DECISION: 'Entscheidung ausstehend',
  OPEN: 'Offen',
  ACCEPTED: 'Angenommen',
  REJECTED: 'Abgelehnt',
  WITHDRAWN: 'Zurückgezogen',
};
const FINAL = ['ACCEPTED', 'REJECTED', 'WITHDRAWN'];
// Erlaubte Statuswechsel der Polizei-Bewerbung
const POLICE_TRANSITIONS = {
  SUBMITTED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['PENDING_DECISION', 'REJECTED', 'WITHDRAWN'],
  PENDING_DECISION: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
};

// Bewerbungsarten mit den Einstellungen eines Servers; baseTypes() = Vorlage aus config.json (z. B. für Befehlsauswahlen).
const types = (guildId) => forGuild(guildId).applications.types;
const typeById = (guildId, id) => types(guildId).find((t) => t.id === id);
const baseTypes = () => base.applications.types;
const isOpenStatus = (status) => !FINAL.includes(status);
const initialStatus = (type) => (type.workflow === 'police' ? 'SUBMITTED' : 'OPEN');

// ---------- Bewerbungsphasen ----------

// Zeitpunkte stehen als Millisekunden (aus Discord) oder als ISO-Text (config.json) in den Einstellungen.
const toMs = (value) => {
  if (!value) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

// Zustand einer Bewerbungsart: { open, state: 'open'|'disabled'|'before'|'after'|'full', opensAt, closesAt, used, max }
function phaseOf(guildId, type, now = Date.now()) {
  const phase = type.phase ?? {};
  const opensAt = toMs(phase.opensAt);
  const closesAt = toMs(phase.closesAt);
  const max = phase.maxApplications || 0;
  const used = max ? Object.values(recordsOf(guildId)).filter((r) => r.type === type.id && r.createdAt >= (opensAt ?? 0)).length : 0;
  let state = 'open';
  if (!type.enabled) state = 'disabled';
  else if (opensAt && now < opensAt) state = 'before';
  else if (closesAt && now >= closesAt) state = 'after';
  else if (max && used >= max) state = 'full';
  return { open: state === 'open', state, opensAt, closesAt, used, max };
}

function phaseError(type, phase) {
  switch (phase.state) {
    case 'disabled':
    case 'after':
      return `Bewerbungen für **${type.name}** sind derzeit geschlossen.`;
    case 'before':
      return `Bewerbungen für **${type.name}** öffnen <t:${Math.floor(phase.opensAt / 1000)}:R> (<t:${Math.floor(phase.opensAt / 1000)}:f>).`;
    case 'full':
      return `Für **${type.name}** sind in dieser Bewerbungsphase alle ${phase.max} Plätze vergeben.`;
    default:
      return null;
  }
}

// Kurzer Hinweis fürs Panel, z. B. „(öffnet in 2 Tagen)“; leer, wenn ohne Einschränkung offen.
function phaseLabel(phase) {
  const unix = (ms) => Math.floor(ms / 1000);
  switch (phase.state) {
    case 'disabled':
    case 'after':
      return '*(geschlossen)*';
    case 'before':
      return `*(öffnet <t:${unix(phase.opensAt)}:R>)*`;
    case 'full':
      return '*(alle Plätze vergeben)*';
    default: {
      const parts = [phase.closesAt && `offen bis <t:${unix(phase.closesAt)}:f>`, phase.max && `${phase.max - phase.used} von ${phase.max} Plätzen frei`].filter(Boolean);
      return parts.length ? `*(${parts.join(' · ')})*` : '';
    }
  }
}

const recordsOf = (guildId) => bucket('apps', guildId);
const bansOf = (guildId) => bucket('appBans', guildId);
const progressOf = (guildId) => bucket('appProgress', guildId);

function getRecord(guildId, number) {
  return recordsOf(guildId)[number] ?? null;
}

function createRecord(guildId, type, fields) {
  const number = `${type.numberPrefix}-${String(nextNumber(`app:${type.numberPrefix}`, guildId)).padStart(4, '0')}`;
  const record = {
    number,
    type: type.id,
    guildId,
    status: initialStatus(type),
    createdAt: Date.now(),
    version: 1,
    history: [{ status: initialStatus(type), by: fields.userId, at: Date.now() }],
    ...fields,
  };
  recordsOf(guildId)[number] = record;
  save();
  return record;
}

// Ändert den Status; gibt false zurück, wenn die Bewerbung inzwischen schon entschieden wurde.
function setStatus(record, status, by, extra = {}) {
  if (!isOpenStatus(record.status)) return false;
  record.status = status;
  record.version++;
  record.history.push({ status, by, at: Date.now(), ...(extra.reason ? { reason: extra.reason } : {}) });
  if (FINAL.includes(status)) {
    record.decidedBy = by;
    record.decidedAt = Date.now();
    record.reason = extra.reason ?? null;
  }
  save();
  return true;
}

const historyOf = (guildId, userId) =>
  Object.values(recordsOf(guildId))
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);

const openOf = (guildId, filter = () => true) =>
  Object.values(recordsOf(guildId)).filter((r) => isOpenStatus(r.status) && filter(r));

// Darf in Discord entscheiden: Staff oder eine Manager-Rolle dieser Bewerbung.
function isManager(member, type) {
  if (!member) return false;
  return isStaff(member) || type.roles.managers.some((id) => member.roles.cache.has(id));
}
const managesAny = (member) => types(member.guild.id).some((t) => isManager(member, t));

// ---------- Sperren ----------

function activeBan(guildId, typeId, { discordId, robloxId }) {
  const type = typeById(guildId, typeId);
  const now = Date.now();
  return (
    Object.values(bansOf(guildId)).find((ban) => {
      if (ban.liftedAt || (ban.expiresAt && ban.expiresAt < now)) return false;
      const scoped = ban.scopes.includes('*') || ban.scopes.includes(typeId) || (ban.scopes.includes('police') && type?.workflow === 'police');
      const matches = (discordId && ban.discordId === discordId) || (robloxId && ban.robloxId === robloxId);
      return scoped && matches;
    }) ?? null
  );
}

// Legt eine Sperre an. scope: '*', 'police' oder der Schlüssel einer Bewerbungsart.
function addBan(guildId, { discordId = null, roblox = null, scope = '*', reason, days = null, createdBy }) {
  const id = `B-${String(nextNumber('appBan', guildId)).padStart(4, '0')}`;
  const ban = {
    id,
    discordId,
    robloxId: roblox?.id ?? null,
    robloxName: roblox?.name ?? null,
    scopes: [scope],
    reason,
    expiresAt: days ? Date.now() + days * 86_400_000 : null,
    createdBy,
    createdAt: Date.now(),
  };
  bansOf(guildId)[id] = ban;
  save();
  return ban;
}

// Hebt eine Sperre auf; gibt sie zurück oder null, wenn es sie nicht (mehr) gibt.
function liftBan(guildId, id, by) {
  const ban = bansOf(guildId)[id];
  if (!ban || ban.liftedAt) return null;
  ban.liftedAt = Date.now();
  ban.liftedBy = by;
  save();
  return ban;
}

const activeBans = (guildId, now = Date.now()) => Object.values(bansOf(guildId)).filter((b) => !b.liftedAt && (!b.expiresAt || b.expiresAt > now));
const scopeName = (guildId, scope) => (scope === '*' ? 'Alle Bewerbungen' : scope === 'police' ? 'Polizei-Bewerbung' : (typeById(guildId, scope)?.name ?? scope));

function banMessage(ban) {
  return `🚫 Du bist für diese Bewerbung gesperrt.\n**Grund:** ${ban.reason}${ban.expiresAt ? `\n**Bis:** <t:${Math.floor(ban.expiresAt / 1000)}:f>` : ''}`;
}

// ---------- Prüfungen (vor dem Start und beim Einreichen) ----------

function roleCheck(member, type) {
  const has = (id) => member.roles.cache.has(id);
  const { required, requiredMode, blocked, blockedMode } = type.roles;
  if (required.length && !(requiredMode === 'any' ? required.some(has) : required.every(has))) {
    return `Dir fehlen die nötigen Rollen: ${required.map((id) => `<@&${id}>`).join(requiredMode === 'any' ? ' oder ' : ', ')}`;
  }
  if (blocked.length && (blockedMode === 'all' ? blocked.every(has) : blocked.some(has))) {
    return 'Mit deinen aktuellen Rollen kannst du dich hierfür nicht bewerben.';
  }
  return null;
}

// Gibt eine Fehlermeldung zurück oder null.
function eligibility(member, type, { robloxId } = {}) {
  const closed = phaseError(type, phaseOf(member.guild.id, type));
  if (closed) return closed;
  const roles = roleCheck(member, type);
  if (roles) return roles;
  const ban = activeBan(member.guild.id, type.id, { discordId: member.id, robloxId });
  if (ban) return banMessage(ban);

  const open = openOf(member.guild.id, (r) => r.type === type.id && (r.userId === member.id || (robloxId && type.workflow === 'police' && r.roblox?.id === robloxId)));
  if (open.length) return `Es gibt bereits eine offene **${type.name}** (${open[0].number}). Bitte warte auf die Entscheidung.`;

  const last = historyOf(member.guild.id, member.id).find((r) => r.type === type.id);
  const until = last ? last.createdAt + type.cooldownMinutes * 60_000 : 0;
  if (until > Date.now()) return `Du kannst dich erst wieder <t:${Math.floor(until / 1000)}:R> für **${type.name}** bewerben.`;
  return null;
}

// ---------- „In Bearbeitung“ ----------

function setProgress(guildId, userId, typeId, data) {
  progressOf(guildId)[`${userId}:${typeId}`] = { userId, typeId, ...data };
  save();
}

function clearProgress(guildId, userId, typeId) {
  delete progressOf(guildId)[`${userId}:${typeId}`];
  save();
}

// Laufende DM-Bewerbungen ({ userId: Sitzung }). Sie liegen in der Datenbank, damit sie einen Neustart überstehen.
const sessions = () => (data.appSessions ??= {});

// Nach dem Start: Anzeige „in Bearbeitung“ auf die Sitzungen und Web-Formulare beschränken, die es noch gibt.
function cleanProgress(now = Date.now()) {
  for (const [guildId, entries] of Object.entries((data.appProgress ??= {}))) {
    for (const [key, entry] of Object.entries(entries)) {
      const session = sessions()[entry.userId];
      const alive = entry.web ? entry.expiresAt > now : session?.guildId === guildId && session.typeId === entry.typeId;
      if (!alive) delete entries[key];
    }
  }
  save();
}

module.exports = {
  STATUS,
  FINAL,
  POLICE_TRANSITIONS,
  types,
  typeById,
  baseTypes,
  isOpenStatus,
  recordsOf,
  bansOf,
  progressOf,
  getRecord,
  createRecord,
  setStatus,
  historyOf,
  openOf,
  isManager,
  managesAny,
  activeBan,
  activeBans,
  addBan,
  liftBan,
  scopeName,
  banMessage,
  eligibility,
  setProgress,
  clearProgress,
  cleanProgress,
  sessions,
  toMs,
  phaseOf,
  phaseError,
  phaseLabel,
};
