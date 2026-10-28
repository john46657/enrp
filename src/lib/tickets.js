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
const { base, forGuild } = require('./settings');
const { bucket, save, nextNumber } = require('./db');
const { embed, sendTo, isStaff, replyPrivate, fill, truncate } = require('./util');
const { isOpen, nextOpening } = require('./openingHours');
const activity = require('./activity');

// Ticket-Einstellungen eines Servers.
const settingsOf = (guildId) => forGuild(guildId).tickets;
const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
];

const typeById = (guildId, id) => settingsOf(guildId).types.find((t) => t.id === id);
const activeTypes = (guildId) => settingsOf(guildId).types.filter((t) => t.enabled !== false);
// Einstellung einer Kategorie, sonst die allgemeine Ticket-Einstellung (z. B. onCreatorLeave, autoClose).
const option = (guildId, ticket, key) => typeById(guildId, ticket.type)?.[key] ?? settingsOf(guildId)[key];
const ticketsOf = (guildId) => bucket('tickets', guildId);
const panelsOf = (guildId) => bucket('ticketPanels', guildId);

// Rollen, die eine Ticket-Art bearbeiten: eigene Rollen der Art, sonst die allgemeine Support-Rolle.
function teamRoles(guildId, type) {
  return type?.roles?.length ? type.roles : [forGuild(guildId).roles.support].filter(Boolean);
}

// Tickets aus anderen Systemen (z. B. Bewerbungen) bringen eigene Rollen und eine eigene Bezeichnung mit.
const ticketTeamRoles = (guildId, ticket) => (ticket.roles?.length ? ticket.roles : teamRoles(guildId, typeById(guildId, ticket.type)));
const ticketLabel = (guildId, ticket) => typeById(guildId, ticket.type)?.label ?? ticket.label ?? ticket.type;

function isTicketTeam(member, ticket) {
  return isStaff(member) || ticketTeamRoles(member.guild.id, ticket).some((id) => member.roles.cache.has(id));
}

const mentions = (roles) => roles.map((id) => `<@&${id}>`).join(' ');
const roleMentions = (guildId, type) => mentions(teamRoles(guildId, type));
const unix = (date) => Math.floor(date.getTime() / 1000);
const ticketRef = (guildId, channelId, ticket) => `<#${channelId}> (#${ticket.number}, ${ticketLabel(guildId, ticket)})`;

// Ticket-Aktivitäten in den Log-Kanal (channels.ticketLog) schreiben.
function logActivity(guild, color, text) {
  if (!settingsOf(guild.id).logging.activities) return null;
  return sendTo(guild, 'ticketLog', { embeds: [embed(color).setDescription(text)], allowedMentions: { parse: [] } });
}

// Claim-Kategorie: übernommene Tickets verschieben und beim Freigeben zurück in die ursprüngliche Kategorie.
async function moveForClaim(channel, ticket, claimed) {
  const { enabled, categoryId } = settingsOf(channel.guild.id).claimCategory;
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
  const settings = settingsOf(guild.id);
  const { panel } = settings;
  const types = activeTypes(guild.id);
  const container = new ContainerBuilder()
    .setAccentColor(parseInt(base.colors.primary.slice(1), 16))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${panel.title}\n${panel.description}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        types.map((t) => `- [${t.emoji}] **${t.label}**\n${t.description}`).join('\n\n') || 'Gerade können keine Tickets erstellt werden.',
      ),
    );

  const withCapacity = types.filter((t) => t.capacity > 0);
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

  if (settings.openingHours.enabled && !isOpen(settings.openingHours)) {
    const next = nextOpening(settings.openingHours);
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

  // Ohne aktive Kategorie kein Auswahlmenü (Discord verlangt mindestens eine Option).
  if (!types.length) return { components: [container], flags: MessageFlags.IsComponentsV2 };
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder(panel.placeholder)
    .addOptions(types.slice(0, 25).map((t) => ({ label: t.label, value: t.id, emoji: t.emoji, description: t.description.slice(0, 100) })));

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
  const name = settingsOf(member.guild.id).channelName.replace(/%(\w+)%/g, (match, key) => values[key] ?? match).slice(0, 100);
  return name.trim() || `ticket-${values.TICKET_NUMBER}`;
}

function controls(guildId, ticket) {
  const close = new ButtonBuilder().setCustomId('ticket:close').setLabel('Schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒');
  if (typeById(guildId, ticket.type)?.allowClaim === false) return new ActionRowBuilder().addComponents(close);
  const claim = ticket.claimedBy
    ? new ButtonBuilder().setCustomId('ticket:unclaim').setLabel('Freigeben').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
    : new ButtonBuilder().setCustomId('ticket:claim').setLabel('Übernehmen').setStyle(ButtonStyle.Success).setEmoji('🙋');
  return new ActionRowBuilder().addComponents(claim, close);
}

async function updateControls(channel, ticket) {
  const message = await channel.messages.fetch(ticket.controlsMessageId).catch(() => null);
  await message?.edit({ components: [controls(channel.guild.id, ticket)] }).catch(() => {});
}

// Eröffnungs-Embed einer Kategorie (openEmbed), sonst der Standardtext.
function openingEmbed(guildId, type, owner, number) {
  const { title, description, image } = type.openEmbed ?? {};
  const vars = { user: `${owner}`, username: owner.user.username, category: type.label, emoji: type.emoji, number };
  const result = embed()
    .setTitle(title ? fill(title, vars).slice(0, 256) : `${type.emoji} ${type.label} – Ticket #${number}`)
    .setDescription(
      (description ? fill(description, vars) : `Danke für dein Ticket, ${owner}! Beschreibe dein Anliegen bitte so genau wie möglich.`) +
        (settingsOf(guildId).creatorCanAddUsers ? '\n\nWeitere Personen kannst du mit `/ticket hinzufuegen` anfragen.' : ''),
    );
  if (image) result.setImage(image);
  return result;
}

// owner = Mitglied, für das das Ticket ist. Weicht es vom Klickenden ab, öffnet das Team im Auftrag (/ticket fuer).
async function openTicket(interaction, typeId, owner = interaction.member) {
  const settings = settingsOf(interaction.guildId);
  const type = typeById(interaction.guildId, typeId);
  if (!type) return replyPrivate(interaction, 'Diese Kategorie gibt es nicht mehr.');
  if (type.enabled === false) return replyPrivate(interaction, 'Diese Kategorie ist gerade deaktiviert.');
  const onBehalf = owner.id !== interaction.user.id;

  const tickets = openTickets(interaction.guild);
  const own = Object.keys(tickets).filter((id) => tickets[id].owner === owner.id);
  if (settings.maxOpenPerUser > 0 && own.length >= settings.maxOpenPerUser) {
    return replyPrivate(
      interaction,
      `${onBehalf ? `${owner} hat` : 'Du hast'} bereits ${own.length} offene(s) Ticket(s): ${own.map((id) => `<#${id}>`).join(', ')}`,
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const number = nextNumber('ticket', interaction.guildId);
  const caseNumber = nextNumber(`ticket:${type.id}`, interaction.guildId);
  const roles = teamRoles(interaction.guildId, type);

  const channel = await interaction.guild.channels.create({
    name: channelName(type, owner, number, caseNumber),
    type: ChannelType.GuildText,
    parent: type.categoryId || settings.categoryId || null,
    topic: `Ticket #${number} von ${owner.user.tag} – ${type.label}`,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: owner.id, allow: MEMBER_PERMS },
      ...(onBehalf ? [{ id: interaction.user.id, allow: MEMBER_PERMS }] : []),
      { id: interaction.client.user.id, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels] },
      ...roles.map((id) => ({ id, allow: MEMBER_PERMS })),
    ],
  });

  const now = Date.now();
  const ticket = { owner: owner.id, type: type.id, number, openedAt: now, lastActivityAt: now };
  if (onBehalf) ticket.openedBy = interaction.user.id;
  const teamAvailable = isOpen(settings.openingHours);
  const embeds = [openingEmbed(interaction.guildId, type, owner, number)];
  if (onBehalf) embeds.push(embed().setDescription(`📨 ${interaction.user} hat dieses Ticket für dich geöffnet.`));
  if (!teamAvailable) {
    const next = nextOpening(settings.openingHours);
    embeds.push(
      embed('warning')
        .setTitle('🌙 Außerhalb der Öffnungszeiten')
        .setDescription(
          `Unser Team ist gerade nicht erreichbar.${next ? ` Wir sind wieder für dich da: <t:${unix(next)}:F> (<t:${unix(next)}:R>).` : ''}\n` +
            'Dein Ticket bleibt natürlich offen – wir melden uns so schnell wie möglich.',
        ),
    );
  }

  const ping = settings.pingTeam && teamAvailable && !onBehalf ? roleMentions(interaction.guildId, type) : '';
  const message = await channel.send({ content: `${owner} ${ping}`.trim(), embeds, components: [controls(interaction.guildId, ticket)] });
  ticket.controlsMessageId = message.id;
  ticket.parentId = channel.parentId;
  tickets[channel.id] = ticket;
  save();

  await interaction.editReply(`✅ ${onBehalf ? `Ticket für ${owner}` : 'Dein Ticket'} wurde erstellt: ${channel}`);
  await logActivity(
    interaction.guild,
    'primary',
    onBehalf
      ? `🎫 ${interaction.user} hat ${ticketRef(interaction.guildId, channel.id, ticket)} für ${owner} geöffnet.`
      : `🎫 ${interaction.user} hat ${ticketRef(interaction.guildId, channel.id, ticket)} geöffnet.`,
  );
  await refreshPanels(interaction.guild);
}

// /ticket fuer: Das Team öffnet ein Ticket im Auftrag eines Mitglieds.
async function openOnBehalf(interaction, typeId, member) {
  const type = typeById(interaction.guildId, typeId);
  if (!type) return replyPrivate(interaction, 'Diese Kategorie gibt es nicht.');
  const team = isStaff(interaction.member) || teamRoles(interaction.guildId, type).some((id) => interaction.member.roles.cache.has(id));
  if (!team) return replyPrivate(interaction, 'Nur das Team dieser Kategorie kann Tickets im Auftrag öffnen.');
  if (type.allowOnBehalf === false) return replyPrivate(interaction, 'In dieser Kategorie sind Tickets im Auftrag ausgeschaltet.');
  if (!member || member.user.bot) return replyPrivate(interaction, 'Wähle ein Mitglied dieses Servers.');
  return openTicket(interaction, typeId, member);
}

// Ticket zwischen Bewerber und Team, geöffnet aus einer Bewerbung. Wer es öffnet, übernimmt es direkt.
async function openApplicationTicket(interaction, applicant, { roles, name, title, label }) {
  const teamRoleIds = roles.length ? roles : teamRoles(interaction.guildId, null);
  const number = nextNumber('ticket', interaction.guildId);
  const channel = await interaction.guild.channels.create({
    name: name.slice(0, 100),
    type: ChannelType.GuildText,
    parent: settingsOf(interaction.guildId).categoryId || null,
    topic: `${label} – ${applicant.user.tag}`,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: applicant.id, allow: MEMBER_PERMS },
      { id: interaction.user.id, allow: MEMBER_PERMS },
      { id: interaction.client.user.id, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels] },
      ...teamRoleIds.map((id) => ({ id, allow: MEMBER_PERMS })),
    ],
  });

  const now = Date.now();
  const ticket = { owner: applicant.id, type: 'bewerbung', label, roles: teamRoleIds, number, openedAt: now, claimedBy: interaction.user.id, claimerLastAt: now };
  const message = await channel.send({
    content: `${applicant} ${interaction.user}`,
    embeds: [embed().setTitle(title).setDescription(`${interaction.user} möchte mit dir über deine Bewerbung sprechen, ${applicant}.`)],
    components: [controls(interaction.guildId, ticket)],
  });
  ticket.controlsMessageId = message.id;
  ticket.parentId = channel.parentId;
  ticketsOf(interaction.guildId)[channel.id] = ticket;
  save();
  await logActivity(interaction.guild, 'primary', `🎫 ${interaction.user} hat ${ticketRef(interaction.guildId, channel.id, ticket)} mit ${applicant} geöffnet.`);
  return channel;
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
    const time = m.createdAt.toLocaleString('de-DE', { timeZone: forGuild(channel.guild.id).timezone });
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
  if (ticket.claimedBy) activity.record(channel.guild.id, ticket.claimedBy, 'ticket'); // für den Rang-Aufstieg

  const { activities, transcripts } = settingsOf(channel.guild.id).logging;
  const transcript = transcripts ? await buildTranscript(channel) : null;
  const files = transcript ? [transcript] : [];
  const summary = embed('danger')
    .setTitle(`🎫 Ticket #${ticket.number} geschlossen`)
    .addFields(
      { name: 'Ersteller', value: `<@${ticket.owner}>`, inline: true },
      { name: 'Geschlossen von', value: closedBy ? `${closedBy}` : 'System', inline: true },
      { name: 'Kategorie', value: ticketLabel(channel.guild.id, ticket), inline: true },
      { name: 'Geöffnet', value: `<t:${Math.floor(ticket.openedAt / 1000)}:f>`, inline: true },
    );
  if (ticket.claimedBy) summary.addFields({ name: 'Bearbeitet von', value: `<@${ticket.claimedBy}>`, inline: true });
  if (reason) summary.addFields({ name: 'Grund', value: truncate(reason, 1024) });

  if (activities || transcripts) await sendTo(channel.guild, 'ticketLog', { embeds: [summary], files, allowedMentions: { parse: [] } });
  const owner = await channel.client.users.fetch(ticket.owner).catch(() => null);
  await owner
    ?.send({
      content: `Dein Ticket auf **${channel.guild.name}** wurde geschlossen.${reason ? `\n**Grund:** ${truncate(reason, 1500)}` : ''}${transcript ? '\nHier ist der Verlauf:' : ''}`,
      files,
    })
    .catch(() => {});

  await refreshPanels(channel.guild);
  setTimeout(() => channel.delete('Ticket geschlossen').catch(() => {}), 5000);
}

const closeFormOf = (guildId, ticket) => typeById(guildId, ticket.type)?.closeForm?.slice(0, 5) ?? [];

function closeError(interaction) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (!ticket) return 'Das hier ist kein Ticket-Kanal.';
  if (isTicketTeam(interaction.member, ticket)) return null;
  if (option(interaction.guildId, ticket, 'onlyTeamCanClose')) return 'Nur das Team kann Tickets schließen.';
  if (ticket.owner !== interaction.user.id) return 'Nur der Ersteller oder das Team kann das Ticket schließen.';
  return null;
}

// Schließen nur durch das Team: Der Ersteller bittet darum, ein Teammitglied stimmt zu (closeaccept) oder lehnt ab.
async function requestClose(interaction, ticket) {
  return interaction.reply({
    content: mentions(ticketTeamRoles(interaction.guildId, ticket)) || undefined,
    embeds: [embed('warning').setDescription(`🔒 ${interaction.user} möchte dieses Ticket schließen. Ein Teammitglied muss zustimmen.`)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:closeaccept').setLabel('Zustimmen').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket:closedeny').setLabel('Offen lassen').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: ['roles'] },
  });
}

// Formular beim Schließen (closeForm der Kategorie, max. 5 Felder).
function closeFormModal(fields) {
  return new ModalBuilder()
    .setCustomId('ticket:closeformmodal')
    .setTitle('Ticket schließen')
    .addComponents(
      fields.map((field, i) => {
        const input = new TextInputBuilder()
          .setCustomId(`f${i}`)
          .setLabel(field.label.slice(0, 45))
          .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(field.required !== false)
          .setMaxLength(Math.min(Math.max(field.maxLength || 500, 1), 4000));
        if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
        return new ActionRowBuilder().addComponents(input);
      }),
    );
}

// Schritt 1: Rückfrage (nur für den Klickenden sichtbar) oder, wenn nur das Team schließen darf, eine Schließungs-Anfrage.
async function closeFromInteraction(interaction) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (
    ticket &&
    ticket.owner === interaction.user.id &&
    !isTicketTeam(interaction.member, ticket) &&
    option(interaction.guildId, ticket, 'onlyTeamCanClose')
  ) {
    return requestClose(interaction, ticket);
  }
  const error = closeError(interaction);
  if (error) return replyPrivate(interaction, error);
  const buttons = closeFormOf(interaction.guildId, ticket).length
    ? [new ButtonBuilder().setCustomId('ticket:closeform').setLabel('Schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒')]
    : [
        new ButtonBuilder().setCustomId('ticket:closeyes').setLabel('Schließen').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket:closereason').setLabel('Mit Grund schließen').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
      ];
  return replyPrivate(interaction, {
    embeds: [embed('danger').setDescription('🔒 Möchtest du dieses Ticket wirklich schließen?')],
    components: [
      new ActionRowBuilder().addComponents(...buttons, new ButtonBuilder().setCustomId('ticket:closeno').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)),
    ],
  });
}

// Schritt 2: closeyes, closereason → closemodal, closeform → closeformmodal, closeno;
// bei einer Schließungs-Anfrage closeaccept (wie closeyes bzw. closeform) und closedeny.
async function confirmClose(interaction, action) {
  if (action === 'closeno') return interaction.update({ embeds: [embed().setDescription('Abgebrochen – das Ticket bleibt offen.')], components: [] });

  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if ((action === 'closeaccept' || action === 'closedeny') && ticket && !isTicketTeam(interaction.member, ticket)) {
    return replyPrivate(interaction, 'Nur das Team kann über diese Anfrage entscheiden.');
  }
  if (action === 'closedeny') {
    return interaction.update({
      content: null,
      embeds: [embed().setDescription(`🔓 ${interaction.user} hat die Anfrage abgelehnt – das Ticket bleibt offen.`)],
      components: [],
    });
  }

  const error = closeError(interaction);
  if (error) return interaction.update({ embeds: [embed('danger').setDescription(error)], components: [] });

  const form = closeFormOf(interaction.guildId, ticket);
  if (action === 'closeform' || (action === 'closeaccept' && form.length)) return interaction.showModal(closeFormModal(form));
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

  let reason = null;
  if (action === 'closemodal') reason = interaction.fields.getTextInputValue('reason');
  if (action === 'closeformmodal') {
    reason =
      form
        .map((field, i) => [field.label, interaction.fields.getTextInputValue(`f${i}`)?.trim()])
        .filter(([, answer]) => answer)
        .map(([label, answer]) => `**${label}:** ${answer}`)
        .join('\n') || null;
  }
  await interaction.update({ content: null, embeds: [embed('danger').setDescription('🔒 Wird geschlossen …')], components: [] });
  await interaction.channel.send({
    embeds: [embed('danger').setDescription(truncate(`🔒 Ticket wird von ${interaction.user} geschlossen …${reason ? `\n${action === 'closeformmodal' ? '' : '**Grund:** '}${reason}` : ''}`, 4096))],
  });
  await closeTicket(interaction.channel, interaction.user, reason);
}

// ---------- Übernehmen / Freigeben ----------

async function claim(interaction) {
  const ticket = ticketsOf(interaction.guildId)[interaction.channelId];
  if (!ticket) return replyPrivate(interaction, 'Das hier ist kein Ticket-Kanal.');
  if (!isTicketTeam(interaction.member, ticket)) return replyPrivate(interaction, 'Nur das Team kann Tickets übernehmen.');
  if (ticket.claimedBy) return replyPrivate(interaction, `Das Ticket wird bereits von <@${ticket.claimedBy}> bearbeitet.`);
  if (typeById(interaction.guildId, ticket.type)?.allowClaim === false) return replyPrivate(interaction, 'In dieser Kategorie können Tickets nicht übernommen werden.');

  ticket.claimedBy = interaction.user.id;
  ticket.claimerLastAt = Date.now();
  save();
  await interaction.update({ components: [controls(interaction.guildId, ticket)] });
  await interaction.followUp({ embeds: [embed('success').setDescription(`🙋 ${interaction.user} kümmert sich um dieses Ticket.`)] });
  await moveForClaim(interaction.channel, ticket, true);
  await logActivity(interaction.guild, 'success', `🙋 ${interaction.user} hat ${ticketRef(interaction.guildId, interaction.channelId, ticket)} übernommen.`);
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
  await interaction.update({ components: [controls(interaction.guildId, ticket)] });
  await interaction.followUp({ embeds: [embed('warning').setDescription(`↩️ ${interaction.user} hat das Ticket wieder freigegeben.`)] });
  await moveForClaim(interaction.channel, ticket, false);
  await logActivity(interaction.guild, 'warning', `↩️ ${interaction.user} hat ${ticketRef(interaction.guildId, interaction.channelId, ticket)} freigegeben.`);
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
    return logActivity(interaction.guild, 'primary', `➕ ${interaction.user} hat ${user} zu ${ticketRef(interaction.guildId, interaction.channelId, ticket)} hinzugefügt.`);
  }
  if (!settingsOf(interaction.guildId).creatorCanAddUsers || ticket.owner !== interaction.user.id) {
    return replyPrivate(interaction, 'Nur das Team kann Personen hinzufügen.');
  }
  await interaction.reply({
    content: mentions(ticketTeamRoles(interaction.guildId, ticket)) || undefined,
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
    `${accepted ? '➕' : '❌'} ${interaction.user} hat die Anfrage für <@${userId}> in ${ticketRef(interaction.guildId, interaction.channelId, ticket)} ${accepted ? 'bestätigt' : 'abgelehnt'}.`,
  );
}

// ---------- Hintergrund: Aktivität, Auto-Team-Alert, Auto-Unclaim ----------

function trackMessage(message) {
  const ticket = ticketsOf(message.guildId)[message.channelId];
  if (!ticket || message.author.bot) return;
  ticket.lastActivityAt = Date.now();
  if (message.author.id !== ticket.owner && message.member && isTicketTeam(message.member, ticket)) ticket.teamRepliedAt = Date.now();
  if (message.author.id === ticket.claimedBy) ticket.claimerLastAt = Date.now();
  save();
}

async function checkReminders(guild) {
  const { autoUnclaim, openingHours } = settingsOf(guild.id);
  if (!isOpen(openingHours)) return; // Außerhalb der Öffnungszeiten pausieren Erinnerungen und Auto-Close
  const now = Date.now();
  for (const [channelId, ticket] of Object.entries(openTickets(guild))) {
    const channel = guild.channels.cache.get(channelId);

    // Auto-Close: so lange hat niemand im Ticket geschrieben.
    const autoClose = option(guild.id, ticket, 'autoClose');
    if (autoClose?.enabled && now - (ticket.lastActivityAt ?? ticket.openedAt) >= autoClose.afterHours * 3_600_000) {
      const reason = `Automatisch geschlossen: ${autoClose.afterHours} Std. ohne Aktivität`;
      await channel.send({ embeds: [embed('danger').setDescription(`🔒 ${reason}.`)] }).catch(() => {});
      await closeTicket(channel, null, reason);
      continue;
    }

    const alert = option(guild.id, ticket, 'autoTeamAlert');
    if (alert?.enabled && !ticket.alerted && !ticket.teamRepliedAt && !ticket.claimedBy && now - ticket.openedAt >= alert.afterMinutes * 60_000) {
      ticket.alerted = true;
      save();
      const since = `<t:${Math.floor(ticket.openedAt / 1000)}:R>`;
      await channel
        .send({
          content: mentions(ticketTeamRoles(guild.id, ticket)) || undefined,
          embeds: [
            embed('warning').setDescription(
              alert.message ? fill(alert.message, { user: `<@${ticket.owner}>`, since }) : `⏰ Dieses Ticket wartet seit ${since} auf eine Antwort vom Team.`,
            ),
          ],
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
      await logActivity(guild, 'warning', `↩️ ${ticketRef(guild.id, channelId, ticket)} wurde automatisch freigegeben (<@${previous}> war inaktiv).`);
      await channel
        .send({
          content: mentions(ticketTeamRoles(guild.id, ticket)) || undefined,
          embeds: [embed('warning').setDescription(`↩️ <@${previous}> war ${autoUnclaim.afterHours} h inaktiv – das Ticket wurde automatisch freigegeben.`)],
          allowedMentions: { parse: ['roles'] },
        })
        .catch(() => {});
    }
  }
}

// Ersteller verlässt den Server: onCreatorLeave "nothing", "notify" (Hinweis) oder "close" (Hinweis als Grund, dann schließen).
async function handleCreatorLeave(member) {
  const tickets = openTickets(member.guild);
  for (const channelId of Object.keys(tickets).filter((id) => tickets[id].owner === member.id)) {
    const ticket = tickets[channelId];
    const mode = option(member.guild.id, ticket, 'onCreatorLeave');
    if (mode !== 'notify' && mode !== 'close') continue;
    const channel = member.guild.channels.cache.get(channelId);
    const text = fill(option(member.guild.id, ticket, 'leaveMessage') || '👋 {user} hat den Server verlassen.', {
      user: `${member}`,
      username: member.user.username,
    });
    await channel?.send({ embeds: [embed('warning').setDescription(text)], allowedMentions: { parse: [] } }).catch(() => {});
    if (mode === 'close') await closeTicket(channel, null, text);
  }
}

const lastOpenState = new Map(); // guildId → Team erreichbar?
function startTicketWatcher(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await checkReminders(guild).catch((err) => console.error('[ticketWatcher]', err));
      // Panels neu zeichnen, wenn sich der Öffnungsstatus ändert.
      const open = isOpen(settingsOf(guild.id).openingHours);
      if (lastOpenState.has(guild.id) && open !== lastOpenState.get(guild.id)) await refreshPanels(guild);
      lastOpenState.set(guild.id, open);
    }
  }, 60_000);
}

module.exports = {
  ticketsOf,
  openTickets,
  postPanel,
  refreshPanels,
  openTicket,
  openOnBehalf,
  openApplicationTicket,
  handleCreatorLeave,
  closeTicket,
  closeFromInteraction,
  confirmClose,
  claim,
  unclaim,
  requestAddUser,
  answerAddRequest,
  isTicketTeam,
  buildPanel,
  closeFormModal,
  logActivity,
  trackMessage,
  startTicketWatcher,
};
