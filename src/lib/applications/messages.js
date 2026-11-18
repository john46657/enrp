// Aufbau von Panels und Team-Nachrichten der Bewerbungen.
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { base, forGuild } = require('../settings');
const { embed, truncate } = require('../util');
const { bucket, save } = require('../db');
const store = require('./store');
const { AI_ICONS } = require('./aiCheck');
const { profileUrl } = require('./roblox');

const STATUS_COLORS = { ACCEPTED: 'success', REJECTED: 'danger', WITHDRAWN: '#99AAB5', SUBMITTED: 'primary', OPEN: 'primary' };
// Eigene Prüfschritte sind gelb.
const statusColor = (status) => STATUS_COLORS[status] ?? 'warning';
const unix = (ms) => Math.floor(ms / 1000);

// ---------- Panels ----------

const panelsOf = (guildId) => forGuild(guildId).applications.panels;

function panelTypes(guildId, panelId) {
  return store.types(guildId).filter((t) => t.panel === panelId);
}

function buildPanel(guildId, panelId) {
  const panel = panelsOf(guildId)[panelId];
  if (!panel) {
    return {
      components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('*Dieses Bewerbungs-Panel wurde gelöscht.*'))],
      flags: MessageFlags.IsComponentsV2,
    };
  }
  const list = panelTypes(guildId, panelId);
  const container = new ContainerBuilder()
    .setAccentColor(parseInt(base.colors.primary.slice(1), 16))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(`## ${panel.title}${panel.description ? `\n${panel.description}` : ''}`, 4000)));

  if (list.length > 1 || (panel.showList && list.length) || !list.length) {
    container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        list.length
          ? truncate(list.map((t) => `- ${t.emoji ? `[${t.emoji}] ` : ''}**${t.name}**${t.enabled ? '' : ' *(geschlossen)*'}${t.description ? `\n${t.description}` : ''}`).join('\n\n'), 3500)
          : '*Derzeit gibt es hier keine Bewerbungen.*',
      ),
    );
  }
  if (panel.image) {
    container.addSeparatorComponents(new SeparatorBuilder()).addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(panel.image)));
  }

  const components = [container];
  if (list.length === 1) {
    const button = new ButtonBuilder().setCustomId(`quali:apply:${list[0].id}`).setLabel('Jetzt bewerben').setStyle(ButtonStyle.Primary);
    if (list[0].emoji) button.setEmoji(list[0].emoji);
    components.push(new ActionRowBuilder().addComponents(button));
  } else if (list.length > 1) {
    components.push(new ActionRowBuilder().addComponents(typeSelect('quali:pick', list, panel.placeholder || 'Wofür möchtest du dich bewerben?')));
  }
  return { components, flags: MessageFlags.IsComponentsV2 };
}

// Auswahlmenü mit Bewerbungsarten (Panel und /bewerbung ohne Angabe).
function typeSelect(customId, list, placeholder) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(truncate(placeholder, 150))
    .addOptions(
      list.slice(0, 25).map((t) => ({
        label: truncate(t.name, 100),
        value: t.id,
        description: truncate(t.description || (t.enabled ? t.name : 'geschlossen'), 100),
        ...(t.emoji ? { emoji: t.emoji } : {}),
      })),
    );
}

async function postPanel(channel, panelId) {
  const message = await channel.send(buildPanel(channel.guild.id, panelId));
  bucket('appPanels', channel.guild.id)[message.id] = { channelId: channel.id, kind: panelId };
  save();
  return message;
}

async function refreshPanels(guild) {
  const panels = bucket('appPanels', guild.id);
  for (const [messageId, { channelId, kind }] of Object.entries(panels)) {
    const message = await guild.channels.cache.get(channelId)?.messages.fetch(messageId).catch(() => null);
    if (!message) {
      delete panels[messageId];
      save();
      continue;
    }
    await message.edit(buildPanel(guild.id, kind)).catch((err) => console.error('[appPanel]', err.message));
  }
}

// ---------- Team-Nachricht ----------

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.` : `${minutes} Min. ${seconds} Sek.`;
}

function infoEmbed(record, type) {
  const color = statusColor(record.status);
  const status = [`**${store.statusLabel(record.status, type)}**`];
  if (record.decidedBy) status.push(`von <@${record.decidedBy}> <t:${unix(record.decidedAt)}:R>`);

  const info = embed(color)
    .setTitle(`${type.emoji ? `${type.emoji} ` : ''}${type.name} – ${record.number}`)
    .setAuthor({ name: record.userTag, iconURL: record.avatarUrl ?? undefined })
    .setFooter({ text: `${base.serverName} · ${record.number}` })
    .setTimestamp(record.createdAt)
    .addFields({ name: 'Status', value: status.join(' ') });
  if (record.reason) info.addFields({ name: 'Grund', value: truncate(record.reason, 1024) });

  const applicant = [`<@${record.userId}> · \`${record.userId}\``];
  if (record.roblox) applicant.push(`Roblox: [${record.roblox.name}](${profileUrl(record.roblox.id)}) (ID ${record.roblox.id})`);
  if (record.joinedAt) applicant.push(`Auf dem Server seit <t:${unix(record.joinedAt)}:R>`);
  if (record.accountCreatedAt) applicant.push(`Discord-Konto seit <t:${unix(record.accountCreatedAt)}:R>`);
  applicant.push(`Dauer: ${formatDuration(record.durationMs ?? 0)}`);
  info.addFields({ name: 'Bewerber', value: applicant.join('\n') });

  if (record.ai) {
    const reasons = record.ai.reasons.length ? `\n${record.ai.reasons.join(' · ')}` : '';
    info.addFields({ name: 'KI-Checker', value: truncate(`${AI_ICONS[record.ai.level]} Verdacht **${record.ai.level}**${reasons}`, 1024), inline: true });
  }
  if (record.roleSelections?.length) {
    info.addFields({ name: 'Rollen bei Annahme', value: record.roleSelections.map((id) => `<@&${id}>`).join(' '), inline: true });
  }
  return info;
}

// Zeichen, die Discord für das 6000er-Limit aller Embeds einer Nachricht zählt.
function embedChars(e) {
  const json = e.toJSON();
  return (
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text?.length ?? 0) +
    (json.author?.name?.length ?? 0) +
    (json.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

// Antworten auf Embeds verteilen (max. 25 Felder je Embed). Reicht der Platz nicht, werden erst die
// Antworten und dann die Fragen gekürzt; die vollständigen Antworten hängen dann als Datei an.
function answerEmbeds(record, budget) {
  const flagged = new Set(record.ai?.flagged ?? []);
  const items = record.answers.map((a, i) => ({ name: `${i + 1}. ${flagged.has(a.question) ? '⚠️ ' : ''}${a.question}`, value: a.answer || '—' }));
  let nameLimit = 256;
  let valueLimit = 1024;
  const size = () => items.reduce((sum, f) => sum + Math.min(f.name.length, nameLimit) + Math.min(f.value.length, valueLimit), 0);
  while (size() > budget && (valueLimit > 20 || nameLimit > 20)) {
    if (valueLimit > 20) valueLimit = Math.max(20, Math.floor(valueLimit * 0.85));
    if (size() > budget && nameLimit > 20) nameLimit = Math.max(20, Math.floor(nameLimit * 0.85));
  }

  const truncated = items.some((f) => f.name.length > nameLimit || f.value.length > valueLimit);
  const embeds = [];
  for (let i = 0; i < items.length; i += 25) {
    embeds.push(
      embed(statusColor(record.status))
        .setFooter(null)
        .setTimestamp(null)
        .addFields(items.slice(i, i + 25).map((f) => ({ name: truncate(f.name, nameLimit), value: truncate(f.value, valueLimit) }))),
    );
  }
  return { embeds, truncated };
}

function answersFile(record, type) {
  const lines = [
    `${type.name} – ${record.number}`,
    `Bewerber: ${record.userTag} (${record.userId})`,
    record.roblox ? `Roblox: ${record.roblox.name} (ID ${record.roblox.id})` : null,
    `Eingereicht: ${new Date(record.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
    `Status: ${store.statusLabel(record.status, type)}${record.reason ? ` – Grund: ${record.reason}` : ''}`,
    record.ai ? `KI-Checker: ${record.ai.level}${record.ai.reasons.length ? ` (${record.ai.reasons.join('; ')})` : ''}` : null,
    '',
    ...record.answers.flatMap((a, i) => [`${i + 1}. ${a.question}`, a.answer || '—', '']),
  ].filter((l) => l !== null);
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `bewerbung-${record.number}.txt` });
}

function teamComponents(record, type) {
  const open = store.isOpenStatus(record.status);
  const rows = [];
  if (open) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`quali:decide:${record.number}:accept`).setLabel('Annehmen').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`quali:decide:${record.number}:reject`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setEmoji('❌'),
        new ButtonBuilder().setCustomId(`quali:reason:${record.number}:accept`).setLabel('Annehmen mit Grund').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`quali:reason:${record.number}:reject`).setLabel('Ablehnen mit Grund').setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`quali:history:${record.userId}`).setLabel('Verlauf').setStyle(ButtonStyle.Secondary).setEmoji('📜'),
      new ButtonBuilder().setCustomId(`quali:ticket:${record.number}`).setLabel('Ticket mit Bewerber öffnen').setStyle(ButtonStyle.Secondary).setEmoji('🎫'),
    ),
  );
  // Status-Menü: Prüfschritte der Art (falls eingerichtet) und Zurückziehen
  const next = store.nextStatuses(record, type);
  if (open && next.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`quali:status:${record.number}`)
          .setPlaceholder(truncate(`Status: ${store.statusLabel(record.status, type)} – ändern …`, 150))
          .addOptions(next.map((s) => ({ label: s === 'WITHDRAWN' ? 'Zurückziehen' : truncate(store.statusLabel(s, type), 100), value: s }))),
      ),
    );
  }
  return rows;
}

// withFile: beim ersten Senden die vollständigen Antworten anhängen, falls etwas gekürzt wurde.
function buildTeamMessage(record, type, { withFile = false, components = true } = {}) {
  const info = infoEmbed(record, type);
  const { embeds, truncated } = answerEmbeds(record, 5900 - embedChars(info));
  const message = { embeds: [info, ...embeds], components: components ? teamComponents(record, type) : [], allowedMentions: { parse: [] } };
  if (withFile && truncated) message.files = [answersFile(record, type)];
  return message;
}

module.exports = { buildPanel, typeSelect, postPanel, refreshPanels, panelTypes, buildTeamMessage, answersFile, formatDuration };
