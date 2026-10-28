// Verwarnungen mit Ablauf, Warn-Rollen und öffentlichem Post. Wird von der Moderation (/warn, Speicher "warnings")
// und der Teamverwaltung (/team verwarnen, Speicher "teamWarnings") genutzt.
// Einstellungen (cfg): { expire: { enabled, days }, dmOnExpire, roles: [Warn 1 … Warn 5], publicChannel }.
const { bucket, save } = require('./db');
const { embed, getChannel } = require('./util');

const DAY = 86_400_000;
const isActive = (w, now = Date.now()) => !w.expired && !(w.expiresAt && w.expiresAt <= now);
const activeOf = (list) => (list ?? []).filter((w) => isActive(w));

// days: eigene Ablaufzeit in Tagen (0 = läuft nie ab), sonst die Standardzeit aus cfg.expire.
function addWarning(store, guildId, userId, { reason, by, days }, cfg) {
  const list = (bucket(store, guildId)[userId] ??= []);
  const expireDays = days ?? (cfg.expire?.enabled ? cfg.expire.days : 0);
  list.push({ reason, by, at: Date.now(), expiresAt: expireDays > 0 ? Date.now() + expireDays * DAY : null });
  save();
  return list;
}

// Hält genau die Warn-Rolle passend zur Anzahl aktiver Verwarnungen (bei mehr als 5: die letzte gesetzte).
async function syncWarnRoles(member, cfg, store) {
  const roles = (cfg.roles ?? []).filter(Boolean);
  if (!member || !roles.length) return;
  const count = activeOf(bucket(store, member.guild.id)[member.id]).length;
  const configured = cfg.roles.slice(0, Math.min(count, cfg.roles.length)).filter(Boolean);
  const target = count > 0 ? configured.at(-1) : null;
  const remove = roles.filter((id) => id !== target && member.roles.cache.has(id));
  if (remove.length) await member.roles.remove(remove, 'Warn-Rollen angepasst').catch((err) => console.error('[warnRoles]', err.message));
  if (target && !member.roles.cache.has(target)) await member.roles.add(target, 'Warn-Rollen angepasst').catch((err) => console.error('[warnRoles]', err.message));
}

async function postPublic(guild, cfg, { title, user, moderator, reason, count }) {
  const channel = await getChannel(guild, cfg.publicChannel);
  if (!channel?.isTextBased()) return;
  await channel
    .send({
      embeds: [
        embed('warning')
          .setTitle(title)
          .setThumbnail(user.displayAvatarURL())
          .addFields(
            { name: 'Mitglied', value: `${user}`, inline: true },
            { name: 'Von', value: `${moderator}`, inline: true },
            { name: 'Aktive Verwarnungen', value: String(count), inline: true },
            { name: 'Grund', value: reason },
          ),
      ],
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('[warnPublic]', err.message));
}

// Abgelaufene Verwarnungen markieren, Rollen anpassen und auf Wunsch per DM Bescheid geben.
async function sweepExpired(guild, store, cfg, label) {
  const now = Date.now();
  for (const [userId, list] of Object.entries(bucket(store, guild.id))) {
    const expired = list.filter((w) => !w.expired && w.expiresAt && w.expiresAt <= now);
    if (!expired.length) continue;
    for (const w of expired) w.expired = true;
    save();
    const member = await guild.members.fetch(userId).catch(() => null);
    await syncWarnRoles(member, cfg, store);
    if (cfg.dmOnExpire && member) {
      await member
        .send({
          embeds: [
            embed('success').setDescription(
              `✅ ${expired.length === 1 ? 'Eine' : expired.length} ${label} auf **${guild.name}** ${expired.length === 1 ? 'ist' : 'sind'} abgelaufen.\n` +
                expired.map((w) => `- ${w.reason}`).join('\n'),
            ),
          ],
        })
        .catch(() => {});
    }
  }
}

module.exports = { isActive, activeOf, addWarning, syncWarnRoles, postPublic, sweepExpired };
