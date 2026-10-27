// Auto-Mod-Regeln (moderation.automod) und Honeypot-Köderkanal (moderation.honeypot).
const { PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { embed, fill, getChannel } = require('./util');
const { logAction } = require('./moderation');

const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINK = /https?:\/\/([^\s/<>]+)/gi;
const HOIST = /^[!-/:-@[-`{-~]+/; // Satzzeichen am Anfang schieben den Namen in der Liste nach oben

const modOf = (guildId) => forGuild(guildId).moderation;
const hasAny = (member, roles) => roles.some((id) => member.roles.cache.has(id));
const recent = new Map(); // "guild:user" → [{ at, message }]

// Admins, „Nachrichten verwalten“ und ignorierte Rollen sind von Auto-Mod ausgenommen.
function automodExempt(member) {
  const { automod } = modOf(member.guild.id);
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages) || hasAny(member, automod.ignoredRoles);
}

// Teammitglieder, Besitzer und ignorierte Rollen lösen den Honeypot nicht aus.
function honeypotExempt(member) {
  const p = member.permissions;
  return (
    member.id === member.guild.ownerId ||
    [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers].some(
      (perm) => p.has(perm),
    ) ||
    hasAny(member, [...modOf(member.guild.id).ignoredRoles, ...modOf(member.guild.id).automod.ignoredRoles])
  );
}

// Welche Regel verletzt die Nachricht? Gibt die Bezeichnung zurück oder null (Spam wird separat geprüft).
function violation(message, automod) {
  const text = message.content;
  if (automod.invites.enabled && INVITE.test(text)) return 'Einladungslinks';
  if (automod.links.enabled) {
    const hosts = [...text.matchAll(LINK)].map((m) => m[1].toLowerCase());
    if (hosts.some((host) => !automod.links.allowed.some((domain) => host === domain || host.endsWith(`.${domain}`)))) return 'Links';
  }
  if (automod.caps.enabled) {
    const letters = text.replace(/[^\p{L}]/gu, '');
    const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
    if (letters.length >= automod.caps.minLength && (upper / letters.length) * 100 >= automod.caps.percent) return 'zu viele Großbuchstaben';
  }
  if (automod.ping.enabled && automod.ping.roles.length) {
    const pinged = message.mentions.roles.some((r) => automod.ping.roles.includes(r.id)) || message.mentions.members?.some((m) => hasAny(m, automod.ping.roles));
    if (pinged) return 'Ping einer geschützten Rolle';
  }
  return null;
}

async function punish(message, rule, messages = [message]) {
  for (const m of messages) await m.delete().catch(() => {});
  const notice = await message.channel
    .send({ content: `${message.author}`, embeds: [embed('warning').setDescription(`🛡️ Deine Nachricht wurde entfernt: **${rule}**.`)] })
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);
  await logAction(message.guild, { action: `Auto-Mod: ${rule}`, target: message.author, moderator: message.client.user, reason: `In ${message.channel}`, color: 'warning' });
}

function trackSpam(message, spam) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((e) => now - e.at < spam.seconds * 1000);
  list.push({ at: now, message });
  recent.set(key, list);
  if (list.length < spam.messages) return null;
  recent.delete(key);
  return list.map((e) => e.message);
}

// ---------- Honeypot ----------

const DELETE_SECONDS = { none: 0, hour: 3600, day: 86_400 };
const ACTION_LABEL = { kick: 'gekickt', ban: 'gebannt', timeout: 'stummgeschaltet' };

async function triggerHoneypot(message) {
  const { honeypot } = modOf(message.guildId);
  const member = message.member;
  await message.delete().catch(() => {});
  const reason = 'Honeypot: Nachricht im Köderkanal';
  const action = ACTION_LABEL[honeypot.action] ? honeypot.action : 'kick';

  if (honeypot.dm) {
    let invite = '';
    if (action === 'kick' && honeypot.invite) {
      const created = await message.channel.createInvite({ maxUses: 1, maxAge: 7 * 86_400, unique: true, reason }).catch(() => null);
      invite = created?.url ?? '';
    }
    const vars = { user: `${message.author}`, server: message.guild.name, action: ACTION_LABEL[action], invite };
    const text =
      honeypot.dmText ||
      'Du hast in einem Sicherheits-Kanal auf **{server}** geschrieben und wurdest deshalb automatisch {action}. Falls das ein Versehen war, melde dich beim Team.' +
        (invite ? '\nHier kannst du wieder beitreten: {invite}' : '');
    await message.author
      .send({ embeds: [embed('danger').setTitle(fill(honeypot.dmTitle || 'Du wurdest entfernt', vars)).setDescription(fill(text, vars))] })
      .catch(() => {});
  }

  const seconds = DELETE_SECONDS[honeypot.deleteMessages] ?? 0;
  try {
    if (action === 'ban') await message.guild.bans.create(member.id, { reason, deleteMessageSeconds: seconds });
    else if (action === 'timeout') await member.timeout(24 * 3_600_000, reason);
    else if (seconds) {
      // Kicken mit Löschen: kurz bannen (löscht die Nachrichten) und sofort wieder entbannen.
      await message.guild.bans.create(member.id, { reason, deleteMessageSeconds: seconds });
      await message.guild.bans.remove(member.id, 'Honeypot: Kick mit Löschen');
    } else await member.kick(reason);
  } catch (err) {
    console.error('[honeypot]', err.message);
  }
  await logAction(message.guild, { action: `Honeypot: ${ACTION_LABEL[action]}`, target: message.author, moderator: message.client.user, reason });
}

// Warn-Hinweis in den Köderkanal posten (Dashboard-Button).
async function postHoneypotNotice(guild) {
  const { honeypot } = modOf(guild.id);
  const channel = await getChannel(guild, honeypot.channel);
  if (!channel?.isTextBased()) throw new Error('Kein Köderkanal eingestellt.');
  await channel.send({ embeds: [embed('danger').setTitle(honeypot.warnTitle || '⛔ Hier nicht schreiben!').setDescription(honeypot.warnText || ' ')] });
}

// Gibt true zurück, wenn die Nachricht entfernt wurde (dann keine XP o. Ä. vergeben).
async function handleMessage(message) {
  const { enabled, honeypot, automod } = modOf(message.guildId);
  const member = message.member;
  if (!enabled || !member) return false;

  if (honeypot.enabled && honeypot.channel === message.channelId && !honeypotExempt(member)) {
    await triggerHoneypot(message);
    return true;
  }
  if (automodExempt(member)) return false;

  const rule = violation(message, automod);
  if (rule) {
    await punish(message, rule);
    return true;
  }
  if (automod.spam.enabled) {
    const spam = trackSpam(message, automod.spam);
    if (spam) {
      await punish(message, 'Spam', spam);
      return true;
    }
  }
  return false;
}

// Anti-Hoisting: Satzzeichen am Anfang des Anzeigenamens entfernen.
async function checkHoisting(member) {
  const { enabled, automod } = modOf(member.guild.id);
  if (!enabled || !automod.hoisting.enabled || !member.manageable || automodExempt(member)) return;
  if (!HOIST.test(member.displayName)) return;
  const name = member.displayName.replace(HOIST, '').trim() || 'Moderierter Name';
  await member.setNickname(name.slice(0, 32), 'Auto-Mod: Anti-Hoisting').catch((err) => console.error('[hoisting]', err.message));
}

module.exports = { handleMessage, checkHoisting, postHoneypotNotice, violation };
