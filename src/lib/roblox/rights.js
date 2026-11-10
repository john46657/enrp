// Spielrechte – nur für Privatserver.
// Ein Privatserver-Discord legt fest, welche Discord-Rolle welches Recht im Spiel gibt (/einstellungen spielrecht),
// z. B. Rolle @Polizei (wird bei angenommener Polizei-Bewerbung vergeben) → Recht „polizei“.
// Das Spiel-Skript lässt dann in den Privatservern dieses Besitzers nur noch Spieler mit dem Recht ins Polizei-Team.
//
// Die Discord-Rollen sind die Quelle: Rolle bekommen → Recht im Spiel, Rolle weg (degradiert, Discord verlassen)
// → Recht weg. Das Roblox-Konto kommt aus /verifizieren, sonst aus der zuletzt angenommenen Bewerbung.
// Öffentliche Server des Spiels sind davon nicht betroffen.
const db = require('../db');
const { forGuild } = require('../settings');
const { sendTo, embed } = require('../util');
const cloud = require('./openCloud');
const links = require('./links');
const appStore = require('../applications/store');
const { profileUrl } = require('../applications/roblox');

const RIGHTS_STORE = 'ENRPRechte'; // Datastore, Schlüssel siehe rightsKey()
const DEBOUNCE_MS = 2000; // Mehrere Rollenänderungen kurz hintereinander (z. B. bei einer Annahme) zusammenfassen
const GAP_MS = 300; // Abstand zwischen zwei Abgleichen, damit Roblox nicht bremst

const rightsKey = (ownerId, robloxId) => `owner-${ownerId}-user-${robloxId}`; // so auch im Spiel-Skript
const synced = () => (db.data.robloxRights ??= {}); // "guildId:discordId" → { robloxId, robloxName, rights }
const stateKey = (guildId, discordId) => `${guildId}:${discordId}`;

// Rechte, die es im Spiel gibt (config.json → roblox.rights)
const availableRights = (guildId) => forGuild(guildId).roblox.rights;

// { recht: rollenId } dieses Discords, ohne leere Einträge und ohne Rechte, die es nicht (mehr) gibt
function rightRoles(guildId) {
  const known = new Set(availableRights(guildId).map((r) => r.id));
  return Object.fromEntries(Object.entries(forGuild(guildId).roblox.rightRoles ?? {}).filter(([right, roleId]) => roleId && known.has(right)));
}

const desiredRights = (guildId, member) =>
  member
    ? Object.entries(rightRoles(guildId))
        .filter(([, roleId]) => member.roles.cache.has(roleId))
        .map(([right]) => right)
        .sort()
    : [];

// Verifiziertes Konto; sonst das Roblox-Konto der zuletzt angenommenen Bewerbung auf diesem Discord.
function accountFor(guildId, discordId) {
  const verified = links.getAccount(discordId);
  if (verified) return { id: String(verified.id), name: verified.name, source: 'verifiziert' };
  const accepted = appStore
    .historyOf(guildId, discordId)
    .filter((r) => r.status === 'ACCEPTED' && r.roblox?.id)
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))[0];
  return accepted ? { id: String(accepted.roblox.id), name: accepted.roblox.name, source: `Bewerbung ${accepted.number}` } : null;
}

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);
const warnedMissing = new Map(); // Warnung „Roblox-Konto fehlt“ nur einmal je Person und Rechte-Stand

// Im Datastore speichern und laufende Privatserver sofort informieren.
async function pushRights(ownerId, robloxId, rights) {
  await cloud.setEntry(RIGHTS_STORE, rightsKey(ownerId, robloxId), { rights, updated: Math.floor(Date.now() / 1000) });
  await cloud.publish('rights', cloud.privateTarget(ownerId), { userId: String(robloxId), rights });
}

async function getRights(ownerId, robloxId) {
  const value = await cloud.getEntry(RIGHTS_STORE, rightsKey(ownerId, robloxId));
  return Array.isArray(value?.rights) ? value.rights : [];
}

function logChange(guild, title, lines, color = 'primary') {
  return sendTo(guild, 'modLog', { embeds: [embed(color).setTitle(`🔑 ${title}`).setDescription(lines.join('\n'))] });
}

// Gleicht eine Person ab. Gibt { account, rights, before } zurück oder null, wenn dieser Discord keine Spielrechte hat.
async function syncMember(guild, discordId, { log = false } = {}) {
  const scope = links.scopeOf(guild.id);
  if (scope.type !== 'private' || !cloud.isConfigured()) return null;

  const key = stateKey(guild.id, discordId);
  const state = synced()[key];
  const member = await guild.members.fetch(discordId).catch(() => null);
  const rights = desiredRights(guild.id, member);
  const account = rights.length || state ? accountFor(guild.id, discordId) : null;
  const before = state?.rights ?? [];

  // Anderes Roblox-Konto als beim letzten Mal (neu verifiziert) → altes Konto verliert die Rechte
  if (state && state.robloxId !== account?.id && before.length) await pushRights(scope.ownerId, state.robloxId, []);
  if (account && (state?.robloxId !== account.id || !sameList(before, rights))) await pushRights(scope.ownerId, account.id, rights);

  if (account && rights.length) synced()[key] = { robloxId: account.id, robloxName: account.name, rights };
  else delete synced()[key];
  db.save();

  const missing = rights.length && !account ? rights.join() : null;
  const warnAgain = missing !== null && warnedMissing.get(key) !== missing;
  if (missing === null) warnedMissing.delete(key);
  else warnedMissing.set(key, missing);

  if (log) {
    const who = `<@${discordId}>`;
    if (missing !== null) {
      if (warnAgain) {
        await logChange(guild, 'Spielrechte: Roblox-Konto fehlt', [
          `${who} hat eine Rolle für **${rights.join(', ')}**, aber kein Roblox-Konto.`,
          'Die Person muss sich mit `/verifizieren start` verknüpfen, dann wird sie im Privatserver freigeschaltet.',
        ], 'warning');
      }
    } else if (account && (!sameList(before, rights) || state?.robloxId !== account.id)) {
      const added = rights.filter((r) => !before.includes(r));
      const removed = before.filter((r) => !rights.includes(r));
      await logChange(guild, 'Spielrechte geändert', [
        `${who} · Roblox: [${account.name}](${profileUrl(account.id)}) (${account.source})`,
        ...(added.length ? [`➕ ${added.join(', ')}`] : []),
        ...(removed.length ? [`➖ ${removed.join(', ')}`] : []),
        `Jetzt: **${rights.join(', ') || 'keine'}**`,
      ], rights.length ? 'success' : 'warning');
    } else if (!account && state && before.length) {
      await logChange(guild, 'Spielrechte entfernt', [`${who} · Roblox: ${state.robloxName ?? state.robloxId} – kein Konto mehr verknüpft`], 'warning');
    }
  }
  return { account, rights, before };
}

// Alle Abgleiche laufen nacheinander mit kleinem Abstand.
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task);
  chain = run
    .catch((err) => console.error('[spielrechte]', err.message))
    .then(() => new Promise((resolve) => setTimeout(resolve, GAP_MS)));
  return run;
}

const timers = new Map();
function scheduleSync(guild, discordId, options = { log: true }) {
  if (links.scopeOf(guild.id).type !== 'private' || !cloud.isConfigured()) return;
  const key = stateKey(guild.id, discordId);
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      enqueue(() => syncMember(guild, discordId, options)).catch(() => {});
    }, DEBOUNCE_MS),
  );
}

// Ganzen Discord abgleichen (Start, Verknüpfen, geänderte Einstellungen). Gibt die Anzahl geprüfter Personen zurück.
async function syncGuild(guild, options = { log: false }) {
  if (links.scopeOf(guild.id).type !== 'private' || !cloud.isConfigured()) return 0;
  const roleIds = new Set(Object.values(rightRoles(guild.id)));
  const ids = new Set(
    Object.keys(synced())
      .filter((k) => k.startsWith(`${guild.id}:`))
      .map((k) => k.slice(guild.id.length + 1)),
  );
  if (roleIds.size) {
    const members = await guild.members.fetch().catch((err) => console.error('[spielrechte] Mitglieder laden:', err.message));
    members?.forEach((m) => {
      if (m.roles.cache.some((r) => roleIds.has(r.id))) ids.add(m.id);
    });
  }
  await Promise.all([...ids].map((id) => enqueue(() => syncMember(guild, id, options)).catch(() => {})));
  return ids.size;
}

// Discord wurde vom Privatserver getrennt: alle Rechte, die er vergeben hat, wieder entfernen.
async function clearGuild(guildId, ownerId) {
  const keys = Object.keys(synced()).filter((k) => k.startsWith(`${guildId}:`));
  await Promise.all(
    keys.map((key) =>
      enqueue(async () => {
        const state = synced()[key];
        if (state?.rights.length) await pushRights(ownerId, state.robloxId, []);
        delete synced()[key];
        db.save();
      }).catch(() => {}),
    ),
  );
  return keys.length;
}

// "Polizei" → "polizei"
const RIGHT_NAME = /^[a-z0-9_]{1,30}$/;

module.exports = {
  RIGHTS_STORE,
  RIGHT_NAME,
  rightsKey,
  availableRights,
  rightRoles,
  accountFor,
  getRights,
  syncMember,
  scheduleSync,
  syncGuild,
  clearGuild,
};
