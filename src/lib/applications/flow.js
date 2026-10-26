// Bewerbung per Direktnachricht: Vorabprüfung, Fragen nacheinander, Einreichen.
// Laufende Bewerbungen liegen im Speicher – ein Neustart des Bots bricht sie ab.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { forGuild } = require('../settings');
const { embed, replyPrivate, truncate } = require('../util');
const store = require('./store');
const { checkAnswer, formatDuration, renderMessage, optionValue, QUESTION_TYPES } = require('./forms');
const { findRobloxUser, profileUrl } = require('./roblox');
const { aiCheck } = require('./aiCheck');
const { buildTeamMessage } = require('./messages');
const { applyRoles } = require('./roles');

const sessions = new Map(); // userId → Sitzung

const dmLink = (channelId) => `https://discord.com/channels/@me/${channelId}`;

function startVars(type, user) {
  return {
    applicationName: type.name,
    applicant: user.toString(),
    questionCount: type.questions.length,
    timeLimit: formatDuration(type.timeLimitMinutes),
  };
}

// ---------- Schritt 1: Angebot aus dem Panel oder /bewerbung ----------

async function offer(interaction, typeId) {
  const type = store.typeById(interaction.guildId, typeId);
  if (!type) return replyPrivate(interaction, 'Diese Bewerbung gibt es nicht mehr.');
  const running = sessions.get(interaction.user.id);
  if (running) return replyPrivate(interaction, `Du hast bereits eine laufende Bewerbung in deinen Direktnachrichten: ${dmLink(running.dmChannelId)}`);
  const error = store.eligibility(interaction.member, type);
  if (error) return replyPrivate(interaction, error);

  let dm;
  try {
    dm = await interaction.user.createDM();
    await dm.send({
      embeds: [
        embed()
          .setTitle(`${type.emoji} ${type.name}`)
          .setDescription(renderMessage(type.messages.start, startVars(type, interaction.user)))
          .setFooter({ text: interaction.guild.name }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`quali:start:${interaction.guildId}:${type.id}`).setLabel('Bewerbung starten').setStyle(ButtonStyle.Success).setEmoji('▶️'),
          new ButtonBuilder().setCustomId('quali:cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  } catch {
    return replyPrivate(interaction, '❌ Ich kann dir keine Direktnachricht schicken. Erlaube DMs von Servermitgliedern (Servereinstellungen → Privatsphäre) und versuche es erneut.');
  }

  return replyPrivate(interaction, {
    content: '📬 Ich habe dir eine Direktnachricht geschickt.',
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Zur Bewerbung').setStyle(ButtonStyle.Link).setURL(dmLink(dm.id)))],
  });
}

// ---------- Schritt 2: Start in den DMs ----------

async function start(interaction, guildId, typeId) {
  const type = store.typeById(guildId, typeId);
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!type || !guild) return interaction.update({ embeds: [embed('danger').setDescription('Diese Bewerbung gibt es nicht mehr.')], components: [] });
  if (sessions.has(interaction.user.id)) return replyPrivate(interaction, 'Du hast bereits eine laufende Bewerbung.');

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const error = member ? store.eligibility(member, type) : 'Du bist nicht mehr auf dem Server.';
  if (error) return interaction.update({ embeds: [embed('danger').setDescription(error)], components: [] });

  const now = Date.now();
  const session = {
    userId: interaction.user.id,
    guildId,
    typeId,
    dmChannelId: interaction.channelId,
    step: 0,
    answers: [],
    roleSelections: [],
    roblox: null,
    pendingRoblox: null,
    busy: false,
    startedAt: now,
    expiresAt: now + type.timeLimitMinutes * 60_000,
  };
  sessions.set(session.userId, session);
  store.setProgress(guildId, session.userId, typeId, { startedAt: now, expiresAt: session.expiresAt, step: 0, total: type.questions.length });

  await interaction.update({
    embeds: [embed('success').setTitle(`${type.emoji} ${type.name}`).setDescription(`Los geht's! Zeit bis <t:${Math.floor(session.expiresAt / 1000)}:t>.`)],
    components: [],
  });
  await ask(interaction.client, session);
}

async function cancelFromButton(interaction) {
  const session = sessions.get(interaction.user.id);
  if (session) end(session);
  await interaction.update({ embeds: [embed().setDescription('Bewerbung abgebrochen. Du kannst jederzeit neu starten.')], components: [] });
}

function end(session) {
  sessions.delete(session.userId);
  store.clearProgress(session.guildId, session.userId, session.typeId);
}

// ---------- Fragen ----------

function questionPayload(type, session) {
  const q = type.questions[session.step];
  const hints = {
    TEXT: `Antworte mit einer Nachricht${q.min ? ` · mind. ${q.min} Zeichen` : ''}${q.max ? ` · max. ${Math.min(q.max, 5000)} Zeichen` : ''}`,
    CHOICE: q.multiple ? 'Wähle eine oder mehrere Optionen im Menü' : 'Wähle eine Option im Menü',
    ROLE: q.multiple ? 'Wähle eine oder mehrere Optionen im Menü' : 'Wähle eine Option im Menü',
    ROBLOX: 'Schreibe deinen Roblox-Benutzernamen (nicht den Anzeigenamen)',
  };
  const payload = {
    embeds: [
      embed()
        .setTitle(`Frage ${session.step + 1}/${type.questions.length}${q.required === false ? ' (optional)' : ''}`)
        .setDescription(`**${q.label}**${q.description ? `\n${q.description}` : ''}`)
        .setFooter({ text: `${hints[q.type] ?? QUESTION_TYPES[q.type]} · „abbrechen“ zum Abbrechen` }),
    ],
    components: [],
  };
  if (q.type === 'CHOICE' || q.type === 'ROLE') {
    payload.components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`quali:ans:${session.step}`)
          .setPlaceholder('Auswählen …')
          .setMinValues(1)
          .setMaxValues(q.multiple ? q.options.length : 1)
          .addOptions(q.options.map((o) => ({ label: truncate(o.label, 100), value: optionValue(o), description: o.description ? truncate(o.description, 100) : undefined }))),
      ),
    );
  }
  if (q.required === false) {
    payload.components.push(
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`quali:skip:${session.step}`).setLabel('Überspringen').setStyle(ButtonStyle.Secondary)),
    );
  }
  return payload;
}

async function ask(client, session) {
  const type = store.typeById(session.guildId, session.typeId);
  const user = await client.users.fetch(session.userId);
  session.questionSentAt = Date.now();
  store.setProgress(session.guildId, session.userId, session.typeId, {
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    step: session.step,
    total: type.questions.length,
  });
  await user.send(questionPayload(type, session));
}

async function saveAnswer(client, session, answer) {
  const type = store.typeById(session.guildId, session.typeId);
  const q = type.questions[session.step];
  const ms = Date.now() - session.questionSentAt;
  session.answers.push({
    key: q.key,
    question: q.label,
    type: q.type,
    answer: answer.display,
    raw: answer.raw,
    ms,
    ...(q.type === 'TEXT' && answer.display ? { cpm: answer.display.length / Math.max(ms / 60_000, 0.05) } : {}),
  });
  session.step++;
  if (session.step < type.questions.length) return ask(client, session);
  return submit(client, session);
}

function expired(session) {
  return Date.now() > session.expiresAt;
}

async function expire(client, session) {
  end(session);
  const user = await client.users.fetch(session.userId).catch(() => null);
  await user?.send({ embeds: [embed('danger').setDescription('⌛ Die Zeit für deine Bewerbung ist abgelaufen. Du kannst sie jederzeit neu starten.')] }).catch(() => {});
}

// Textantworten (TEXT, ROBLOX) und „abbrechen“ kommen als normale DM-Nachricht.
async function handleDirectMessage(message) {
  const session = sessions.get(message.author.id);
  if (!session) return;
  const content = message.content.trim();

  if (content.toLowerCase() === 'abbrechen') {
    end(session);
    return message.reply({ embeds: [embed().setDescription('Bewerbung abgebrochen. Du kannst jederzeit neu starten.')] });
  }
  if (expired(session)) return expire(message.client, session);
  if (session.busy) return message.reply('Einen Moment bitte …');

  const type = store.typeById(session.guildId, session.typeId);
  const q = type.questions[session.step];
  if (q.type === 'CHOICE' || q.type === 'ROLE') return message.reply('Bitte nutze das Auswahlmenü oben. 👆');
  if (session.pendingRoblox) return message.reply('Bitte bestätige zuerst das Roblox-Konto oben mit **Ja** oder **Nein**.');
  if (!content && message.attachments.size) return message.reply('Bitte antworte mit Text – Dateien kann ich hier nicht annehmen.');

  const error = checkAnswer(q, content);
  if (error) return message.reply(`❌ ${error}`);

  if (q.type === 'TEXT') return saveAnswer(message.client, session, { display: content, raw: content });

  // ROBLOX: Konto suchen und bestätigen lassen
  session.busy = true;
  try {
    const found = await findRobloxUser(content);
    if (!found) return message.reply(`❌ Ich finde kein Roblox-Konto „${content}“. Prüfe die Schreibweise und schicke den Namen erneut.`);
    session.pendingRoblox = found;
    const card = embed()
      .setTitle('Bist du das?')
      .setDescription(`**${found.displayName}** (@${found.name})\nID ${found.id} · [Profil ansehen](${profileUrl(found.id)})`)
      .setThumbnail(found.avatarUrl);
    return message.reply({
      embeds: [card],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`quali:rb:${session.step}:yes`).setLabel('Ja, das bin ich').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`quali:rb:${session.step}:no`).setLabel('Nein').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  } catch (err) {
    console.error('[roblox]', err.message);
    return message.reply('⚠️ Roblox ist gerade nicht erreichbar. Bitte schicke deinen Namen gleich noch einmal.');
  } finally {
    session.busy = false;
  }
}

// Gemeinsame Prüfung für Buttons/Menüs in den DMs; gibt die Sitzung zurück oder antwortet selbst.
async function activeSession(interaction, step) {
  const session = sessions.get(interaction.user.id);
  if (!session || Number(step) !== session.step) {
    await interaction.update({ components: [] }).catch(() => {});
    return null;
  }
  if (expired(session)) {
    await interaction.update({ components: [] }).catch(() => {});
    await expire(interaction.client, session);
    return null;
  }
  return session;
}

async function handleSelect(interaction, step) {
  const session = await activeSession(interaction, step);
  if (!session) return;
  const q = store.typeById(session.guildId, session.typeId).questions[session.step];
  const error = checkAnswer(q, interaction.values);
  if (error) return replyPrivate(interaction, `❌ ${error}`);

  const chosen = q.options.filter((o) => interaction.values.includes(optionValue(o)));
  if (q.type === 'ROLE') session.roleSelections.push(...chosen.map((o) => o.roleId));
  const display = chosen.map((o) => o.label).join(', ');
  await interaction.update({ embeds: [...interaction.message.embeds, embed('success').setDescription(`✅ ${display}`)], components: [] });
  await saveAnswer(interaction.client, session, { display, raw: interaction.values });
}

async function handleSkip(interaction, step) {
  const session = await activeSession(interaction, step);
  if (!session) return;
  await interaction.update({ embeds: [...interaction.message.embeds, embed().setDescription('⏭️ Übersprungen')], components: [] });
  await saveAnswer(interaction.client, session, { display: '', raw: null });
}

async function handleRoblox(interaction, step, answer) {
  const session = await activeSession(interaction, step);
  if (!session?.pendingRoblox) return;
  const found = session.pendingRoblox;
  session.pendingRoblox = null;
  if (answer !== 'yes') {
    await interaction.update({ components: [] });
    return interaction.followUp('Okay – schicke mir bitte den richtigen Roblox-Benutzernamen.');
  }
  session.roblox = { id: found.id, name: found.name };
  await interaction.update({ embeds: [embed('success').setDescription(`✅ Roblox-Konto **${found.name}** bestätigt.`)], components: [] });
  await saveAnswer(interaction.client, session, { display: `${found.name} (ID ${found.id})`, raw: found.name });
}

// ---------- Einreichen ----------

function teamChannelId(guildId, type) {
  const { applications } = forGuild(guildId);
  return type.channels.open || (type.panel === 'apply' ? applications.channel : applications.qualiChannel);
}

async function submit(client, session) {
  end(session);
  const type = store.typeById(session.guildId, session.typeId);
  const guild = client.guilds.cache.get(session.guildId);
  const user = await client.users.fetch(session.userId);
  const fail = (text) => user.send({ embeds: [embed('danger').setTitle('Bewerbung nicht eingereicht').setDescription(text)] }).catch(() => {});

  const member = await guild?.members.fetch(session.userId).catch(() => null);
  if (!member) return fail('Du bist nicht mehr auf dem Server.');

  // Serverseitige Prüfungen – gleich wie vor dem Start, plus Antworten und Roblox-Sperre
  const answerError = type.questions
    .map((q, i) => {
      const problem = checkAnswer(q, session.answers[i]?.raw ?? null);
      return problem && `Frage ${i + 1}: ${problem}`;
    })
    .find(Boolean);
  const error = store.eligibility(member, type, { robloxId: session.roblox?.id }) ?? answerError;
  if (error) return fail(error);

  const answers = session.answers.map(({ raw, ...rest }) => rest);
  const record = store.createRecord(guild.id, type, {
    userId: member.id,
    userTag: member.user.tag,
    avatarUrl: member.displayAvatarURL(),
    roblox: session.roblox,
    answers,
    roleSelections: session.roleSelections,
    durationMs: Date.now() - session.startedAt,
    joinedAt: member.joinedTimestamp,
    accountCreatedAt: member.user.createdTimestamp,
    ai: aiCheck(session.answers),
  });

  const channel = await guild.channels.fetch(teamChannelId(guild.id, type)).catch(() => null);
  if (channel?.isTextBased()) {
    const message = await channel
      .send({
        ...buildTeamMessage(record, type, { withFile: true }),
        content: type.roles.ping.map((id) => `<@&${id}>`).join(' ') || undefined,
        allowedMentions: { roles: type.roles.ping },
      })
      .catch((err) => console.error('[bewerbung] Team-Nachricht:', err.message));
    if (message) {
      record.channelId = channel.id;
      record.messageId = message.id;
      if (type.teamThreads) {
        const thread = await message.startThread({ name: truncate(`${record.number} – ${member.user.username}`, 100) }).catch(() => null);
        record.threadId = thread?.id;
      }
      require('../db').save();
    }
  } else {
    console.warn(`[bewerbung] Kein Team-Kanal für ${type.id} eingestellt – ${record.number} ist nur per /bewerbungen sichtbar.`);
  }

  await applyRoles(member, { add: type.roles.pending, remove: type.roles.removeOnSubmit }, `Bewerbung ${record.number} eingereicht`);
  await user
    .send({
      embeds: [embed('success').setDescription(renderMessage(type.messages.finish, { ...startVars(type, user), number: record.number }))],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`quali:withdraw:${guild.id}:${record.number}`).setLabel('Bewerbung zurückziehen').setStyle(ButtonStyle.Secondary),
        ),
      ],
    })
    .catch(() => {});
}

// Läuft jede Minute: abgelaufene Sitzungen beenden.
async function sweep(client) {
  for (const session of [...sessions.values()]) {
    if (expired(session)) await expire(client, session);
  }
}

function cancelForMember(guildId, userId) {
  const session = sessions.get(userId);
  if (session?.guildId === guildId) end(session);
}

module.exports = { offer, start, cancelFromButton, handleDirectMessage, handleSelect, handleSkip, handleRoblox, sweep, cancelForMember, sessions };
