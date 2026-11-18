// Web-Dashboard: läuft im Bot-Prozess mit (node:http, keine zusätzlichen Pakete).
// Für HTTPS über eine eigene Domain einen Reverse-Proxy (Caddy, nginx) davorsetzen – siehe docs/dashboard.md.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createAuth, parseCookies } = require('./auth');
const api = require('./api');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 512 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://tr.rbxcdn.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// Liest die Einstellungen aus der Umgebung. Fehlt etwas, bleibt das Dashboard aus.
function readConfig(env = process.env) {
  const config = {
    port: Number(env.DASHBOARD_PORT) || 0,
    host: env.DASHBOARD_HOST || '127.0.0.1',
    baseUrl: (env.DASHBOARD_URL || '').replace(/\/+$/, ''),
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
    secret: env.DASHBOARD_SECRET || '',
  };
  const missing = [];
  if (!config.port) missing.push('DASHBOARD_PORT');
  if (!/^https?:\/\/[^/]+/.test(config.baseUrl)) missing.push('DASHBOARD_URL');
  if (!config.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (config.secret.length < 32) missing.push('DASHBOARD_SECRET (mind. 32 Zeichen)');
  return { config, missing };
}

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, { ...SECURITY_HEADERS, Location: location, 'Set-Cookie': cookies });
  res.end();
}

function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(full)] || !fs.existsSync(full)) return false;
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(full)], 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Ungültiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function createServer(client, config) {
  const auth = createAuth(config);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, config.baseUrl);
      const cookies = parseCookies(req.headers.cookie);

      if (url.pathname === '/login') {
        const { location, setCookie } = auth.login();
        return redirect(res, location, [setCookie]);
      }
      if (url.pathname === '/auth/callback') {
        try {
          return redirect(res, '/', await auth.callback(url.searchParams, cookies));
        } catch (err) {
          return send(res, 400, `${err.message}\n\nZurück: ${config.baseUrl}/login`);
        }
      }
      if (url.pathname === '/logout') return redirect(res, '/', [auth.logout()]);

      if (url.pathname.startsWith('/api/')) {
        const user = auth.session(cookies);
        if (!user) return send(res, 401, { error: 'Nicht angemeldet.' });
        // Schutz vor fremden Seiten (CSRF): Änderungen nur mit eigenem Header, den nur unser Skript setzt.
        if (req.method !== 'GET' && req.headers['x-enrp'] !== '1') return send(res, 403, { error: 'Ungültige Anfrage.' });
        let body = {};
        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
          try {
            body = await readBody(req);
          } catch (err) {
            return send(res, 400, { error: err.message });
          }
        }
        const result = await api.handle(client, { id: user.id, name: user.name, avatar: user.avatar }, req.method, url.pathname, url.searchParams, body);
        return send(res, result.status, result.body);
      }

      if (req.method === 'GET' && serveStatic(res, url.pathname)) return;
      // Alles andere ist eine Seite der App (z. B. /server/123) → index.html
      if (req.method === 'GET' && !path.extname(url.pathname) && serveStatic(res, '/')) return;
      return send(res, 404, 'Nicht gefunden.');
    } catch (err) {
      console.error('[dashboard]', err);
      if (!res.headersSent) send(res, 500, { error: 'Interner Fehler.' });
    }
  });
}

function start(client) {
  const { config, missing } = readConfig();
  if (missing.length === 5) return null; // gar nicht eingerichtet – kein Hinweis nötig
  if (missing.length) {
    console.warn(`⚠️  Dashboard aus – in der .env fehlt: ${missing.join(', ')} (siehe docs/dashboard.md)`);
    return null;
  }
  const server = createServer(client, config);
  server.on('error', (err) => console.error(`❌ Dashboard konnte nicht starten (${config.host}:${config.port}): ${err.message}`));
  server.listen(config.port, config.host, () => {
    console.log(`✅ Dashboard läuft auf ${config.host}:${config.port} → ${config.baseUrl}`);
    console.log(`   Redirect-URL im Developer Portal (OAuth2 → Redirects): ${config.baseUrl}/auth/callback`);
  });
  return server;
}

module.exports = { start, createServer, readConfig };
