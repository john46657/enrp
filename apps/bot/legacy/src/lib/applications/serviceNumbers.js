// Dienstnummern: bei Annahme automatisch die nächste freie Nummer vergeben, optional mit Nickname.
const { bucket, save } = require('../db');
const { fill } = require('../util');

// userId → { userId, n, value, typeId, application, at }
const numbersOf = (guildId) => bucket('serviceNumbers', guildId);
const getNumber = (guildId, userId) => numbersOf(guildId)[userId] ?? null;

// "PD-{n}" mit digits 2 → "PD-07"; ohne {n} wird die Nummer angehängt.
function formatNumber(cfg, n) {
  const padded = String(n).padStart(cfg.digits || 1, '0');
  return cfg.format?.includes('{n}') ? cfg.format.replaceAll('{n}', padded) : `${cfg.format ?? ''}${padded}`;
}

const isTaken = (guildId, value, exceptUserId) => Object.values(numbersOf(guildId)).some((e) => e.value === value && e.userId !== exceptUserId);

// Kleinste freie Nummer zwischen start und end (end 0 = offen), null wenn alle vergeben sind.
function nextFree(guildId, cfg) {
  const used = new Set(Object.values(numbersOf(guildId)).map((e) => e.value));
  const start = cfg.start ?? 1;
  const end = cfg.end > 0 ? cfg.end : start + 99_999;
  for (let n = start; n <= end; n++) {
    if (!used.has(formatNumber(cfg, n))) return n;
  }
  return null;
}

// Nickname nach Vorlage setzen: {serviceNumber} {name} {roblox} {username}. name = Roblox-Name, sonst Discord-Name.
async function applyNickname(member, cfg, entry, robloxName) {
  if (!member || !cfg.nickname) return false;
  const username = member.user.globalName ?? member.user.username;
  const nick = fill(cfg.nickname, { serviceNumber: entry.value, name: robloxName ?? username, roblox: robloxName ?? '', username }).trim().slice(0, 32);
  if (!nick) return false;
  return member
    .setNickname(nick, `Dienstnummer ${entry.value}`)
    .then(() => true)
    .catch((err) => {
      console.error(`[dienstnummer] Nickname für ${member.id}:`, err.message);
      return false;
    });
}

function store(guildId, userId, cfg, n, typeId, application) {
  const entry = { userId, n, value: formatNumber(cfg, n), typeId, application: application ?? null, at: Date.now() };
  numbersOf(guildId)[userId] = entry;
  save();
  return entry;
}

// Bei Annahme: vorhandene Nummer behalten, sonst die nächste freie vergeben. Gibt den Eintrag oder null zurück.
async function assign(guild, userId, member, type, record) {
  const cfg = type.serviceNumber;
  if (!cfg?.enabled) return null;
  const existing = getNumber(guild.id, userId);
  if (existing) return existing;
  const n = nextFree(guild.id, cfg);
  if (n === null) {
    console.warn(`[dienstnummer] Keine freie Dienstnummer mehr für ${type.id} (Bereich ${cfg.start}–${cfg.end}).`);
    return null;
  }
  const entry = store(guild.id, userId, cfg, n, type.id, record?.number);
  await applyNickname(member, cfg, entry, record?.roblox?.name);
  return entry;
}

// Von Hand setzen (/dienstnummer setzen). Wirft, wenn die Nummer schon vergeben ist.
async function setManual(guild, member, type, n, robloxName) {
  const cfg = type.serviceNumber;
  const value = formatNumber(cfg, n);
  if (isTaken(guild.id, value, member.id)) throw new Error(`Die Dienstnummer **${value}** ist schon vergeben.`);
  const entry = store(guild.id, member.id, cfg, n, type.id, getNumber(guild.id, member.id)?.application);
  await applyNickname(member, cfg, entry, robloxName);
  return entry;
}

function release(guildId, userId) {
  const entry = getNumber(guildId, userId);
  if (!entry) return null;
  delete numbersOf(guildId)[userId];
  save();
  return entry;
}

module.exports = { numbersOf, getNumber, formatNumber, nextFree, assign, setManual, release };
