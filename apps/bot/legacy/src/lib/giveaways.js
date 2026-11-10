// Giveaways (giveaways in config.json): Teilnahme-Button, Bedingungen, Bonus-Lose, Blacklist, automatische Ziehung,
// Gewinner-DM, Gewinner-Rolle (optional befristet), Einlösefrist mit Neuziehung, Ticket für Gewinner und Vorlagen.
// Laufende und beendete Giveaways liegen in data/db.json unter giveaways.<guildId> (Nachrichten-ID → Giveaway).
const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save } = require('./db');
const { embed, fill, getChannel, replyPrivate } = require('./util');
const { zonedParts } = require('./time');

const settingsOf = (guildId) => forGuild(guildId).giveaways;
const giveawaysOf = (guildId) => bucket('giveaways', guildId);
const DAY = 86_400_000;
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY };

// "1d12h", "30m", "2w" → Millisekunden (null bei ungültiger Eingabe). Höchstens 60 Tage.
function parseDuration(text) {
  const value = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(value)) return null;
  const ms = [...value.matchAll(/(\d+)([smhdw])/g)].reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit], 0);
  return ms >= 60_000 && ms <= 60 * DAY ? ms : null;
}

const isManager = (member) =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) || settingsOf(member.guild.id).managerRoles.some((id) => member.roles.cache.has(id));

async function log(guild, text) {
  const channel = await getChannel(guild, settingsOf(guild.id).logChannel);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed().setTitle('🎉 Giveaways').setDescription(text)], allowedMentions: { parse: [] } }).catch(() => {});
}

// ---------- Nachricht ----------

const unix = (ms) => Math.floor(ms / 1000);
function requirementLines(g) {
  const lines = [];
  if (g.requiredRoles?.length) lines.push(`Rolle${g.requiredRoles.length > 1 ? (g.requireAll ? 'n (alle)' : 'n (eine davon)') : ''}: ${g.requiredRoles.map((id) => `<@&${id}>`).join(' ')}`);
  if (g.blockedRoles?.length) lines.push(`Ausgeschlossen: ${g.blockedRoles.map((id) => `<@&${id}>`).join(' ')}`);
  if (g.minServerDays) lines.push(`Mind. ${g.minServerDays} Tage auf dem Server`);
  if (g.minAccountDays) lines.push(`Account mind. ${g.minAccountDays} Tage alt`);
  if (g.bonus?.length) lines.push(`Bonus-Lose: ${g.bonus.map((b) => `<@&${b.role}> +${b.entries}`).join(', ')}`);
  return lines;
}

function giveawayMessage(guildId, g) {
  const cfg = settingsOf(guildId);
  const count = Object.keys(g.entries).length;
  const result = new EmbedBuilder()
    .setColor(g.ended ? '#4B5563' : g.color || cfg.color || '#2F7BFF')
    .setTitle(`🎉 ${g.prize}`)
    .setDescription(
      [
        g.description,
        g.ended
          ? `**Beendet** <t:${unix(g.endsAt)}:R>\n**Gewinner:** ${g.winnerIds?.length ? g.winnerIds.map((id) => `<@${id}>`).join(', ') : 'niemand'}`
          : `Endet <t:${unix(g.endsAt)}:R> (<t:${unix(g.endsAt)}:f>)\n**Gewinner:** ${g.winners}`,
        `Veranstaltet von <@${g.hostId}>`,
        requirementLines(g).length ? `**Bedingungen**\n${requirementLines(g).map((l) => `- ${l}`).join('\n')}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
    .setTimestamp(g.endsAt);
  if (cfg.showCount) result.setFooter({ text: `${count} Teilnehmer` });
  if (g.image || cfg.image) result.setImage(g.image || cfg.image);
  const button = new ButtonBuilder()
    .setCustomId('giveaway:join')
    .setLabel(g.ended ? 'Beendet' : (cfg.buttonLabel || 'Teilnehmen').slice(0, 80))
    .setStyle(ButtonStyle.Primary)
    .setDisabled(Boolean(g.ended));
  if (cfg.buttonEmoji) button.setEmoji(cfg.buttonEmoji);
  return { embeds: [result], components: [new ActionRowBuilder().addComponents(button)] };
}

async function editMessage(guild, g) {
  const channel = guild.channels.cache.get(g.channelId);
  const message = await channel?.messages.fetch(g.messageId).catch(() => null);
  await message?.edit(giveawayMessage(guild.id, g)).catch((err) => console.error('[giveaway]', err.message));
}

// Teilnehmerzahl höchstens alle 5 Sekunden je Giveaway aktualisieren.
const pendingEdits = new Map();
function scheduleEdit(guild, g) {
  if (pendingEdits.has(g.messageId)) return;
  pendingEdits.set(
    g.messageId,
    setTimeout(() => {
      pendingEdits.delete(g.messageId);
      editMessage(guild, g);
    }, 5000),
  );
}

// ---------- Starten ----------

// options: { prize, description, durationMs, winners, channelId, image, requiredRoles, requireAll, blockedRoles, minServerDays, minAccountDays, bonus, hostId, templateId }
async function startGiveaway(guild, options) {
  const cfg = settingsOf(guild.id);
  if (!cfg.enabled) throw new Error('Giveaways sind auf diesem Server deaktiviert.');
  if (!options.prize?.trim()) throw new Error('Gib einen Preis an.');
  if (!(options.durationMs >= 60_000)) throw new Error('Ungültige Dauer. Beispiele: 30m, 2h, 1d, 1d12h, 1w');
  const winners = Math.min(Math.max(Number(options.winners) || 1, 1), 20);
  const channel = await getChannel(guild, options.channelId || cfg.defaultChannel);
  if (!channel?.isTextBased()) throw new Error('Kein Kanal angegeben und kein Standard-Kanal eingestellt.');

  const g = {
    id: crypto.randomBytes(4).toString('hex'),
    channelId: channel.id,
    prize: options.prize.trim().slice(0, 200),
    description: options.description?.slice(0, 1500) || '',
    winners,
    endsAt: Date.now() + options.durationMs,
    startedAt: Date.now(),
    hostId: options.hostId,
    image: options.image || '',
    requiredRoles: options.requiredRoles ?? [],
    requireAll: Boolean(options.requireAll),
    blockedRoles: options.blockedRoles ?? [],
    minServerDays: options.minServerDays || 0,
    minAccountDays: options.minAccountDays || 0,
    bonus: (options.bonus ?? []).filter((b) => b.role && b.entries > 0),
    templateId: options.templateId ?? null,
    entries: {},
    ended: false,
    cancelled: false,
    winnerIds: [],
    claims: {},
  };
  const ping = { everyone: '@everyone', here: '@here', role: cfg.pingRole ? `<@&${cfg.pingRole}>` : null }[cfg.ping] ?? null;
  const message = await channel.send({
    content: ping ?? undefined,
    ...giveawayMessage(guild.id, g),
    allowedMentions: cfg.ping === 'role' ? { roles: [cfg.pingRole] } : cfg.ping === 'everyone' || cfg.ping === 'here' ? { parse: ['everyone'] } : { parse: [] },
  });
  g.messageId = message.id;
  giveawaysOf(guild.id)[message.id] = g;
  save();
  await log(guild, `▶️ Giveaway **${g.prize}** in ${channel} gestartet von <@${g.hostId}> (endet <t:${unix(g.endsAt)}:R>).`);
  return g;
}

function startFromTemplate(guild, template, hostId) {
  return startGiveaway(guild, { ...template, durationMs: parseDuration(template.duration), channelId: template.channel, hostId, templateId: template.id });
}

// ---------- Teilnahme ----------

function entryError(member, g) {
  const cfg = settingsOf(member.guild.id);
  const has = (id) => member.roles.cache.has(id);
  if (cfg.blacklist.users.includes(member.id) || cfg.blacklist.roles.some(has)) return 'Du bist von Giveaways ausgeschlossen.';
  if (g.blockedRoles.some(has)) return 'Mit deinen Rollen kannst du hier nicht teilnehmen.';
  if (g.requiredRoles.length && !(g.requireAll ? g.requiredRoles.every(has) : g.requiredRoles.some(has))) {
    return `Dafür brauchst du ${g.requireAll ? 'alle' : 'eine'} dieser Rollen: ${g.requiredRoles.map((id) => `<@&${id}>`).join(' ')}`;
  }
  if (g.minServerDays && Date.now() - member.joinedTimestamp < g.minServerDays * DAY) return `Du musst mindestens ${g.minServerDays} Tage auf dem Server sein.`;
  if (g.minAccountDays && Date.now() - member.user.createdTimestamp < g.minAccountDays * DAY) return `Dein Account muss mindestens ${g.minAccountDays} Tage alt sein.`;
  return null;
}

async function handleJoin(interaction) {
  const g = giveawaysOf(interaction.guildId)[interaction.message.id];
  if (!g || g.ended) return replyPrivate(interaction, 'Dieses Giveaway ist beendet.');
  if (g.entries[interaction.user.id]) {
    delete g.entries[interaction.user.id];
    save();
    scheduleEdit(interaction.guild, g);
    return replyPrivate(interaction, '↩️ Du nimmst nicht mehr teil.');
  }
  const error = entryError(interaction.member, g);
  if (error) return replyPrivate(interaction, `❌ ${error}`);
  g.entries[interaction.user.id] = Date.now();
  save();
  scheduleEdit(interaction.guild, g);
  const bonus = g.bonus.filter((b) => interaction.member.roles.cache.has(b.role)).reduce((n, b) => n + b.entries, 0);
  return replyPrivate(interaction, `🎉 Du nimmst teil!${bonus ? ` Du hast **${1 + bonus} Lose** (Bonus-Rollen).` : ''} Klicke nochmal, um auszutreten.`);
}

// ---------- Ziehung ----------

// Gewichtete Ziehung ohne Zurücklegen. pool: [{ id, weight }]
function drawWinners(pool, count, random = Math.random) {
  const remaining = [...pool];
  const winners = [];
  while (winners.length < count && remaining.length) {
    const total = remaining.reduce((sum, p) => sum + p.weight, 0);
    let pick = random() * total;
    const index = remaining.findIndex((p) => (pick -= p.weight) < 0);
    winners.push(remaining.splice(index < 0 ? remaining.length - 1 : index, 1)[0].id);
  }
  return winners;
}

async function buildPool(guild, g, exclude = []) {
  await guild.members.fetch().catch(() => null);
  const pool = [];
  for (const userId of Object.keys(g.entries)) {
    if (exclude.includes(userId)) continue;
    const member = guild.members.cache.get(userId);
    if (!member || entryError(member, g)) continue; // verlassen oder Bedingungen nicht mehr erfüllt
    pool.push({ id: userId, weight: 1 + g.bonus.filter((b) => member.roles.cache.has(b.role)).reduce((n, b) => n + Math.min(b.entries, 10), 0) });
  }
  return pool;
}

async function notifyWinners(guild, g, winnerIds) {
  const cfg = settingsOf(guild.id);
  const channel = guild.channels.cache.get(g.channelId);
  if (cfg.notify !== 'dm' && channel) {
    await channel
      .send({
        content: winnerIds.length ? `🎉 Glückwunsch ${winnerIds.map((id) => `<@${id}>`).join(', ')}! Ihr habt **${g.prize}** gewonnen.` : `Für **${g.prize}** gab es keine gültigen Teilnehmer.`,
        components: cfg.claim.enabled && winnerIds.length
          ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:claim:${g.messageId}`).setLabel('Gewinn einlösen').setStyle(ButtonStyle.Success).setEmoji('🎁'))]
          : [],
        allowedMentions: { users: winnerIds },
        reply: { messageReference: g.messageId, failIfNotExists: false },
      })
      .catch((err) => console.error('[giveaway]', err.message));
  }
  for (const id of winnerIds) {
    if (cfg.claim.enabled) g.claims[id] = { deadline: Date.now() + cfg.claim.hours * 3_600_000, claimed: false };
    if (cfg.notify !== 'channel') {
      const user = await guild.client.users.fetch(id).catch(() => null);
      const text = fill(cfg.winnerMessage, { user: `<@${id}>`, username: user?.username ?? '', prize: g.prize, server: guild.name, giveaway: g.prize });
      const extra = cfg.claim.enabled ? `\n\nLöse deinen Gewinn bis <t:${unix(g.claims[id].deadline)}:f> im Kanal <#${g.channelId}> ein – sonst wird neu gezogen.` : '';
      await user?.send({ embeds: [embed('success').setDescription(text + extra)] }).catch(() => {});
    }
    if (!cfg.claim.enabled) await giveWinnerRole(guild, id);
  }
  save();
}

async function giveWinnerRole(guild, userId) {
  const { winnerRole, winnerRoleDays } = settingsOf(guild.id);
  if (!winnerRole) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  await member?.roles.add(winnerRole, 'Giveaway gewonnen').catch((err) => console.error('[giveawayRole]', err.message));
  if (winnerRoleDays > 0) {
    bucket('giveawayRoles', guild.id)[`${userId}:${winnerRole}`] = Date.now() + winnerRoleDays * DAY;
    save();
  }
}

async function endGiveaway(guild, g) {
  if (g.ended) return g;
  g.ended = true;
  const pool = await buildPool(guild, g);
  g.winnerIds = drawWinners(pool, g.winners);
  save();
  await editMessage(guild, g);
  await notifyWinners(guild, g, g.winnerIds);
  await log(guild, `🏁 **${g.prize}** beendet – ${Object.keys(g.entries).length} Teilnehmer, Gewinner: ${g.winnerIds.map((id) => `<@${id}>`).join(', ') || 'niemand'}.`);
  return g;
}

// Neu ziehen: count neue Gewinner, bisherige Gewinner sind ausgeschlossen. replace = ersetzt diese Gewinner.
async function reroll(guild, g, count = 1, replace = []) {
  if (!g.ended) throw new Error('Das Giveaway läuft noch.');
  const pool = await buildPool(guild, g, [...g.winnerIds, ...(g.rerolled ?? [])]);
  const fresh = drawWinners(pool, count);
  g.rerolled = [...(g.rerolled ?? []), ...replace];
  g.winnerIds = [...g.winnerIds.filter((id) => !replace.includes(id)), ...fresh];
  for (const id of replace) delete g.claims[id];
  save();
  await editMessage(guild, g);
  await notifyWinners(guild, g, fresh);
  await log(guild, `🔁 **${g.prize}** neu gezogen: ${fresh.map((id) => `<@${id}>`).join(', ') || 'keine weiteren Teilnehmer'}.`);
  return fresh;
}

async function cancelGiveaway(guild, g) {
  g.ended = true;
  g.cancelled = true;
  g.winnerIds = [];
  save();
  await editMessage(guild, g);
  await log(guild, `⛔ **${g.prize}** abgebrochen.`);
}

async function handleClaim(interaction, messageId) {
  const g = giveawaysOf(interaction.guildId)[messageId];
  const claim = g?.claims[interaction.user.id];
  if (!claim) return replyPrivate(interaction, 'Du hast hier nichts gewonnen.');
  if (claim.claimed) return replyPrivate(interaction, 'Du hast deinen Gewinn bereits eingelöst. ✅');
  if (claim.deadline < Date.now()) return replyPrivate(interaction, 'Die Einlösefrist ist abgelaufen.');
  claim.claimed = true;
  claim.claimedAt = Date.now();
  save();
  await giveWinnerRole(interaction.guild, interaction.user.id);
  await log(interaction.guild, `🎁 ${interaction.user} hat **${g.prize}** eingelöst.`);
  const ticketType = settingsOf(interaction.guildId).winnerTicket;
  if (ticketType) {
    // Ticket zur Preisübergabe – öffnet wie über das Ticket-Panel.
    return require('./tickets').openTicket(interaction, ticketType);
  }
  return replyPrivate(interaction, `✅ Eingelöst! Das Team meldet sich wegen **${g.prize}** bei dir.`);
}

// ---------- Hintergrund ----------

// Wochentag, Uhrzeit und Datum in der Zeitzone des Servers (für wöchentliche Vorlagen).
function localNow(now = new Date(), timeZone = 'Europe/Berlin') {
  const p = zonedParts(now, timeZone);
  return { day: p.weekday, time: p.time, date: p.date };
}

async function tick(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const local = localNow(new Date(now), forGuild(guild.id).timezone);
    const all = giveawaysOf(guild.id);
    for (const g of Object.values(all)) {
      if (!g.ended && g.endsAt <= now) await endGiveaway(guild, g).catch((err) => console.error('[giveaway]', err));
      // Nicht eingelöste Gewinne neu ziehen.
      const expired = Object.entries(g.claims ?? {}).filter(([, c]) => !c.claimed && c.deadline <= now).map(([id]) => id);
      if (expired.length) {
        await log(guild, `⌛ Einlösefrist für **${g.prize}** abgelaufen: ${expired.map((id) => `<@${id}>`).join(', ')} – es wird neu gezogen.`);
        await reroll(guild, g, expired.length, expired).catch((err) => console.error('[giveaway]', err));
      }
    }
    // Befristete Gewinner-Rollen entfernen.
    const roles = bucket('giveawayRoles', guild.id);
    for (const [key, removeAt] of Object.entries(roles)) {
      if (removeAt > now) continue;
      const [userId, roleId] = key.split(':');
      const member = await guild.members.fetch(userId).catch(() => null);
      await member?.roles.remove(roleId, 'Gewinner-Rolle abgelaufen').catch(() => {});
      delete roles[key];
      save();
    }
    // Wöchentliche Vorlagen (Zeitzone des Servers).
    const cfg = settingsOf(guild.id);
    if (!cfg.enabled) continue;
    const runs = bucket('giveawayWeekly', guild.id);
    for (const t of cfg.templates) {
      if (!t.weekly?.enabled || t.weekly.day !== local.day || t.weekly.time !== local.time || runs[t.id] === local.date) continue;
      runs[t.id] = local.date;
      save();
      await startFromTemplate(guild, t, client.user.id).catch((err) => log(guild, `⚠️ Vorlage **${t.name}** konnte nicht starten: ${err.message}`));
    }
  }
}

function startGiveawayWatcher(client) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    await tick(client).catch((err) => console.error('[giveaway]', err));
    running = false;
  }, 15_000);
}

function statsOf(guildId) {
  const list = Object.values(giveawaysOf(guildId)).filter((g) => !g.cancelled);
  const ended = list.filter((g) => g.ended);
  const entries = list.reduce((n, g) => n + Object.keys(g.entries).length, 0);
  const claims = list.flatMap((g) => Object.values(g.claims ?? {}));
  return {
    total: list.length,
    running: list.filter((g) => !g.ended).length,
    entries,
    average: ended.length ? Math.round(ended.reduce((n, g) => n + Object.keys(g.entries).length, 0) / ended.length) : null,
    winners: ended.reduce((n, g) => n + g.winnerIds.length, 0),
    claimRate: claims.length ? Math.round((claims.filter((c) => c.claimed).length / claims.length) * 100) : null,
  };
}

module.exports = {
  parseDuration,
  drawWinners,
  isManager,
  giveawaysOf,
  startGiveaway,
  startFromTemplate,
  endGiveaway,
  reroll,
  cancelGiveaway,
  handleJoin,
  handleClaim,
  startGiveawayWatcher,
  statsOf,
  localNow,
};
