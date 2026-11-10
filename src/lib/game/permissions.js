// Berechtigungsstufen für Spiel, CAD und BOLO – je Discord einstellbar (/spiel-admin berechtigung).
//
//   view        Einsicht: Live-Spieler, Fahrzeuge, Staff, Notrufe, Logs ansehen
//   dispatch    CAD und BOLO bearbeiten, Notrufe übernehmen
//   moderation  Spieleraktionen: PM, Kick, Jail, Heal, Kill, Respawn, Wanted, Team
//   admin       Bann, Ansage, Neustart, freie Befehle, Admin-Center
//
// Jede Stufe schließt die darunterliegenden ein. Staff-Rolle oder „Server verwalten“ = admin.
// Ohne eingestellte Rollen gilt: view hat jeder, alles andere nur Staff.
const { forGuild } = require('../settings');
const { isStaff } = require('../util');

const LEVELS = ['view', 'dispatch', 'moderation', 'admin'];
const LABELS = { view: 'Einsicht', dispatch: 'Dispatch', moderation: 'Moderation', admin: 'Admin' };

const rolesFor = (guildId, level) => forGuild(guildId).game.permissions[level] ?? [];

// Höchste Stufe als Index (-1 = keine)
function levelIndex(member) {
  if (!member) return -1;
  if (isStaff(member)) return LEVELS.length - 1;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (rolesFor(member.guild.id, LEVELS[i]).some((roleId) => member.roles.cache.has(roleId))) return i;
  }
  return rolesFor(member.guild.id, 'view').length ? -1 : 0;
}

const can = (member, level) => levelIndex(member) >= LEVELS.indexOf(level);
const levelName = (member) => LABELS[LEVELS[levelIndex(member)]] ?? 'keine';

function deny(level) {
  return `🔒 Dafür brauchst du die Stufe **${LABELS[level]}** (Rollen: \`/spiel-admin berechtigung\`).`;
}

module.exports = { LEVELS, LABELS, levelIndex, can, levelName, deny, rolesFor };
