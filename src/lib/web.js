// Optionaler Web-Teil (Browser-Formular und Dashboard): Adresse, Geheimnis und signierte Links.
// Aktiv, sobald WEB_URL in der .env steht. Der Server selbst liegt in src/web/server.js.
const crypto = require('node:crypto');
const db = require('./db');

const baseUrl = () => (process.env.WEB_URL ?? '').trim().replace(/\/+$/, '');
const enabled = () => /^https?:\/\/\S+$/.test(baseUrl());
const port = () => Number(process.env.WEB_PORT || process.env.SERVER_PORT || process.env.PORT || 8080);

// WEB_SECRET aus der .env, sonst ein zufälliges Geheimnis, das in data/db.json liegt.
function secret() {
  if (process.env.WEB_SECRET) return process.env.WEB_SECRET;
  if (!db.data.webSecret) {
    db.data.webSecret = crypto.randomBytes(32).toString('hex');
    db.save();
  }
  return db.data.webSecret;
}

const hmac = (text) => crypto.createHmac('sha256', secret()).update(text).digest('base64url');

// payload braucht k (Art des Links) und exp (Ablauf in ms).
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

// Gibt den Inhalt zurück oder null (falsche Signatur, falsche Art, abgelaufen).
function verify(token, kind, now = Date.now()) {
  const [body, signature, ...rest] = String(token ?? '').split('.');
  if (!body || !signature || rest.length) return null;
  const expected = Buffer.from(hmac(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.k === kind && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

const applyUrl = ({ guildId, userId, typeId, expiresAt }) =>
  `${baseUrl()}/apply/${sign({ k: 'apply', g: guildId, u: userId, t: typeId, iat: Date.now(), exp: expiresAt })}`;
const loginUrl = ({ guildId, userId }) => `${baseUrl()}/dash/login/${sign({ k: 'login', g: guildId, u: userId, exp: Date.now() + 10 * 60_000 })}`;

module.exports = { baseUrl, enabled, port, sign, verify, applyUrl, loginUrl };
