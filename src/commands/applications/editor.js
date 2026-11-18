// /bewerbungsart: Bewerbungsarten komplett in Discord anlegen und bearbeiten (je Server, ohne Neustart).
// Alles läuft über eine private Editor-Nachricht mit Buttons und Formularen (customId "appedit:<aktion>:<id>:…").
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { forGuild } = require('../../lib/settings');
const { embed, replyPrivate, truncate, canManageServer } = require('../../lib/util');
const store = require('../../lib/applications/store');
const admin = require('../../lib/applications/admin');
const templates = require('../../lib/applications/templates');
const autocomplete = require('../../lib/applications/autocomplete');
const { refreshPanels } = require('../../lib/applications/messages');
const { QUESTION_TYPES, formatDuration } = require('../../lib/applications/forms');
const { teamChannelId } = require('../../lib/applications/flow');

const ON_LEAVE = { NONE: 'Nichts tun', DENY: 'Ablehnen', WITHDRAW: 'Zurückziehen' };
const ROLE_GROUPS = {
  zugang: {
    title: 'Rollen: Wer darf sich bewerben?',
    button: 'Rollen: Zugang',
    fields: { required: 'Erforderliche Rollen', blocked: 'Gesperrte Rollen' },
  },
  entscheidung: {
    title: 'Rollen bei Annahme / Ablehnung',
    button: 'Rollen: Entscheidung',
    fields: { acceptAdd: 'Bei Annahme geben', acceptRemove: 'Bei Annahme nehmen', rejectAdd: 'Bei Ablehnung geben', rejectRemove: 'Bei Ablehnung nehmen' },
  },
  team: {
    title: 'Rollen: Team und Ablauf',
    button: 'Rollen: Team',
    fields: { managers: 'Manager (dürfen entscheiden)', ping: 'Bei neuen Bewerbungen pingen', pending: 'Solange offen geben', removeOnSubmit: 'Beim Einreichen nehmen' },
  },
};

const canEdit = (interaction) => canManageServer(interaction.member);
const roleList = (ids) => (ids?.length ? ids.map((id) => `<@&${id}>`).join(' ') : '—');
const channel = (id) => (id ? `<#${id}>` : '—');
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const yesNoSelect = (id, value) =>
  new StringSelectMenuBuilder().setCustomId(id).addOptions({ label: 'Ja', value: 'ja', default: Boolean(value) }, { label: 'Nein', value: 'nein', default: !value });
const text = (id, { value = '', style = TextInputStyle.Short, required = false, max = 4000, placeholder } = {}) => {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
  if (value !== undefined && value !== null && String(value) !== '') input.setValue(String(value).slice(0, max));
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
};
const label = (name, description) => {
  const l = new LabelBuilder().setLabel(name);
  if (description) l.setDescription(description);
  return l;
};

function typeOf(guildId, id) {
  const type = store.typeById(guildId, id);
  if (!type) throw new admin.EditError(`Die Bewerbungsart „${id}“ gibt es nicht mehr.`);
  return type;
}

// ---------- Ansichten ----------

function homeView(guildId, type, notice) {
  const panels = forGuild(guildId).applications.panels;
  const r = type.roles;
  const info = embed(type.enabled ? 'primary' : '#99AAB5')
    .setTitle(`${type.emoji ? `${type.emoji} ` : ''}${type.name}`)
    .setDescription(
      [
        notice ? `${notice}\n` : null,
        type.description || '*Keine Beschreibung*',
        '',
        `**ID:** \`${type.id}\` · **Nummern:** \`${type.numberPrefix}-0001\` · ${type.enabled ? '🟢 offen' : '🔴 geschlossen'}`,
        `**Panel:** ${panels[type.panel]?.title ?? type.panel} (\`${type.panel}\`)`,
      ]
        .filter((l) => l !== null)
        .join('\n'),
    )
    .addFields(
      {
        name: `Fragen (${type.questions.length})`,
        value: truncate(type.questions.map((q, i) => `${i + 1}. ${q.label}`).join('\n') || '—', 1024),
      },
      {
        name: 'Ablauf',
        value: [
          `Prüfschritte: ${type.stages.length ? type.stages.map((s) => s.label).join(' → ') : '— (nur Annehmen/Ablehnen)'}`,
          `Wartezeit: ${type.cooldownMinutes ? formatDuration(type.cooldownMinutes) : 'keine'} · Zeitlimit: ${formatDuration(type.timeLimitMinutes)}`,
          `Bei Verlassen: ${ON_LEAVE[type.onLeave]} · Team-Thread: ${type.teamThreads ? 'ja' : 'nein'}`,
        ].join('\n'),
      },
      {
        name: 'Kanäle',
        value: `Neue Bewerbungen: ${channel(teamChannelId(guildId, type))}${type.channels.open ? '' : ' *(vom Panel)*'}\nAngenommen: ${channel(type.channels.accepted)} · Abgelehnt: ${channel(type.channels.rejected)}`,
      },
      {
        name: 'Rollen',
        value: truncate(
          [
            `Manager: ${roleList(r.managers)} · Ping: ${roleList(r.ping)}`,
            `Erforderlich (${r.requiredMode === 'any' ? 'eine' : 'alle'}): ${roleList(r.required)} · Gesperrt: ${roleList(r.blocked)}`,
            `Annahme: +${roleList(r.acceptAdd)} −${roleList(r.acceptRemove)}`,
            `Ablehnung: +${roleList(r.rejectAdd)} −${roleList(r.rejectRemove)}`,
            `Solange offen: ${roleList(r.pending)} · Beim Einreichen nehmen: ${roleList(r.removeOnSubmit)}`,
          ].join('\n'),
          1024,
        ),
      },
    )
    .setFooter({ text: 'Änderungen gelten sofort und nur auf diesem Server.' });

  const id = type.id;
  return {
    embeds: [info],
    components: [
      row(
        button(`appedit:basic:${id}`, 'Name, ID & Präfix', ButtonStyle.Primary).setEmoji('✏️'),
        button(`appedit:texts:${id}`, 'Texte').setEmoji('💬'),
        button(`appedit:flow:${id}`, 'Ablauf & Prüfschritte').setEmoji('🔁'),
        button(`appedit:channels:${id}`, 'Kanäle & Panel').setEmoji('#️⃣'),
      ),
      row(
        button(`appedit:questions:${id}`, `Fragen (${type.questions.length})`, ButtonStyle.Primary).setEmoji('❓'),
        ...Object.entries(ROLE_GROUPS).map(([key, g]) => button(`appedit:roles:${id}:${key}`, g.button).setEmoji('🏷️')),
      ),
      row(
        button(`appedit:toggle:${id}`, type.enabled ? 'Schließen' : 'Öffnen', type.enabled ? ButtonStyle.Secondary : ButtonStyle.Success).setEmoji(type.enabled ? '🔒' : '🔓'),
        button(`appedit:move:${id}:up`, 'Nach oben').setEmoji('⬆️'),
        button(`appedit:move:${id}:down`, 'Nach unten').setEmoji('⬇️'),
        button(`appedit:delete:${id}`, 'Löschen', ButtonStyle.Danger).setEmoji('🗑️'),
      ),
    ],
  };
}

function questionsView(type, notice) {
  const lines = type.questions.map((q, i) => `**${i + 1}.** ${truncate(q.label, 120)}\n-# ${QUESTION_TYPES[q.type]}${q.required === false ? ' · optional' : ''}`);
  const view = embed()
    .setTitle(`❓ Fragen – ${type.name}`)
    .setDescription(truncate(`${notice ? `${notice}\n\n` : ''}${lines.join('\n') || '*Noch keine Fragen.*'}`, 4000))
    .setFooter({ text: 'Wähle eine Frage zum Bearbeiten, Verschieben oder Löschen.' });
  const components = [];
  for (let page = 0; page * 25 < type.questions.length && page < 2; page++) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`appedit:qpick:${type.id}:${page}`)
          .setPlaceholder(page ? 'Fragen 26–50 …' : 'Frage auswählen …')
          .addOptions(
            type.questions.slice(page * 25, page * 25 + 25).map((q, i) => ({
              label: truncate(`${page * 25 + i + 1}. ${q.label}`, 100),
              value: q.key,
              description: QUESTION_TYPES[q.type],
            })),
          ),
      ),
    );
  }
  const add = button(`appedit:qadd:${type.id}`, 'Frage hinzufügen', ButtonStyle.Success).setEmoji('➕');
  if (type.questions.length >= 50) add.setDisabled(true);
  components.push(row(add, button(`appedit:home:${type.id}`, 'Zurück').setEmoji('↩️')));
  return { embeds: [view], components };
}

function questionView(type, key, notice) {
  const index = type.questions.findIndex((q) => q.key === key);
  const q = type.questions[index];
  if (!q) return questionsView(type, '⚠️ Diese Frage gibt es nicht mehr.');
  const details = [`**Typ:** ${QUESTION_TYPES[q.type]} · ${q.required === false ? 'optional' : 'Pflicht'}`];
  if (q.description) details.push(`**Zusatztext:** ${q.description}`);
  if (q.type === 'TEXT') details.push(`**Länge:** ${q.min || 0}–${q.max || 5000} Zeichen`);
  if (q.type === 'CHOICE') details.push(`**Optionen${q.multiple ? ' (Mehrfachauswahl)' : ''}:**\n${q.options.map((o) => `- ${o.label}`).join('\n')}`);
  if (q.type === 'ROLE') details.push(`**Rollen${q.multiple ? ' (Mehrfachauswahl)' : ''}:** ${roleList(q.options.map((o) => o.roleId))}`);
  const id = type.id;
  return {
    embeds: [
      embed()
        .setTitle(truncate(`Frage ${index + 1}: ${q.label}`, 256))
        .setDescription(truncate(`${notice ? `${notice}\n\n` : ''}${details.join('\n')}`, 4000))
        .setFooter({ text: `Schlüssel: ${q.key}` }),
    ],
    components: [
      row(
        button(`appedit:qedit:${id}:${key}`, 'Bearbeiten', ButtonStyle.Primary).setEmoji('✏️'),
        button(`appedit:qmove:${id}:${key}:up`, 'Nach oben').setEmoji('⬆️').setDisabled(index === 0),
        button(`appedit:qmove:${id}:${key}:down`, 'Nach unten').setEmoji('⬇️').setDisabled(index === type.questions.length - 1),
        button(`appedit:qdel:${id}:${key}`, 'Löschen', ButtonStyle.Danger).setEmoji('🗑️').setDisabled(type.questions.length === 1),
      ),
      row(button(`appedit:questions:${id}`, 'Zur Fragenliste').setEmoji('↩️')),
    ],
  };
}

function newQuestionView(type) {
  return {
    embeds: [embed().setTitle(`➕ Neue Frage – ${type.name}`).setDescription('Welche Art von Frage?')],
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`appedit:qtype:${type.id}`)
          .setPlaceholder('Fragetyp wählen …')
          .addOptions(
            { label: 'Freitext', value: 'TEXT', description: 'Antwort als Nachricht, mit Mindest- und Höchstlänge', emoji: '✍️' },
            { label: 'Auswahl', value: 'CHOICE', description: 'Optionen im Auswahlmenü, auch Mehrfachauswahl', emoji: '📋' },
            { label: 'Rollen-Auswahl', value: 'ROLE', description: 'Gewählte Rollen werden bei Annahme vergeben', emoji: '🏷️' },
            { label: 'Roblox-Benutzer', value: 'ROBLOX', description: 'Konto wird gesucht und muss bestätigt werden', emoji: '🎮' },
          ),
      ),
      row(button(`appedit:questions:${type.id}`, 'Abbrechen').setEmoji('↩️')),
    ],
  };
}

function deleteView(guildId, type) {
  const open = store.openOf(guildId, (r) => r.type === type.id).length;
  const total = Object.values(store.recordsOf(guildId)).filter((r) => r.type === type.id).length;
  return {
    embeds: [
      embed('danger')
        .setTitle(`🗑️ ${type.name} löschen?`)
        .setDescription(
          `Die Bewerbungsart \`${type.id}\` wird von diesem Server entfernt.\n` +
            `Bisherige Bewerbungen (${total}) bleiben gespeichert und sind über \`/bewerbungen anzeigen\` weiter abrufbar.` +
            (open ? `\n\n⚠️ Es gibt noch **${open} offene** Bewerbung(en). Entscheide sie zuerst.` : ''),
        ),
    ],
    components: [row(button(`appedit:deleteyes:${type.id}`, 'Ja, löschen', ButtonStyle.Danger).setDisabled(Boolean(open)), button(`appedit:home:${type.id}`, 'Abbrechen'))],
  };
}

function listView(guildId) {
  const panels = forGuild(guildId).applications.panels;
  const types = store.types(guildId);
  const result = embed().setTitle(`📋 Bewerbungsarten (${types.length})`).setDescription('Bearbeiten mit `/bewerbungsart bearbeiten` oder im Menü unten. Neu: `/bewerbungsart erstellen`.');
  for (const [panelId, panel] of Object.entries(panels)) {
    const own = types.filter((t) => t.panel === panelId);
    result.addFields({
      name: truncate(`${panel.title} (${panelId})`, 256),
      value: truncate(
        own.map((t) => `${t.enabled ? '🟢' : '🔴'} ${t.emoji ?? ''} **${t.name}** · \`${t.id}\` · \`${t.numberPrefix}-\` · ${t.questions.length} Fragen`).join('\n') || '*leer*',
        1024,
      ),
    });
  }
  const components = types.length
    ? [
        row(
          new StringSelectMenuBuilder()
            .setCustomId('appedit:open')
            .setPlaceholder('Bewerbungsart bearbeiten …')
            .addOptions(types.slice(0, 25).map((t) => ({ label: truncate(t.name, 100), value: t.id, description: `${t.id} · ${t.numberPrefix}-0001`, ...(t.emoji ? { emoji: t.emoji } : {}) }))),
        ),
      ]
    : [];
  return { embeds: [result], components };
}

// ---------- Formulare ----------

function basicModal(type) {
  return new ModalBuilder()
    .setCustomId(`appedit:basicsave:${type.id}`)
    .setTitle('Name, ID & Präfix')
    .addLabelComponents(
      label('Name', 'So heißt die Bewerbung im Panel und in Nachrichten').setTextInputComponent(text('name', { value: type.name, required: true, max: 80 })),
      label('ID', 'Kleinbuchstaben, Zahlen, _ oder - · für Befehle und Sperren').setTextInputComponent(text('id', { value: type.id, required: true, max: 24 })),
      label('Nummern-Präfix', 'z. B. FW → Bewerbungsnummern FW-0001, FW-0002 …').setTextInputComponent(text('prefix', { value: type.numberPrefix, required: true, max: 10 })),
      label('Emoji', 'Ein Emoji, z. B. 🚒 (leer = ohne)').setTextInputComponent(text('emoji', { value: type.emoji, max: 60 })),
      label('Beschreibung', 'Steht im Panel unter dem Namen').setTextInputComponent(text('description', { value: type.description, style: TextInputStyle.Paragraph, max: 1000 })),
    );
}

function textsModal(type) {
  const vars = 'Variablen: {applicant} {applicationName} {number} {user} {reason} {questionCount} {timeLimit}';
  return new ModalBuilder()
    .setCustomId(`appedit:textssave:${type.id}`)
    .setTitle('Texte')
    .addLabelComponents(
      label('Startnachricht (DM)', vars).setTextInputComponent(text('start', { value: type.messages.start, style: TextInputStyle.Paragraph, required: true, max: 2000 })),
      label('Nach dem Einreichen (DM)').setTextInputComponent(text('finish', { value: type.messages.finish, style: TextInputStyle.Paragraph, required: true, max: 2000 })),
      label('Bei Annahme (DM)').setTextInputComponent(text('accept', { value: type.messages.accept, style: TextInputStyle.Paragraph, required: true, max: 2000 })),
      label('Bei Ablehnung (DM)', 'Ein Grund wird automatisch angehängt').setTextInputComponent(text('reject', { value: type.messages.reject, style: TextInputStyle.Paragraph, required: true, max: 2000 })),
    );
}

function flowModal(type) {
  return new ModalBuilder()
    .setCustomId(`appedit:flowsave:${type.id}`)
    .setTitle('Ablauf & Prüfschritte')
    .addLabelComponents(
      label('Prüfschritte (einer je Zeile)', 'z. B. In Prüfung / Gespräch · leer = nur Annehmen/Ablehnen').setTextInputComponent(
        text('stages', { value: type.stages.map((s) => s.label).join('\n'), style: TextInputStyle.Paragraph, max: 900, placeholder: 'In Prüfung\nGespräch\nEntscheidung ausstehend' }),
      ),
      label('Wartezeit in Minuten', 'Zwischen zwei Bewerbungen derselben Person · 1440 = 1 Tag').setTextInputComponent(text('cooldown', { value: type.cooldownMinutes, required: true, max: 6 })),
      label('Zeitlimit zum Ausfüllen in Minuten', '5 bis 10080 (7 Tage)').setTextInputComponent(text('timeLimit', { value: type.timeLimitMinutes, required: true, max: 5 })),
      label('Wenn die Person den Server verlässt').setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId('onLeave').addOptions(Object.entries(ON_LEAVE).map(([value, name]) => ({ label: name, value, default: type.onLeave === value }))),
      ),
      label('Team-Thread zu jeder Bewerbung?').setStringSelectMenuComponent(yesNoSelect('threads', type.teamThreads)),
    );
}

function channelsModal(guildId, type) {
  const panels = forGuild(guildId).applications.panels;
  const channelSelect = (id, value) => {
    const select = new ChannelSelectMenuBuilder().setCustomId(id).setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1).setRequired(false);
    if (value) select.setDefaultChannels(value);
    return select;
  };
  return new ModalBuilder()
    .setCustomId(`appedit:channelssave:${type.id}`)
    .setTitle('Kanäle & Panel')
    .addLabelComponents(
      label('Panel', 'In welchem Panel erscheint die Bewerbung?').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('panel')
          .addOptions(Object.entries(panels).slice(0, 25).map(([id, p]) => ({ label: truncate(p.title, 100), value: id, description: id, default: id === type.panel }))),
      ),
      label('Kanal für neue Bewerbungen', 'Leer = Kanal des Panels').setChannelSelectMenuComponent(channelSelect('open', type.channels.open)),
      label('Kopie angenommener Bewerbungen', 'Leer = keine Kopie').setChannelSelectMenuComponent(channelSelect('accepted', type.channels.accepted)),
      label('Kopie abgelehnter Bewerbungen', 'Leer = keine Kopie').setChannelSelectMenuComponent(channelSelect('rejected', type.channels.rejected)),
    );
}

function rolesModal(type, groupKey) {
  const group = ROLE_GROUPS[groupKey];
  const modal = new ModalBuilder().setCustomId(`appedit:rolessave:${type.id}:${groupKey}`).setTitle(group.title.slice(0, 45));
  for (const [field, name] of Object.entries(group.fields)) {
    const select = new RoleSelectMenuBuilder().setCustomId(field).setMinValues(0).setMaxValues(25).setRequired(false);
    if (type.roles[field]?.length) select.setDefaultRoles(...type.roles[field].slice(0, 25));
    modal.addLabelComponents(label(name).setRoleSelectMenuComponent(select));
  }
  if (groupKey === 'zugang') {
    modal.addLabelComponents(
      label('Erforderliche Rollen: welche?').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('requiredMode')
          .addOptions({ label: 'Alle erforderlichen Rollen', value: 'all', default: type.roles.requiredMode !== 'any' }, { label: 'Mindestens eine', value: 'any', default: type.roles.requiredMode === 'any' }),
      ),
      label('Gesperrt, wenn die Person … hat').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('blockedMode')
          .addOptions({ label: 'eine der gesperrten Rollen', value: 'any', default: type.roles.blockedMode !== 'all' }, { label: 'alle gesperrten Rollen', value: 'all', default: type.roles.blockedMode === 'all' }),
      ),
    );
  }
  return modal;
}

// Formular für eine neue (key = "new") oder vorhandene Frage.
function questionModal(type, kind, question) {
  const q = question ?? { type: kind, required: true };
  const key = question?.key ?? 'new';
  const modal = new ModalBuilder()
    .setCustomId(`appedit:qsave:${type.id}:${key}:${kind}`)
    .setTitle(`${question ? 'Frage bearbeiten' : 'Neue Frage'} – ${QUESTION_TYPES[kind]}`.slice(0, 45))
    .addLabelComponents(
      label('Frage').setTextInputComponent(text('label', { value: q.label, style: TextInputStyle.Paragraph, required: true, max: 250 })),
      label('Zusatztext', 'Erscheint klein unter der Frage (optional)').setTextInputComponent(text('description', { value: q.description, style: TextInputStyle.Paragraph, max: 500 })),
      label('Pflichtfrage?', 'Bei „Nein“ gibt es einen Button „Überspringen“').setStringSelectMenuComponent(yesNoSelect('required', q.required !== false)),
    );
  if (kind === 'TEXT') {
    modal.addLabelComponents(
      label('Mindestens Zeichen', 'leer = keine Mindestlänge').setTextInputComponent(text('min', { value: q.min, max: 4 })),
      label('Höchstens Zeichen', 'bis 5000 · leer = 5000').setTextInputComponent(text('max', { value: q.max, max: 4 })),
    );
  } else if (kind === 'CHOICE') {
    modal.addLabelComponents(
      label('Optionen (eine je Zeile, max. 25)', 'Optional mit Beschreibung: Name | Beschreibung').setTextInputComponent(
        text('options', { value: admin.optionsToLines(q.options), style: TextInputStyle.Paragraph, required: true, placeholder: 'Täglich\nMehrmals pro Woche\nAm Wochenende' }),
      ),
      label('Mehrere Optionen wählbar?').setStringSelectMenuComponent(yesNoSelect('multiple', q.multiple)),
    );
  } else if (kind === 'ROLE') {
    const select = new RoleSelectMenuBuilder().setCustomId('roles').setMinValues(1).setMaxValues(25);
    const current = (q.options ?? []).map((o) => o.roleId).filter(Boolean);
    if (current.length) select.setDefaultRoles(...current.slice(0, 25));
    modal.addLabelComponents(
      label('Wählbare Rollen', 'Die gewählten Rollen bekommt die Person bei Annahme').setRoleSelectMenuComponent(select),
      label('Mehrere Rollen wählbar?').setStringSelectMenuComponent(yesNoSelect('multiple', q.multiple)),
    );
  }
  return modal;
}

// ---------- Formulare auswerten ----------

const value = (interaction, id) => interaction.fields.getTextInputValue(id)?.trim() ?? '';
const selected = (interaction, id) => interaction.fields.getStringSelectValues(id)?.[0];
const roleIds = (interaction, id) => [...(interaction.fields.getSelectedRoles(id, false)?.keys() ?? [])];
const channelId = (interaction, id) => interaction.fields.getSelectedChannels(id, false)?.first()?.id ?? '';

function questionFromModal(interaction, kind, existing, questions) {
  const labelText = value(interaction, 'label');
  const question = {
    key: existing?.key ?? admin.questionKey(labelText, questions),
    type: kind,
    label: labelText,
    required: selected(interaction, 'required') !== 'nein',
  };
  const description = value(interaction, 'description');
  if (description) question.description = description;
  if (kind === 'TEXT') {
    const min = admin.parseNumber(value(interaction, 'min'), { min: 0, max: 5000, name: 'Mindestens Zeichen' });
    const max = admin.parseNumber(value(interaction, 'max'), { min: 1, max: 5000, name: 'Höchstens Zeichen' });
    if (min) question.min = min;
    if (max) question.max = max;
  } else if (kind === 'CHOICE') {
    question.options = admin.optionsFromLines(value(interaction, 'options'));
    question.multiple = selected(interaction, 'multiple') === 'ja';
  } else if (kind === 'ROLE') {
    const roles = interaction.fields.getSelectedRoles('roles', false);
    const descriptions = Object.fromEntries((existing?.options ?? []).map((o) => [o.roleId, o.description]));
    question.options = [...roles.values()].map((role) => ({
      label: truncate(role.name, 100),
      value: role.id,
      roleId: role.id,
      ...(descriptions[role.id] ? { description: descriptions[role.id] } : {}),
    }));
    question.multiple = selected(interaction, 'multiple') === 'ja';
  }
  return question;
}

// ---------- Befehl ----------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungsart')
    .setDescription('Bewerbungsarten anlegen und komplett bearbeiten (Fragen, Texte, Rollen, Kanäle …).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('liste').setDescription('Alle Bewerbungsarten dieses Servers.'))
    .addSubcommand((s) =>
      s
        .setName('erstellen')
        .setDescription('Neue Bewerbungsart – leer, aus einer Vorlage oder als Kopie.')
        .addStringOption((o) => o.setName('id').setDescription('Eindeutige ID, z. B. feuerwehr (a-z, 0-9, _ -)').setRequired(true).setMinLength(2).setMaxLength(24))
        .addStringOption((o) => o.setName('name').setDescription('Anzeigename, z. B. Feuerwehr-Bewerbung').setMaxLength(80))
        .addStringOption((o) => o.setName('vorlage').setDescription('Fertige Fragen für …').addChoices(...templates.choices().slice(0, 25)))
        .addStringOption((o) => o.setName('kopie_von').setDescription('Oder: eine vorhandene Bewerbungsart kopieren').setAutocomplete(true))
        .addStringOption((o) => o.setName('panel').setDescription('In welchem Panel? (Standard: das erste)').setAutocomplete(true))
        .addStringOption((o) => o.setName('praefix').setDescription('Nummern-Präfix, z. B. FW → FW-0001').setMaxLength(10))
        .addStringOption((o) => o.setName('emoji').setDescription('z. B. 🚒').setMaxLength(60)),
    )
    .addSubcommand((s) =>
      s
        .setName('bearbeiten')
        .setDescription('Öffnet den Editor einer Bewerbungsart.')
        .addStringOption((o) => o.setName('art').setDescription('Welche Bewerbung?').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('loeschen')
        .setDescription('Löscht eine Bewerbungsart (bisherige Bewerbungen bleiben gespeichert).')
        .addStringOption((o) => o.setName('art').setDescription('Welche Bewerbung?').setRequired(true).setAutocomplete(true)),
    ),

  autocomplete: autocomplete.respond,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    try {
      if (sub === 'liste') return replyPrivate(interaction, listView(guildId));
      if (sub === 'erstellen') {
        if (interaction.options.getString('vorlage') && interaction.options.getString('kopie_von')) {
          throw new admin.EditError('Gib entweder eine Vorlage oder `kopie_von` an, nicht beides.');
        }
        const type = admin.createType(guildId, {
          id: interaction.options.getString('id'),
          name: interaction.options.getString('name'),
          template: interaction.options.getString('vorlage') ?? 'leer',
          copyFrom: interaction.options.getString('kopie_von'),
          panel: interaction.options.getString('panel') ?? undefined,
          prefix: interaction.options.getString('praefix'),
          emoji: interaction.options.getString('emoji'),
        });
        await replyPrivate(interaction, homeView(guildId, type, '✅ Angelegt. Stell jetzt mindestens die **Manager-Rollen** ein (Rollen: Team) und prüfe die Fragen.'));
        return refreshPanels(interaction.guild);
      }
      const type = typeOf(guildId, interaction.options.getString('art'));
      if (sub === 'bearbeiten') return replyPrivate(interaction, homeView(guildId, type));
      if (sub === 'loeschen') return replyPrivate(interaction, deleteView(guildId, type));
    } catch (err) {
      if (err instanceof admin.EditError) return replyPrivate(interaction, `❌ ${err.message}`);
      throw err;
    }
  },

  components: {
    async appedit(interaction, [action, id, a, b]) {
      if (!canEdit(interaction)) return replyPrivate(interaction, 'Dafür brauchst du die Berechtigung „Server verwalten“.');
      const guildId = interaction.guildId;
      const save = async (change, view) => {
        const updated = admin.updateType(guildId, id, change);
        await interaction.update(view(updated));
        refreshPanels(interaction.guild).catch((err) => console.error('[appPanel]', err.message));
      };

      // Alles in einer async-Funktion, damit auch Fehler aus await-Aufrufen unten abgefangen werden.
      const handle = async () => {
        switch (action) {
          case 'open':
            return interaction.update(homeView(guildId, typeOf(guildId, interaction.values[0])));
          case 'home':
            return interaction.update(homeView(guildId, typeOf(guildId, id)));

          // Grunddaten
          case 'basic':
            return interaction.showModal(basicModal(typeOf(guildId, id)));
          case 'basicsave': {
            const newId = value(interaction, 'id').toLowerCase();
            if (newId !== id && admin.runningSessions(guildId, id)) {
              throw new admin.EditError('Gerade füllt jemand diese Bewerbung aus – die ID kann erst danach geändert werden.');
            }
            const emoji = value(interaction, 'emoji');
            return save(
              (t) => {
                t.name = value(interaction, 'name');
                t.id = newId;
                t.numberPrefix = admin.normalizePrefix(value(interaction, 'prefix'));
                t.emoji = emoji;
                t.description = value(interaction, 'description');
              },
              (t) => homeView(guildId, t, newId !== id ? `✅ Gespeichert. Neue ID: \`${t.id}\` – bisherige Bewerbungen und Sperren wurden übernommen.` : '✅ Gespeichert.'),
            );
          }

          // Texte
          case 'texts':
            return interaction.showModal(textsModal(typeOf(guildId, id)));
          case 'textssave':
            return save(
              (t) => {
                for (const key of ['start', 'finish', 'accept', 'reject']) t.messages[key] = value(interaction, key);
              },
              (t) => homeView(guildId, t, '✅ Texte gespeichert.'),
            );

          // Ablauf
          case 'flow':
            return interaction.showModal(flowModal(typeOf(guildId, id)));
          case 'flowsave':
            return save(
              (t) => {
                t.stages = admin.stagesFromLines(value(interaction, 'stages'), t.stages);
                t.cooldownMinutes = admin.parseNumber(value(interaction, 'cooldown'), { min: 0, max: 525_600, name: 'Die Wartezeit' }) ?? 0;
                t.timeLimitMinutes = admin.parseNumber(value(interaction, 'timeLimit'), { min: 5, max: 10_080, name: 'Das Zeitlimit' }) ?? t.timeLimitMinutes;
                t.onLeave = selected(interaction, 'onLeave') ?? t.onLeave;
                t.teamThreads = selected(interaction, 'threads') === 'ja';
                delete t.workflow;
              },
              (t) => homeView(guildId, t, '✅ Ablauf gespeichert.'),
            );

          // Kanäle
          case 'channels':
            return interaction.showModal(channelsModal(guildId, typeOf(guildId, id)));
          case 'channelssave':
            return save(
              (t) => {
                t.panel = selected(interaction, 'panel') ?? t.panel;
                t.channels.open = channelId(interaction, 'open');
                t.channels.accepted = channelId(interaction, 'accepted');
                t.channels.rejected = channelId(interaction, 'rejected');
              },
              (t) => homeView(guildId, t, '✅ Kanäle gespeichert.'),
            );

          // Rollen
          case 'roles':
            if (!ROLE_GROUPS[a]) return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
            return interaction.showModal(rolesModal(typeOf(guildId, id), a));
          case 'rolessave':
            if (!ROLE_GROUPS[a]) return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
            return save(
              (t) => {
                for (const field of Object.keys(ROLE_GROUPS[a].fields)) t.roles[field] = roleIds(interaction, field);
                if (a === 'zugang') {
                  t.roles.requiredMode = selected(interaction, 'requiredMode') ?? 'all';
                  t.roles.blockedMode = selected(interaction, 'blockedMode') ?? 'any';
                }
              },
              (t) => homeView(guildId, t, '✅ Rollen gespeichert.'),
            );

          case 'toggle':
            return save(
              (t) => {
                t.enabled = !t.enabled;
              },
              (t) => homeView(guildId, t, t.enabled ? '🔓 Bewerbung ist jetzt offen.' : '🔒 Bewerbung ist jetzt geschlossen.'),
            );
          case 'move':
            admin.moveType(guildId, id, a === 'up' ? -1 : 1);
            await interaction.update(homeView(guildId, typeOf(guildId, id), '✅ Reihenfolge geändert.'));
            return refreshPanels(interaction.guild);
          case 'delete':
            return interaction.update(deleteView(guildId, typeOf(guildId, id)));
          case 'deleteyes': {
            const name = typeOf(guildId, id).name;
            admin.deleteType(guildId, id);
            await interaction.update({ ...listView(guildId), content: `🗑️ **${name}** wurde gelöscht.` });
            return refreshPanels(interaction.guild);
          }

          // Fragen
          case 'questions':
            return interaction.update(questionsView(typeOf(guildId, id)));
          case 'qpick':
            return interaction.update(questionView(typeOf(guildId, id), interaction.values[0]));
          case 'qadd':
            return interaction.update(newQuestionView(typeOf(guildId, id)));
          case 'qtype': {
            const kind = interaction.values[0];
            if (!QUESTION_TYPES[kind]) return replyPrivate(interaction, 'Unbekannter Fragetyp.');
            return interaction.showModal(questionModal(typeOf(guildId, id), kind));
          }
          case 'qedit': {
            const type = typeOf(guildId, id);
            const question = type.questions.find((q) => q.key === a);
            if (!question) return interaction.update(questionsView(type, '⚠️ Diese Frage gibt es nicht mehr.'));
            return interaction.showModal(questionModal(type, question.type, question));
          }
          case 'qsave': {
            const isNew = a === 'new';
            let key;
            return save(
              (t) => {
                const index = isNew ? -1 : t.questions.findIndex((q) => q.key === a);
                if (!isNew && index < 0) throw new admin.EditError('Diese Frage gibt es nicht mehr.');
                const question = questionFromModal(interaction, b, isNew ? null : t.questions[index], t.questions);
                key = question.key;
                if (isNew) t.questions.push(question);
                else t.questions[index] = question;
              },
              (t) => questionView(t, key, isNew ? '✅ Frage hinzugefügt.' : '✅ Frage gespeichert.'),
            );
          }
          case 'qmove':
            return save(
              (t) => {
                const index = t.questions.findIndex((q) => q.key === a);
                const target = index + (b === 'up' ? -1 : 1);
                if (index < 0 || target < 0 || target >= t.questions.length) return;
                [t.questions[index], t.questions[target]] = [t.questions[target], t.questions[index]];
              },
              (t) => questionView(t, a),
            );
          case 'qdel':
            return save(
              (t) => {
                t.questions = t.questions.filter((q) => q.key !== a);
              },
              (t) => questionsView(t, '🗑️ Frage gelöscht.'),
            );
          default:
            return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
        }
      };
      try {
        return await handle();
      } catch (err) {
        if (err instanceof admin.EditError) return replyPrivate(interaction, `❌ ${err.message}`);
        throw err;
      }
    },
  },

  // für Tests
  views: { homeView, questionsView, questionView, newQuestionView, deleteView, listView },
  modals: { basicModal, textsModal, flowModal, channelsModal, rolesModal, questionModal },
};
