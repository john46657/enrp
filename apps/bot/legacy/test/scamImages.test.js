// Tests für den Scam-Bilder-Schutz: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-scam-'));
const { Collection, PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { Jimp } = require('jimp');
const settings = require('../src/lib/settings');
const db = require('../src/lib/db');
const scam = require('../src/lib/scamImages');

// Testbilder mit Struktur: zufällige Helligkeitsflächen (fester Startwert), damit der Hash Information enthält.
async function pattern(seed, size, mime = 'image/png') {
  let state = seed;
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cells = Array.from({ length: 64 }, () => Math.floor(random() * 256));
  const img = new Jimp({ width: size, height: size, color: 0x000000ff });
  img.scan(0, 0, size, size, function (x, y, idx) {
    const v = cells[Math.floor((y / size) * 8) * 8 + Math.floor((x / size) * 8)];
    this.bitmap.data[idx] = v;
    this.bitmap.data[idx + 1] = (v * 3) % 256;
    this.bitmap.data[idx + 2] = 255 - v;
  });
  return img.getBuffer(mime, mime === 'image/jpeg' ? { quality: 60 } : undefined);
}
const gradient = (size, mime) => pattern(42, size, mime); // „Scam-Bild“
const checker = (size) => pattern(7, size); // anderes Bild

const files = new Map(); // URL → Buffer für den nachgebauten Download
global.fetch = async (url) => ({ ok: files.has(url), status: files.has(url) ? 200 : 404, arrayBuffer: async () => files.get(url) });

function fakeMessage(guildId, userId, url, { admin = false } = {}) {
  const actions = [];
  return {
    guildId,
    guild: { id: guildId, channels: { cache: new Collection(), fetch: async () => null }, bans: { create: async (id) => actions.push(`ban:${id}`) } },
    channel: { toString: () => '#chat' },
    author: { id: userId, username: `u${userId}`, toString: () => `<@${userId}>` },
    member: { id: userId, permissions: new PermissionsBitField(admin ? PermissionFlagsBits.Administrator : 0n), timeout: async () => actions.push('timeout'), kick: async () => actions.push('kick') },
    attachments: new Collection([[url, { url, name: 'bild.png', contentType: 'image/png', size: files.get(url)?.length ?? 0 }]]),
    deleted: false,
    delete: async function () {
      this.deleted = true;
    },
    actions,
  };
}

let n = 0;
function guildWith(extra = {}) {
  const id = `500000000000000000${++n}`;
  settings.set(id, 'security.enabled', true);
  settings.set(id, 'security.scamImages', { ...settings.forGuild(id).security.scamImages, enabled: true, ...extra });
  return id;
}

test('Bild-Hash: Kopien in anderer Größe und als JPEG gelten als gleich, andere Bilder nicht', async () => {
  const original = await scam.dHash(await gradient(256));
  const smaller = await scam.dHash(await gradient(120, 'image/jpeg'));
  const other = await scam.dHash(await checker(256));
  assert.ok(scam.distance(original, smaller) <= 6, `Abstand Kopie: ${scam.distance(original, smaller)}`);
  assert.ok(scam.distance(original, other) > 16, `Abstand anderes Bild: ${scam.distance(original, other)}`);
  assert.equal(scam.distance(original, original), 0);
});

test('Gemeldetes Bild wird danach automatisch entfernt (mit Aktion), andere Bilder bleiben', async () => {
  const guildId = guildWith({ action: 'timeout' });
  files.set('https://cdn/scam.png', await gradient(256));
  files.set('https://cdn/scam-kopie.jpg', await gradient(180, 'image/jpeg'));
  files.set('https://cdn/harmlos.png', await checker(200));

  const reported = fakeMessage(guildId, '1', 'https://cdn/scam.png');
  assert.equal(await scam.reportMessage(reported, { id: 'mod', tag: 'mod', toString: () => '<@mod>' }), 1);
  assert.ok(reported.deleted);
  assert.equal(scam.knownOf(guildId)[0].source, 'report');

  const copy = fakeMessage(guildId, '2', 'https://cdn/scam-kopie.jpg');
  assert.equal(await scam.checkMessage(copy), true);
  assert.ok(copy.deleted);
  assert.deepEqual(copy.actions, ['timeout']);
  assert.equal(scam.knownOf(guildId)[0].hits, 1);

  const harmless = fakeMessage(guildId, '3', 'https://cdn/harmlos.png');
  assert.equal(await scam.checkMessage(harmless), false);
  assert.ok(!harmless.deleted);

  const admin = fakeMessage(guildId, '4', 'https://cdn/scam-kopie.jpg', { admin: true });
  assert.equal(await scam.checkMessage(admin), false, 'Admins sind ausgenommen');
});

test('Selbst erkennen: gleiches Bild von mehreren Mitgliedern in kurzer Zeit', async () => {
  const guildId = guildWith({ autoDetect: { enabled: true, members: 3, minutes: 10 } });
  files.set('https://cdn/neu.png', await gradient(300));
  const first = fakeMessage(guildId, 'a', 'https://cdn/neu.png');
  const second = fakeMessage(guildId, 'b', 'https://cdn/neu.png');
  assert.equal(await scam.checkMessage(first), false);
  assert.equal(await scam.checkMessage(second), false);
  const third = fakeMessage(guildId, 'c', 'https://cdn/neu.png');
  assert.equal(await scam.checkMessage(third), true);
  assert.ok(first.deleted && second.deleted && third.deleted, 'alle drei Nachrichten entfernt');
  assert.equal(scam.knownOf(guildId)[0].source, 'auto');
  // Ein Mitglied, das dasselbe Bild dreimal postet, löst die Erkennung nicht aus.
  const g2 = guildWith({ autoDetect: { enabled: true, members: 3, minutes: 10 } });
  for (let i = 0; i < 3; i++) assert.equal(await scam.checkMessage(fakeMessage(g2, 'same', 'https://cdn/neu.png')), false);
});

test('Strukturlose Bilder werden weder gespeichert noch verglichen', async () => {
  const plain = new Jimp({ width: 64, height: 64, color: 0x336699ff });
  const hash = await scam.dHash(await plain.getBuffer('image/png'));
  assert.equal(scam.informative(hash), false);
  const guildId = guildWith();
  files.set('https://cdn/blau.png', await plain.getBuffer('image/png'));
  await assert.rejects(scam.reportMessage(fakeMessage(guildId, '1', 'https://cdn/blau.png'), { id: 'mod', tag: 'mod' }), /zu wenig Bildinhalt/);
  assert.equal(scam.knownOf(guildId).length, 0);
});

test('Ausgeschaltet: nichts wird geprüft', async () => {
  const guildId = guildWith({ enabled: false });
  files.set('https://cdn/x.png', await gradient(64));
  scam.addKnown(guildId, await scam.dHash(files.get('https://cdn/x.png')), { source: 'report' });
  const message = fakeMessage(guildId, '9', 'https://cdn/x.png');
  assert.equal(await scam.checkMessage(message), false);
  assert.ok(!message.deleted);
});

test.after(() => {
  db.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
