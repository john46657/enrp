// Zentrale Markenangaben von Emden Network. Name, Produktbezeichnungen, Profilbild und Banner stehen nur in
// config.json → branding; alle Module holen sie von hier, damit eine Änderung an einer Stelle reicht.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config.json');
const db = require('./db');

const branding = config.branding ?? {};
const ROOT = path.join(__dirname, '..', '..');

// Öffentliche Bild-URLs; ohne Eintrag in der config die von Discord gehosteten Bilder des Bots.
const discordUrls = { logo: null, banner: null };

function name() {
  return branding.name || 'Emden Network';
}

// Produktname, z. B. product('dashboard') → "Emden Network Control Center".
function product(key) {
  const template = branding.products?.[key] ?? '{name}';
  return template.replace(/\{name\}/g, name());
}

// Fußzeile für Embeds mit dem Profilbild von Emden Network als Icon.
function footer(extra) {
  return {
    text: extra ? `${name()} · ${extra}` : name(),
    iconURL: logoUrl() ?? undefined,
  };
}

function logoUrl() {
  return branding.logoUrl || discordUrls.logo;
}

function bannerUrl() {
  return branding.bannerUrl || discordUrls.banner;
}

function color(key = 'primary') {
  return config.colors[key] ?? key;
}

// "#1E9BF0" → 0x1E9BF0 für Components V2 (setAccentColor)
function colorInt(key = 'primary') {
  return parseInt(color(key).slice(1), 16);
}

// Profilbild und Banner aus assets/brand auf den Bot-Account übertragen – nur wenn sich die Dateien
// geändert haben, weil Discord Profiländerungen stark begrenzt.
async function syncProfile(client) {
  if (branding.syncProfile !== false) {
    const state = (db.data.branding ??= {});
    for (const [key, setter] of [['avatar', 'setAvatar'], ['banner', 'setBanner']]) {
      const file = branding[key] && path.join(ROOT, branding[key]);
      if (!file || !fs.existsSync(file)) continue;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (state[key] === hash) continue;
      try {
        await client.user[setter](file);
        state[key] = hash;
        db.save();
        console.log(`✅ ${key === 'avatar' ? 'Profilbild' : 'Banner'} von ${name()} aktualisiert`);
      } catch (err) {
        console.warn(`⚠️  ${key === 'avatar' ? 'Profilbild' : 'Banner'} konnte nicht gesetzt werden: ${err.message}`);
      }
    }
  }
  const user = await client.user.fetch(true).catch(() => client.user);
  discordUrls.logo = user.displayAvatarURL({ extension: 'png', size: 256 });
  discordUrls.banner = user.bannerURL({ extension: 'png', size: 1024 }) ?? null;
}

module.exports = { name, product, footer, color, colorInt, logoUrl, bannerUrl, syncProfile };
