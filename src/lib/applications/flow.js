// Bewerbung per Direktnachricht: Vorabprüfung, Fragen nacheinander, Einreichen.
// Laufende Bewerbungen liegen in data/db.json und gehen nach einem Neustart weiter (restore).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { forGuild } = require('../settings');
const { save } = require('../db');
const web = require('../web');
const { embed, replyPrivate, truncate } = require('../util');
const store = require('./store');
const { checkAnswer, formatDuration, renderMessage, optionValue, QUESTION_TYPES } = require('./forms');
const { findRobloxUser, profileUrl } = require('./roblox');
const { aiCheck } = require('./aiCheck');
const { buildTeamMessage, refreshPanels } = require('./messages');
const { applyRoles } = require('./roles');

const sessions = store.sessions; // () → { userId: Sitzung }

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
  const running = sessions()[interaction.user.id];
  if (running) return replyPrivate(interaction, `Du hast bereits eine laufende Bewerbung in deinen Direktnachrichten: ${dmLink(running.dmChannelId)}`);
  const error = store.eligibility(interaction.member, type);
  if (error) return replyPrivate(interaction, error);

  // Web-Formular statt DM-Fragen: persönlicher, signierter Link (nur wenn der Web-Teil läuft)
  if (type.mode === 'WEB' && web.enabled()) {
    const now = Date.now();
    const expiresAt = now + type.timeLimitMinutes * 60_000;
    store.setProgress(interaction.guildId, interaction.user.id, type.id, { startedAt: now, expiresAt, step: 0, total: type.questions.length, web: true });
    return replyPrivate(interaction, {
      content: `📝 Fülle die **${type.name}** im Browser aus. Der Link gilt nur für dich und bis <t:${Math.floor(expiresAt / 1000)}:t> – gib ihn nicht weiter.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Formular öffnen')
            .setStyle(ButtonStyle.Link)
            .setURL(web.applyUrl({ guildId: interaction.guildId, userId: interaction.user.id, typeId: type.id, expiresAt })),
        ),
      ],
    });
  }

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
  if (sessions()[interaction.user.id]) return replyPrivate(interaction, 'Du hast bereits eine laufende Bewerbung.');

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
  sessions()[session.userId] = session;
  store.setProgress(guildId, session.userId, typeId, { startedAt: now, expiresAt: session.expiresAt, step: 0, total: type.questions.length });

  await interaction.update({
    embeds: [embed('success').setTitle(`${type.emoji} ${type.name}`).setDescription(`Los geht's! Zeit bis <t:${Math.floor(session.expiresAt / 1000)}:t>.`)],
    components: [],
  });
  await ask(interaction.client, session);
}

async function cancelFromButton(interaction) {
  const session = sessions()[interaction.user.id];
  if (session) end(session);
  await interaction.update({ embeds: [embed().setDescription('Bewerbung abgebrochen. Du kannst jederzeit neu starten.')], components: [] });
}

function end(session) {
  delete sessions()[session.userId];
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

// Die Bewerbungsart wurde gelöscht oder ihre Fragen wurden geändert, während jemand sie ausfüllt.
async function abortChanged(client, session) {
  end(session);
  const user = await client.users.fetch(session.userId).catch(() => null);
  await user?.send({ embeds: [embed('warning').setDescription('⚠️ Diese Bewerbung wurde vom Team geändert. Bitte starte sie neu.')] }).catch(() => {});
}

// Aktuelle Frage der Sitzung; null, wenn es die Art oder die Frage nicht mehr gibt.
function currentQuestion(session) {
  const type = store.typeById(session.guildId, session.typeId);
  const question = type?.questions[session.step];
  return question ? { type, question } : null;
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
  const session = sessions()[message.author.id];
  if (!session) return;
  const content = message.content.trim();

  if (content.toLowerCase() === 'abbrechen') {
    end(session);
    return message.reply({ embeds: [embed().setDescription('Bewerbung abgebrochen. Du kannst jederzeit neu starten.')] });
  }
  if (expired(session)) return expire(message.client, session);
  if (session.busy) return message.reply('Einen Moment bitte …');

  const q = currentQuestion(session)?.question;
  if (!q) return abortChanged(message.client, session);
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
    save();
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
  const session = sessions()[interaction.user.id];
  if (!session || Number(step) !== session.step) {
    await interaction.update({ components: [] }).catch(() => {});
    return null;
  }
  if (!currentQuestion(session)) {
    await interaction.update({ components: [] }).catch(() => {});
    await abortChanged(interaction.client, session);
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
  save();
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

// Gemeinsames Einreichen für DM und Web-Formular. answers = [{ key, question, type, answer, raw, ms, cpm? }] in der
// Reihenfolge der Fragen. Gibt { error } oder { record } zurück.
async function submitApplication(client, { guildId, typeId, userId, answers, roleSelections = [], roblox = null, startedAt, via = 'DM' }) {
  const type = store.typeById(guildId, typeId);
  const guild = client.guilds.cache.get(guildId);
  if (!type || !guild) return { error: 'Diese Bewerbung gibt es nicht mehr.' };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { error: 'Du bist nicht mehr auf dem Server.' };

  // Serverseitige Prüfungen – gleich wie vor dem Start, plus Antworten und Roblox-Sperre
  const answerError =
    answers.length !== type.questions.length || answers.some((a, i) => a.key !== type.questions[i].key)
      ? 'Die Fragen dieser Bewerbung wurden geändert. Bitte starte sie neu.'
      : type.questions
          .map((q, i) => {
            const problem = checkAnswer(q, answers[i]?.raw ?? null);
            return problem && `Frage ${i + 1}: ${problem}`;
          })
          .find(Boolean);
  const error = store.eligibility(member, type, { robloxId: roblox?.id }) ?? answerError;
  if (error) return { error };

  const record = store.createRecord(guild.id, type, {
    userId: member.id,
    userTag: member.user.tag,
    avatarUrl: member.displayAvatarURL(),
    roblox,
    answers: answers.map(({ raw, ...rest }) => rest),
    roleSelections,
    durationMs: Date.now() - startedAt,
    joinedAt: member.joinedTimestamp,
    accountCreatedAt: member.user.createdTimestamp,
    ai: aiCheck(answers),
    via,
  });
  store.clearProgress(guild.id, member.id, type.id);

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
      save();
    }
  } else {
    console.warn(`[bewerbung] Kein Team-Kanal für ${type.id} eingestellt – ${record.number} ist nur per /bewerbungen sichtbar.`);
  }

  await applyRoles(member, { add: type.roles.pending, remove: type.roles.removeOnSubmit }, `Bewerbung ${record.number} eingereicht`);
  await member.user
    .send({
      embeds: [embed('success').setDescription(renderMessage(type.messages.finish, { ...startVars(type, member.user), number: record.number }))],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`quali:withdraw:${guild.id}:${record.number}`).setLabel('Bewerbung zurückziehen').setStyle(ButtonStyle.Secondary),
        ),
      ],
    })
    .catch(() => {});
  // Bei begrenzten Plätzen zeigt das Panel, wie viele noch frei sind.
  if (type.phase?.maxApplications) await refreshPanels(guild).catch(() => {});
  return { record };
}

async function submit(client, session) {
  end(session);
  const { error } = await submitApplication(client, session);
  if (!error) return;
  const user = await client.users.fetch(session.userId).catch(() => null);
  await user?.send({ embeds: [embed('danger').setTitle('Bewerbung nicht eingereicht').setDescription(error)] }).catch(() => {});
}

// Läuft jede Minute: abgelaufene Sitzungen beenden.
async function sweep(client) {
  for (const session of Object.values(sessions())) {
    if (expired(session)) await expire(client, session);
  }
}

// Nach einem Neustart: laufende Bewerbungen fortsetzen und die aktuelle Frage noch einmal schicken.
async function restore(client) {
  for (const session of Object.values(sessions())) {
    session.busy = false;
    session.pendingRoblox = null;
    try {
      if (expired(session)) await expire(client, session);
      else if (!client.guilds.cache.has(session.guildId)) end(session);
      else if (!currentQuestion(session)) await abortChanged(client, session);
      else {
        const user = await client.users.fetch(session.userId);
        await user.send({ embeds: [embed().setDescription('🔄 Der Bot wurde kurz neu gestartet. Deine Bewerbung geht hier weiter:')] });
        await ask(client, session);
      }
    } catch (err) {
      console.error(`[bewerbung] Sitzung von ${session.userId} konnte nicht fortgesetzt werden:`, err.message);
      end(session);
    }
  }
  store.cleanProgress();
}

function cancelForMember(guildId, userId) {
  const session = sessions()[userId];
  if (session?.guildId === guildId) end(session);
}

// Fragen einer Art wurden geändert oder die Art gelöscht: laufende Bewerbungen dieser Art beenden.
async function cancelForType(client, guildId, typeId) {
  for (const session of Object.values(sessions())) {
    if (session.guildId === guildId && session.typeId === typeId) await abortChanged(client, session);
  }
}

module.exports = {
  offer,
  start,
  cancelFromButton,
  handleDirectMessage,
  handleSelect,
  handleSkip,
  handleRoblox,
  submitApplication,
  teamChannelId,
  sweep,
  restore,
  cancelForMember,
  cancelForType,
};
