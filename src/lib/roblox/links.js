// Welche Discord-Server was im Spiel dürfen, und welcher Discord-Nutzer zu welchem Roblox-Konto gehört.
//
// Haupt-Discord   (ROBLOX_MAIN_GUILD_IDS in der .env): steuert das ganze Spiel – Banns, Kicks und Ansagen in allen Servern.
// Privatserver-Discord: wird vom Haupt-Discord mit dem Besitzer eines Privatservers verknüpft und darf nur in dessen
//                       Privatservern moderieren. Erkannt wird der Privatserver im Spiel über game.PrivateServerOwnerId,
//                       so muss niemand eine Server-ID abtippen.
// Andere Discords: nur Status und Verifizierung.
//
// Die Verknüpfung liegt bewusst nicht in /einstellungen: Sonst könnte sich jeder Server-Admin selbst Rechte im Spiel geben.
const db = require('../db');

const mainGuildIds = () =>
  (process.env.ROBLOX_MAIN_GUILD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const privateServers = () => (db.data.robloxPrivateServers ??= {}); // guildId → { ownerId, ownerName, name, linkedBy, linkedAt }
const accounts = () => (db.data.robloxAccounts ??= {}); // discordUserId → { id, name, verifiedAt }

// { type: 'main' } | { type: 'private', ownerId, ownerName, name } | { type: 'none' }
function scopeOf(guildId) {
  if (mainGuildIds().includes(guildId)) return { type: 'main' };
  const link = privateServers()[guildId];
  if (link) return { type: 'private', ...link };
  return { type: 'none' };
}

function linkPrivateServer(guildId, { ownerId, ownerName, name, linkedBy }) {
  if (mainGuildIds().includes(guildId)) throw new Error('Das ist ein Haupt-Discord, der kann nicht auf einen Privatserver beschränkt werden.');
  const taken = Object.entries(privateServers()).find(([id, link]) => id !== guildId && link.ownerId === ownerId);
  if (taken) throw new Error(`Die Privatserver von ${ownerName} sind schon mit dem Discord-Server \`${taken[0]}\` verknüpft.`);
  privateServers()[guildId] = { ownerId, ownerName, name, linkedBy, linkedAt: Date.now() };
  db.save();
}

function unlinkPrivateServer(guildId) {
  const existed = Boolean(privateServers()[guildId]);
  delete privateServers()[guildId];
  db.save();
  return existed;
}

const listPrivateServers = () => Object.entries(privateServers()).map(([guildId, link]) => ({ guildId, ...link }));

// Roblox-Konten (gelten auf allen Discord-Servern des Bots)
const getAccount = (discordId) => accounts()[discordId] ?? null;

function setAccount(discordId, robloxUser) {
  for (const [otherId, account] of Object.entries(accounts())) {
    if (otherId !== discordId && account.id === robloxUser.id) delete accounts()[otherId]; // Ein Roblox-Konto gehört nur einem Discord-Nutzer
  }
  accounts()[discordId] = { id: robloxUser.id, name: robloxUser.name, verifiedAt: Date.now() };
  db.save();
}

function removeAccount(discordId) {
  const existed = Boolean(accounts()[discordId]);
  delete accounts()[discordId];
  db.save();
  return existed;
}

const discordIdForRoblox = (robloxId) => Object.entries(accounts()).find(([, a]) => a.id === String(robloxId))?.[0] ?? null;

module.exports = {
  mainGuildIds,
  scopeOf,
  linkPrivateServer,
  unlinkPrivateServer,
  listPrivateServers,
  getAccount,
  setAccount,
  removeAccount,
  discordIdForRoblox,
};
