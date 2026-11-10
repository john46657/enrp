// Absicherung der Spiel-Schnittstelle (Bridge): jede Anfrage des Spiels ist mit HMAC-SHA256 signiert.
//
//   Header  X-ENRP-Timestamp  Unix-Sekunden
//           X-ENRP-Nonce      Zufallswert, pro Anfrage neu (16–64 Zeichen)
//           X-ENRP-Signature  hex(HMAC_SHA256(Bridge-Schlüssel, Kanon))
//   Kanon   Timestamp + "\n" + Nonce + "\n" + Methode + "\n" + Pfad mit Query + "\n" + Roh-Body
//
// Prüfungen: Signatur (zeitkonstanter Vergleich), Zeitstempel höchstens 5 Minuten daneben, jede Nonce nur einmal
// (Schutz vor Replay). Der Bridge-Schlüssel kommt aus BRIDGE_SECRET (.env) oder wird per /spiel-admin bridge-schluessel
// erzeugt und verschlüsselt gespeichert. Er wird nie geloggt und nach dem Erzeugen nie wieder angezeigt.
const crypto = require('node:crypto');
const secrets = require('../secrets');

const SECRET_NAME = 'bridgeSecret';
const MAX_SKEW_SECONDS = 300;
const NONCE_TTL_MS = 2 * MAX_SKEW_SECONDS * 1000;
const MIN_SECRET_LENGTH = 32;

const nonces = new Map(); // Nonce → Ablaufzeit

function bridgeSecret() {
  const env = (process.env.BRIDGE_SECRET ?? '').trim();
  if (env.length >= MIN_SECRET_LENGTH) return env;
  return secrets.getSecret(SECRET_NAME);
}

const secretSource = () => ((process.env.BRIDGE_SECRET ?? '').trim().length >= MIN_SECRET_LENGTH ? 'env' : secrets.secretInfo(SECRET_NAME) ? 'discord' : null);

// Neuen Schlüssel erzeugen (nur wenn er nicht aus der .env kommt). Gibt ihn genau einmal zurück.
function rotateSecret(by) {
  if (secretSource() === 'env') throw new Error('Der Bridge-Schlüssel kommt aus BRIDGE_SECRET in der .env – dort ändern.');
  const value = crypto.randomBytes(32).toString('base64url'); // 43 Zeichen
  secrets.setSecret(SECRET_NAME, value, by);
  return value;
}

const canonical = ({ timestamp, nonce, method, path, body }) => `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${body}`;

function sign(secret, parts) {
  return crypto.createHmac('sha256', secret).update(canonical(parts), 'utf8').digest('hex');
}

function pruneNonces(now = Date.now()) {
  for (const [nonce, expires] of nonces) if (expires < now) nonces.delete(nonce);
}

// Gibt null zurück, wenn alles stimmt, sonst einen Grund (wird nur geloggt, nie an den Absender geschickt).
function verify({ headers, method, path, body }, now = Date.now()) {
  const secret = bridgeSecret();
  if (!secret) return 'kein Bridge-Schlüssel eingerichtet';
  const timestamp = String(headers['x-enrp-timestamp'] ?? '');
  const nonce = String(headers['x-enrp-nonce'] ?? '');
  const signature = String(headers['x-enrp-signature'] ?? '');
  if (!/^\d{9,11}$/.test(timestamp) || !/^[\w-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return 'Header fehlen oder sind ungültig';
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return 'Zeitstempel außerhalb von ±5 Minuten';

  const expected = Buffer.from(sign(secret, { timestamp, nonce, method, path, body }), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return 'Signatur falsch';

  if (nonces.size > 50_000) pruneNonces(now);
  if (nonces.has(nonce) && nonces.get(nonce) > now) return 'Nonce schon benutzt (Replay)';
  nonces.set(nonce, now + NONCE_TTL_MS);
  return null;
}

module.exports = { SECRET_NAME, MAX_SKEW_SECONDS, MIN_SECRET_LENGTH, bridgeSecret, secretSource, rotateSecret, canonical, sign, verify, pruneNonces };
