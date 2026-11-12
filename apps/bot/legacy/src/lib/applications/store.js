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

// Bewerbungsarten eines Servers (aus config.json und selbst erstellt). Gelöschte Arten mit alten Bewerbungen sind
// nur noch archiviert: types() blendet sie aus, typeById() findet sie weiterhin (für alte Bewerbungen).
const allTypes = (guildId) => forGuild(guildId).applications.types;
const types = (guildId) => allTypes(guildId).filter((t) => !t.archived);
const typeById = (guildId, id) => allTypes(guildId).find((t) => t.id === id);
const baseTypes = () => base.applications.types;

// Vorschläge für Befehlsoptionen „art“ (Autovervollständigung, max. 25).
function typeChoices(guildId, query = '', { extra = [] } = {}) {
  const q = query.trim().toLowerCase();
  return [...extra, ...types(guildId).map((t) => ({ name: `${t.emoji} ${t.name}`.trim(), value: t.id }))]
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.includes(q))
    .slice(0, 25)
    .map((c) => ({ name: c.name.slice(0, 100), value: c.value }));
}
const isOpenStatus = (status) => !FINAL.includes(status);
const initialStatus = (type) => (type.workflow === 'police' ? 'SUBMITTED' : 'OPEN');

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
  if (type.archived) return 'Diese Bewerbung gibt es nicht mehr.';
  if (!type.questions.length) return `**${type.name}** ist noch nicht fertig eingerichtet (es gibt noch keine Fragen).`;
  if (!type.enabled) return `Bewerbungen für **${type.name}** sind derzeit geschlossen.`;
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

// Nach einem Neustart sind laufende DM-Bewerbungen verloren – Anzeige aufräumen.
function resetProgress() {
  data.appProgress = {};
  save();
}

module.exports = {
  STATUS,
  FINAL,
  POLICE_TRANSITIONS,
  allTypes,
  types,
  typeById,
  baseTypes,
  typeChoices,
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
  banMessage,
  eligibility,
  setProgress,
  clearProgress,
  resetProgress,
};
