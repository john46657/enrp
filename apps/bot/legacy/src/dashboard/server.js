// Web-Dashboard: läuft im Bot-Prozess, Login per Discord (OAuth2), Einstellungen je Server.
// Benötigt in der .env: DASHBOARD_URL, DISCORD_CLIENT_SECRET (und DASHBOARD_SECRET für dauerhafte Sitzungen).
// Port: PORT, SERVER_PORT (Pterodactyl/bot-hosting) oder DASHBOARD_PORT.
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { PermissionFlagsBits, OAuth2Scopes } = require('discord.js');
const settings = require('../lib/settings');
const { bucket, save } = require('../lib/db');
const { isValidTimeZone } = require('../lib/time');

const API = 'https://discord.com/api/v10';
const SESSION_DAYS = 7;
const MAX_VALUE_BYTES = 60_000;

// Top-Level-Bereiche, die das Dashboard ändern darf (applications bleibt in der config.json).
const EDITABLE = ['timezone', 'channels', 'roles', 'welcome', 'tickets', 'leveling', 'roblox', 'stats', 'moderation', 'team', 'security', 'giveaways', 'suggestions', 'counting'];

// Module können Aktionen (Buttons) und Live-Daten fürs Dashboard anmelden.
const actions = new Map(); // name → async (guild, body, member) => Ergebnis
const liveData = new Map(); // name → async (guild) => Daten
const afterSave = []; // (guild, paths) => Promise – z. B. Panels neu zeichnen
const routes = []; // (app) => void – eigene Endpunkte ohne Dashboard-Login (z. B. Webhooks)
const registerAction = (name, fn) => actions.set(name, fn);
const registerLive = (name, fn) => liveData.set(name, fn);
const onSave = (fn) => afterSave.push(fn);
const registerRoute = (fn) => routes.push(fn);

const sessions = () => bucket('dashboardSessions', 'all'); // id → { user, guilds, expiresAt }
const secret = () => process.env.DASHBOARD_SECRET || process.env.DISCORD_TOKEN;
const sign = (value) => `${value}.${crypto.createHmac('sha256', secret()).update(value).digest('base64url')}`;
function unsign(signed) {
  const index = signed?.lastIndexOf('.') ?? -1;
  if (index < 1) return null;
  const value = signed.slice(0, index);
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signed);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? value : null;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter(([k]) => k));
}
function setCookie(res, name, value, maxAgeSeconds) {
  const secure = (process.env.DASHBOARD_URL ?? '').startsWith('https://') ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

// Einfaches Rate-Limit je Schlüssel (z. B. Sitzung): max Anfragen pro Minute.
const hits = new Map();
function rateLimited(key, max) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

async function discord(pathname, token, init = {}) {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { ...init.headers, Authorization: token } });
  if (!res.ok) throw new Error(`Discord ${pathname}: ${res.status}`);
  return res.json();
}

function createApp(client) {
  const app = express();
  const baseUrl = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
  const redirectUri = `${baseUrl}/auth/callback`;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  for (const fn of routes) fn(app, { rateLimited });

  // ---------- Login ----------

  app.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', state, 600);
    const params = new URLSearchParams({
      client_id: client.application.id,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: [OAuth2Scopes.Identify, OAuth2Scopes.Guilds].join(' '),
      state,
      prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== cookies(req).oauth_state) return res.status(400).send('Ungültige Anmeldung. Bitte erneut versuchen.');
    try {
      const token = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.application.id,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: redirectUri,
        }),
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Token: ${r.status}`))));
      const auth = `${token.token_type} ${token.access_token}`;
      const [user, guilds] = await Promise.all([discord('/users/@me', auth), discord('/users/@me/guilds', auth)]);
      const id = crypto.randomBytes(24).toString('base64url');
      sessions()[id] = {
        user: { id: user.id, username: user.username, globalName: user.global_name, avatar: user.avatar },
        // Nur Server, auf denen der Nutzer „Server verwalten“ hat (Discord liefert die Rechte als Zahl).
        guilds: guilds
          .filter((g) => g.owner || (BigInt(g.permissions) & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild)
          .map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner })),
        expiresAt: Date.now() + SESSION_DAYS * 86_400_000,
      };
      save();
      setCookie(res, 'session', sign(id), SESSION_DAYS * 86_400);
      setCookie(res, 'oauth_state', '', 0);
      res.redirect('/');
    } catch (err) {
      console.error('[dashboard] Login:', err.message);
      res.status(500).send('Anmeldung fehlgeschlagen. Prüfe DISCORD_CLIENT_SECRET und die Redirect-URL im Developer Portal.');
    }
  });

  app.post('/logout', (req, res) => {
    const id = unsign(cookies(req).session);
    if (id) delete sessions()[id];
    save();
    setCookie(res, 'session', '', 0);
    res.json({ ok: true });
  });

  // ---------- API ----------

  // Sitzung prüfen; schreibende Anfragen brauchen zusätzlich den Header X-Dashboard (Schutz gegen CSRF).
  app.use('/api', (req, res, next) => {
    const id = unsign(cookies(req).session);
    const session = id && sessions()[id];
    if (!session || session.expiresAt < Date.now()) return res.status(401).json({ error: 'Nicht angemeldet' });
    if (req.method !== 'GET' && req.get('X-Dashboard') !== '1') return res.status(403).json({ error: 'Ungültige Anfrage' });
    if (rateLimited(id, req.method === 'GET' ? 240 : 60)) return res.status(429).json({ error: 'Zu viele Anfragen, kurz warten.' });
    req.session = session;
    next();
  });

  app.get('/api/me', (req, res) => {
    const invite = (guildId) =>
      client.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: [PermissionFlagsBits.Administrator], guild: guildId });
    res.json({
      user: req.session.user,
      bot: { name: client.user.username, avatar: client.user.displayAvatarURL(), brand: settings.base.serverName },
      guilds: req.session.guilds.map((g) => ({ ...g, botIn: client.guilds.cache.has(g.id), invite: invite(g.id) })),
    });
  });

  // Zugriff auf einen Server: Bot muss drauf sein, der Nutzer dort (laut Bot) „Server verwalten“ haben.
  async function guildAccess(req, res, next) {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Der Bot ist nicht auf diesem Server.' });
    const member = await guild.members.fetch(req.session.user.id).catch(() => null);
    if (!member || !(member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild))) {
      return res.status(403).json({ error: 'Du brauchst auf diesem Server „Server verwalten“.' });
    }
    req.guild = guild;
    req.member = member;
    next();
  }

  app.get('/api/guilds/:guildId', guildAccess, (req, res) => {
    const { guild } = req;
    const config = settings.forGuild(guild.id);
    res.json({
      guild: { id: guild.id, name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount },
      config: Object.fromEntries(EDITABLE.filter((key) => key in config).map((key) => [key, config[key]])),
      changed: settings.overrideCount(guild.id),
      channels: guild.channels.cache
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition ?? 0 }))
        .sort((a, b) => a.position - b.position),
      roles: guild.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed }))
        .sort((a, b) => b.position - a.position),
    });
  });

  app.get('/api/guilds/:guildId/live/:name', guildAccess, async (req, res) => {
    const fn = liveData.get(req.params.name);
    if (!fn) return res.status(404).json({ error: 'Unbekannt' });
    try {
      res.json(await fn(req.guild, req.member));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Änderungen: [{ path: "tickets.panel.title", value: "…" }, …] – alle oder keine werden übernommen.
  app.put('/api/guilds/:guildId/settings', guildAccess, async (req, res) => {
    const changes = req.body?.changes;
    if (!Array.isArray(changes) || !changes.length || changes.length > 100) return res.status(400).json({ error: 'Keine gültigen Änderungen.' });
    for (const change of changes) {
      const error = validateChange(change);
      if (error) return res.status(400).json({ error });
    }
    const guildId = req.guild.id;
    const invalid = settings.invalidPath(guildId, changes);
    if (invalid) return res.status(400).json({ error: `Unbekannte Einstellung: ${invalid}` });
    for (const { path: p, value } of changes) settings.set(guildId, p, value ?? undefined);
    for (const fn of afterSave) await Promise.resolve(fn(req.guild, changes.map((c) => c.path))).catch((err) => console.error('[dashboard] afterSave:', err));
    console.log(`[dashboard] ${req.session.user.username} hat ${changes.length} Einstellung(en) auf „${req.guild.name}“ geändert`);
    res.json({ ok: true, config: settings.forGuild(guildId) });
  });

  app.post('/api/guilds/:guildId/reset', guildAccess, async (req, res) => {
    settings.reset(req.guild.id);
    for (const fn of afterSave) await Promise.resolve(fn(req.guild, EDITABLE)).catch(() => {});
    res.json({ ok: true });
  });

  app.post('/api/guilds/:guildId/actions/:name', guildAccess, async (req, res) => {
    const fn = actions.get(req.params.name);
    if (!fn) return res.status(404).json({ error: 'Unbekannte Aktion' });
    try {
      res.json({ ok: true, result: (await fn(req.guild, req.body ?? {}, req.member)) ?? null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------- Oberfläche ----------

  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  return app;
}

function validateChange(change) {
  if (!change || typeof change.path !== 'string') return 'Ungültige Änderung.';
  const parts = change.path.split('.');
  if (!EDITABLE.includes(parts[0])) return `„${parts[0]}“ kann im Dashboard nicht geändert werden.`;
  if (parts.some((p) => !p || ['__proto__', 'prototype', 'constructor'].includes(p))) return 'Ungültiger Pfad.';
  if (change.value !== undefined && JSON.stringify(change.value).length > MAX_VALUE_BYTES) return 'Wert ist zu groß.';
  if ((parts.at(-1) === 'timezone' || parts.at(-1) === 'timeZone') && !isValidTimeZone(change.value)) return `Unbekannte Zeitzone „${change.value}“.`;
  return null;
}

function startDashboard(client) {
  const port = Number(process.env.PORT || process.env.SERVER_PORT || process.env.DASHBOARD_PORT);
  if (!port) return console.log('ℹ️  Dashboard aus (kein PORT/SERVER_PORT/DASHBOARD_PORT gesetzt)');
  if (!process.env.DASHBOARD_URL || !process.env.DISCORD_CLIENT_SECRET) {
    return console.warn('⚠️  Dashboard aus: DASHBOARD_URL und DISCORD_CLIENT_SECRET fehlen in der .env');
  }
  // Abgelaufene Sitzungen aufräumen.
  for (const [id, s] of Object.entries(sessions())) if (s.expiresAt < Date.now()) delete sessions()[id];
  save();
  createApp(client).listen(port, () => console.log(`✅ Dashboard läuft auf Port ${port} → ${process.env.DASHBOARD_URL}`));
}

module.exports = { startDashboard, createApp, registerAction, registerLive, onSave, registerRoute, validateChange, EDITABLE };
