// Verbindung zum eigenen Roblox-Spiel über die offizielle Roblox Open Cloud API.
// Alles läuft vom Bot zu Roblox. Der Bot braucht keinen eigenen Webserver, das klappt auf jedem Bot-Hoster.
//
// .env:
//   ROBLOX_UNIVERSE_ID  Universe-ID des Spiels (Creator Hub → Spiel → „Copy Universe ID“)
//   ROBLOX_API_KEY      Open-Cloud-API-Key (siehe docs/roblox.md, welche Rechte er braucht)

const BASE = 'https://apis.roblox.com/cloud/v2';
// Thema, auf das das Spiel-Skript (roblox/ENRPBridge.server.lua) hört. Muss in beiden gleich sein.
const TOPIC = 'ENRPBot';
// Datastore für Banns, die nur in den Privatservern eines Besitzers gelten (Schlüssel = Roblox-ID des Besitzers).
const PRIVATE_BANS_STORE = 'ENRPPrivatServerBans';

const universeId = () => (process.env.ROBLOX_UNIVERSE_ID ?? '').trim();
const apiKey = () => (process.env.ROBLOX_API_KEY ?? '').trim();
const isConfigured = () => Boolean(universeId() && apiKey());

class RobloxError extends Error {}

const HINTS = {
  401: 'Der ROBLOX_API_KEY ist ungültig oder abgelaufen.',
  403: 'Dem API-Key fehlt eine Berechtigung oder er ist nicht für dieses Spiel freigegeben (siehe docs/roblox.md).',
  404: 'Nicht gefunden. Stimmt die ROBLOX_UNIVERSE_ID?',
  429: 'Roblox bremst gerade (zu viele Anfragen). Versuche es gleich noch einmal.',
};

async function cloud(method, path, body) {
  if (!isConfigured()) throw new RobloxError('Das Spiel ist nicht verbunden: ROBLOX_UNIVERSE_ID und ROBLOX_API_KEY fehlen in der .env.');
  const res = await fetch(`${BASE}/universes/${universeId()}${path}`, {
    method,
    headers: { 'x-api-key': apiKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (method === 'GET' && res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[roblox] ${method} ${path} → HTTP ${res.status} ${detail.slice(0, 300)}`);
    throw new RobloxError(HINTS[res.status] ?? `Roblox antwortet mit HTTP ${res.status}.`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// Nachricht an laufende Spielserver. target: "all" oder privateTarget(ownerId) für die Privatserver eines Besitzers.
// Roblox erlaubt höchstens 1 KB pro Nachricht.
async function publish(action, target, data = {}) {
  const message = JSON.stringify({ v: 1, action, target, ...data });
  if (Buffer.byteLength(message) > 1000) throw new RobloxError('Die Nachricht ist zu lang für Roblox (max. 1 KB).');
  await cloud('POST', ':publishMessage', { topic: TOPIC, message });
}

// Bann für das ganze Spiel über die offizielle Roblox-Ban-API. seconds = null → dauerhaft.
async function banUser(userId, { seconds, displayReason, privateReason, excludeAltAccounts = false }) {
  const restriction = {
    active: true,
    displayReason: displayReason.slice(0, 400),
    privateReason: privateReason.slice(0, 1000),
    excludeAltAccounts,
  };
  if (seconds) restriction.duration = `${seconds}s`;
  await cloud('PATCH', `/user-restrictions/${userId}`, { gameJoinRestriction: restriction });
}

async function unbanUser(userId) {
  await cloud('PATCH', `/user-restrictions/${userId}`, { gameJoinRestriction: { active: false } });
}

async function getBan(userId) {
  const result = await cloud('GET', `/user-restrictions/${userId}`);
  const r = result?.gameJoinRestriction;
  return r?.active ? r : null;
}

// Datastore-Einträge (Werte sind JSON).
async function getEntry(store, key) {
  const entry = await cloud('GET', `/data-stores/${encodeURIComponent(store)}/entries/${encodeURIComponent(key)}`);
  return entry?.value ?? null;
}

async function setEntry(store, key, value) {
  await cloud('PATCH', `/data-stores/${encodeURIComponent(store)}/entries/${encodeURIComponent(key)}?allowMissing=true`, { value });
}

const privateTarget = (ownerId) => `owner:${ownerId}`;

const isActive = (ban, now = Math.floor(Date.now() / 1000)) => !ban.expires || ban.expires > now;

// Banns der Privatserver eines Besitzers: { robloxUserId: { name, reason, expires (Unix-Sekunden, 0 = dauerhaft), by } }
async function getPrivateBans(ownerId) {
  const bans = (await getEntry(PRIVATE_BANS_STORE, String(ownerId))) ?? {};
  return Object.fromEntries(Object.entries(bans).filter(([, ban]) => isActive(ban)));
}

async function updatePrivateBans(ownerId, change) {
  const bans = await getPrivateBans(ownerId); // Abgelaufene fallen dabei weg
  change(bans);
  await setEntry(PRIVATE_BANS_STORE, String(ownerId), bans);
  return bans;
}

// Öffentliche Spiel-Statistik (kein API-Key nötig), 60 Sekunden zwischengespeichert.
let statsCache = { at: 0, value: null };
async function gameStats() {
  if (!universeId()) return null;
  if (Date.now() - statsCache.at < 60_000 && statsCache.value) return statsCache.value;
  const res = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId()}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new RobloxError(`Roblox antwortet mit HTTP ${res.status}.`);
  const game = (await res.json()).data?.[0];
  if (!game) throw new RobloxError('Spiel nicht gefunden. Stimmt die ROBLOX_UNIVERSE_ID?');
  const value = {
    name: game.name,
    playing: game.playing ?? 0,
    visits: game.visits ?? 0,
    favorites: game.favoritedCount ?? 0,
    maxPlayers: game.maxPlayers ?? 0,
    url: `https://www.roblox.com/games/${game.rootPlaceId}`,
  };
  statsCache = { at: Date.now(), value };
  return value;
}

// "30m", "12h", "7d", "2w" → Sekunden; "perm"/"dauerhaft" → null. Ungültig → wirft.
function parseDuration(text) {
  const value = text.trim().toLowerCase();
  if (['perm', 'permanent', 'dauerhaft', 'immer', '-1'].includes(value)) return null;
  const match = value.match(/^(\d+)\s*(m|min|h|std|d|t|w)$/);
  if (!match) throw new RobloxError(`Dauer „${text}“ verstehe ich nicht. Beispiele: \`30m\`, \`12h\`, \`7d\`, \`2w\`, \`perm\``);
  const unit = { m: 60, min: 60, h: 3600, std: 3600, d: 86_400, t: 86_400, w: 604_800 }[match[2]];
  const seconds = Number(match[1]) * unit;
  if (seconds <= 0) throw new RobloxError('Die Dauer muss größer als 0 sein.');
  return seconds;
}

function formatDuration(seconds) {
  if (!seconds) return 'dauerhaft';
  for (const [unit, label] of [[604_800, 'Woche(n)'], [86_400, 'Tag(e)'], [3600, 'Stunde(n)'], [60, 'Minute(n)']]) {
    if (seconds % unit === 0) return `${seconds / unit} ${label}`;
  }
  return `${seconds} Sekunden`;
}

module.exports = {
  TOPIC,
  PRIVATE_BANS_STORE,
  RobloxError,
  isConfigured,
  universeId,
  publish,
  privateTarget,
  banUser,
  unbanUser,
  getBan,
  getPrivateBans,
  updatePrivateBans,
  gameStats,
  parseDuration,
  formatDuration,
};
