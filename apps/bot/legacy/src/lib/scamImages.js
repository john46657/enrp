// Scam-Bilder-Schutz (security.scamImages): erkennt bekannte Betrugsbilder per Bild-Vergleich und entfernt sie.
// Vergleich über einen Differenz-Hash (dHash, 64 Bit): Bild auf 9×8 Graustufen verkleinern, je Zeile benachbarte
// Pixel vergleichen. Kleine Änderungen (Größe, Kompression, leichte Farbänderungen) ändern nur wenige Bits.
// Bekannte Bilder kommen aus Meldungen („Als Scam-Bild melden“) oder werden selbst erkannt, wenn dasselbe Bild kurz
// hintereinander von mehreren verschiedenen Mitgliedern gepostet wird (typisches Scam-Bot-Muster).
const { PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save } = require('./db');
const { embed, getChannel } = require('./util');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_KNOWN = 500;
const settingsOf = (guildId) => forGuild(guildId).security;
function knownOf(guildId) {
  const data = bucket('scamImages', guildId);
  data.list ??= [];
  return data.list;
}

let Jimp;
async function dHash(buffer) {
  Jimp ??= require('jimp').Jimp;
  const image = await Jimp.read(buffer);
  image.resize({ w: 9, h: 8 }).greyscale();
  const { data } = image.bitmap;
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[(y * 9 + x) * 4];
      const right = data[(y * 9 + x + 1) * 4];
      bits += left > right ? '1' : '0';
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

function distance(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

// Bilder ohne Struktur (einfarbig, gleichmäßiger Verlauf) haben fast nur 0- oder 1-Bits und würden sich mit allen
// ähnlich strukturlosen Bildern decken. Solche Hashes werden weder gespeichert noch verglichen.
const bitCount = (hash) => [...BigInt(`0x${hash}`).toString(2)].filter((b) => b === '1').length;
const informative = (hash) => bitCount(hash) >= 8 && bitCount(hash) <= 56;

const findKnown = (guildId, hash) => knownOf(guildId).find((k) => distance(k.hash, hash) <= settingsOf(guildId).scamImages.threshold);

function addKnown(guildId, hash, { source, addedBy, name }) {
  const list = knownOf(guildId);
  const existing = list.find((k) => distance(k.hash, hash) <= settingsOf(guildId).scamImages.threshold);
  if (existing) return existing;
  const entry = { hash, source, addedBy: addedBy ?? null, addedAt: Date.now(), name: name?.slice(0, 100) ?? '', hits: 0 };
  list.unshift(entry);
  list.length = Math.min(list.length, MAX_KNOWN);
  save();
  return entry;
}

const imageAttachments = (message) => [...message.attachments.values()].filter((a) => a.contentType?.startsWith('image/') && a.size <= MAX_BYTES);

async function hashAttachment(attachment) {
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  return dHash(Buffer.from(await res.arrayBuffer()));
}

async function log(guild, text) {
  const cfg = settingsOf(guild.id);
  const channel = await getChannel(guild, cfg.logChannel || forGuild(guild.id).channels.modLog);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed('danger').setTitle('🖼️ Scam-Bild').setDescription(text)], allowedMentions: { parse: [] } }).catch(() => {});
}

// Nachricht löschen und die eingestellte Aktion gegen den Absender ausführen.
async function punish(message, reason) {
  const { action, timeoutMinutes } = settingsOf(message.guildId).scamImages;
  await message.delete().catch(() => {});
  const member = message.member;
  if (!member) return 'gelöscht';
  try {
    if (action === 'timeout') await member.timeout(timeoutMinutes * 60_000, reason);
    else if (action === 'kick') await member.kick(reason);
    else if (action === 'ban') await message.guild.bans.create(member.id, { reason, deleteMessageSeconds: 3600 });
  } catch (err) {
    console.error('[scamImages]', err.message);
  }
  return { timeout: `gelöscht + ${timeoutMinutes} Min. Timeout`, kick: 'gelöscht + gekickt', ban: 'gebannt (Nachrichten der letzten Stunde gelöscht)' }[action] ?? 'gelöscht';
}

const exempt = (member) => !member || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages);
const recent = new Map(); // guildId → [{ hash, userId, at, message }]

// Gibt true zurück, wenn die Nachricht als Scam entfernt wurde.
async function checkMessage(message) {
  const cfg = settingsOf(message.guildId);
  if (!cfg.enabled || !cfg.scamImages.enabled || exempt(message.member)) return false;
  const images = imageAttachments(message);
  if (!images.length) return false;
  const hashes = [];
  for (const attachment of images) {
    try {
      const hash = await hashAttachment(attachment);
      if (informative(hash)) hashes.push(hash);
    } catch (err) {
      // Nicht lesbare Formate (z. B. WebP) werden übersprungen.
      if (!/unsupported|mime/i.test(err.message)) console.error('[scamImages]', err.message);
    }
  }
  for (const hash of hashes) {
    const known = findKnown(message.guildId, hash);
    if (known) {
      known.hits++;
      save();
      const result = await punish(message, 'Bekanntes Scam-Bild');
      await log(message.guild, `${message.author} (${message.author.username}) hat ein bekanntes Scam-Bild in ${message.channel} gepostet → ${result}.`);
      return true;
    }
  }
  // Selbst erkennen: gleiches Bild von mehreren verschiedenen Mitgliedern in kurzer Zeit.
  const auto = cfg.scamImages.autoDetect;
  if (!auto.enabled || !hashes.length) return false;
  const now = Date.now();
  const list = (recent.get(message.guildId) ?? []).filter((e) => now - e.at < auto.minutes * 60_000);
  for (const hash of hashes) list.push({ hash, userId: message.author.id, at: now, message });
  recent.set(message.guildId, list);
  for (const hash of hashes) {
    const similar = list.filter((e) => distance(e.hash, hash) <= cfg.scamImages.threshold);
    const users = new Set(similar.map((e) => e.userId));
    if (users.size < auto.members) continue;
    addKnown(message.guildId, hash, { source: 'auto', name: `Automatisch erkannt (${users.size} Mitglieder)` });
    for (const e of similar) await punish(e.message, 'Scam-Bild (von mehreren Konten gepostet)');
    recent.set(message.guildId, list.filter((e) => !similar.includes(e)));
    await log(message.guild, `Dasselbe Bild wurde in ${auto.minutes} Min. von ${users.size} Mitgliedern gepostet: ${[...users].map((id) => `<@${id}>`).join(', ')}. Es ist jetzt als Scam-Bild bekannt und wurde entfernt.`);
    return true;
  }
  return false;
}

// Rechtsklick „Als Scam-Bild melden“: Bilder der Nachricht merken und die Nachricht entfernen.
async function reportMessage(message, reporter) {
  const images = imageAttachments(message);
  if (!images.length) throw new Error('Diese Nachricht enthält kein Bild (als Anhang).');
  let added = 0;
  for (const attachment of images) {
    const hash = await hashAttachment(attachment).catch(() => null);
    if (!hash || !informative(hash)) continue;
    addKnown(message.guildId, hash, { source: 'report', addedBy: reporter.id, name: attachment.name });
    added++;
  }
  if (!added) throw new Error('Das Bild kann nicht verwendet werden: Format nicht lesbar (unterstützt: PNG, JPEG, GIF, BMP, TIFF) oder zu wenig Bildinhalt (z. B. einfarbig).');
  const result = await punish(message, `Scam-Bild, gemeldet von ${reporter.tag}`);
  await log(message.guild, `${reporter} hat ein Bild von ${message.author} als Scam gemeldet (${added} Bild(er) gespeichert) → ${result}.`);
  return added;
}

function removeKnown(guildId, hash) {
  const list = knownOf(guildId);
  const index = list.findIndex((k) => k.hash === hash);
  if (index < 0) throw new Error('Nicht gefunden.');
  list.splice(index, 1);
  save();
}

module.exports = { dHash, distance, informative, checkMessage, reportMessage, knownOf, removeKnown, addKnown };
