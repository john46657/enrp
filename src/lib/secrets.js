// Verschlüsselte Ablage von Geheimnissen in data/db.json, z. B. des Open-Cloud-API-Keys, wenn er per Discord
// (/spiel-admin api-key) statt in der .env hinterlegt wird.
// Verfahren: AES-256-GCM. Der Schlüssel wird aus ENRP_SECRET (.env, mind. 32 Zeichen) abgeleitet und liegt nie in der
// Datenbank. Gespeicherte Geheimnisse werden nie wieder angezeigt – nur ein Fingerabdruck zum Wiedererkennen.
const crypto = require('node:crypto');
const db = require('./db');

const MIN_SECRET_LENGTH = 32;
const store = () => (db.data.secrets ??= {});
const cache = new Map(); // entschlüsselte Werte nur im Arbeitsspeicher

function masterKey() {
  const secret = process.env.ENRP_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  return crypto.createHash('sha256').update(`enrp:${secret}`).digest();
}

const canEncrypt = () => Boolean(masterKey());

// Kurzer Fingerabdruck (nicht umkehrbar), damit man sieht, welcher Key hinterlegt ist.
const fingerprint = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);

function encrypt(plain) {
  const key = masterKey();
  if (!key) throw new Error(`ENRP_SECRET fehlt in der .env oder ist kürzer als ${MIN_SECRET_LENGTH} Zeichen.`);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(blob) {
  const key = masterKey();
  const [version, iv, tag, data] = String(blob).split(':');
  if (!key || version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // falscher ENRP_SECRET oder manipulierte Daten
  }
}

function setSecret(name, value, by = null) {
  store()[name] = { value: encrypt(value), fingerprint: fingerprint(value), updatedAt: Date.now(), updatedBy: by };
  cache.set(name, value);
  db.save();
}

function getSecret(name) {
  if (cache.has(name)) return cache.get(name);
  const entry = store()[name];
  if (!entry) return null;
  const value = decrypt(entry.value);
  if (value === null) {
    console.warn(`⚠️  Geheimnis „${name}“ lässt sich nicht entschlüsseln (ENRP_SECRET geändert?). Bitte neu hinterlegen.`);
    return null;
  }
  cache.set(name, value);
  return value;
}

function deleteSecret(name) {
  cache.delete(name);
  const existed = Boolean(store()[name]);
  delete store()[name];
  db.save();
  return existed;
}

// Nur Metadaten, nie den Wert.
function secretInfo(name) {
  const entry = store()[name];
  if (!entry) return null;
  return { fingerprint: entry.fingerprint, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy, readable: getSecret(name) !== null };
}

module.exports = { MIN_SECRET_LENGTH, canEncrypt, fingerprint, encrypt, decrypt, setSecret, getSecret, deleteSecret, secretInfo };
