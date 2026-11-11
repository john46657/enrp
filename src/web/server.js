// Kleiner Webserver für das Browser-Formular und das Dashboard. Startet nur, wenn WEB_URL gesetzt ist.
const http = require('node:http');
const web = require('../lib/web');
const { base } = require('../lib/settings');
const { page, notice, escapeHtml } = require('./html');
const HttpError = require('./httpError');
const form = require('./form');
const dashboard = require('./dashboard');

const MAX_BODY = 256 * 1024;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', // die Links enthalten Zugangs-Tokens
  'Cache-Control': 'no-store',
};

// Antwort-Objekte der Seiten: { status?, html?, redirect?, headers? }
function respond(res, { status = 200, html = '', redirect, headers = {} }) {
  if (redirect) {
    res.writeHead(303, { ...SECURITY_HEADERS, ...headers, Location: redirect });
    return res.end();
  }
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', ...headers });
  return res.end(html);
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/x-www-form-urlencoded/i.test(req.headers['content-type'] ?? '')) return reject(new HttpError(415, 'Dieses Format wird nicht unterstützt.'));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Die Eingabe ist zu groß.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

const errorPage = (status, message) => ({
  status,
  html: page({ title: 'Fehler', narrow: true, body: `<h1>${escapeHtml(base.serverName)}</h1>${notice(escapeHtml(message), 'error')}` }),
});

async function route(client, req) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!['GET', 'POST', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Diese Methode wird nicht unterstützt.');
  const request = { client, method: req.method === 'HEAD' ? 'GET' : req.method, url, parts, headers: req.headers, body: req.method === 'POST' ? await readForm(req) : null };

  if (!parts.length) {
    return {
      html: page({
        title: 'Bewerbungen',
        narrow: true,
        body: `<h1>${escapeHtml(base.serverName)}</h1><div class="card"><p>Bewerbungen startest du in Discord: Klicke im Bewerbungs-Panel auf <strong>Jetzt bewerben</strong> oder nutze <code>/bewerbung</code>. Du bekommst dann deinen persönlichen Link zum Formular.</p><p class="muted">Team-Mitglieder öffnen das Dashboard mit <code>/dashboard</code>.</p></div>`,
      }),
    };
  }
  if (parts[0] === 'healthz') return { html: 'ok', headers: { 'Content-Type': 'text/plain; charset=utf-8' } };
  if (parts[0] === 'apply' && parts.length === 2) return form.handle(request, parts[1]);
  if (parts[0] === 'dash') return dashboard.handle(request);
  throw new HttpError(404, 'Diese Seite gibt es nicht.');
}

function createServer(client) {
  return http.createServer((req, res) => {
    route(client, req)
      .then((result) => respond(res, result))
      .catch((err) => {
        if (!(err instanceof HttpError)) console.error('[web]', err);
        if (res.headersSent) return res.end();
        return respond(res, errorPage(err.status ?? 500, err instanceof HttpError ? err.message : 'Da ist etwas schiefgelaufen.'));
      });
  });
}

function start(client) {
  const server = createServer(client);
  server.on('error', (err) => console.error(`❌ Web-Teil konnte nicht starten (Port ${web.port()}): ${err.message}`));
  server.listen(web.port(), () => console.log(`✅ Web-Teil läuft auf Port ${web.port()} – erreichbar unter ${web.baseUrl()}`));
  return server;
}

module.exports = { start, createServer };
