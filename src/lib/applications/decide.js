// Entscheidungen über Bewerbungen (Discord-Buttons), Statusschritte, Rückzug, Verlauf, Ticket, Verlassen des Servers.
const { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { embed, replyPrivate, truncate } = require('../util');
const store = require('./store');
const { renderMessage } = require('./forms');
const { buildTeamMessage } = require('./messages');
const { applyRoles } = require('./roles');
const { cancelForMember } = require('./flow');

const LEFT_REASON = 'Hat den Discord-Server verlassen.';

// Bewerbung + Art laden und prüfen, ob der Klickende entscheiden darf. Antwortet selbst bei Fehlern.
async function loadForManager(interaction, number) {
  const record = store.getRecord(interaction.guildId, number);
  const type = record && store.typeById(record.type);
  if (!record || !type) {
    await replyPrivate(interaction, 'Diese Bewerbung gibt es nicht mehr.');
    return null;
  }
  if (!store.isManager(interaction.member, type)) {
    await replyPrivate(interaction, 'Du darfst über diese Bewerbung nicht entscheiden.');
    return null;
  }
  return { record, type };
}

async function updateTeamMessage(guild, record, type) {
  if (!record.messageId) return;
  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  const message = await channel?.messages.fetch(record.messageId).catch(() => null);
  if (!message) {
    delete record.messageId;
    return;
  }
  await message.edit(buildTeamMessage(record, type)).catch((err) => console.error('[bewerbung] Team-Nachricht aktualisieren:', err.message));
}

// Folgen einer Entscheidung: DM, Rollen, Thread-Hinweis, Archiv-Kanal.
async function afterDecision(guild, record, type, decider) {
  const client = guild.client;
  const user = await client.users.fetch(record.userId).catch(() => null);
  const vars = {
    applicationName: type.name,
    user: decider ? decider.toString() : 'dem System',
    applicant: user ? user.toString() : `<@${record.userId}>`,
    number: record.number,
    reason: record.reason,
  };

  const texts = {
    ACCEPTED: ['success', type.messages.accept],
    REJECTED: ['danger', type.messages.reject],
    WITHDRAWN: ['warning', 'Deine **{applicationName}** (**{number}**) wurde zurückgezogen.'],
  };
  const [color, template] = texts[record.status];
  await user?.send({ embeds: [embed(color).setDescription(renderMessage(template, vars))] }).catch(() => {});

  const member = await guild.members.fetch(record.userId).catch(() => null);
  const reason = `Bewerbung ${record.number}: ${store.STATUS[record.status]}`;
  if (record.status === 'ACCEPTED') {
    await applyRoles(member, { add: [...type.roles.acceptAdd, ...(record.roleSelections ?? [])], remove: [...type.roles.acceptRemove, ...type.roles.pending] }, reason);
  } else if (record.status === 'REJECTED') {
    await applyRoles(member, { add: type.roles.rejectAdd, remove: [...type.roles.rejectRemove, ...type.roles.pending] }, reason);
  } else {
    await applyRoles(member, { remove: type.roles.pending }, reason);
  }

  if (record.threadId) {
    const thread = await guild.channels.fetch(record.threadId).catch(() => null);
    await thread
      ?.send({ embeds: [embed(color).setDescription(`${store.STATUS[record.status]} von ${vars.user}${record.reason ? `\n**Grund:** ${record.reason}` : ''}`)] })
      .catch(() => {});
  }

  const archiveId = { ACCEPTED: type.channels.accepted, REJECTED: type.channels.rejected }[record.status];
  if (archiveId && (archiveId !== record.channelId || !record.messageId)) {
    const archive = await guild.channels.fetch(archiveId).catch(() => null);
    await archive?.send(buildTeamMessage(record, type, { components: false })).catch((err) => console.error('[bewerbung] Archiv:', err.message));
  }
}

// Annehmen/Ablehnen per Button (reason = null) oder über das Grund-Formular.
async function decide(interaction, number, action, reason = null) {
  const loaded = await loadForManager(interaction, number);
  if (!loaded) return;
  const { record, type } = loaded;
  if (record.userId === interaction.user.id) return replyPrivate(interaction, 'Über deine eigene Bewerbung kannst du nicht entscheiden.');

  const status = action === 'accept' ? 'ACCEPTED' : 'REJECTED';
  // setStatus prüft und setzt synchron – ein zweiter, gleichzeitiger Klick scheitert hier.
  if (!store.setStatus(record, status, interaction.user.id, { reason })) {
    return replyPrivate(interaction, `Diese Bewerbung wurde bereits entschieden: **${store.STATUS[record.status]}**${record.decidedBy ? ` von <@${record.decidedBy}>` : ''}.`);
  }
  await interaction.update(buildTeamMessage(record, type));
  if (interaction.message.id !== record.messageId) await updateTeamMessage(interaction.guild, record, type);
  await afterDecision(interaction.guild, record, type, interaction.user);
}

async function askReason(interaction, number, action) {
  const loaded = await loadForManager(interaction, number);
  if (!loaded) return;
  const label = action === 'accept' ? 'Annehmen' : 'Ablehnen';
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`quali:reasonsubmit:${number}:${action}`)
      .setTitle(`${loaded.record.number} ${label.toLowerCase()}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Grund (geht per DM an die Person)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000),
        ),
      ),
  );
}

// Polizei-Workflow: SUBMITTED → SCREENING → INTERVIEW → PENDING_DECISION (oder Zurückziehen)
async function changeStatus(interaction, number) {
  const loaded = await loadForManager(interaction, number);
  if (!loaded) return;
  const { record, type } = loaded;
  if (record.userId === interaction.user.id) return replyPrivate(interaction, 'Über deine eigene Bewerbung kannst du nicht entscheiden.');
  const next = interaction.values[0];
  if (!(store.POLICE_TRANSITIONS[record.status] ?? []).includes(next)) {
    return replyPrivate(interaction, `Von „${store.STATUS[record.status]}“ geht es nicht nach „${store.STATUS[next]}“.`);
  }
  const reason = next === 'WITHDRAWN' ? 'Vom Team zurückgezogen.' : undefined;
  if (!store.setStatus(record, next, interaction.user.id, { reason })) return replyPrivate(interaction, 'Diese Bewerbung wurde bereits entschieden.');
  await interaction.update(buildTeamMessage(record, type));
  if (next === 'WITHDRAWN') await afterDecision(interaction.guild, record, type, interaction.user);
}

// Button in der Abschluss-DM des Bewerbers.
async function withdraw(interaction, guildId, number) {
  const record = store.getRecord(guildId, number);
  const guild = interaction.client.guilds.cache.get(guildId);
  const type = record && store.typeById(record.type);
  if (!record || !guild || !type || record.userId !== interaction.user.id) {
    return interaction.update({ components: [] });
  }
  if (!store.setStatus(record, 'WITHDRAWN', interaction.user.id, { reason: 'Vom Bewerber zurückgezogen.' })) {
    return interaction.update({ embeds: [...interaction.message.embeds, embed().setDescription(`Diese Bewerbung ist bereits ${store.STATUS[record.status].toLowerCase()}.`)], components: [] });
  }
  await interaction.update({ embeds: [...interaction.message.embeds, embed('warning').setDescription(`↩️ Du hast ${record.number} zurückgezogen.`)], components: [] });
  await updateTeamMessage(guild, record, type);
  await afterDecision(guild, record, type, interaction.user);
}

async function showHistory(interaction, userId) {
  if (!store.managesAny(interaction.member)) return replyPrivate(interaction, 'Nur das Team kann den Verlauf sehen.');
  const list = store.historyOf(interaction.guildId, userId);
  if (!list.length) return replyPrivate(interaction, `<@${userId}> hat noch keine Bewerbungen.`);
  const lines = list.map((r) => {
    const type = store.typeById(r.type);
    const link = r.messageId ? ` · [Nachricht](https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId})` : '';
    return `**${r.number}** ${type?.emoji ?? ''} ${type?.name ?? r.type} – ${store.STATUS[r.status]} <t:${Math.floor(r.createdAt / 1000)}:R>${link}`;
  });
  return replyPrivate(interaction, { embeds: [embed().setTitle(`📜 Verlauf (${list.length})`).setDescription(`<@${userId}>\n\n${truncate(lines.join('\n'), 3900)}`)] });
}

async function openTicket(interaction, number) {
  const loaded = await loadForManager(interaction, number);
  if (!loaded) return;
  const { record, type } = loaded;
  const { openApplicationTicket } = require('../tickets');
  const member = await interaction.guild.members.fetch(record.userId).catch(() => null);
  if (!member) return replyPrivate(interaction, 'Der Bewerber ist nicht mehr auf dem Server.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await openApplicationTicket(interaction, member, {
    roles: type.roles.managers,
    name: `${record.number}-${member.user.username}`,
    title: `${type.emoji} ${type.name} – ${record.number}`,
    label: `Bewerbung ${record.number}`,
  });
  return interaction.editReply(`🎫 Ticket erstellt: ${channel}`);
}

// Bewerber verlässt den Server: je nach onLeave nichts tun, ablehnen oder zurückziehen.
async function handleMemberLeave(member) {
  cancelForMember(member.guild.id, member.id);
  for (const record of store.openOf(member.guild.id, (r) => r.userId === member.id)) {
    const type = store.typeById(record.type);
    if (!type || type.onLeave === 'NONE') continue;
    const status = type.onLeave === 'DENY' ? 'REJECTED' : 'WITHDRAWN';
    if (!store.setStatus(record, status, null, { reason: LEFT_REASON })) continue;
    await updateTeamMessage(member.guild, record, type);
    await afterDecision(member.guild, record, type, null);
  }
}

module.exports = { decide, askReason, changeStatus, withdraw, showHistory, openTicket, handleMemberLeave, updateTeamMessage };
