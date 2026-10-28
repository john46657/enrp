// Rang-Aufstieg (team.careers): Der Bot verfolgt Laufbahnen (Hauptrolle + Stufen) und befördert automatisch oder
// schlägt die Beförderung zur Freigabe vor, sobald die Voraussetzungen der nächsten Stufe erfüllt sind.
// Gezählt wird ab dem letzten Rangwechsel: bearbeitete Tickets, Moderationsaktionen und Tage im Rang.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save, nextNumber } = require('./db');
const { embed, fill, getChannel, replyPrivate } = require('./util');
const activity = require('./activity');
const team = require('./team');

const DAY = 86_400_000;
const careersOf = (guildId) => forGuild(guildId).team.careers;
const stateOf = (guildId) => bucket('careerState', guildId); // "track:user" → { stage, since, pending }
const historyOf = (guildId) => {
  const data = bucket('careerHistory', guildId);
  data.list ??= [];
  return data.list;
};

function addHistory(guildId, entry) {
  const list = historyOf(guildId);
  list.unshift({ at: Date.now(), ...entry });
  list.length = Math.min(list.length, 100);
  save();
}

// Höchste Stufe, deren Rolle das Mitglied hat (-1 = nur Hauptrolle).
const currentStage = (member, track) => track.stages.reduce((best, s, i) => (member.roles.cache.has(s.role) ? i : best), -1);

function progress(guildId, member, track, state) {
  const counts = activity.countSince(guildId, member.id, state.since);
  const next = track.stages[state.stage + 1];
  const days = Math.floor((Date.now() - state.since) / DAY);
  if (!next) return { next: null, days, counts, ready: false };
  const checks = [
    { label: 'Tage im Rang', have: days, need: next.minDays || 0 },
    { label: 'Tickets', have: counts.ticket, need: next.tickets || 0 },
    { label: 'Mod-Aktionen', have: counts.mod, need: next.modActions || 0 },
  ];
  return { next, days, counts, checks, ready: checks.every((c) => c.have >= c.need) };
}

async function announce(guild, member, track, oldRoleId, newRoleId, info) {
  const { announce: a } = careersOf(guild.id);
  if (!a.enabled) return;
  const channel = await getChannel(guild, a.channel);
  if (!channel?.isTextBased()) return;
  const role = (id) => guild.roles.cache.get(id)?.toString() ?? '—';
  const vars = { user: `${member}`, username: member.user.username, oldrole: oldRoleId ? role(oldRoleId) : role(track.baseRole), newrole: role(newRoleId), laufbahn: track.name, server: guild.name };
  const message = embed(a.color || 'success').setTitle(fill(a.title, vars)).setDescription(fill(a.text, vars)).setThumbnail(member.displayAvatarURL());
  if (a.showStats) message.addFields({ name: 'Geleistet', value: `${info.counts.ticket} Tickets · ${info.counts.mod} Mod-Aktionen · ${info.days} Tage im Rang` });
  await channel.send({ content: a.ping ? `${member}` : undefined, embeds: [message], allowedMentions: { users: a.ping ? [member.id] : [] } }).catch((err) => console.error('[career]', err.message));
}

async function promote(guild, member, track, key, mode, byId) {
  const state = stateOf(guild.id)[key];
  const info = progress(guild.id, member, track, state);
  const from = track.stages[state.stage]?.role ?? null;
  const to = track.stages[state.stage + 1]?.role;
  if (!to) return false;
  await member.roles.add(to, `Rang-Aufstieg: ${track.name}`);
  if (from) await member.roles.remove(from, `Rang-Aufstieg: ${track.name}`).catch(() => {});
  Object.assign(state, { stage: state.stage + 1, since: Date.now(), pending: null });
  save();
  const caseNumber = nextNumber('teamCase', guild.id);
  addHistory(guild.id, { userId: member.id, track: track.name, from, to, mode, by: byId ?? null });
  await team.log(guild, {
    embeds: [
      embed('success')
        .setTitle(`⬆️ Rang-Aufstieg · Fall #${caseNumber}`)
        .setDescription(`${member}: ${from ? `<@&${from}>` : `<@&${track.baseRole}>`} → <@&${to}> (Laufbahn **${track.name}**, ${mode === 'auto' ? 'automatisch' : `freigegeben von <@${byId}>`})`),
    ],
  });
  if (careersOf(guild.id).dm) await member.send(`⬆️ Glückwunsch! Du bist auf **${guild.name}** jetzt **${guild.roles.cache.get(to)?.name}** (Laufbahn ${track.name}).`).catch(() => {});
  await announce(guild, member, track, from, to, info);
  return true;
}

async function suggest(guild, member, track, key) {
  const state = stateOf(guild.id)[key];
  const info = progress(guild.id, member, track, state);
  const channel = await getChannel(guild, track.approvalChannel || forGuild(guild.id).team.logChannel);
  if (!channel?.isTextBased()) return;
  const message = await channel.send({
    content: track.approverRoles?.map((id) => `<@&${id}>`).join(' ') || undefined,
    embeds: [
      embed('primary')
        .setTitle(`📈 Beförderungs-Vorschlag · ${track.name}`)
        .setDescription(`${member} erfüllt die Voraussetzungen für <@&${info.next.role}>.\n${info.checks.map((c) => `- ${c.label}: ${c.have}/${c.need}`).join('\n')}`),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`career:ok:${key}`).setLabel('Befördern').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`career:no:${key}`).setLabel('Ablehnen').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { roles: track.approverRoles ?? [] },
  });
  state.pending = { messageId: message.id, stage: state.stage + 1, at: Date.now() };
  save();
  addHistory(guild.id, { userId: member.id, track: track.name, from: track.stages[state.stage]?.role ?? null, to: info.next.role, mode: 'suggested' });
}

// Alle Laufbahnen eines Servers prüfen. Gibt die Anzahl der Beförderungen und Vorschläge zurück.
async function checkGuild(guild) {
  const cfg = careersOf(guild.id);
  const teamCfg = forGuild(guild.id).team;
  if (!teamCfg.enabled || !cfg.enabled || !cfg.tracks.length) return { promoted: 0, suggested: 0 };
  await guild.members.fetch().catch(() => null);
  const states = stateOf(guild.id);
  const absent = team.absencesOf(guild.id);
  let promoted = 0;
  let suggested = 0;
  for (const track of cfg.tracks) {
    if (!track.baseRole || !track.stages.length) continue;
    for (const member of guild.members.cache.filter((m) => m.roles.cache.has(track.baseRole) && !m.user.bot).values()) {
      const key = `${track.id}:${member.id}`;
      const stage = currentStage(member, track);
      let state = states[key];
      if (!state) {
        // Erstes Erfassen: auf Wunsch vorhandene Aktivität mitzählen, sonst ab jetzt.
        state = states[key] = { stage, since: cfg.countExisting ? 0 : Date.now(), pending: null };
        save();
      } else if (state.stage !== stage) {
        // Rang wurde von Hand geändert: ab jetzt neu zählen.
        Object.assign(state, { stage, since: Date.now(), pending: null });
        save();
      }
      if (state.pending || (cfg.skipAbsent && absent[member.id])) continue;
      if (!progress(guild.id, member, track, state).ready) continue;
      try {
        if (track.mode === 'approval') {
          await suggest(guild, member, track, key);
          suggested++;
        } else if (await promote(guild, member, track, key, 'auto')) promoted++;
      } catch (err) {
        console.error('[career]', err.message);
      }
    }
  }
  return { promoted, suggested };
}

async function answer(interaction, approve, key) {
  const [trackId, userId] = key.split(':');
  const cfg = careersOf(interaction.guildId);
  const track = cfg.tracks.find((t) => t.id === trackId);
  const state = stateOf(interaction.guildId)[key];
  const allowed = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) || (track?.approverRoles ?? []).some((id) => interaction.member.roles.cache.has(id));
  if (!allowed) return replyPrivate(interaction, 'Nur Freigebende dieser Laufbahn können das entscheiden.');
  if (!track || !state?.pending) return interaction.update({ components: [] });
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) {
    state.pending = null;
    save();
    return interaction.update({ embeds: [embed('danger').setDescription('Das Mitglied ist nicht mehr auf dem Server.')], components: [] });
  }
  if (!approve) {
    // Abgelehnt: neu zählen, damit der Vorschlag nicht sofort wiederkommt.
    Object.assign(state, { since: Date.now(), pending: null });
    save();
    addHistory(interaction.guildId, { userId, track: track.name, mode: 'denied', by: interaction.user.id });
    return interaction.update({ embeds: [embed('danger').setDescription(`❌ ${interaction.user} hat die Beförderung von ${member} abgelehnt.`)], components: [] });
  }
  await interaction.update({ embeds: [embed('success').setDescription(`✅ ${interaction.user} hat die Beförderung von ${member} freigegeben.`)], components: [] });
  await promote(interaction.guild, member, track, key, 'approved', interaction.user.id);
}

// Fortschritt für das Dashboard.
async function progressList(guild) {
  const cfg = careersOf(guild.id);
  const states = stateOf(guild.id);
  const rows = [];
  for (const track of cfg.tracks) {
    for (const member of guild.members.cache.filter((m) => m.roles.cache.has(track.baseRole) && !m.user.bot).values()) {
      const state = states[`${track.id}:${member.id}`];
      if (!state) continue;
      const p = progress(guild.id, member, track, state);
      rows.push({ track: track.name, user: member.user.username, stage: track.stages[state.stage] ? guild.roles.cache.get(track.stages[state.stage].role)?.name : guild.roles.cache.get(track.baseRole)?.name, next: p.next ? guild.roles.cache.get(p.next.role)?.name : null, checks: p.checks ?? [], pending: Boolean(state.pending) });
    }
  }
  return rows;
}

function startCareerWatcher(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) await checkGuild(guild).catch((err) => console.error('[career]', err));
  }, 10 * 60_000);
}

module.exports = { checkGuild, answer, progressList, historyOf, startCareerWatcher, currentStage };
