// Login mit Discord (OAuth2, Scope "identify") und signierte Sitzungs-Cookies (HMAC-SHA256, ohne Datenbank).
const crypto = require('node:crypto');

const SESSION_COOKIE = 'enrp_session';
const STATE_COOKIE = 'enrp_state';
const SESSION_HOURS = 12;

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

function sign(secret, payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

// Gibt den Inhalt zurück oder null (falsche Signatur, abgelaufen, kaputt).
function verify(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function cookie(name, value, { maxAge, secure }) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secure ? 'Secure' : null].filter(Boolean).join('; ');
}

function createAuth({ clientId, clientSecret, baseUrl, secret }) {
  const redirectUri = `${baseUrl}/auth/callback`;
  const secure = baseUrl.startsWith('https://');

  return {
    redirectUri,

    // Weiterleitung zu Discord; state schützt vor untergeschobenen Logins.
    login() {
      const state = crypto.randomBytes(16).toString('base64url');
      const url = new URL('https://discord.com/oauth2/authorize');
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state }).toString();
      return { location: url.toString(), setCookie: cookie(STATE_COOKIE, state, { maxAge: 600, secure }) };
    },

    // Code gegen Token tauschen, Nutzer laden, Sitzung ausstellen.
    async callback(query, cookies) {
      if (!query.get('code') || !query.get('state') || query.get('state') !== cookies[STATE_COOKIE]) throw new Error('Ungültige Anmeldung – bitte erneut versuchen.');
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: query.get('code'), redirect_uri: redirectUri }),
      });
      if (!tokenResponse.ok) throw new Error(`Discord hat die Anmeldung abgelehnt (${tokenResponse.status}). Stimmen Client-ID, Secret und Redirect-URL?`);
      const { access_token: accessToken } = await tokenResponse.json();
      const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!userResponse.ok) throw new Error('Discord-Konto konnte nicht geladen werden.');
      const user = await userResponse.json();
      const session = { id: user.id, name: user.global_name || user.username, avatar: user.avatar, exp: Date.now() + SESSION_HOURS * 3_600_000 };
      return [cookie(SESSION_COOKIE, sign(secret, session), { maxAge: SESSION_HOURS * 3600, secure }), cookie(STATE_COOKIE, '', { maxAge: 0, secure })];
    },

    session(cookies) {
      return verify(secret, cookies[SESSION_COOKIE]);
    },

    logout() {
      return cookie(SESSION_COOKIE, '', { maxAge: 0, secure });
    },
  };
}

module.exports = { createAuth, sign, verify, parseCookies };
