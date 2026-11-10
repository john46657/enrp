// Team-Kalender & Meetings (team.meetings): Termine mit Zu-/Absage, Erinnerung vor Beginn und Anwesenheit.
// Hat ein Meeting einen Sprachkanal, hält der Bot zu Beginn, nach 10 Minuten und zur Hälfte fest, wer drin ist.
// Daten: data/db.json → meetings.<guildId>.<id>
const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save } = require('./db');
const { embed, getChannel, replyPrivate, truncate } = require('./util');
const { fromZoned } = require('./time');
const team = require('./team');

const meetingsOf = (guildId) => bucket('meetings', guildId);
const settingsOf = (guildId) => forGuild(guildId).team.meetings;
const RSVP = { yes: '✅ Zusage', maybe: '❔ Vielleicht', no: '❌ Absage' };
const unix = (ms) => Math.floor(ms / 1000);

// "31.12.2026" + "18:30" in der Zeitzone des Servers → Zeitpunkt (null bei ungültiger Eingabe).
function parseStart(date, time, timeZone) {
  const d = String(date ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const t = String(time ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) return null;
  const [day, month, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59) return null;
  return fromZoned({ year, month, day, hour, minute }, timeZone);
}

function meetingEmbed(m) {
  const count = (v) => Object.values(m.rsvp).filter((x) => x === v).length;
  const list = (v) => Object.entries(m.rsvp).filter(([, x]) => x === v).map(([id]) => `<@${id}>`).join(' ') || '—';
  const result = embed(m.cancelled ? 'danger' : 'primary')
    .setTitle(`${m.cancelled ? '🚫 Abgesagt: ' : '📅 '}${m.title}`)
    .setDescription(
      [
        m.description,
        `🕒 <t:${unix(m.start)}:F> (<t:${unix(m.start)}:R>) · ${m.duration} Min.`,
        m.voiceChannelId && `🔊 <#${m.voiceChannelId}>`,
        m.roles.length && `👥 ${m.roles.map((id) => `<@&${id}>`).join(' ')}`,
        `Erstellt von <@${m.createdBy}>`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .addFields(
      { name: `${RSVP.yes} (${count('yes')})`, value: truncate(list('yes'), 1024), inline: true },
      { name: `${RSVP.maybe} (${count('maybe')})`, value: truncate(list('maybe'), 1024), inline: true },
      { name: `${RSVP.no} (${count('no')})`, value: truncate(list('no'), 1024), inline: true },
    );
  if (m.attendance && Object.keys(m.attendance).length) result.addFields({ name: '🎙️ Anwesend', value: truncate(Object.keys(m.attendance).map((id) => `<@${id}>`).join(' '), 1024) });
  return result;
}

const buttons = (m) =>
  m.cancelled || m.start + m.duration * 60_000 < Date.now()
    ? []
    : [
        new ActionRowBuilder().addComponents(
          ...Object.entries(RSVP).map(([key, label]) =>
            new ButtonBuilder().setCustomId(`meeting:${key}:${m.id}`).setLabel(label).setStyle(key === 'yes' ? ButtonStyle.Success : key === 'no' ? ButtonStyle.Danger : ButtonStyle.Secondary),
          ),
        ),
      ];

async function refresh(guild, m) {
  const channel = guild.channels.cache.get(m.channelId);
  const message = await channel?.messages.fetch(m.messageId).catch(() => null);
  await message?.edit({ embeds: [meetingEmbed(m)], components: buttons(m) }).catch(() => {});
}

// options: { title, description, start, duration, roles, voiceChannelId, createdBy }
async function createMeeting(guild, options) {
  const cfg = settingsOf(guild.id);
  if (!forGuild(guild.id).team.enabled || !cfg.enabled) throw new Error('Meetings sind auf diesem Server deaktiviert.');
  if (!options.title?.trim()) throw new Error('Gib einen Titel an.');
  if (!options.start || options.start < Date.now()) throw new Error('Der Termin muss in der Zukunft liegen (Datum TT.MM.JJJJ, Uhrzeit HH:MM).');
  const channel = await getChannel(guild, cfg.channel);
  if (!channel?.isTextBased()) throw new Error('Kein Ankündigungskanal für Meetings eingestellt.');
  const m = {
    id: crypto.randomBytes(3).toString('hex'),
    title: options.title.trim().slice(0, 150),
    description: options.description?.slice(0, 1000) || '',
    start: options.start,
    duration: Math.min(Math.max(Number(options.duration) || 60, 5), 1440),
    roles: options.roles ?? [],
    voiceChannelId: options.voiceChannelId || null,
    createdBy: options.createdBy,
    rsvp: {},
    attendance: {},
    samples: 0,
    reminded: false,
    cancelled: false,
    channelId: channel.id,
  };
  const message = await channel.send({
    content: m.roles.map((id) => `<@&${id}>`).join(' ') || undefined,
    embeds: [meetingEmbed(m)],
    components: buttons(m),
    allowedMentions: { roles: m.roles },
  });
  m.messageId = message.id;
  meetingsOf(guild.id)[m.id] = m;
  save();
  await team.log(guild, { embeds: [embed().setDescription(`📅 <@${m.createdBy}> hat das Meeting **${m.title}** für <t:${unix(m.start)}:f> angelegt.`)] });
  return m;
}

async function cancelMeeting(guild, id, byId) {
  const m = meetingsOf(guild.id)[id];
  if (!m) throw new Error('Meeting nicht gefunden.');
  if (m.cancelled) throw new Error('Das Meeting ist bereits abgesagt.');
  m.cancelled = true;
  save();
  await refresh(guild, m);
  await team.log(guild, { embeds: [embed('danger').setDescription(`🚫 <@${byId}> hat das Meeting **${m.title}** abgesagt.`)] });
}

async function answer(interaction, choice, id) {
  const m = meetingsOf(interaction.guildId)[id];
  if (!m || m.cancelled) return replyPrivate(interaction, 'Dieses Meeting gibt es nicht mehr.');
  if (!team.isTeam(interaction.member)) return replyPrivate(interaction, 'Nur Teammitglieder können zu- oder absagen.');
  m.rsvp[interaction.user.id] = choice;
  save();
  await interaction.update({ embeds: [meetingEmbed(m)], components: buttons(m) });
}

// Erinnerung vor Beginn und Anwesenheit im Sprachkanal.
async function tick(guild) {
  const cfg = settingsOf(guild.id);
  const now = Date.now();
  for (const m of Object.values(meetingsOf(guild.id))) {
    if (m.cancelled) continue;
    if (!m.reminded && cfg.reminderMinutes > 0 && now >= m.start - cfg.reminderMinutes * 60_000 && now < m.start) {
      m.reminded = true;
      save();
      const channel = guild.channels.cache.get(m.channelId);
      const people = Object.entries(m.rsvp).filter(([, v]) => v !== 'no').map(([id]) => id);
      await channel
        ?.send({
          content: [...m.roles.map((id) => `<@&${id}>`), ...people.map((id) => `<@${id}>`)].join(' ') || undefined,
          embeds: [embed('warning').setDescription(`⏰ **${m.title}** beginnt <t:${unix(m.start)}:R>.${m.voiceChannelId ? ` Treffpunkt: <#${m.voiceChannelId}>` : ''}`)],
          allowedMentions: { roles: m.roles, users: people },
          reply: { messageReference: m.messageId, failIfNotExists: false },
        })
        .catch(() => {});
    }
    // Anwesenheit: zu Beginn, nach 10 Minuten und zur Hälfte.
    if (m.voiceChannelId && m.samples < 3) {
      const due = [m.start, m.start + 10 * 60_000, m.start + (m.duration * 60_000) / 2].sort((a, b) => a - b)[m.samples];
      if (now >= due && now <= m.start + m.duration * 60_000) {
        const voice = guild.channels.cache.get(m.voiceChannelId);
        for (const id of voice?.members?.keys() ?? []) m.attendance[id] = true;
        m.samples++;
        save();
        await refresh(guild, m);
      } else if (now > m.start + m.duration * 60_000) {
        m.samples = 3;
        save();
      }
    }
    if (!m.closed && now > m.start + m.duration * 60_000) {
      m.closed = true;
      save();
      await refresh(guild, m); // Buttons entfernen
    }
  }
}

// Anwesenheitsstatistik der letzten Tage: { userId: { meetings, yes, no, maybe, none, present } }
function attendanceStats(guildId, days = 90) {
  const since = Date.now() - days * 86_400_000;
  const stats = {};
  const row = (id) => (stats[id] ??= { meetings: 0, yes: 0, no: 0, maybe: 0, present: 0 });
  for (const m of Object.values(meetingsOf(guildId))) {
    if (m.cancelled || m.start < since || m.start > Date.now()) continue;
    for (const [id, v] of Object.entries(m.rsvp)) {
      row(id).meetings++;
      row(id)[v]++;
    }
    for (const id of Object.keys(m.attendance ?? {})) {
      if (!m.rsvp[id]) row(id).meetings++;
      row(id).present++;
    }
  }
  return stats;
}

function startMeetingWatcher(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      if (!forGuild(guild.id).team.enabled) continue;
      await tick(guild).catch((err) => console.error('[meetings]', err));
    }
  }, 60_000);
}

module.exports = { parseStart, createMeeting, cancelMeeting, answer, meetingsOf, attendanceStats, startMeetingWatcher, meetingEmbed, tick };
