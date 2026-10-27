// Teamverwaltung (team in config.json): Rechte je Team-Rolle, Team-Verwarnungen, Rang-Änderungen mit Ankündigung
// und Uprank-Angebot, Live-Teamliste und Abwesenheitsliste.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save, nextNumber } = require('./db');
const { embed, fill, getChannel, truncate, replyPrivate } = require('./util');

const settingsOf = (guildId) => forGuild(guildId).team;

// Rechte, die eine Team-Rolle haben kann.
const PERMS = {
  absence: 'Sich abwesend melden (/abwesend, /zurueck)',
  warn: 'Team verwarnen (/team verwarnen …)',
  rank: 'Up-/Downrank (/team rang)',
};

const isAdmin = (member) => member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild);
const teamRolesOf = (member) => settingsOf(member.guild.id).roles.filter((r) => member.roles.cache.has(r.id));
const isTeam = (member) => isAdmin(member) || teamRolesOf(member).length > 0;
const can = (member, perm) => isAdmin(member) || teamRolesOf(member).some((r) => r.perms?.includes(perm));

// Fehlermeldung, wenn das Modul aus ist oder das Recht fehlt.
function guard(interaction, perm) {
  if (!settingsOf(interaction.guildId).enabled) return 'Die Teamverwaltung ist auf diesem Server deaktiviert.';
  if (!can(interaction.member, perm)) return 'Dafür fehlt dir das Team-Recht.';
  return null;
}

async function log(guild, payload) {
  const channel = await getChannel(guild, settingsOf(guild.id).logChannel);
  if (channel?.isTextBased()) await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch((err) => console.error('[teamLog]', err.message));
}

async function dm(user, guild, text) {
  if (!settingsOf(guild.id).dmNotify) return;
  await user.send({ embeds: [embed().setDescription(text).setFooter({ text: guild.name })] }).catch(() => {});
}

// ---------- Rang-Änderungen ----------

const offersOf = (guildId) => bucket('rankOffers', guildId); // messageId → Angebot

async function announceRank(guild, { member, oldRole, newRole, up }) {
  const { rank } = settingsOf(guild.id);
  const channel = await getChannel(guild, rank.announceChannel);
  if (!channel?.isTextBased()) return;
  const vars = { user: `${member}`, username: member.user.username, oldrole: oldRole ? `${oldRole}` : '—', newrole: `${newRole}`, server: guild.name };
  await channel
    .send({
      embeds: [
        embed(up ? 'success' : 'warning')
          .setTitle(fill(rank.announceTitle || (up ? '⬆️ Beförderung' : '⬇️ Rückstufung'), vars))
          .setDescription(fill(rank.announceText || '{user} ist jetzt {newrole}.', vars))
          .setThumbnail(member.displayAvatarURL()),
      ],
      allowedMentions: { users: [member.id] },
    })
    .catch((err) => console.error('[rankAnnounce]', err.message));
}

// Tauscht die Rollen und protokolliert den Fall. Gibt die Fallnummer zurück.
async function applyRankChange(guild, { member, oldRoleId, newRoleId, up, reason, byId }) {
  if (oldRoleId && member.roles.cache.has(oldRoleId)) await member.roles.remove(oldRoleId, `Rang-Änderung: ${reason || '—'}`);
  await member.roles.add(newRoleId, `Rang-Änderung: ${reason || '—'}`);
  const caseNumber = nextNumber('teamCase', guild.id);
  const oldRole = oldRoleId ? guild.roles.cache.get(oldRoleId) : null;
  const newRole = guild.roles.cache.get(newRoleId);
  await log(guild, {
    embeds: [
      embed(up ? 'success' : 'warning')
        .setTitle(`${up ? '⬆️ Uprank' : '⬇️ Derank'} · Fall #${caseNumber}`)
        .addFields(
          { name: 'Mitglied', value: `${member}`, inline: true },
          { name: 'Von', value: `<@${byId}>`, inline: true },
          { name: 'Rolle', value: `${oldRole ?? '—'} → ${newRole}`, inline: true },
          { name: 'Grund', value: reason || '—' },
        ),
    ],
  });
  await dm(member.user, guild, `${up ? '⬆️ Du wurdest befördert' : '⬇️ Du wurdest zurückgestuft'}: **${newRole?.name}**${reason ? `\n**Grund:** ${reason}` : ''}`);
  await announceRank(guild, { member, oldRole, newRole, up });
  return caseNumber;
}

// Uprank-Angebot: Das Mitglied nimmt an oder lehnt ab, erst dann werden die Rollen getauscht.
async function postRankOffer(guild, offer) {
  const { rank } = settingsOf(guild.id);
  const channel = await getChannel(guild, rank.offer.channel || rank.announceChannel);
  if (!channel?.isTextBased()) throw new Error('Für Uprank-Angebote ist kein Kanal eingestellt (Angebots- oder Ankündigungskanal).');
  const expiresAt = Date.now() + rank.offer.hours * 3_600_000;
  const message = await channel.send({
    content: `<@${offer.memberId}>`,
    embeds: [
      embed('primary')
        .setTitle('⬆️ Beförderungs-Angebot')
        .setDescription(
          `<@${offer.memberId}>, dir wird der Rang <@&${offer.newRoleId}> angeboten.${offer.reason ? `\n**Grund:** ${offer.reason}` : ''}\n` +
            `Das Angebot gilt bis <t:${Math.floor(expiresAt / 1000)}:f>.`,
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('team:offeryes').setLabel('Annehmen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('team:offerno').setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
      ),
    ],
    allowedMentions: { users: [offer.memberId] },
  });
  offersOf(guild.id)[message.id] = { ...offer, channelId: channel.id, expiresAt };
  save();
}

async function answerRankOffer(interaction, accepted) {
  const offers = offersOf(interaction.guildId);
  const offer = offers[interaction.message.id];
  if (!offer) return interaction.update({ components: [] });
  if (interaction.user.id !== offer.memberId) return replyPrivate(interaction, 'Nur das angesprochene Mitglied kann antworten.');
  delete offers[interaction.message.id];
  save();
  if (!accepted) {
    await interaction.update({ embeds: [embed('danger').setDescription(`❌ <@${offer.memberId}> hat das Angebot abgelehnt.`)], components: [] });
    return log(interaction.guild, { embeds: [embed('danger').setDescription(`❌ <@${offer.memberId}> hat den Uprank zu <@&${offer.newRoleId}> abgelehnt.`)] });
  }
  await interaction.update({ embeds: [embed('success').setDescription(`✅ <@${offer.memberId}> hat das Angebot angenommen.`)], components: [] });
  await applyRankChange(interaction.guild, { ...offer, member: interaction.member, up: true });
}

async function expireOffers(guild) {
  const offers = offersOf(guild.id);
  for (const [messageId, offer] of Object.entries(offers)) {
    if (offer.expiresAt > Date.now()) continue;
    delete offers[messageId];
    save();
    const channel = guild.channels.cache.get(offer.channelId);
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    await message?.edit({ embeds: [embed('danger').setDescription(`⌛ Das Angebot für <@${offer.memberId}> ist verfallen.`)], components: [] }).catch(() => {});
    await log(guild, { embeds: [embed('danger').setDescription(`⌛ Uprank-Angebot für <@${offer.memberId}> (<@&${offer.newRoleId}>) ist verfallen.`)] });
  }
}

// ---------- Abwesenheit ----------

const absencesOf = (guildId) => bucket('absences', guildId); // userId → { from, until, reason }

// "3" (Tage) oder "31.12.2026" → Zeitpunkt; null bei ungültiger Eingabe.
function parseUntil(text, now = Date.now()) {
  const value = text.trim();
  if (/^\d{1,3}$/.test(value)) return Number(value) > 0 ? now + Number(value) * 86_400_000 : null;
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match.map(Number);
  const date = new Date(y, m - 1, d, 23, 59);
  return date.getMonth() === m - 1 && date.getTime() > now ? date.getTime() : null;
}

async function setAbsence(member, entry) {
  const { absence } = settingsOf(member.guild.id);
  const absences = absencesOf(member.guild.id);
  if (entry) absences[member.id] = entry;
  else delete absences[member.id];
  save();
  if (absence.role) {
    const action = entry ? member.roles.add(absence.role, 'Abwesend') : member.roles.remove(absence.role, 'Zurück');
    await action.catch((err) => console.error('[absenceRole]', err.message));
  }
  await updateLists(member.guild);
}

async function expireAbsences(guild) {
  for (const [userId, entry] of Object.entries(absencesOf(guild.id))) {
    if (entry.until > Date.now()) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await setAbsence(member, null);
    else {
      delete absencesOf(guild.id)[userId];
      save();
    }
  }
}

// ---------- Live-Listen (Teamliste, Abwesenheit) ----------

const listMessages = (guildId) => bucket('teamListMessages', guildId); // "team" | "absence" → { channelId, messageId }

async function upsertList(guild, key, channelId, payload) {
  const stored = listMessages(guild.id)[key];
  if (stored?.channelId === channelId) {
    const message = await guild.channels.cache.get(channelId)?.messages.fetch(stored.messageId).catch(() => null);
    if (message) return message.edit(payload).catch((err) => console.error('[teamList]', err.message));
  }
  const channel = await getChannel(guild, channelId);
  if (!channel?.isTextBased()) return null;
  const message = await channel.send(payload).catch((err) => console.error('[teamList]', err.message));
  if (message) {
    listMessages(guild.id)[key] = { channelId, messageId: message.id };
    save();
  }
  return message;
}

function teamListEmbed(guild) {
  const { teamList } = settingsOf(guild.id);
  const absences = absencesOf(guild.id);
  const fields = teamList.roles
    .map((id) => guild.roles.cache.get(id))
    .filter(Boolean)
    .map((role) => ({
      name: `${role.name} (${role.members.size})`,
      value: truncate(role.members.map((m) => `${m}${absences[m.id] ? ' 🌴' : ''} · ${m.user.username}`).join('\n') || '—', 1024),
    }));
  return embed().setTitle(`👥 Team von ${guild.name}`).setFields(fields.slice(0, 25)).setDescription(fields.length ? null : 'Keine Rollen eingestellt.');
}

function absenceEmbed(guild) {
  const entries = Object.entries(absencesOf(guild.id)).sort(([, a], [, b]) => a.until - b.until);
  return embed('warning')
    .setTitle('🌴 Abwesenheiten')
    .setDescription(
      truncate(
        entries.map(([id, e]) => `<@${id}> bis <t:${Math.floor(e.until / 1000)}:d> (<t:${Math.floor(e.until / 1000)}:R>)${e.reason ? ` – ${e.reason}` : ''}`).join('\n') ||
          'Aktuell ist niemand abwesend.',
        4096,
      ),
    );
}

const pendingLists = new Map();
const membersFetched = new Set();
// Aktualisiert die Listen (gesammelt, höchstens alle paar Sekunden je Server).
function updateLists(guild) {
  if (pendingLists.has(guild.id)) return pendingLists.get(guild.id);
  const run = new Promise((resolve) => setTimeout(resolve, 3000)).then(async () => {
    pendingLists.delete(guild.id);
    const { enabled, teamList, absence } = settingsOf(guild.id);
    if (!enabled) return;
    if (teamList.enabled && teamList.channel && teamList.roles.length) {
      // role.members braucht alle Mitglieder im Cache (danach hält GuildMembers ihn aktuell).
      if (!membersFetched.has(guild.id)) {
        await guild.members.fetch().catch((err) => console.error('[teamList] Mitglieder laden:', err.message));
        membersFetched.add(guild.id);
      }
      await upsertList(guild, 'team', teamList.channel, { embeds: [teamListEmbed(guild)], allowedMentions: { parse: [] } });
    }
    if (absence.enabled && absence.channel) await upsertList(guild, 'absence', absence.channel, { embeds: [absenceEmbed(guild)], allowedMentions: { parse: [] } });
  });
  pendingLists.set(guild.id, run);
  return run;
}

function startTeamWatcher(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!settingsOf(guild.id).enabled) continue;
      await expireOffers(guild).catch((err) => console.error('[team]', err));
      await expireAbsences(guild).catch((err) => console.error('[team]', err));
    }
  }, 60_000);
  // Sicherheitsnetz: Listen alle 10 Minuten neu zeichnen.
  setInterval(() => {
    for (const guild of client.guilds.cache.values()) updateLists(guild).catch((err) => console.error('[teamList]', err));
  }, 10 * 60_000);
}

module.exports = {
  PERMS,
  isTeam,
  can,
  guard,
  log,
  dm,
  applyRankChange,
  postRankOffer,
  answerRankOffer,
  absencesOf,
  parseUntil,
  setAbsence,
  updateLists,
  startTeamWatcher,
};
