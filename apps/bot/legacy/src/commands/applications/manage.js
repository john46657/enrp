// /bewerbung-verwalten: Bewerbungen und ihre Fragen selbst in Discord anlegen – es gibt keine vorgefertigten.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const store = require('../../lib/applications/store');
const manage = require('../../lib/applications/manage');
const { QUESTION_TYPES } = require('../../lib/applications/forms');
const { refreshPanels } = require('../../lib/applications/messages');
const dashboard = require('../../lib/applications/discordOverview');
const settings = require('../../lib/settings');
const { parseLocalDate } = require('../../lib/time');

const { describeQuestion, typeLine } = dashboard;

const WORKFLOWS = { simple: 'Einfach (offen → angenommen/abgelehnt)', police: 'Mehrstufig (Prüfung → Gespräch → Entscheidung)' };
const MESSAGES = {
  start: 'Startnachricht (DM)',
  finish: 'Nach dem Einreichen',
  accept: 'Bei Annahme',
  reject: 'Bei Ablehnung',
};

const artOption = (o) => o.setName('art').setDescription('Welche Bewerbung?').setRequired(true).setAutocomplete(true);
const numberOption = (o, name = 'nummer', description = 'Nummer der Frage (siehe /bewerbung-verwalten fragen)') =>
  o.setName(name).setDescription(description).setRequired(true).setMinValue(1).setMaxValue(manage.MAX_QUESTIONS);

// Gemeinsame Optionen von „erstellen“ und „bearbeiten“
function typeOptions(s, { nameRequired }) {
  return s
    .addStringOption((o) => o.setName('name').setDescription('z. B. Polizei-Bewerbung, SEK, Sanitäter').setMaxLength(80).setRequired(nameRequired))
    .addStringOption((o) => o.setName('emoji').setDescription('z. B. 👮').setMaxLength(64))
    .addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel (- = leeren)').setMaxLength(500))
    .addStringOption((o) =>
      o
        .setName('ablauf')
        .setDescription('Statusablauf (Standard: einfach)')
        .addChoices(...Object.entries(WORKFLOWS).map(([value, name]) => ({ name, value }))),
    )
    .addStringOption((o) => o.setName('kuerzel').setDescription('Kürzel der Nummer, z. B. POL → POL-0001 (1–6 Zeichen A-Z, 0-9)').setMaxLength(6));
}

// Gemeinsame Optionen von „frage-hinzufuegen“ und „frage-bearbeiten“
function questionOptions(s, { typeRequired }) {
  return s
    .addStringOption((o) =>
      o
        .setName('typ')
        .setDescription('Art der Antwort')
        .setRequired(typeRequired)
        .addChoices(
          { name: 'Freitext', value: 'TEXT' },
          { name: 'Auswahl (eigene Antworten)', value: 'CHOICE' },
          { name: 'Rollen-Auswahl (Rollen gibt es bei Annahme)', value: 'ROLE' },
          { name: 'Roblox-Benutzername (wird geprüft)', value: 'ROBLOX' },
        ),
    )
    .addStringOption((o) => o.setName('frage').setDescription('Die Frage, z. B. Warum möchtest du zu uns?').setMaxLength(250).setRequired(typeRequired))
    .addStringOption((o) => o.setName('hinweis').setDescription('Zusatztext unter der Frage (- = leeren)').setMaxLength(500))
    .addBooleanOption((o) => o.setName('pflicht').setDescription('Muss beantwortet werden? (Standard: ja)'))
    .addIntegerOption((o) => o.setName('min_zeichen').setDescription('Freitext: Mindestlänge (0 = keine)').setMinValue(0).setMaxValue(5000))
    .addIntegerOption((o) => o.setName('max_zeichen').setDescription('Freitext: Höchstlänge (Standard 1000)').setMinValue(1).setMaxValue(5000))
    .addStringOption((o) =>
      o.setName('optionen').setDescription('Auswahl: Antworten mit ; trennen · Rollen-Auswahl: @Rolle1; @Rolle2').setMaxLength(2000),
    )
    .addBooleanOption((o) => o.setName('mehrfach').setDescription('Auswahl: mehrere Antworten erlaubt?'));
}

const builder = new SlashCommandBuilder()
  .setName('bewerbung-verwalten')
  .setDescription('Eigene Bewerbungen und Fragen anlegen, ändern und löschen.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('uebersicht').setDescription('Übersicht mit Buttons: Bewerbungen, Fragen und Panels verwalten.'))
  .addSubcommand((s) => typeOptions(s.setName('erstellen').setDescription('Legt eine neue Bewerbung an (danach Fragen hinzufügen).'), { nameRequired: true }))
  .addSubcommand((s) =>
    typeOptions(s.setName('bearbeiten').setDescription('Name, Emoji, Beschreibung, Ablauf oder Kürzel ändern.').addStringOption(artOption), {
      nameRequired: false,
    }),
  )
  .addSubcommand((s) =>
    s
      .setName('loeschen')
      .setDescription('Löscht eine Bewerbung. Alte Bewerbungen bleiben lesbar.')
      .addStringOption(artOption)
      .addBooleanOption((o) => o.setName('bestaetigen').setDescription('Wirklich löschen?').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('texte').setDescription('Texte der DMs (Start, Einreichen, Annahme, Ablehnung) ändern.').addStringOption(artOption))
  .addSubcommand((s) => s.setName('fragen').setDescription('Zeigt alle Fragen einer Bewerbung.').addStringOption(artOption))
  .addSubcommand((s) =>
    questionOptions(s.setName('frage-hinzufuegen').setDescription('Fügt eine Frage hinzu.').addStringOption(artOption), { typeRequired: true }).addIntegerOption((o) =>
      o.setName('position').setDescription('An welche Stelle? (Standard: ans Ende)').setMinValue(1).setMaxValue(manage.MAX_QUESTIONS),
    ),
  )
  .addSubcommand((s) =>
    questionOptions(s.setName('frage-bearbeiten').setDescription('Ändert eine Frage (nur angegebene Optionen).').addStringOption(artOption).addIntegerOption((o) => numberOption(o)), {
      typeRequired: false,
    }),
  )
  .addSubcommand((s) =>
    s
      .setName('frage-entfernen')
      .setDescription('Entfernt eine Frage.')
      .addStringOption(artOption)
      .addIntegerOption((o) => numberOption(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('frage-verschieben')
      .setDescription('Verschiebt eine Frage an eine andere Stelle.')
      .addStringOption(artOption)
      .addIntegerOption((o) => numberOption(o))
      .addIntegerOption((o) => numberOption(o, 'position', 'Neue Stelle')),
  )
  .addSubcommand((s) =>
    s
      .setName('phase')
      .setDescription('Bewerbungsphase: automatisch öffnen/schließen und Plätze begrenzen (- = leeren).')
      .addStringOption(artOption)
      .addStringOption((o) => o.setName('oeffnet').setDescription('z. B. 24.12.2026 18:00 (Zeitzone des Servers)'))
      .addStringOption((o) => o.setName('schliesst').setDescription('z. B. 31.12.2026 23:59 (Zeitzone des Servers)'))
      .addIntegerOption((o) => o.setName('plaetze').setDescription('Höchstzahl Bewerbungen in dieser Phase (0 = unbegrenzt)').setMinValue(0).setMaxValue(10_000)),
  )
  .addSubcommand((s) =>
    s
      .setName('dienstnummer')
      .setDescription('Dienstnummer-Automatik bei Annahme einstellen.')
      .addStringOption(artOption)
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Bei Annahme automatisch eine Dienstnummer vergeben?'))
      .addStringOption((o) => o.setName('format').setDescription('z. B. PD-{n} ({n} = Nummer)').setMaxLength(20))
      .addIntegerOption((o) => o.setName('stellen').setDescription('Stellen der Nummer, z. B. 2 → 07').setMinValue(1).setMaxValue(6))
      .addIntegerOption((o) => o.setName('start').setDescription('Erste Nummer').setMinValue(0).setMaxValue(999_999))
      .addIntegerOption((o) => o.setName('ende').setDescription('Letzte Nummer (0 = offen)').setMinValue(0).setMaxValue(999_999))
      .addStringOption((o) => o.setName('nickname').setDescription('z. B. [{serviceNumber}] {name} (- = Nickname nicht ändern)').setMaxLength(60))
      .addBooleanOption((o) => o.setName('freigeben_bei_verlassen').setDescription('Nummer wieder freigeben, wenn die Person den Server verlässt?')),
  );

// Bewerbungsphase und Dienstnummern: Werte einer Bewerbungsart setzen (gleicher Speicherort wie das Dashboard).
function saveTypeFields(guildId, typeId, changes) {
  for (const [key, value] of Object.entries(changes)) settings.set(guildId, `applications.types.${typeId}.${key}`, value);
}

function phaseChanges(interaction, type) {
  const o = interaction.options;
  const timezone = settings.forGuild(interaction.guildId).timezone || 'Europe/Berlin';
  const changes = {};
  for (const [option, key] of [
    ['oeffnet', 'opensAt'],
    ['schliesst', 'closesAt'],
  ]) {
    const raw = o.getString(option);
    if (raw !== null) changes[`phase.${key}`] = raw.trim() === '-' || !raw.trim() ? null : parseLocalDate(raw, timezone);
  }
  if (o.getInteger('plaetze') !== null) changes['phase.maxApplications'] = o.getInteger('plaetze');
  if (!Object.keys(changes).length) throw new Error('Du hast keine Option angegeben – es wurde nichts geändert.');
  const opens = 'phase.opensAt' in changes ? changes['phase.opensAt'] : store.toMs(type.phase?.opensAt);
  const closes = 'phase.closesAt' in changes ? changes['phase.closesAt'] : store.toMs(type.phase?.closesAt);
  if (opens && closes && closes <= opens) throw new Error('Die Phase muss nach dem Öffnen schließen.');
  return changes;
}

function serviceNumberChanges(interaction, type) {
  const o = interaction.options;
  const changes = {};
  for (const [option, key, getter, transform = (v) => v] of [
    ['aktiv', 'enabled', 'getBoolean'],
    ['format', 'format', 'getString', (v) => v.trim()],
    ['stellen', 'digits', 'getInteger'],
    ['start', 'start', 'getInteger'],
    ['ende', 'end', 'getInteger'],
    ['nickname', 'nickname', 'getString', (v) => (v.trim() === '-' ? '' : v.trim())],
    ['freigeben_bei_verlassen', 'releaseOnLeave', 'getBoolean'],
  ]) {
    const raw = o[getter](option);
    if (raw !== null) changes[`serviceNumber.${key}`] = transform(raw);
  }
  if (!Object.keys(changes).length) throw new Error('Du hast keine Option angegeben – es wurde nichts geändert.');
  const next = { ...type.serviceNumber, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k.split('.')[1], v])) };
  if (next.end > 0 && next.end < next.start) throw new Error('Die letzte Nummer ist kleiner als die erste.');
  return changes;
}

function phaseText(guildId, type) {
  const phase = store.phaseOf(guildId, type);
  const when = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:f>` : '—');
  const states = { open: '🟢 offen', disabled: '⚪ ausgeschaltet', before: '🕒 öffnet bald', after: '🔴 geschlossen', full: '🟠 alle Plätze vergeben' };
  return `${states[phase.state]} · Öffnet: ${when(phase.opensAt)} · Schließt: ${when(phase.closesAt)} · Plätze: ${phase.max ? `${phase.used}/${phase.max}` : 'unbegrenzt'}`;
}

// ---------- Eingaben umwandeln ----------

// "Täglich; Mehrmals pro Woche" → [{ label }] · "@Streife; @Verkehr" → [{ label, roleId }]
function parseOptions(text, type, guild) {
  if (type === 'ROLE') {
    const ids = [...new Set([...text.matchAll(/<@&(\d+)>|(\d{17,20})/g)].map((m) => m[1] ?? m[2]))];
    if (!ids.length) throw new Error('Gib bei `optionen` Rollen an, z. B. `@Streife; @Verkehr`.');
    return ids.map((id) => {
      const role = guild.roles.cache.get(id);
      if (!role) throw new Error(`Die Rolle ${id} gibt es auf diesem Server nicht.`);
      return { label: truncate(role.name, 100), roleId: id };
    });
  }
  const labels = text
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (labels.some((l) => l.length > 100)) throw new Error('Eine Antwort darf höchstens 100 Zeichen lang sein.');
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw new Error('Jede Antwort darf nur einmal vorkommen.');
  if (labels.length > 25) throw new Error('Höchstens 25 Antworten.');
  return labels.map((label) => ({ label }));
}

function questionFields(interaction, current) {
  const o = interaction.options;
  const type = o.getString('typ') ?? current?.type;
  const fields = {
    type: o.getString('typ') ?? undefined,
    label: o.getString('frage')?.trim() || undefined,
    required: o.getBoolean('pflicht') ?? undefined,
    multiple: o.getBoolean('mehrfach') ?? undefined,
  };
  const hint = o.getString('hinweis');
  if (hint !== null) fields.description = hint.trim() === '-' ? '' : hint.trim();
  const min = o.getInteger('min_zeichen');
  if (min !== null) fields.min = min; // 0 = keine Mindestlänge
  const max = o.getInteger('max_zeichen');
  if (max !== null) fields.max = max;
  if (!current && type === 'TEXT' && fields.max === undefined) fields.max = 1000;
  const options = o.getString('optionen');
  if (options !== null) fields.options = parseOptions(options, type, interaction.guild);
  else if (current && fields.type === 'ROLE' && current.type !== 'ROLE') fields.options = [];
  return fields;
}

// ---------- Anzeigen ----------

function questionsEmbed(type) {
  const lines = type.questions.map(describeQuestion);
  return embed()
    .setTitle(`${type.emoji} ${type.name} – ${type.questions.length} Fragen`)
    .setDescription(
      truncate(lines.join('\n') || '*Noch keine Fragen.* Füge welche mit `/bewerbung-verwalten frage-hinzufuegen` hinzu – erst dann erscheint die Bewerbung im Panel.', 4000),
    );
}

function textsModal(type) {
  const modal = new ModalBuilder().setCustomId(`appadmin:texts:${type.id}`).setTitle(truncate(`Texte – ${type.name}`, 45));
  for (const [key, label] of Object.entries(MESSAGES)) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(key)
          .setLabel(label)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1500)
          .setPlaceholder('Leer = Standardtext')
          .setValue(truncate(type.messages[key] ?? '', 1500)),
      ),
    );
  }
  return modal;
}

// ---------- Ausführen ----------

async function done(interaction, result, text, extraEmbed) {
  if (result.error) return replyPrivate(interaction, `❌ ${result.error}`);
  await replyPrivate(interaction, { content: text, embeds: extraEmbed ? [extraEmbed] : [] });
  await refreshPanels(interaction.guild);
}

module.exports = {
  data: builder,
  parseOptions,

  autocomplete: (interaction) => store.typeChoices(interaction.guildId, interaction.options.getFocused()),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return replyPrivate(interaction, 'Dafür brauchst du „Server verwalten“.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guildId = interaction.guildId;
    const typeId = o.getString('art');

    if (sub === 'uebersicht') return dashboard.open(interaction);

    if (sub === 'phase' || sub === 'dienstnummer') {
      const type = store.types(guildId).find((t) => t.id === typeId);
      if (!type) return replyPrivate(interaction, '❌ Diese Bewerbung gibt es nicht. Wähle sie aus der Liste aus.');
      try {
        saveTypeFields(guildId, type.id, sub === 'phase' ? phaseChanges(interaction, type) : serviceNumberChanges(interaction, type));
      } catch (err) {
        return replyPrivate(interaction, `❌ ${err.message}`);
      }
      const saved = store.typeById(guildId, type.id);
      const text =
        sub === 'phase'
          ? `✅ Bewerbungsphase von **${saved.name}** gespeichert. Das Panel aktualisiert sich automatisch, wenn die Phase öffnet oder schließt.\n${phaseText(guildId, saved)}`
          : `✅ Dienstnummer-Automatik von **${saved.name}** gespeichert: ${saved.serviceNumber.enabled ? 'an' : 'aus'} · Format \`${saved.serviceNumber.format}\` · ab ${saved.serviceNumber.start}${saved.serviceNumber.end ? ` bis ${saved.serviceNumber.end}` : ''}`;
      return done(interaction, {}, text);
    }

    if (sub === 'erstellen' || sub === 'bearbeiten') {
      const fields = {
        name: o.getString('name') ?? undefined,
        emoji: o.getString('emoji')?.trim() || undefined,
        description: o.getString('beschreibung') ?? undefined,
        workflow: o.getString('ablauf') ?? undefined,
        numberPrefix: o.getString('kuerzel') ?? undefined,
      };
      if (sub === 'erstellen') {
        const result = manage.createType(guildId, fields);
        return done(
          interaction,
          result,
          result.type &&
            `✅ **${result.type.name}** angelegt${result.panel ? ` (im Panel **${result.panel.name}**)` : ''}. Jetzt Fragen hinzufügen mit ` +
              `\`/bewerbung-verwalten frage-hinzufuegen art:${result.type.name}\`, dann Rollen und Kanäle mit \`/einstellungen bewerbung\` festlegen.`,
        );
      }
      if (Object.values(fields).every((v) => v === undefined)) return replyPrivate(interaction, 'Du hast keine Option angegeben – es wurde nichts geändert.');
      const result = manage.updateType(guildId, typeId, fields);
      return done(interaction, result, result.type && `✅ **${result.type.name}** gespeichert.\n${typeLine(result.type)}`);
    }

    if (sub === 'loeschen') {
      if (!o.getBoolean('bestaetigen')) return replyPrivate(interaction, 'Abgebrochen.');
      const result = manage.deleteType(guildId, typeId);
      return done(
        interaction,
        result,
        result.name && `🗑️ **${result.name}** gelöscht.${result.archived ? ' Alte Bewerbungen dafür kannst du weiterhin mit `/bewerbungen` ansehen.' : ''}`,
      );
    }

    const type = store.types(guildId).find((t) => t.id === typeId);
    if (!type) return replyPrivate(interaction, '❌ Diese Bewerbung gibt es nicht. Wähle sie aus der Liste aus.');

    if (sub === 'fragen') return replyPrivate(interaction, { embeds: [questionsEmbed(type)] });
    if (sub === 'texte') return interaction.showModal(textsModal(type));

    let fields;
    try {
      if (sub === 'frage-hinzufuegen') fields = questionFields(interaction);
      if (sub === 'frage-bearbeiten') {
        const current = type.questions[o.getInteger('nummer') - 1];
        if (!current) return replyPrivate(interaction, `❌ Frage ${o.getInteger('nummer')} gibt es nicht (es gibt ${type.questions.length}).`);
        fields = questionFields(interaction, current);
      }
    } catch (err) {
      return replyPrivate(interaction, `❌ ${err.message}`);
    }

    switch (sub) {
      case 'frage-hinzufuegen': {
        const result = manage.addQuestion(guildId, typeId, fields, o.getInteger('position'));
        return done(interaction, result, '✅ Frage hinzugefügt.', result.type && questionsEmbed(result.type));
      }
      case 'frage-bearbeiten': {
        if (Object.values(fields).every((v) => v === undefined)) return replyPrivate(interaction, 'Du hast keine Option angegeben – es wurde nichts geändert.');
        const result = manage.updateQuestion(guildId, typeId, o.getInteger('nummer'), fields);
        return done(interaction, result, '✅ Frage geändert.', result.type && questionsEmbed(result.type));
      }
      case 'frage-entfernen': {
        const result = manage.removeQuestion(guildId, typeId, o.getInteger('nummer'));
        return done(interaction, result, result.removed && `🗑️ Frage „${truncate(result.removed.label, 200)}“ entfernt.`, result.type && questionsEmbed(result.type));
      }
      case 'frage-verschieben': {
        const result = manage.moveQuestion(guildId, typeId, o.getInteger('nummer'), o.getInteger('position'));
        return done(interaction, result, '✅ Frage verschoben.', result.type && questionsEmbed(result.type));
      }
      default:
        return replyPrivate(interaction, 'Unbekannter Unterbefehl.');
    }
  },

  components: {
    // Übersicht mit Buttons (siehe src/lib/applications/discordOverview.js)
    dash: (interaction, args) => dashboard.handle(interaction, args),

    // Formular aus „texte“
    async appadmin(interaction, [action, typeId]) {
      if (action !== 'texts' || !interaction.isModalSubmit()) return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return replyPrivate(interaction, 'Dafür brauchst du „Server verwalten“.');
      const messages = Object.fromEntries(Object.keys(MESSAGES).map((key) => [key, interaction.fields.getTextInputValue(key)]));
      const result = manage.setMessages(interaction.guildId, typeId, messages);
      if (result.error) return replyPrivate(interaction, `❌ ${result.error}`);
      return replyPrivate(
        interaction,
        '✅ Texte gespeichert. Variablen: `{applicant}` `{applicationName}` `{number}` `{user}` (Entscheider) `{reason}` `{questionCount}` `{timeLimit}`',
      );
    },
  },
};
