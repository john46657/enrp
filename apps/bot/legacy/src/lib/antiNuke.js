// Schutz vor Massenlöschungen (security.antiNuke): Wer in kurzer Zeit mehrere Kanäle/Rollen löscht oder Mitglieder
// bannt, verliert seine Rollen (bzw. es wird nur gemeldet). Der Täter wird über das Discord-Audit-Log ermittelt.
const { AuditLogEvent } = require('discord.js');
const { forGuild } = require('./settings');
const { embed, getChannel } = require('./util');

const settingsOf = (guildId) => forGuild(guildId).security;
const recent = new Map(); // `${guildId}:${userId}` → Zeitpunkte
const punished = new Map(); // `${guildId}:${userId}` → Zeitpunkt der letzten Maßnahme

const LABELS = {
  [AuditLogEvent.ChannelDelete]: 'Kanal gelöscht',
  [AuditLogEvent.RoleDelete]: 'Rolle gelöscht',
  [AuditLogEvent.MemberBanAdd]: 'Mitglied gebannt',
};

// Zählt eine Aktion; liefert die Anzahl im Zeitfenster.
function track(key, now, seconds) {
  const list = (recent.get(key) ?? []).filter((t) => now - t < seconds * 1000);
  list.push(now);
  recent.set(key, list);
  return list.length;
}

// Ausgenommen: der Bot selbst, der Server-Besitzer und Mitglieder mit vertrauenswürdiger Rolle.
function isTrusted(guild, member, userId, trustedRoles) {
  if (userId === guild.client.user.id || userId === guild.ownerId) return true;
  return Boolean(member && trustedRoles.some((id) => member.roles.cache.has(id)));
}

async function findExecutor(guild, type, targetId) {
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find((e) => e.targetId === targetId && Date.now() - e.createdTimestamp < 15_000);
  return entry?.executorId ?? null;
}

async function alarm(guild, text) {
  const cfg = settingsOf(guild.id);
  const channel = await getChannel(guild, cfg.logChannel || forGuild(guild.id).channels.modLog);
  if (!channel?.isTextBased()) return;
  await channel
    .send({
      content: cfg.antiNuke.pingRoles.map((id) => `<@&${id}>`).join(' ') || undefined,
      embeds: [embed('danger').setTitle('🚨 Schutz vor Massenlöschung').setDescription(text)],
      allowedMentions: { roles: cfg.antiNuke.pingRoles },
    })
    .catch(() => {});
}

// Entfernt alle Rollen, die der Bot verwalten darf. Gibt die Zahl der entfernten Rollen zurück.
async function stripRoles(member) {
  const removable = member.roles.cache.filter((r) => r.id !== member.guild.id && r.editable && !r.managed);
  if (removable.size) await member.roles.remove([...removable.keys()], 'Schutz vor Massenlöschung');
  return removable.size;
}

async function handleDestructive(guild, type, targetId, targetName) {
  const { enabled, antiNuke } = settingsOf(guild.id);
  if (!enabled || !antiNuke.enabled) return null;
  const userId = await findExecutor(guild, type, targetId);
  if (!userId) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (isTrusted(guild, member, userId, antiNuke.trustedRoles)) return null;

  const key = `${guild.id}:${userId}`;
  const now = Date.now();
  const count = track(key, now, antiNuke.seconds);
  if (count < antiNuke.actions || now - (punished.get(key) ?? 0) < antiNuke.seconds * 1000) return { count, punished: false };
  punished.set(key, now);

  let result = 'nur gemeldet';
  if (antiNuke.punish === 'strip' && member) {
    try {
      const removed = await stripRoles(member);
      result = removed ? `${removed} Rolle(n) entfernt` : 'keine entfernbaren Rollen (Rolle steht über dem Bot?)';
    } catch (err) {
      result = `Rollen konnten nicht entfernt werden: ${err.message}`;
    }
  }
  await alarm(
    guild,
    `<@${userId}> hat ${count} destruktive Aktionen in ${antiNuke.seconds} Sekunden ausgeführt (zuletzt: ${LABELS[type]} „${targetName}“).\n**Maßnahme:** ${result}.\nNotfalls \`/sicherheit lockdown\` nutzen.`,
  );
  return { count, punished: true, result };
}

module.exports = { handleDestructive, track, isTrusted, stripRoles, _reset: () => (recent.clear(), punished.clear()) };
