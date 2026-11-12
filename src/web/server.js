// Web-Dashboard: Bewerbungen und Panels im Browser verwalten (Login mit Discord).
// Startet nur, wenn DISCORD_CLIENT_SECRET und DASHBOARD_URL gesetzt sind. Keine zusätzlichen Pakete nötig.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const settings = require('../lib/settings');
const store = require('../lib/applications/store');
const manage = require('../lib/applications/manage');
const panels = require('../lib/applications/panels');
const messages = require('../lib/applications/messages');

const API = 'https://discord.com/api/v10';
const PUBLIC = path.join(__dirname, 'public');
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SESSION_HOURS = 12;

const sessions = new Map(); // token → { user, expiresAt }

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(json ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- Daten für die Oberfläche ----------

function typeJson(guildId, type) {
  const raw = settings.ownAppTypes(guildId).find((t) => t.id === type.id);
  return {
    id: type.id,
    name: type.name,
    emoji: type.emoji,
    description: type.description,
    workflow: type.workflow,
    numberPrefix: type.numberPrefix,
    enabled: type.enabled,
    editable: Boolean(raw),
    questions: type.questions,
    messages: raw?.messages ?? {},
    openCount: store.openOf(guildId, (r) => r.type === type.id).length,
  };
}

function overview(guild) {
  const config = settings.forGuild(guild.id);
  return {
    guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }) },
    types: store.types(guild.id).map((t) => typeJson(guild.id, t)),
    panels: panels.panelsOf(guild.id).map((p) => ({ ...p, posts: panels.postsOf(guild.id, p.id) })),
    defaultMessages: config.applications.defaults.messages,
    channels: guild.channels.cache
      .filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name })),
    roles: guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor })),
  };
}

// Nur wer auf dem Server „Server verwalten“ hat, darf ihn bearbeiten. Geprüft wird live über den Bot.
async function manageableGuild(client, userId, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, 'Server nicht gefunden.');
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) throw new HttpError(403, 'Dafür brauchst du auf diesem Server „Server verwalten“.');
  return guild;
}

async function guildsFor(client, userId) {
  const result = [];
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member?.permissions.has(PermissionFlagsBits.ManageGuild)) result.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }) });
  }
  return result;
}

const check = (result) => {
  if (result.error) throw new HttpError(400, result.error);
  return result;
};

// ---------- API ----------

async function api(client, req, res, user, parts) {
  const method = req.method;
  if (parts[0] === 'me' && method === 'GET') return send(res, 200, { user, guilds: await guildsFor(client, user.id) });
  if (parts[0] !== 'g' || !parts[1]) throw new HttpError(404, 'Unbekannte Adresse.');

  const guild = await manageableGuild(client, user.id, parts[1]);
  const [, , section, id, extra] = parts;
  const body = method === 'GET' ? {} : await readBody(req);
  const refresh = () => messages.refreshPanels(guild).catch((err) => console.error('[web] Panels aktualisieren:', err.message));

  if (!section && method === 'GET') return send(res, 200, overview(guild));

  if (section === 'types') {
    if (!id && method === 'POST') {
      const result = check(manage.createType(guild.id, { name: body.name, emoji: body.emoji, description: body.description, workflow: body.workflow, numberPrefix: body.numberPrefix }));
      refresh();
      return send(res, 201, { id: result.type.id, ...overview(guild) });
    }
    if (id && method === 'PATCH') {
      const fields = {};
      for (const key of ['name', 'emoji', 'workflow', 'numberPrefix', 'enabled']) if (body[key] !== undefined) fields[key] = body[key];
      if (body.description !== undefined) fields.description = String(body.description).trim() || '-';
      if (fields.enabled !== undefined) fields.enabled = Boolean(fields.enabled);
      if (fields.workflow !== undefined && !['simple', 'police'].includes(fields.workflow)) throw new HttpError(400, 'Unbekannter Ablauf.');
      if (body.questions !== undefined) check(manage.setQuestions(guild.id, id, body.questions));
      if (Object.keys(fields).length) check(manage.updateType(guild.id, id, fields));
      if (body.messages !== undefined) {
        const texts = {};
        for (const key of ['start', 'finish', 'accept', 'reject']) texts[key] = String(body.messages?.[key] ?? '').slice(0, 1500);
        check(manage.setMessages(guild.id, id, texts));
      }
      refresh();
      return send(res, 200, overview(guild));
    }
    if (id && method === 'DELETE') {
      check(manage.deleteType(guild.id, id));
      refresh();
      return send(res, 200, overview(guild));
    }
  }

  if (section === 'panels') {
    const fields = {};
    for (const key of ['name', 'title', 'description', 'image']) if (body[key] !== undefined) fields[key] = String(body[key]);
    if (Array.isArray(body.types)) fields.types = body.types.map(String);
    if (!id && method === 'POST') {
      const result = check(panels.createPanel(guild.id, fields));
      return send(res, 201, { id: result.panel.id, ...overview(guild) });
    }
    if (id && !extra && method === 'PATCH') {
      if (fields.title !== undefined && !fields.title.trim()) fields.title = fields.name ?? panels.getPanel(guild.id, id)?.name ?? '';
      check(panels.updatePanel(guild.id, id, fields));
      refresh();
      return send(res, 200, overview(guild));
    }
    if (id && !extra && method === 'DELETE') {
      check(await messages.deletePanel(guild, id));
      return send(res, 200, overview(guild));
    }
    if (id && extra === 'post' && method === 'POST') {
      const panel = panels.getPanel(guild.id, id);
      if (!panel) throw new HttpError(404, 'Dieses Panel gibt es nicht.');
      if (!panels.activeTypes(guild.id, panel).length) throw new HttpError(400, 'Im Panel ist keine Bewerbung mit Fragen.');
      const channel = guild.channels.cache.get(String(body.channelId ?? ''));
      if (!channel?.isTextBased() || channel.isDMBased()) throw new HttpError(400, 'Bitte einen Textkanal wählen.');
      try {
        await messages.postPanel(channel, panel.id);
      } catch (err) {
        throw new HttpError(400, `Ich kann in #${channel.name} nicht schreiben (${err.message}).`);
      }
      return send(res, 200, overview(guild));
    }
  }
  throw new HttpError(404, 'Unbekannte Adresse.');
}

// ---------- Login mit Discord ----------

async function login(client, req, res, url, base) {
  const cookieOpts = `Path=/; HttpOnly; SameSite=Lax${base.startsWith('https') ? '; Secure' : ''}`;
  const redirectUri = `${base}/callback`;
  const clientId = process.env.DISCORD_CLIENT_ID || client.application.id;

  if (url.pathname === '/login') {
    const state = crypto.randomBytes(16).toString('hex');
    const target = new URL('https://discord.com/oauth2/authorize');
    target.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'identify', state, prompt: 'none' });
    return send(res, 302, '', { Location: target.toString(), 'Set-Cookie': `oauth_state=${state}; Max-Age=600; ${cookieOpts}` });
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || state !== cookies(req).oauth_state) return send(res, 400, 'Login fehlgeschlagen. Bitte noch einmal versuchen.');
    const token = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    }).then((r) => r.json());
    if (!token.access_token) {
      console.error('[web] Login:', token.error_description ?? token.error ?? token);
      return send(res, 400, 'Login fehlgeschlagen. Prüfe DISCORD_CLIENT_SECRET und die Redirect-URL im Developer Portal.');
    }
    const me = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } }).then((r) => r.json());
    if (!me.id) return send(res, 400, 'Login fehlgeschlagen.');
    const session = crypto.randomBytes(32).toString('hex');
    sessions.set(session, {
      user: { id: me.id, name: me.global_name ?? me.username, avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null },
      expiresAt: Date.now() + SESSION_HOURS * 3_600_000,
    });
    return send(res, 302, '', {
      Location: '/',
      'Set-Cookie': [`session=${session}; Max-Age=${SESSION_HOURS * 3600}; ${cookieOpts}`, `oauth_state=; Max-Age=0; ${cookieOpts}`],
    });
  }

  if (url.pathname === '/logout') {
    sessions.delete(cookies(req).session);
    return send(res, 302, '', { Location: '/', 'Set-Cookie': `session=; Max-Age=0; ${cookieOpts}` });
  }
  return null;
}

function currentUser(req) {
  const token = cookies(req).session;
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}

// ---------- Server ----------

function start(client) {
  const base = (process.env.DASHBOARD_URL ?? '').replace(/\/+$/, '');
  const port = Number(process.env.DASHBOARD_PORT || process.env.SERVER_PORT || 0);
  if (!process.env.DISCORD_CLIENT_SECRET || !base) {
    console.log('ℹ️  Web-Dashboard aus (DISCORD_CLIENT_SECRET und DASHBOARD_URL in der .env setzen, siehe README).');
    return null;
  }
  if (!port) {
    console.warn('⚠️  Web-Dashboard: kein Port. Setze DASHBOARD_PORT in der .env (auf Bot-Hostern ist es meist der Port deines Servers).');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const file = STATIC[url.pathname];
        return send(res, 200, fs.readFileSync(path.join(PUBLIC, file), 'utf8'), {
          'Content-Type': TYPES[path.extname(file)],
          'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
        });
      }
      if ((await login(client, req, res, url, base)) !== null) return;

      if (url.pathname.startsWith('/api/')) {
        const user = currentUser(req);
        if (!user) throw new HttpError(401, 'Bitte melde dich an.');
        // Schutz vor fremden Seiten (CSRF): Änderungen nur mit diesem Header, den nur unsere Seite setzt.
        if (req.method !== 'GET' && req.headers['x-dashboard'] !== '1') throw new HttpError(403, 'Ungültige Anfrage.');
        const parts = url.pathname.slice(5).split('/').filter(Boolean).map(decodeURIComponent);
        return await api(client, req, res, user, parts);
      }
      throw new HttpError(404, 'Nicht gefunden.');
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[web]', err);
      if (!res.headersSent) send(res, err.status ?? 500, { error: err instanceof HttpError ? err.message : 'Interner Fehler – siehe Konsole des Bots.' });
    }
  });

  server.on('error', (err) => console.error(`❌ Web-Dashboard konnte Port ${port} nicht öffnen: ${err.message}`));
  server.listen(port, () => console.log(`🌐 Web-Dashboard läuft auf ${base} (Port ${port})`));
  setInterval(() => {
    for (const [token, s] of sessions) if (s.expiresAt < Date.now()) sessions.delete(token);
  }, 3_600_000).unref();
  return server;
}

module.exports = { start, api, overview, HttpError, sessions };
