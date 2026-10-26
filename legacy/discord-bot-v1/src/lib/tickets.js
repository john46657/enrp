const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../../config.json');
const { bucket, save, nextNumber } = require('./db');
const { embed, sendTo, isStaff, replyPrivate } = require('./util');
const { isOpen, nextOpening } = require('./openingHours');

const settings = config.tickets;
const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
];

const typeById = (id) => settings.types.find((t) => t.id === id);
const ticketsOf = (guildId) => bucket('tickets', guildId);
const panelsOf = (guildId) => bucket('ticketPanels', guildId);

// Rollen, die eine Ticket-Art bearbeiten: eigene Rollen der Art, sonst die allgemeine Support-Rolle.
function teamRoles(type) {
  return type?.roles?.length ? type.roles : [config.roles.support].filter(Boolean);
}

function isTicketTeam(member, ticket) {
  return isStaff(member) || teamRoles(typeById(ticket.type)).some((id) => member.roles.cache.has(id));
}

const roleMentions = (type) => teamRoles(type).map((id) => `<@&${id}>`).join(' ');
const unix = (date) => Math.floor(date.getTime() / 1000);
const ticketRef = (channelId, ticket) => `<#${channelId}> (#${ticket.number}, ${typeById(ticket.type)?.label ?? ticket.type})`;

// Ticket-Aktivitäten in den Log-Kanal (channels.ticketLog) schreiben.
function logActivity(guild, color, text) {
  if (!settings.logging.activities) return null;
  return sendTo(guild, 'ticketLog', { embeds: [embed(color).setDescription(text)], allowedMentions: { parse: [] } });
}

// Claim-Kategorie: übernommene Tickets verschieben und beim Freigeben zurück in die ursprüngliche Kategorie.
async function moveForClaim(channel, ticket, claimed) {
  const { enabled, categoryId } = settings.claimCategory;
  if (!enabled || !categoryId) return;
  await channel
    .setParent(claimed ? categoryId : (ticket.parentId ?? null), { lockPermissions: false })
    .catch((err) => console.error('[claimCategory]', err.message));
}

// Offene Tickets eines Servers; Einträge zu manuell gelöschten Kanälen werden aufgeräumt.
function openTickets(guild) {
  const tickets = ticketsOf(guild.id);
  for (const channelId of Object.keys(tickets)) {
    if (!guild.channels.cache.has(channelId)) {
      delete tickets[channelId];
      save();
    }
  }
  return tickets;
}

// ---------- Panel ----------

function loadLine(type, count) {
  const percent = Math.round((count / type.capacity) * 100);
  const [icon, status] =
    percent >= 100 ? ['🔴', 'Voll ausgelastet'] : percent >= 80 ? ['🟠', 'Stark ausgelastet'] : percent >= 50 ? ['🟡', 'Erhöhte Auslastung'] : ['🟢', 'Verfügbar'];
  return `- ${icon} **${type.label}:** ${status} \`${count}/${type.capacity}\` (${percent}%)`;
}

function buildPanel(guild) {
  const { panel } = settings;
  const container = new ContainerBuilder()
    .setAccentColor(parseInt(config.colors.primary.slice(1), 16))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${panel.title}\n${panel.description}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(settings.types.map((t) => `- [${t.emoji}] **${t.label}**\n${t.description}`).join('\n\n')),
    );

  const withCapacity = settings.types.filter((t) => t.capacity > 0);
  if (panel.showLoad && withCapacity.length) {
    const tickets = Object.values(openTickets(guild));
    const lines = withCapacity.map((t) => loadLine(t, tickets.filter((x) => x.type === t.id).length));
    container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '### 📊 Ticket-Auslastung\nHier siehst du die aktuelle Auslastung unserer Tickets. Bei einer höheren Auslastung kann es zu ' +
          'längeren Bearbeitungszeiten kommen. Ein Ticket kannst du jedoch jederzeit eröffnen, unabhängig von der Auslastung.\n\n' +
          lines.join('\n'),
      ),
    );
  }

  if (settings.openingHours.enabled && !isOpen()) {
    const next = nextOpening();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# 🌙 Das Team ist gerade nicht erreichbar${next ? ` – wieder da <t:${unix(next)}:R>` : ''}.`),
    );
  }
  if (panel.image) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(panel.image)));
  }
  if (panel.footer) {
    container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${panel.footer}`));
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder(panel.placeholder)
    .addOptions(
      settings.types.slice(0, 25).map((t) => ({ label: t.label, value: t.id, emoji: t.emoji, description: t.description.slice(0, 100) })),
    );

  return { components: [container, new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.IsComponentsV2 };
}

async function postPanel(channel) {
  const message = await channel.send(buildPanel(channel.guild));
  panelsOf(channel.guild.id)[message.id] = channel.id;
  save();
}

// Aktualisiert alle geposteten Panels (Auslastung, Öffnungszeiten-Hinweis).
async function refreshPanels(guild) {
  const panels = panelsOf(guild.id);
  const payload = buildPanel(guild);
  for (const [messageId, channelId] of Object.entries(panels)) {
    const channel = guild.channels.cache.get(channelId);
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    if (!message) {
      delete panels[messageId];
      save();
      continue;
    }
    await message.edit(payload).catch((err) => console.error('[ticketPanel]', err.message));
  }
}

// ---------- Ticket öffnen ----------

function channelName(type, member, number, caseNumber) {
  const values = {
    CASEID: String(caseNumber).padStart(4, '0'),
    TICKET_NUMBER: String(number).padStart(4, '0'),
    PREFIX: type.prefix ?? type.id,
    USERNAME: member.user.username,
    USER_ID: member.id,
    USER_NICK_NAME: member.nickname ?? member.user.username,
    DISPLAY_NAME: member.user.globalName ?? member.user.username,
    EMOTE: type.emoji ?? '',
  };
  const name = settings.channelName.replace(/%(\w+)%/g, (match, key) => values[key] ?? match).slice(0, 100);
  return name.trim() || `ticket-${values.TICKET_NUMBER}`;
}

function controls(ticket) {
  const claim = ticket.claimedBy
    ? new ButtonBuilder().setCustomId('ticket:unclaim').setLabel('Freigeben').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    : new ButtonBuilder().setCustomId('ticket:claim').setLabel('Übernehmen').setStyle(ButtonStyle.Success).setEmoji('🙋');
  return new ActionRowBuilder().addComponents(
    claim,
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
  );
}

async function updateControls(channel, ticket) {
  const message = await channel.messages.fetch(ticket.controlsMessageId).catch(() => null);
  await message?.edit({ components: [controls(ticket)] }).catch(() => {});
}

async function openTicket(interaction, typeId) {
  const type = typeById(typeId);
  if (!type) return replyPrivate(interaction, 'Diese Kategorie gibt es nicht mehr.');

  const tickets = openTickets(interaction.guild);
  const own = Object.keys(tickets).filter((id) => tickets[id].owner === interaction.user.id);
  if (settings.maxOpenPerUser > 0 && own.length >= settings.maxOpenPerUser) {
    return replyPrivate(interaction, `Du hast bereits ${own.length} offene(s) Ticket(s): ${own.map((id) => `<#${id}>`).join(', ')}`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const number = nextNumber('ticket', interaction.guildId);
  const caseNumber = nextNumber(`ticket:${type.id}`, interaction.guildId);
  const roles = teamRoles(type);

  const channel = await interaction.guild.channels.create({
    name: channelName(type, interaction.member, number, caseNumber),
    type: ChannelType.GuildText,
    parent: type.categoryId || settings.categoryId || null,
    topic: `Ticket #${number} von ${interaction.user.tag} – ${type.label}`,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: MEMBER_PERMS },
      { id: interaction.client.user.id, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels] },
      ...roles.map((id) => ({ id, allow: MEMBER_PERMS })),
    ],
  });

  const ticket = { owner: interaction.user.id, type: type.id, number, openedAt: Date.now() };
  const teamAvailable = isOpen();
  const embeds = [
    embed()
      .setTitle(`${type.emoji} ${type.label} – Ticket #${number}`)
      .setDescription(
        `Danke für dein Ticket, ${interaction.user}! Beschreibe dein Anliegen bitte so genau wie möglich.\n\n` +
          (settings.creatorCanAddUsers ? 'Weitere Personen kannst du mit `/ticket hinzufuegen` anfragen.' : ''),
      ),
  ];
  if (!teamAvailable) {
    const next = nextOpening();
    embeds.push(
      embed('warning')
        .setTitle('🌙 Außerhalb der Öffnungszeiten')
        .setDescription(
          `Unser Team ist gerade nicht erreichbar.${next ? ` Wir sind wieder für dich da: <t:${unix(next)}:F> (<t:${unix(next)}:R>).` : ''}\n` +
            'Dein Ticket bleibt natürlich offen – wir melden uns so schnell wie möglich.',
        ),
    );
  }

  const ping = settings.pingTeam && teamAvailable ? roleMentions(type) : '';
  const message = await channel.send({ content: `${interaction.user} ${ping}`.trim(), embeds, components: [controls(ticket)] });
  ticket.controlsMessageId = message.id;
  ticket.parentId = channel.parentId;
  tickets[channel.id] = ticket;
  save();

  await interaction.editReply(`✅ Dein Ticket wurde erstellt: ${channel}`);
  await logActivity(interaction.guild, 'primary', `🎫 ${interaction.user} hat ${ticketRef(channel.id, ticket)} geöffnet.`);
  await refreshPanels(interaction.guild);
}

// ---------- Ticket schließen ----------

async function buildTranscript(channel) {
  const all = [];
  let before;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  const lines = all.reverse().map((m) => {
    const time = m.createdAt.toLocaleString('de-DE', { timeZone: settings.openingHours.timezone });
    const files = [...m.attachments.values()].map((a) => ` [Anhang: ${a.url}]`).join('');
    const embeds = m.embeds.map((e) => ` [Embed: ${e.title ?? e.description ?? ''}]`).join('');
    return `[${time}] ${m.author.tag}: ${m.content}${files}${embeds}`;
  });
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `transcript-${channel.name}.txt` });
}

// closedBy = User oder null (automatisch geschlossen).
async function closeTicket(channel, closedBy, reason) {
  const tickets = ticketsOf(channel.guild.id);
  const ticket = tickets[channel.id];
  if (!ticket) return;
  delete tickets[channel.id];
  save();

  const { activities, transcripts } = settings.logging;
  const transcript = transcripts ? await buildTranscript(channel) : null;
  const files = transcript ? [transcript] : [];
  const summary = embed('danger')
    .setTitle(`🎫 Ticket #${ticket.number} geschlossen`)
    .addFields(
      { name: 'Ersteller', value: `<@${ticket.owner}>`, inline: true },
      { name: 'Geschlossen von', value: closedBy ? `${closedBy}` : 'System', inline: true },
      { name: 'Kategorie', value: typeById(ticket.type)?.label ?? ticket.type, inline: true },
      { name: 'Geöffnet', value: `<t:${Math.floor(ticket.openedAt / 1000)}:f>`, inline: true },
    );
  if (ticket.claimedBy) summary.addFields({ name: 'Bearbeitet von', value: `<@${ticket.claimedBy}>`, inline: true });
  if (reason) summary.addFields({ name: 'Grund', value: reason });

  if (activities || transcripts) await sendTo(channel.guild, 'ticketLog', { embeds: [summary], files, allowedMentions: { parse: [] } });
  const owner = await channel.client.users.fetch(ticket.owner).catch(() => null);
  await owner
    ?.send({
      content: `Dein Ticket auf **${channel.guild.name}** wurde geschlossen.${reason ? `\n**Grund:** ${reason}` : ''}${transcript ? '\nHier ist der Verlauf:' : ''}`,
      files,
    })
    .catch(() => {});

  await refreshPanels(channel.guild);
  setTimeout(() => channel.delete('Ticket geschlossen').catch(() => {}), 5000);
}

function closeError(interaction) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (!ticket) return 'Das hier ist kein Ticket-Kanal.';
  if (isTicketTeam(interaction.member, ticket)) return null;
  if (settings.onlyTeamCanClose) return 'Nur das Team kann Tickets schließen.';
  if (ticket.owner !== interaction.user.id) return 'Nur der Ersteller oder das Team kann das Ticket schließen.';
  return null;
}

// Schritt 1: Rückfrage (nur für den Klickenden sichtbar).
async function closeFromInteraction(interaction) {
  const error = closeError(interaction);
  if (error) return replyPrivate(interaction, error);
  return replyPrivate(interaction, {
    embeds: [embed('danger').setDescription('🔒 Möchtest du dieses Ticket wirklich schließen?')],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:closeyes').setLabel('Schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket:closereason').setLabel('Mit Grund schließen').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
        new ButtonBuilder().setCustomId('ticket:closeno').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// Schritt 2: Antwort auf die Rückfrage (closeyes, closereason → Formular → closemodal, closeno).
async function confirmClose(interaction, action) {
  if (action === 'closeno') return interaction.update({ embeds: [embed().setDescription('Abgebrochen – das Ticket bleibt offen.')], components: [] });

  const error = closeError(interaction);
  if (error) return interaction.update({ embeds: [embed('danger').setDescription(error)], components: [] });

  if (action === 'closereason') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('ticket:closemodal')
        .setTitle('Ticket schließen')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reason').setLabel('Grund').setStyle(TextInputStyle.Paragraph).setMaxLength(1000),
          ),
        ),
    );
  }

  const reason = action === 'closemodal' ? interaction.fields.getTextInputValue('reason') : null;
  await interaction.update({ embeds: [embed('danger').setDescription('🔒 Wird geschlossen …')], components: [] });
  await interaction.channel.send({
    embeds: [embed('danger').setDescription(`🔒 Ticket wird von ${interaction.user} geschlossen …${reason ? `\n**Grund:** ${reason}` : ''}`)],
  });
  await closeTicket(interaction.channel, interaction.user, reason);
}

// ---------- Übernehmen / Freigeben ----------

async function claim(interaction) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (!ticket) return replyPrivate(interaction, 'Das hier ist kein Ticket-Kanal.');
  if (!isTicketTeam(interaction.member, ticket)) return replyPrivate(interaction, 'Nur das Team kann Tickets übernehmen.');
  if (ticket.claimedBy) return replyPrivate(interaction, `Das Ticket wird bereits von <@${ticket.claimedBy}> bearbeitet.`);

  ticket.claimedBy = interaction.user.id;
  ticket.claimerLastAt = Date.now();
  save();
  await interaction.update({ components: [controls(ticket)] });
  await interaction.followUp({ embeds: [embed('success').setDescription(`🙋 ${interaction.user} kümmert sich um dieses Ticket.`)] });
  await moveForClaim(interaction.channel, ticket, true);
  await logActivity(interaction.guild, 'success', `🙋 ${interaction.user} hat ${ticketRef(interaction.channelId, ticket)} übernommen.`);
}

async function unclaim(interaction) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (!ticket?.claimedBy) return replyPrivate(interaction, 'Dieses Ticket ist nicht übernommen.');
  if (ticket.claimedBy !== interaction.user.id && !isStaff(interaction.member)) {
    return replyPrivate(interaction, 'Nur wer das Ticket übernommen hat (oder Staff), kann es freigeben.');
  }
  delete ticket.claimedBy;
  delete ticket.claimerLastAt;
  save();
  await interaction.update({ components: [controls(ticket)] });
  await interaction.followUp({ embeds: [embed('warning').setDescription(`↩️ ${interaction.user} hat das Ticket wieder freigegeben.`)] });
  await moveForClaim(interaction.channel, ticket, false);
  await logActivity(interaction.guild, 'warning', `↩️ ${interaction.user} hat ${ticketRef(interaction.channelId, ticket)} freigegeben.`);
}

// ---------- Personen hinzufügen ----------

async function addUser(channel, userId) {
  await channel.permissionOverwrites.edit(
    userId,
    { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true },
    { type: OverwriteType.Member },
  );
}

async function requestAddUser(interaction, ticket, user) {
  if (isTicketTeam(interaction.member, ticket)) {
    await addUser(interaction.channel, user.id);
    await interaction.reply(`➕ ${user} wurde zum Ticket hinzugefügt.`);
    return logActivity(interaction.guild, 'primary', `➕ ${interaction.user} hat ${user} zu ${ticketRef(interaction.channelId, ticket)} hinzugefügt.`);
  }
  if (!settings.creatorCanAddUsers || ticket.owner !== interaction.user.id) {
    return replyPrivate(interaction, 'Nur das Team kann Personen hinzufügen.');
  }
  await interaction.reply({
    content: roleMentions(typeById(ticket.type)) || undefined,
    embeds: [embed('warning').setDescription(`📨 ${interaction.user} möchte ${user} zum Ticket hinzufügen. Ein Teammitglied muss das bestätigen.`)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket:addok:${user.id}`).setLabel('Bestätigen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ticket:addno:${user.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function answerAddRequest(interaction, userId, accepted) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (!ticket) return replyPrivate(interaction, 'Das hier ist kein Ticket-Kanal.');
  if (!isTicketTeam(interaction.member, ticket)) return replyPrivate(interaction, 'Nur das Team kann diese Anfrage bearbeiten.');
  if (accepted) await addUser(interaction.channel, userId);
  await interaction.update({
    content: null,
    embeds: [
      embed(accepted ? 'success' : 'danger').setDescription(
        accepted ? `➕ <@${userId}> wurde von ${interaction.user} hinzugefügt.` : `❌ ${interaction.user} hat die Anfrage für <@${userId}> abgelehnt.`,
      ),
    ],
    components: [],
  });
  await logActivity(
    interaction.guild,
    accepted ? 'primary' : 'danger',
    `${accepted ? '➕' : '❌'} ${interaction.user} hat die Anfrage für <@${userId}> in ${ticketRef(interaction.channelId, ticket)} ${accepted ? 'bestätigt' : 'abgelehnt'}.`,
  );
}

// ---------- Hintergrund: Aktivität, Auto-Team-Alert, Auto-Unclaim ----------

function trackMessage(message) {
  const ticket = ticketsOf(message.guildId)[message.channelId];
  if (!ticket || message.author.bot) return;
  if (message.author.id !== ticket.owner && message.member && isTicketTeam(message.member, ticket)) ticket.teamRepliedAt = Date.now();
  if (message.author.id === ticket.claimedBy) ticket.claimerLastAt = Date.now();
  save();
}

async function checkReminders(client) {
  if (!isOpen()) return; // Außerhalb der Öffnungszeiten pausieren die Erinnerungen
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const [channelId, ticket] of Object.entries(openTickets(guild))) {
      const channel = guild.channels.cache.get(channelId);
      const { autoTeamAlert, autoUnclaim } = settings;

      if (autoTeamAlert.enabled && !ticket.alerted && !ticket.teamRepliedAt && !ticket.claimedBy && now - ticket.openedAt >= autoTeamAlert.afterMinutes * 60_000) {
        ticket.alerted = true;
        save();
        await channel
          .send({
            content: roleMentions(typeById(ticket.type)) || undefined,
            embeds: [embed('warning').setDescription(`⏰ Dieses Ticket wartet seit <t:${Math.floor(ticket.openedAt / 1000)}:R> auf eine Antwort vom Team.`)],
          })
          .catch(() => {});
      }

      if (autoUnclaim.enabled && ticket.claimedBy && now - (ticket.claimerLastAt ?? 0) >= autoUnclaim.afterHours * 3_600_000) {
        const previous = ticket.claimedBy;
        delete ticket.claimedBy;
        delete ticket.claimerLastAt;
        save();
        await updateControls(channel, ticket);
        await moveForClaim(channel, ticket, false);
        await logActivity(guild, 'warning', `↩️ ${ticketRef(channelId, ticket)} wurde automatisch freigegeben (<@${previous}> war inaktiv).`);
        await channel
          .send({
            content: roleMentions(typeById(ticket.type)) || undefined,
            embeds: [embed('warning').setDescription(`↩️ <@${previous}> war ${autoUnclaim.afterHours} h inaktiv – das Ticket wurde automatisch freigegeben.`)],
            allowedMentions: { parse: ['roles'] },
          })
          .catch(() => {});
      }
    }
  }
}

let lastOpenState = null;
function startTicketWatcher(client) {
  setInterval(async () => {
    await checkReminders(client).catch((err) => console.error('[ticketWatcher]', err));
    // Panels neu zeichnen, wenn sich der Öffnungsstatus ändert.
    const open = isOpen();
    if (lastOpenState !== null && open !== lastOpenState) {
      for (const guild of client.guilds.cache.values()) await refreshPanels(guild);
    }
    lastOpenState = open;
  }, 60_000);
}

module.exports = {
  ticketsOf,
  openTickets,
  postPanel,
  refreshPanels,
  openTicket,
  closeTicket,
  closeFromInteraction,
  confirmClose,
  claim,
  unclaim,
  requestAddUser,
  answerAddRequest,
  isTicketTeam,
  buildPanel,
  logActivity,
  trackMessage,
  startTicketWatcher,
};
