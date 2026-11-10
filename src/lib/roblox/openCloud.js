// Optionaler Client für die offizielle Roblox Open Cloud API (https://apis.roblox.com/cloud/v2).
// Die Spiel-Anbindung selbst läuft über die eigene Domain (Bridge, src/lib/web). Open Cloud wird nur noch genutzt für:
//   - die Roblox-Ban-API: Banns im ganzen Spiel zusätzlich bei Roblox eintragen (Zweitaccount-Erkennung)
//   - die öffentliche Spiel-Statistik (Besuche, Favoriten; dafür reicht die Universe-ID)
//
// Zugangsdaten (Reihenfolge):
//   ROBLOX_UNIVERSE_ID  .env, sonst /spiel-admin universe
//   ROBLOX_API_KEY      .env, sonst verschlüsselt per /spiel-admin api-key (braucht ENRP_SECRET)
//
// Der Client kümmert sich um Zeitlimits, Wiederholungen (429/5xx/Netzwerk, exponentiell, Retry-After),
// ein API-Log ohne Geheimnisse und den Gesundheitszustand je Bereich (für /spiel-admin uebersicht).
const db = require('../db');
const secrets = require('../secrets');

const BASE = 'https://apis.roblox.com/cloud/v2';
const API_KEY_SECRET = 'robloxApiKey';

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const API_LOG_LIMIT = 300;

const gameConfig = () => (db.data.gameConfig ??= {});
const universeId = () => (process.env.ROBLOX_UNIVERSE_ID ?? '').trim() || String(gameConfig().universeId ?? '');
const apiKey = () => (process.env.ROBLOX_API_KEY ?? '').trim() || secrets.getSecret(API_KEY_SECRET) || '';
const apiKeySource = () => ((process.env.ROBLOX_API_KEY ?? '').trim() ? 'env' : secrets.secretInfo(API_KEY_SECRET) ? 'discord' : null);
const isConfigured = () => Boolean(universeId() && apiKey());

class RobloxError extends Error {
  constructor(message, { status = null, area = null } = {}) {
    super(message);
    this.status = status;
    this.area = area;
  }
}

const HINTS = {
  400: 'Roblox hat die Anfrage abgelehnt (ungültige Daten).',
  401: 'Der Roblox-API-Key ist ungültig oder abgelaufen.',
  403: 'Dem API-Key fehlt eine Berechtigung oder er ist nicht für dieses Spiel freigegeben (siehe docs/live-system.md, Abschnitt 3.2).',
  404: 'Nicht gefunden. Stimmt die Universe-ID?',
  429: 'Roblox bremst gerade (zu viele Anfragen). Versuche es gleich noch einmal.',
};

// ---------- API-Log und Gesundheit ----------

const health = new Map(); // Bereich → { ok, failed, lastOkAt, lastErrorAt, lastError, lastStatus, totalMs }
const recent = []; // die letzten Anfragen (nur im Speicher)

const apiLog = () => (db.data.apiLogs ??= []);

function areaOf(path) {
  if (path.startsWith('/user-restrictions')) return 'bans';
  if (path.startsWith('/games')) return 'stats';
  return 'other';
}

// Pfade ohne Spieler-IDs/Schlüssel, damit das Log keine personenbezogenen Daten sammelt.
const redactPath = (path) => path.replace(/\/user-restrictions\/\d+/, '/user-restrictions/{id}');

function redact(text) {
  let out = String(text ?? '');
  const key = apiKey();
  if (key) out = out.split(key).join('***');
  return out.replace(/x-api-key["']?\s*[:=]\s*["']?[^\s"',}]+/gi, 'x-api-key: ***').slice(0, 300);
}

function record({ method, path, status, ms, error, attempt }) {
  const area = areaOf(path);
  const h = health.get(area) ?? { ok: 0, failed: 0, lastOkAt: null, lastErrorAt: null, lastError: null, lastStatus: null, totalMs: 0 };
  h.lastStatus = status;
  h.totalMs += ms;
  if (error) {
    h.failed++;
    h.lastErrorAt = Date.now();
    h.lastError = error;
  } else {
    h.ok++;
    h.lastOkAt = Date.now();
  }
  health.set(area, h);

  const entry = { at: Date.now(), method, area, path: redactPath(path), status, ms, attempt, ...(error ? { error } : {}) };
  recent.push(entry);
  if (recent.length > 100) recent.shift();
  // Dauerhaft gespeichert werden nur Aktionen und Fehler, nicht jede Live-Abfrage.
  if (method !== 'GET' || error) {
    apiLog().push(entry);
    if (apiLog().length > API_LOG_LIMIT) apiLog().splice(0, apiLog().length - API_LOG_LIMIT);
    db.save();
  }
}

const healthReport = () => Object.fromEntries([...health.entries()].map(([area, h]) => [area, { ...h, avgMs: Math.round(h.totalMs / Math.max(1, h.ok + h.failed)) }]));
const recentRequests = () => [...recent];

// ---------- Anfragen ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(res, attempt) {
  const header = Number(res?.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 30_000);
  return 1000 * 2 ** (attempt - 1); // 1 s, 2 s, 4 s
}

// Gibt das geparste JSON zurück; bei GET/Queue-Read wird 404 als null geliefert.
async function request(method, path, body, { notFoundIsNull = method === 'GET', attempts = MAX_ATTEMPTS } = {}) {
  if (!isConfigured()) {
    throw new RobloxError('Das Spiel ist nicht verbunden: Universe-ID oder API-Key fehlt (siehe /spiel-admin uebersicht).', { area: areaOf(path) });
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    let res;
    try {
      res = await fetch(`${BASE}/universes/${universeId()}${path}`, {
        method,
        headers: { 'x-api-key': apiKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const message = err.name === 'TimeoutError' ? 'Zeitüberschreitung' : `Netzwerkfehler: ${err.message}`;
      record({ method, path, status: 0, ms: Date.now() - started, error: redact(message), attempt });
      lastError = new RobloxError(`Roblox ist nicht erreichbar (${message}).`, { area: areaOf(path) });
      if (attempt < attempts) await sleep(retryDelay(null, attempt));
      continue;
    }

    if (res.status === 404 && notFoundIsNull) {
      record({ method, path, status: 404, ms: Date.now() - started, attempt });
      return null;
    }
    if (res.ok) {
      const text = await res.text();
      record({ method, path, status: res.status, ms: Date.now() - started, attempt });
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new RobloxError('Roblox hat eine unlesbare Antwort geschickt.', { status: res.status, area: areaOf(path) });
      }
    }

    const detail = redact(await res.text().catch(() => ''));
    record({ method, path, status: res.status, ms: Date.now() - started, error: `HTTP ${res.status} ${detail}`.trim(), attempt });
    lastError = new RobloxError(HINTS[res.status] ?? `Roblox antwortet mit HTTP ${res.status}.`, { status: res.status, area: areaOf(path) });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === attempts) break;
    await sleep(retryDelay(res, attempt));
  }
  throw lastError;
}

// ---------- Banns (offizielle Roblox-Ban-API) ----------

// seconds = null → dauerhaft
async function banUser(userId, { seconds, displayReason, privateReason, excludeAltAccounts = false }) {
  const restriction = {
    active: true,
    displayReason: displayReason.slice(0, 400),
    privateReason: privateReason.slice(0, 1000),
    excludeAltAccounts,
  };
  if (seconds) restriction.duration = `${seconds}s`;
  await request('PATCH', `/user-restrictions/${userId}`, { gameJoinRestriction: restriction });
}

async function unbanUser(userId) {
  await request('PATCH', `/user-restrictions/${userId}`, { gameJoinRestriction: { active: false } });
}

async function getBan(userId) {
  const result = await request('GET', `/user-restrictions/${userId}`);
  const r = result?.gameJoinRestriction;
  return r?.active ? r : null;
}

// ---------- Öffentliche Spiel-Statistik (kein API-Key nötig), 60 s zwischengespeichert ----------

let statsCache = { at: 0, value: null };
async function gameStats() {
  if (!universeId()) return null;
  if (Date.now() - statsCache.at < 60_000 && statsCache.value) return statsCache.value;
  const started = Date.now();
  let res;
  try {
    res = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId()}`, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    record({ method: 'GET', path: '/games', status: 0, ms: Date.now() - started, error: err.message, attempt: 1 });
    throw new RobloxError('Roblox ist nicht erreichbar.');
  }
  record({ method: 'GET', path: '/games', status: res.status, ms: Date.now() - started, attempt: 1, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) });
  if (!res.ok) throw new RobloxError(`Roblox antwortet mit HTTP ${res.status}.`);
  const game = (await res.json()).data?.[0];
  if (!game) throw new RobloxError('Spiel nicht gefunden. Stimmt die Universe-ID?');
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

// ---------- Hilfen ----------

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
  API_KEY_SECRET,
  RobloxError,
  isConfigured,
  universeId,
  apiKeySource,
  gameConfig,
  request,
  banUser,
  unbanUser,
  getBan,
  gameStats,
  healthReport,
  recentRequests,
  redact,
  parseDuration,
  formatDuration,
};
