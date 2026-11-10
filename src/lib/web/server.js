// Bridge-Webserver: Schnittstelle zwischen Spiel und Bot über die eigene Domain (z. B. https://….apps.bot-hosting.cloud).
// Alle /bridge/v1/*-Routen verlangen eine gültige Signatur (web/auth.js). Antworten enthalten nie Geheimnisse.
//
//   GET  /health              ohne Signatur – nur „ok“, für Uptime-Monitore
//   POST /bridge/v1/live      Live-Snapshot eines Spielservers
//   POST /bridge/v1/bye       Spielserver fährt herunter
//   POST /bridge/v1/events    Ereignisse (Webhooks: Notrufe, Befehle, Kills, Beitritte …)
//   GET  /bridge/v1/sync      neue Befehle für diesen Server + Bann-Version
//   GET  /bridge/v1/bans      alle Banns, die auf diesem Server gelten
//   GET  /bridge/v1/player    Bann und Rechte eines Spielers (beim Beitreten)
const http = require('node:http');
const crypto = require('node:crypto');
const auth = require('./auth');
const live = require('../game/live');
const events = require('../game/events');
const outbox = require('../game/outbox');
const bans = require('../game/bans');
const rights = require('../roblox/rights');
const cloud = require('../roblox/openCloud');

const MAX_BODY = 256 * 1024;
const RATE_PER_MINUTE = 1200; // je IP
const AUTH_FAIL_LIMIT = 30; // fehlgeschlagene Signaturen je IP und Minute → 10 Minuten gesperrt
const BLOCK_MS = 10 * 60_000;
const LOG_LIMIT = 200;

const state = { server: null, port: null, startedAt: null, error: null, requests: 0, authFailures: 0, lastAuthFailure: null };
const recent = []; // die letzten Anfragen (ohne Inhalte)
const ipStats = new Map(); // gehashte IP → { window, count, fails, blockedUntil }

const hashIp = (ip) => crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 12); // keine IPs speichern
const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';

function logRequest(entry) {
  recent.push({ at: Date.now(), ...entry });
  if (recent.length > LOG_LIMIT) recent.shift();
}

function ipEntry(ip) {
  const now = Date.now();
  const entry = ipStats.get(ip) ?? { window: now, count: 0, fails: 0, blockedUntil: 0 };
  if (now - entry.window > 60_000) Object.assign(entry, { window: now, count: 0, fails: 0 });
  ipStats.set(ip, entry);
  if (ipStats.size > 5000) for (const [key, value] of ipStats) if (now - value.window > 120_000 && value.blockedUntil < now) ipStats.delete(key);
  return entry;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Owner-/Job-Parameter aus der Query prüfen
const ownerParam = (value) => (/^\d{1,20}$/.test(value ?? '') && value !== '0' ? value : null);
const jobParam = (value) => (/^[\w-]{1,64}$/.test(value ?? '') ? value : null);

const routes = {
  'POST /bridge/v1/live': ({ json }) => (live.ingest(json) ? [200, { ok: true }] : [400, { error: 'Snapshot ungültig' }]),
  'POST /bridge/v1/bye': ({ json }) => {
    if (jobParam(json?.job)) live.remove(json.job);
    return [200, { ok: true }];
  },
  'POST /bridge/v1/events': ({ json }) => [200, events.ingest(json?.events)],
  'GET /bridge/v1/sync': ({ query }) => {
    const job = jobParam(query.get('job'));
    if (!job) return [400, { error: 'job fehlt' }];
    const config = cloud.gameConfig();
    return [
      200,
      {
        ...outbox.pull({ job, ownerId: ownerParam(query.get('owner')), cursor: Number(query.get('cursor')), boot: query.get('boot') ?? '' }),
        // Intervalle sind per /spiel-admin intervall einstellbar; das Spiel übernimmt sie beim nächsten Abruf
        config: { live: config.liveSeconds ?? 15, sync: config.syncSeconds ?? 3 },
        // Teamsperre (Extra-Funktion je Privatserver, Standard aus) – das Spiel übernimmt Änderungen sofort
        teamLock: rights.teamLockFor(ownerParam(query.get('owner'))),
        time: Math.floor(Date.now() / 1000),
      },
    ];
  },
  'GET /bridge/v1/bans': ({ query }) => [200, { version: outbox.versions.bans, bans: bans.forServer(ownerParam(query.get('owner'))) }],
  'GET /bridge/v1/player': ({ query }) => {
    const id = /^\d{1,20}$/.test(query.get('id') ?? '') ? query.get('id') : null;
    if (!id) return [400, { error: 'id fehlt' }];
    const ownerId = ownerParam(query.get('owner'));
    const ban = bans.forServer(ownerId)[id] ?? null;
    return [200, { ban, rights: ownerId ? rights.getRights(ownerId, id) : [], teamLock: rights.teamLockFor(ownerId) }];
  },
};

async function handle(req, res) {
  const started = Date.now();
  state.requests++;
  const url = new URL(req.url, 'http://bridge.local');
  const ip = hashIp(clientIp(req));
  const route = `${req.method} ${url.pathname}`;
  const finish = (status, body, note) => {
    send(res, status, body);
    logRequest({ route, status, ms: Date.now() - started, ip, ...(note ? { note } : {}) });
  };

  if (req.method === 'GET' && url.pathname === '/health') return finish(200, { ok: true, service: 'enrp-bridge' });
  if (!url.pathname.startsWith('/bridge/')) return finish(404, { error: 'nicht gefunden' });

  const limits = ipEntry(ip);
  if (limits.blockedUntil > Date.now()) return finish(429, { error: 'vorübergehend gesperrt' }, 'gesperrt');
  if (++limits.count > RATE_PER_MINUTE) return finish(429, { error: 'zu viele Anfragen' }, 'Rate-Limit');

  const handler = routes[route];
  if (!handler) return finish(404, { error: 'nicht gefunden' });

  let body = '';
  try {
    body = req.method === 'POST' ? await readBody(req) : '';
  } catch (err) {
    return finish(err.status ?? 400, { error: 'Anfrage ungültig' });
  }

  const problem = auth.verify({ headers: req.headers, method: req.method, path: req.url, body });
  if (problem) {
    state.authFailures++;
    state.lastAuthFailure = { at: Date.now(), reason: problem };
    if (++limits.fails >= AUTH_FAIL_LIMIT) limits.blockedUntil = Date.now() + BLOCK_MS;
    return finish(401, { error: 'nicht autorisiert' }, problem); // Grund nur im Log, nicht in der Antwort
  }

  const json = req.method === 'POST' ? parseJson(body) : null;
  if (req.method === 'POST' && (json === undefined || json === null || typeof json !== 'object')) return finish(400, { error: 'JSON erwartet' });

  try {
    const [status, payload] = await handler({ json, query: url.searchParams, req });
    return finish(status, payload);
  } catch (err) {
    console.error(`[bridge] ${route}:`, err.message);
    return finish(500, { error: 'interner Fehler' });
  }
}

function port() {
  const value = Number(process.env.WEB_PORT || process.env.SERVER_PORT || 0);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : null;
}

function start() {
  if (state.server) return state.server;
  const p = port();
  if (!p) {
    state.error = 'Kein Port: WEB_PORT (oder SERVER_PORT vom Bot-Hoster) fehlt.';
    console.warn(`⚠️  Bridge-Webserver aus: ${state.error}`);
    return null;
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[bridge]', err.message);
      if (!res.headersSent) send(res, 500, { error: 'interner Fehler' });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('error', (err) => {
    state.error = err.code === 'EADDRINUSE' ? `Port ${p} ist schon belegt (läuft dort ein anderes Programm?)` : err.message;
    console.error(`❌ Bridge-Webserver: ${state.error}`);
    state.server = null;
  });
  server.listen(p, '0.0.0.0', () => {
    state.port = p;
    state.startedAt = Date.now();
    state.error = null;
    console.log(`✅ Bridge-Webserver läuft auf Port ${p}${process.env.PUBLIC_URL ? ` (${process.env.PUBLIC_URL})` : ''}`);
  });
  state.server = server;
  return server;
}

function stop() {
  state.server?.close();
  state.server = null;
}

const status = () => ({
  running: Boolean(state.server && state.port),
  port: state.port,
  startedAt: state.startedAt,
  error: state.error,
  requests: state.requests,
  authFailures: state.authFailures,
  lastAuthFailure: state.lastAuthFailure,
  publicUrl: process.env.PUBLIC_URL || null,
});

const recentRequests = () => [...recent];

module.exports = { start, stop, status, recentRequests, handle, port };
