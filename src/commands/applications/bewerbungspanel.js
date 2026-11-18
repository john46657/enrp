// /bewerbungspanel: Panels posten, anlegen, bearbeiten und löschen. Jedes Panel zeigt die Bewerbungsarten,
// die ihm zugeordnet sind (z. B. „Fraktionen“, „Server-Team“, „Einheiten“).
const {
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { bucket } = require('../../lib/db');
const admin = require('../../lib/applications/admin');
const autocomplete = require('../../lib/applications/autocomplete');
const { postPanel, refreshPanels, panelTypes } = require('../../lib/applications/messages');

const panelsOf = (guildId) => forGuild(guildId).applications.panels;

function panelModal(id, panel) {
  const input = (customId, value, style, max, required = false) => {
    const t = new TextInputBuilder().setCustomId(customId).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) t.setValue(String(value).slice(0, max));
    return t;
  };
  const channel = new ChannelSelectMenuBuilder().setCustomId('channel').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setRequired(false);
  if (panel.channel) channel.setDefaultChannels(panel.channel);
  return new ModalBuilder()
    .setCustomId(`apppanel:save:${id}`)
    .setTitle(truncate(`Panel ${id}`, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel('Titel').setTextInputComponent(input('title', panel.title, TextInputStyle.Short, 200, true)),
      new LabelBuilder().setLabel('Beschreibung').setDescription('Markdown erlaubt').setTextInputComponent(input('description', panel.description, TextInputStyle.Paragraph, 3000)),
      new LabelBuilder().setLabel('Bild-URL (optional)').setDescription('Banner unter dem Text, https://…').setTextInputComponent(input('image', panel.image, TextInputStyle.Short, 500)),
      new LabelBuilder().setLabel('Text im Auswahlmenü (optional)').setDescription('z. B. „Wofür möchtest du dich bewerben?“').setTextInputComponent(input('placeholder', panel.placeholder, TextInputStyle.Short, 150)),
      new LabelBuilder()
        .setLabel('Team-Kanal für neue Bewerbungen')
        .setDescription('Für alle Arten dieses Panels ohne eigenen Kanal')
        .setChannelSelectMenuComponent(channel),
    );
}

function listEmbed(guildId) {
  const posted = Object.values(bucket('appPanels', guildId));
  const result = embed().setTitle('🗂️ Bewerbungs-Panels').setDescription('Arten verschiebst du im Editor (`/bewerbungsart bearbeiten` → Kanäle & Panel).');
  for (const [id, panel] of Object.entries(panelsOf(guildId))) {
    const types = panelTypes(guildId, id);
    const count = posted.filter((p) => p.kind === id).length;
    result.addFields({
      name: truncate(`${panel.title} (${id})`, 256),
      value: truncate(
        `${types.map((t) => `${t.emoji ?? ''} ${t.name}`).join(', ') || '*keine Bewerbungsarten*'}\n` +
          `Team-Kanal: ${panel.channel ? `<#${panel.channel}>` : '—'} · Liste anzeigen: ${panel.showList ? 'ja' : 'nein'} · gepostet: ${count}×`,
        1024,
      ),
    });
  }
  return result;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungspanel')
    .setDescription('Bewerbungs-Panels posten und verwalten.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('posten')
        .setDescription('Postet ein Panel in diesem Kanal.')
        .addStringOption((o) => o.setName('panel').setDescription('Welches Panel? (Standard: das erste)').setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('erstellen')
        .setDescription('Neues Panel, z. B. für Fraktionen oder das Server-Team.')
        .addStringOption((o) => o.setName('id').setDescription('Eindeutige ID, z. B. fraktionen (a-z, 0-9, _ -)').setRequired(true).setMinLength(2).setMaxLength(24))
        .addStringOption((o) => o.setName('titel').setDescription('Überschrift, z. B. 🚓 Fraktionen').setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName('bearbeiten')
        .setDescription('Titel, Text, Bild und Team-Kanal eines Panels ändern.')
        .addStringOption((o) => o.setName('panel').setDescription('Welches Panel?').setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName('liste_anzeigen').setDescription('Arten mit Beschreibung im Panel auflisten? (ohne Angabe öffnet sich das Formular)')),
    )
    .addSubcommand((s) =>
      s
        .setName('loeschen')
        .setDescription('Löscht ein Panel.')
        .addStringOption((o) => o.setName('panel').setDescription('Welches Panel?').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('verschieben_nach').setDescription('Bewerbungsarten in dieses Panel verschieben').setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Alle Panels mit ihren Bewerbungsarten.')),

  autocomplete: autocomplete.respond,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const panels = panelsOf(guildId);
    try {
      if (sub === 'liste') return replyPrivate(interaction, { embeds: [listEmbed(guildId)] });

      if (sub === 'posten') {
        const id = interaction.options.getString('panel') ?? Object.keys(panels)[0];
        if (!panels[id]) return replyPrivate(interaction, `❌ Das Panel „${id}“ gibt es nicht. Übersicht: \`/bewerbungspanel liste\``);
        if (!interaction.channel?.isTextBased()) return replyPrivate(interaction, '❌ In diesem Kanal kann ich nichts posten.');
        await postPanel(interaction.channel, id);
        return replyPrivate(interaction, '✅ Panel gepostet. Es aktualisiert sich automatisch, wenn du Bewerbungsarten oder das Panel änderst.');
      }

      if (sub === 'erstellen') {
        const panel = admin.createPanel(guildId, { id: interaction.options.getString('id'), title: interaction.options.getString('titel') });
        const id = interaction.options.getString('id').trim().toLowerCase();
        return replyPrivate(
          interaction,
          `✅ Panel **${panel.title}** (\`${id}\`) angelegt.\n` +
            `Nächste Schritte: Bewerbungsarten zuordnen (\`/bewerbungsart erstellen panel:${id}\` oder im Editor unter „Kanäle & Panel“), ` +
            `Text und Team-Kanal mit \`/bewerbungspanel bearbeiten\`, dann \`/bewerbungspanel posten panel:${id}\`.`,
        );
      }

      const id = interaction.options.getString('panel');
      if (!panels[id]) return replyPrivate(interaction, `❌ Das Panel „${id}“ gibt es nicht.`);

      if (sub === 'bearbeiten') {
        const showList = interaction.options.getBoolean('liste_anzeigen');
        if (showList === null) return interaction.showModal(panelModal(id, panels[id]));
        admin.updatePanel(guildId, id, (p) => ({ ...p, showList }));
        await replyPrivate(interaction, `✅ Liste im Panel: ${showList ? 'an' : 'aus'}.`);
        return refreshPanels(interaction.guild);
      }

      if (sub === 'loeschen') {
        const moved = admin.deletePanel(guildId, id, interaction.options.getString('verschieben_nach'));
        await replyPrivate(interaction, `🗑️ Panel \`${id}\` gelöscht.${moved ? ` ${moved} Bewerbungsart(en) verschoben.` : ''} Bereits gepostete Nachrichten dieses Panels kannst du löschen.`);
        return refreshPanels(interaction.guild);
      }
    } catch (err) {
      if (err instanceof admin.EditError) return replyPrivate(interaction, `❌ ${err.message}`);
      throw err;
    }
  },

  components: {
    async apppanel(interaction, [action, id]) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return replyPrivate(interaction, 'Dafür brauchst du die Berechtigung „Server verwalten“.');
      if (action !== 'save') return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
      try {
        const field = (name) => interaction.fields.getTextInputValue(name)?.trim() ?? '';
        admin.updatePanel(interaction.guildId, id, (p) => ({
          ...p,
          title: field('title'),
          description: field('description'),
          image: field('image'),
          placeholder: field('placeholder'),
          channel: interaction.fields.getSelectedChannels('channel', false)?.first()?.id ?? '',
        }));
      } catch (err) {
        if (err instanceof admin.EditError) return replyPrivate(interaction, `❌ ${err.message}`);
        throw err;
      }
      await replyPrivate(interaction, { content: '✅ Panel gespeichert. Gepostete Panels werden aktualisiert.', embeds: [listEmbed(interaction.guildId)] });
      return refreshPanels(interaction.guild);
    },
  },

  panelModal,
};
