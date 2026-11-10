// Banns fürs Spiel – gespeichert im Bot, abgefragt vom Spiel über die Bridge (GET /bridge/v1/bans, /player).
//
// Bereiche:
//   global       ganzes Spiel (nur Haupt-Discord). Ist ein Roblox-API-Key eingerichtet, wird der Bann zusätzlich
//                an die offizielle Roblox-Ban-API gespiegelt (Zweitaccount-Erkennung, wirkt auch ohne Bot).
//   owner:<id>   nur die Privatserver dieses Besitzers (Privatserver-Discord)
const db = require('../db');
const cloud = require('../roblox/openCloud');
const outbox = require('./outbox');

const store = () => (db.data.gameBans ??= {}); // Bereich → { robloxId: { name, reason, note, expires, by, at } }
const scopeKeyOf = (scope) => (scope.type === 'main' ? 'global' : `owner:${scope.ownerId}`);
const nowSeconds = () => Math.floor(Date.now() / 1000);
const isActive = (ban, now = nowSeconds()) => !ban.expires || ban.expires > now;

function cleanup(scopeKey) {
  const bans = store()[scopeKey] ?? {};
  for (const [id, ban] of Object.entries(bans)) if (!isActive(ban)) delete bans[id];
  return bans;
}

function list(scopeKey) {
  return Object.entries(cleanup(scopeKey)).map(([id, ban]) => ({ id, ...ban }));
}

function get(scopeKey, robloxId) {
  const ban = store()[scopeKey]?.[robloxId];
  return ban && isActive(ban) ? ban : null;
}

// seconds = null → dauerhaft. Gibt { mirrored, mirrorError } zurück.
async function add(scopeKey, player, { seconds, reason, note = '', by, excludeAltAccounts = false }) {
  const bans = (store()[scopeKey] ??= {});
  bans[player.id] = {
    name: player.name,
    reason: reason.slice(0, 300),
    note: note.slice(0, 500),
    expires: seconds ? nowSeconds() + seconds : 0,
    by,
    at: nowSeconds(),
  };
  db.save();
  outbox.bumpBans();
  if (scopeKey !== 'global' || !cloud.isConfigured()) return { mirrored: false };
  try {
    await cloud.banUser(player.id, { seconds, displayReason: reason, privateReason: [note, by].filter(Boolean).join(' · '), excludeAltAccounts });
    return { mirrored: true };
  } catch (err) {
    return { mirrored: false, mirrorError: err.message };
  }
}

async function remove(scopeKey, robloxId) {
  const existed = Boolean(store()[scopeKey]?.[robloxId]);
  if (existed) {
    delete store()[scopeKey][robloxId];
    db.save();
    outbox.bumpBans();
  }
  let mirrorError = null;
  if (scopeKey === 'global' && cloud.isConfigured()) {
    await cloud.unbanUser(robloxId).catch((err) => {
      mirrorError = err.message;
    });
  }
  return { existed, mirrorError };
}

// Alle Banns, die auf einem Spielserver gelten (global + Privatserver des Besitzers). Kompakt fürs Spiel.
function forServer(ownerId) {
  const result = {};
  for (const key of ['global', ...(ownerId ? [`owner:${ownerId}`] : [])]) {
    for (const ban of list(key)) result[ban.id] = { r: ban.reason, e: ban.expires, s: key === 'global' ? 'g' : 'p' };
  }
  return result;
}

module.exports = { scopeKeyOf, list, get, add, remove, forServer, isActive };
