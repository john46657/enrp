// Vorschläge (suggestions in config.json): Mitglieder reichen mit /vorschlag Ideen ein, die Community stimmt ab,
// das Team nimmt an, lehnt ab oder setzt „In Bearbeitung“. Daten: data/db.json unter suggestions.<guildId>.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { forGuild } = require('./settings');
const { bucket, save, nextNumber } = require('./db');
const { getChannel, replyPrivate, truncate } = require('./util');

const settingsOf = (guildId) => forGuild(guildId).suggestions;
const suggestionsOf = (guildId) => bucket('suggestions', guildId); // Nachrichten-ID → Vorschlag
const activeCategories = (guildId) => settingsOf(guildId).categories.filter((c) => c.enabled !== false);
const isTeam = (member) => member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild) || settingsOf(member.guild.id).teamRoles.some((id) => member.roles.cache.has(id));

const STATUS = {
  open: ['🗳️ Offen', '#2F7BFF'],
  progress: ['🛠️ In Bearbeitung', '#EAB308'],
  accepted: ['✅ Angenommen', '#22C55E'],
  done: ['🏁 Fertiggestellt', '#22C55E'],
  denied: ['❌ Abgelehnt', '#EF4444'],
};

function suggestionEmbed(s, author) {
  const [label, color] = STATUS[s.status];
  const up = Object.keys(s.up).length;
  const down = Object.keys(s.down).length;
  const total = up + down;
  const result = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${s.emoji ?? '💡'} Vorschlag #${s.number}${s.category ? ` · ${s.category}` : ''}`)
    .setDescription(truncate(s.fields.map(([q, a]) => `**${q}**\n${a || '—'}`).join('\n\n'), 4000))
    .addFields(
      { name: 'Status', value: label, inline: true },
      { name: 'Stimmen', value: `👍 ${up} · 👎 ${down}${total ? ` (${Math.round((up / total) * 100)} % dafür)` : ''}`, inline: true },
    )
    .setTimestamp(s.createdAt);
  if (author) result.setAuthor({ name: author.username, iconURL: author.displayAvatarURL() });
  if (s.reason) result.addFields({ name: s.status === 'denied' ? 'Grund der Ablehnung' : 'Begründung', value: truncate(s.reason, 1024) });
  if (s.by) result.addFields({ name: 'Bearbeitet von', value: `<@${s.by}>`, inline: true });
  return result;
}

function suggestionButtons(guildId, s) {
  const cfg = settingsOf(guildId);
  const votes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('suggest:up').setEmoji('👍').setStyle(ButtonStyle.Secondary).setDisabled(s.status !== 'open'),
    new ButtonBuilder().setCustomId('suggest:down').setEmoji('👎').setStyle(ButtonStyle.Secondary).setDisabled(s.status !== 'open'),
  );
  if (s.status === 'progress') return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('suggest:done').setLabel('Fertiggestellt').setStyle(ButtonStyle.Success))];
  if (s.status !== 'open') return [];
  const team = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('suggest:accept').setLabel('Annehmen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('suggest:deny').setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
    ...(cfg.inProgress ? [new ButtonBuilder().setCustomId('suggest:progress').setLabel('In Bearbeitung').setStyle(ButtonStyle.Primary)] : []),
    new ButtonBuilder().setCustomId('suggest:reset').setLabel('Stimmen zurücksetzen').setStyle(ButtonStyle.Secondary),
  );
  return [votes, team];
}

async function refresh(message, s) {
  const author = await message.client.users.fetch(s.authorId).catch(() => null);
  await message.edit({ embeds: [suggestionEmbed(s, author)], components: suggestionButtons(message.guildId, s) }).catch((err) => console.error('[suggestion]', err.message));
}

// ---------- Einreichen ----------

function formModal(category) {
  return new ModalBuilder()
    .setCustomId(`suggest:submit:${category.id}`)
    .setTitle(`Vorschlag: ${category.name}`.slice(0, 45))
    .addComponents(
      category.fields.slice(0, 5).map((f, i) =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`f${i}`)
            .setLabel(f.label.slice(0, 45))
            .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(f.required !== false)
            .setMaxLength(Math.min(Math.max(f.maxLength || 1000, 1), 4000)),
        ),
      ),
    );
}

// /vorschlag: bei nur einer aktiven Kategorie direkt das Formular, sonst erst die Auswahl.
async function startSuggestion(interaction) {
  const cfg = settingsOf(interaction.guildId);
  if (!cfg.enabled || !cfg.channel) return replyPrivate(interaction, 'Vorschläge sind auf diesem Server gerade nicht aktiv.');
  const categories = activeCategories(interaction.guildId).filter((c) => c.fields?.length);
  if (!categories.length) return replyPrivate(interaction, 'Es gibt noch keine Vorschlags-Kategorie.');
  if (categories.length === 1) return interaction.showModal(formModal(categories[0]));
  return replyPrivate(interaction, {
    content: 'Worum geht es?',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('suggest:category')
          .setPlaceholder('Kategorie wählen …')
          .addOptions(categories.slice(0, 25).map((c) => ({ label: c.name.slice(0, 100), value: c.id, emoji: c.emoji || undefined, description: c.description?.slice(0, 100) || undefined }))),
      ),
    ],
  });
}

async function submit(interaction, categoryId) {
  const cfg = settingsOf(interaction.guildId);
  const category = cfg.categories.find((c) => c.id === categoryId);
  const channel = await getChannel(interaction.guild, cfg.channel);
  if (!category || !channel?.isTextBased()) return replyPrivate(interaction, 'Vorschläge sind gerade nicht möglich.');
  const s = {
    number: nextNumber('suggestion', interaction.guildId),
    authorId: interaction.user.id,
    category: category.name,
    emoji: category.emoji,
    fields: category.fields.slice(0, 5).map((f, i) => [f.label, interaction.fields.getTextInputValue(`f${i}`)?.trim()]),
    up: {},
    down: {},
    status: 'open',
    createdAt: Date.now(),
  };
  const message = await channel.send({ embeds: [suggestionEmbed(s, interaction.user)], components: suggestionButtons(interaction.guildId, s) });
  suggestionsOf(interaction.guildId)[message.id] = s;
  save();
  if (cfg.threads) await message.startThread({ name: `Vorschlag #${s.number}`.slice(0, 100), autoArchiveDuration: 10080 }).catch((err) => console.error('[suggestionThread]', err.message));
  return replyPrivate(interaction, `✅ Dein Vorschlag #${s.number} wurde eingereicht: ${message.url}`);
}

// ---------- Abstimmen & Entscheiden ----------

async function vote(interaction, up) {
  const s = suggestionsOf(interaction.guildId)[interaction.message.id];
  if (!s || s.status !== 'open') return replyPrivate(interaction, 'Über diesen Vorschlag kann nicht mehr abgestimmt werden.');
  const id = interaction.user.id;
  const [mine, other] = up ? [s.up, s.down] : [s.down, s.up];
  if (mine[id]) delete mine[id];
  else {
    mine[id] = true;
    delete other[id];
  }
  save();
  await interaction.deferUpdate();
  await refresh(interaction.message, s);
}

function reasonModal(action, required) {
  return new ModalBuilder()
    .setCustomId(`suggest:${action}modal`)
    .setTitle(action === 'accept' ? 'Vorschlag annehmen' : 'Vorschlag ablehnen')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Grund').setStyle(TextInputStyle.Paragraph).setRequired(required).setMaxLength(1000)));
}

async function decide(interaction, action) {
  const s = suggestionsOf(interaction.guildId)[interaction.message.id];
  if (!s) return replyPrivate(interaction, 'Dieser Vorschlag ist nicht mehr gespeichert.');
  if (!isTeam(interaction.member)) return replyPrivate(interaction, 'Nur das Team kann Vorschläge bearbeiten.');
  const cfg = settingsOf(interaction.guildId);

  if (action === 'accept' || action === 'deny') return interaction.showModal(reasonModal(action, action === 'accept' ? cfg.requireAcceptReason : cfg.requireDenyReason));
  if (action === 'reset') {
    s.up = {};
    s.down = {};
  } else if (action === 'progress') s.status = 'progress';
  else if (action === 'done') s.status = 'done';
  else if (action === 'acceptmodal' || action === 'denymodal') {
    s.status = action === 'acceptmodal' ? 'accepted' : 'denied';
    s.reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
  }
  if (action !== 'reset') s.by = interaction.user.id;
  save();
  await interaction.deferUpdate();
  await refresh(interaction.message, s);

  if (s.status === 'accepted' && action === 'acceptmodal') {
    if (cfg.dmOnAccept) {
      const author = await interaction.client.users.fetch(s.authorId).catch(() => null);
      await author?.send(`✅ Dein Vorschlag #${s.number} auf **${interaction.guild.name}** wurde angenommen!${s.reason ? `\n**Begründung:** ${s.reason}` : ''}\n${interaction.message.url}`).catch(() => {});
    }
    const log = await getChannel(interaction.guild, cfg.acceptedChannel);
    if (log?.isTextBased()) {
      const author = await interaction.client.users.fetch(s.authorId).catch(() => null);
      await log.send({ embeds: [suggestionEmbed(s, author).setURL(interaction.message.url)] }).catch(() => {});
    }
  }
}

module.exports = { startSuggestion, submit, vote, decide, formModal, suggestionEmbed, suggestionsOf, activeCategories };
