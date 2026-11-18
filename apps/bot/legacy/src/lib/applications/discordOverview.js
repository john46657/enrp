// Übersicht in Discord (/bewerbung-verwalten uebersicht): Bewerbungen und Panels mit Buttons, Menüs und Formularen
// verwalten – wie im Web-Dashboard. Alle customIds beginnen mit "dash:".
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { embed, truncate } = require('../util');
const store = require('./store');
const manage = require('./manage');
const panels = require('./panels');
const messages = require('./messages');
const { QUESTION_TYPES } = require('./forms');

const searches = new Map(); // `${guildId}:${userId}` → Suchtext
const QUESTION_TYPE_HELP = {
  TEXT: 'Antwort als Nachricht',
  CHOICE: 'Auswahlmenü mit eigenen Antworten',
  ROLE: 'Auswahlmenü mit Rollen, die es bei Annahme gibt',
  ROBLOX: 'Roblox-Konto wird gesucht und bestätigt',
};
const MESSAGE_FIELDS = { start: 'Startnachricht (DM)', finish: 'Nach dem Einreichen', accept: 'Bei Annahme', reject: 'Bei Ablehnung' };

const button = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(`dash:${id}`).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const input = (id, label, { style = TextInputStyle.Short, value, required = false, max = 4000, placeholder } = {}) => {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) field.setValue(truncate(String(value), max));
  if (placeholder) field.setPlaceholder(placeholder);
  return row(field);
};

// ---------- Texte ----------

function describeQuestion(q, i) {
  const details = [QUESTION_TYPES[q.type], q.required === false ? 'optional' : 'Pflicht'];
  if (q.type === 'TEXT') details.push(`${q.min ? `${q.min}–` : 'bis '}${q.max ?? 5000} Zeichen`);
  if (q.options) details.push(`${q.multiple ? 'mehrere: ' : ''}${q.options.map((x) => (x.roleId ? `<@&${x.roleId}>` : x.label)).join(', ')}`);
  return `**${i + 1}.** ${q.label}\n-# ${details.join(' · ')}${q.description ? `\n-# ${q.description}` : ''}`;
}

function typeLine(t) {
  const state = !t.questions.length ? '⚠️ keine Fragen' : t.enabled ? '✅ offen' : '⛔ geschlossen';
  return `${t.emoji} **${t.name}** · ${state} · ${t.questions.length} Fragen · ${t.workflow === 'police' ? 'mehrstufig' : 'einfach'} · \`${t.numberPrefix}-0001\``;
}

const panelsWith = (guildId, typeId) => panels.panelsOf(guildId).filter((p) => p.types.includes(typeId));

// ---------- Ansichten ----------

function homeView(guildId, userId) {
  const query = searches.get(`${guildId}:${userId}`) ?? '';
  const all = store.types(guildId);
  const list = all.filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase()));
  const e = embed().setTitle(`📋 Bewerbungen: ${all.length}`);
  if (!all.length) {
    e.setDescription('Hier gibt es noch keine Bewerbungen.\nKlicke auf **➕ Neue Bewerbung** und füge danach Fragen hinzu.');
  } else {
    e.setDescription(
      (query ? `🔍 Suche „${query}“ – ${list.length} Treffer\n\n` : '') + (truncate(list.map(typeLine).join('\n'), 3800) || '*Keine Bewerbung passt zur Suche.*'),
    );
  }
  const buttons = [button('newapp', 'Neue Bewerbung', ButtonStyle.Success, '➕'), button('search', 'Suchen', ButtonStyle.Secondary, '🔍')];
  if (query) buttons.push(button('clearsearch', 'Suche zurücksetzen', ButtonStyle.Secondary, '✖️'));
  buttons.push(button('panels', 'Panels', ButtonStyle.Primary, '🗂️'));
  const components = [row(...buttons)];
  if (list.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('dash:openapp')
          .setPlaceholder('Bewerbung öffnen …')
          .addOptions(list.slice(0, 25).map((t) => ({ label: truncate(t.name, 100), value: t.id, emoji: t.emoji, description: truncate(`${t.questions.length} Fragen${t.enabled ? '' : ' · geschlossen'}`, 100) }))),
      ),
    );
  }
  return { embeds: [e], components };
}

function appView(guildId, typeId) {
  const type = store.types(guildId).find((t) => t.id === typeId);
  if (!type) return homeViewWithNotice(guildId, 'Diese Bewerbung gibt es nicht mehr.');
  const inPanels = panelsWith(guildId, typeId);
  const e = embed()
    .setTitle(`${type.emoji} ${type.name}`)
    .setDescription(
      [
        type.description || '*Keine Beschreibung*',
        '',
        `**Status:** ${type.enabled ? '✅ offen' : '⛔ geschlossen'} · **Ablauf:** ${type.workflow === 'police' ? 'mehrstufig' : 'einfach'} · **Nummer:** \`${type.numberPrefix}-0001\``,
        `**Panels:** ${inPanels.map((p) => p.name).join(', ') || '— (in keinem Panel, siehe 🗂️ Panels)'}`,
        '',
        `**Fragen (${type.questions.length})**`,
        type.questions.map(describeQuestion).join('\n') || '*Noch keine Fragen – füge unten welche hinzu. Ohne Fragen erscheint die Bewerbung nicht.*',
      ].join('\n').slice(0, 4000),
    )
    .setFooter({ text: 'Rollen, Kanäle, Wartezeit: /einstellungen bewerbung' });

  const components = [
    row(
      button(`appedit:${type.id}`, 'Bearbeiten', ButtonStyle.Primary, '✏️'),
      button(`texts:${type.id}`, 'Texte', ButtonStyle.Secondary, '💬'),
      button(`toggle:${type.id}`, type.enabled ? 'Schließen' : 'Öffnen', type.enabled ? ButtonStyle.Secondary : ButtonStyle.Success, type.enabled ? '⛔' : '✅'),
      button(`workflow:${type.id}`, type.workflow === 'police' ? 'Ablauf: mehrstufig' : 'Ablauf: einfach', ButtonStyle.Secondary, '🔀'),
      button(`del:${type.id}`, 'Löschen', ButtonStyle.Danger, '🗑️'),
    ),
  ];
  if (type.questions.length < manage.MAX_QUESTIONS) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`dash:qadd:${type.id}`)
          .setPlaceholder('➕ Frage hinzufügen – Typ wählen …')
          .addOptions(
            Object.entries(QUESTION_TYPES)
              .filter(([key]) => key !== 'ROBLOX' || !type.questions.some((q) => q.type === 'ROBLOX'))
              .map(([value, label]) => ({ label, value, description: QUESTION_TYPE_HELP[value] })),
          ),
      ),
    );
  }
  if (type.questions.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`dash:qopen:${type.id}`)
          .setPlaceholder('✏️ Frage bearbeiten, verschieben oder entfernen …')
          .addOptions(type.questions.slice(0, 25).map((q, i) => ({ label: truncate(`${i + 1}. ${q.label}`, 100), value: String(i + 1), description: QUESTION_TYPES[q.type] }))),
      ),
    );
  }
  components.push(row(button('home', 'Übersicht', ButtonStyle.Secondary, '⬅️'), button('panels', 'Panels', ButtonStyle.Secondary, '🗂️')));
  return { embeds: [e], components };
}

function questionView(guildId, typeId, number) {
  const type = store.types(guildId).find((t) => t.id === typeId);
  const q = type?.questions[number - 1];
  if (!q) return appView(guildId, typeId);
  return {
    embeds: [embed().setTitle(`${type.emoji} ${type.name} – Frage ${number}/${type.questions.length}`).setDescription(describeQuestion(q, number - 1))],
    components: [
      row(
        button(`qedit:${typeId}:${number}`, 'Bearbeiten', ButtonStyle.Primary, '✏️'),
        button(`qmove:${typeId}:${number}:up`, 'Nach oben', ButtonStyle.Secondary, '⬆️').setDisabled(number === 1),
        button(`qmove:${typeId}:${number}:down`, 'Nach unten', ButtonStyle.Secondary, '⬇️').setDisabled(number === type.questions.length),
        button(`qdel:${typeId}:${number}`, 'Entfernen', ButtonStyle.Danger, '🗑️'),
        button(`app:${typeId}`, 'Zurück', ButtonStyle.Secondary, '⬅️'),
      ),
    ],
  };
}

function panelsView(guildId) {
  const list = panels.panelsOf(guildId);
  const types = store.types(guildId);
  const e = embed().setTitle(`🗂️ Panels: ${list.length}`);
  if (!types.length) {
    e.setDescription('### Keine Bewerbungen gefunden\nDu brauchst mindestens eine Bewerbung, um ein Panel zu erstellen. Komm zurück, sobald du eine angelegt hast.');
    return { embeds: [e], components: [row(button('newapp', 'Bewerbung erstellen', ButtonStyle.Success, '➕'), button('home', 'Bewerbungen', ButtonStyle.Secondary, '📋'))] };
  }
  e.setDescription(
    list.length
      ? truncate(
          list
            .map((p) => {
              const posts = panels.postsOf(guildId, p.id);
              return `**${p.name}** · ${p.types.length} Bewerbung(en)${posts.length ? ` · gepostet in ${posts.map((x) => `<#${x.channelId}>`).join(' ')}` : ' · noch nicht gepostet'}`;
            })
            .join('\n'),
          4000,
        )
      : 'Noch keine Panels. Ein Panel ist die Nachricht, über die man sich bewirbt. Klicke auf **➕ Neues Panel**.',
  );
  const components = [row(button('newpanel', 'Neues Panel', ButtonStyle.Success, '➕'), button('home', 'Bewerbungen', ButtonStyle.Secondary, '📋'))];
  if (list.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('dash:openpanel')
          .setPlaceholder('Panel öffnen …')
          .addOptions(list.slice(0, 25).map((p) => ({ label: truncate(p.name, 100), value: p.id, description: `${p.types.length} Bewerbung(en)` }))),
      ),
    );
  }
  return { embeds: [e], components };
}

function panelView(guildId, panelId) {
  const panel = panels.getPanel(guildId, panelId);
  if (!panel) return panelsView(guildId);
  const types = store.types(guildId);
  const posts = panels.postsOf(guildId, panelId);
  const e = embed()
    .setTitle(`🗂️ ${panel.name}`)
    .addFields(
      { name: 'Titel', value: truncate(panel.title || '—', 1024) },
      { name: 'Beschreibung', value: truncate(panel.description || '—', 1024) },
      { name: 'Bewerbungen', value: truncate(panel.types.map((id) => store.typeById(guildId, id)).filter(Boolean).map((t) => `${t.emoji} ${t.name}${t.questions.length ? '' : ' ⚠️ keine Fragen'}`).join('\n') || '— wähle unten welche aus', 1024) },
      { name: 'Gepostet in', value: posts.map((p) => `https://discord.com/channels/${guildId}/${p.channelId}/${p.messageId}`).join('\n') || 'noch nirgends – wähle unten einen Kanal', inline: false },
    );
  if (panel.image) e.setImage(panel.image);
  return {
    embeds: [e],
    components: [
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`dash:ptypes:${panel.id}`)
          .setPlaceholder('Welche Bewerbungen sind in diesem Panel?')
          .setMinValues(0)
          .setMaxValues(Math.min(types.length, 25))
          .addOptions(types.slice(0, 25).map((t) => ({ label: truncate(t.name, 100), value: t.id, emoji: t.emoji, default: panel.types.includes(t.id) }))),
      ),
      row(
        new ChannelSelectMenuBuilder()
          .setCustomId(`dash:ppost:${panel.id}`)
          .setPlaceholder('📤 In einen Kanal posten …')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
      row(
        button(`pedit:${panel.id}`, 'Bearbeiten', ButtonStyle.Primary, '✏️'),
        button(`pdel:${panel.id}`, 'Löschen', ButtonStyle.Danger, '🗑️'),
        button('panels', 'Zurück', ButtonStyle.Secondary, '⬅️'),
      ),
    ],
  };
}

function confirmView(text, yesId, noId) {
  return {
    embeds: [embed('danger').setDescription(text)],
    components: [row(button(yesId, 'Ja, löschen', ButtonStyle.Danger, '🗑️'), button(noId, 'Abbrechen', ButtonStyle.Secondary))],
  };
}

function homeViewWithNotice(guildId, text, userId = '') {
  return { ...homeView(guildId, userId), content: `❌ ${text}` };
}

// ---------- Formulare ----------

function appModal(type) {
  return new ModalBuilder()
    .setCustomId(type ? `dash:appeditsubmit:${type.id}` : 'dash:newappsubmit')
    .setTitle(type ? truncate(`Bearbeiten – ${type.name}`, 45) : 'Neue Bewerbung')
    .addComponents(
      input('name', 'Name', { required: true, max: 80, value: type?.name, placeholder: 'z. B. Polizei-Bewerbung, SEK, Sanitäter' }),
      input('emoji', 'Emoji', { max: 64, value: type?.emoji, placeholder: '📝' }),
      input('description', 'Beschreibung (im Panel)', { style: TextInputStyle.Paragraph, max: 500, value: type?.description }),
      input('prefix', 'Kürzel der Nummer (1–6 Zeichen A-Z, 0-9)', { max: 6, value: type?.numberPrefix, placeholder: 'leer = aus dem Namen' }),
    );
}

function textsModal(type) {
  const modal = new ModalBuilder().setCustomId(`dash:textssubmit:${type.id}`).setTitle(truncate(`Texte – ${type.name}`, 45));
  for (const [key, label] of Object.entries(MESSAGE_FIELDS)) {
    modal.addComponents(input(key, label, { style: TextInputStyle.Paragraph, max: 1500, value: type.messages[key], placeholder: 'Leer = Standardtext' }));
  }
  return modal;
}

function questionModal(typeId, questionType, question, number) {
  const modal = new ModalBuilder()
    .setCustomId(question ? `dash:qeditsubmit:${typeId}:${number}` : `dash:qaddsubmit:${typeId}:${questionType}`)
    .setTitle(question ? `Frage ${number} bearbeiten` : `Neue Frage – ${QUESTION_TYPES[questionType]}`)
    .addComponents(
      input('label', 'Frage', { required: true, max: 250, value: question?.label, placeholder: 'z. B. Warum möchtest du zu uns?' }),
      input('description', 'Hinweis unter der Frage (optional)', { style: TextInputStyle.Paragraph, max: 500, value: question?.description }),
    );
  if (questionType === 'TEXT') {
    const length = question ? `${question.min ?? 0}-${question.max ?? 1000}` : '';
    modal.addComponents(input('length', 'Länge in Zeichen: min-max', { max: 11, value: length, placeholder: '20-1000 (leer = bis 1000)' }));
  }
  if (questionType === 'CHOICE' || questionType === 'ROLE') {
    const value = question?.options?.map((o) => o.label).join('\n');
    modal.addComponents(
      input('options', questionType === 'ROLE' ? 'Rollen (Name oder ID, eine pro Zeile)' : 'Antworten (eine pro Zeile, max. 25)', {
        style: TextInputStyle.Paragraph,
        required: true,
        max: 2500,
        value,
        placeholder: questionType === 'ROLE' ? 'Streife\nVerkehrspolizei' : 'Täglich\nMehrmals pro Woche\nSelten',
      }),
      input('multiple', 'Mehrere Antworten erlaubt? (ja/nein)', { max: 4, value: question ? (question.multiple ? 'ja' : 'nein') : 'nein' }),
    );
  }
  modal.addComponents(input('required', 'Pflichtfrage? (ja/nein)', { max: 4, value: question ? (question.required === false ? 'nein' : 'ja') : 'ja' }));
  return modal;
}

// ---------- Eingaben aus Formularen ----------

function yesNo(text, fallback) {
  const value = text.trim().toLowerCase();
  if (!value) return fallback;
  if (['ja', 'j', 'yes', 'y', 'true', '1'].includes(value)) return true;
  if (['nein', 'n', 'no', 'false', '0'].includes(value)) return false;
  throw new Error(`Bitte „ja“ oder „nein“ eingeben (nicht „${text.trim()}“).`);
}

function parseLength(text) {
  const value = text.trim();
  if (!value) return { min: 0, max: 1000 };
  const match = value.match(/^(\d{1,4})\s*(?:-\s*(\d{1,4}))?$/);
  if (!match) throw new Error('Länge bitte als „min-max“ angeben, z. B. 20-1000.');
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : 1000;
  if (max < 1 || max > 5000 || min > max) throw new Error('Die Länge muss zwischen 0 und 5000 liegen, Minimum ≤ Maximum.');
  return { min, max };
}

function parseLines(text, type, guild) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Gib mindestens eine Antwort an.');
  if (lines.length > 25) throw new Error('Höchstens 25 Antworten.');
  if (type !== 'ROLE') {
    if (lines.some((l) => l.length > 100)) throw new Error('Eine Antwort darf höchstens 100 Zeichen lang sein.');
    if (new Set(lines.map((l) => l.toLowerCase())).size !== lines.length) throw new Error('Jede Antwort darf nur einmal vorkommen.');
    return lines.map((label) => ({ label }));
  }
  const roles = lines.map((line) => {
    const id = line.match(/(\d{17,20})/)?.[1];
    const name = line.replace(/^@/, '').toLowerCase();
    const role = (id && guild.roles.cache.get(id)) || guild.roles.cache.find((r) => r.name.toLowerCase() === name);
    if (!role) throw new Error(`Die Rolle „${line}“ gibt es auf diesem Server nicht.`);
    return { label: truncate(role.name, 100), roleId: role.id };
  });
  if (new Set(roles.map((r) => r.roleId)).size !== roles.length) throw new Error('Jede Rolle darf nur einmal vorkommen.');
  return roles;
}

function questionFromModal(interaction, questionType) {
  const f = interaction.fields;
  const has = (id) => {
    try {
      f.getTextInputValue(id);
      return true;
    } catch {
      return false;
    }
  };
  const fields = {
    label: f.getTextInputValue('label').trim(),
    description: f.getTextInputValue('description').trim(),
    required: yesNo(f.getTextInputValue('required'), true),
  };
  if (has('length')) Object.assign(fields, parseLength(f.getTextInputValue('length')));
  if (has('options')) {
    fields.options = parseLines(f.getTextInputValue('options'), questionType, interaction.guild);
    fields.multiple = yesNo(f.getTextInputValue('multiple'), false);
  }
  return fields;
}

// ---------- Ablauf ----------

// Antwortet auf Buttons/Menüs/Formulare, indem die Übersichts-Nachricht ersetzt wird.
async function show(interaction, view, notice) {
  const payload = { content: notice ?? '', allowedMentions: { parse: [] }, ...view };
  if (interaction.isModalSubmit() && !interaction.isFromMessage()) return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  return interaction.update(payload);
}

const refresh = (guild) => messages.refreshPanels(guild).catch((err) => console.error('[appPanel]', err.message));

async function open(interaction) {
  searches.delete(`${interaction.guildId}:${interaction.user.id}`);
  return interaction.reply({ ...homeView(interaction.guildId, interaction.user.id), flags: MessageFlags.Ephemeral });
}

async function handle(interaction, [action, a, b, c]) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Dafür brauchst du „Server verwalten“.', flags: MessageFlags.Ephemeral });
  }
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const type = a ? store.types(guildId).find((t) => t.id === a) : null;
  const fail = (view, error) => show(interaction, view, `❌ ${error}`);

  try {
    switch (action) {
      // Bewerbungen
      case 'home':
        return show(interaction, homeView(guildId, userId));
      case 'search':
        return interaction.showModal(
          new ModalBuilder().setCustomId('dash:searchsubmit').setTitle('Bewerbungen suchen').addComponents(input('query', 'Suchtext', { max: 80, value: searches.get(`${guildId}:${userId}`) })),
        );
      case 'searchsubmit': {
        const query = interaction.fields.getTextInputValue('query').trim();
        if (query) searches.set(`${guildId}:${userId}`, query);
        else searches.delete(`${guildId}:${userId}`);
        return show(interaction, homeView(guildId, userId));
      }
      case 'clearsearch':
        searches.delete(`${guildId}:${userId}`);
        return show(interaction, homeView(guildId, userId));
      case 'newapp':
        return interaction.showModal(appModal());
      case 'newappsubmit':
      case 'appeditsubmit': {
        const f = interaction.fields;
        const fields = {
          name: f.getTextInputValue('name'),
          emoji: f.getTextInputValue('emoji').trim() || '📝',
          description: f.getTextInputValue('description'),
          numberPrefix: f.getTextInputValue('prefix').trim() || undefined,
        };
        if (action === 'newappsubmit') {
          const result = manage.createType(guildId, fields);
          if (result.error) return fail(homeView(guildId, userId), result.error);
          refresh(interaction.guild);
          const where = result.panel ? ` Sie ist im Panel **${result.panel.name}**.` : '';
          return show(interaction, appView(guildId, result.type.id), `✅ **${result.type.name}** angelegt. Füge jetzt Fragen hinzu.${where}`);
        }
        const result = manage.updateType(guildId, a, { ...fields, description: fields.description.trim() || '-' });
        if (result.error) return fail(appView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, appView(guildId, a), '✅ Gespeichert.');
      }
      case 'openapp':
        return show(interaction, appView(guildId, interaction.values[0]));
      case 'app':
        return show(interaction, appView(guildId, a));
      case 'appedit':
        return type ? interaction.showModal(appModal(type)) : show(interaction, homeView(guildId, userId));
      case 'texts':
        return type ? interaction.showModal(textsModal(type)) : show(interaction, homeView(guildId, userId));
      case 'textssubmit': {
        const values = Object.fromEntries(Object.keys(MESSAGE_FIELDS).map((key) => [key, interaction.fields.getTextInputValue(key)]));
        const result = manage.setMessages(guildId, a, values);
        if (result.error) return fail(appView(guildId, a), result.error);
        return show(
          interaction,
          appView(guildId, a),
          '✅ Texte gespeichert. Variablen: `{applicant}` `{applicationName}` `{number}` `{user}` `{reason}` `{questionCount}` `{timeLimit}`',
        );
      }
      case 'toggle':
      case 'workflow': {
        if (!type) return show(interaction, homeView(guildId, userId));
        const fields = action === 'toggle' ? { enabled: !type.enabled } : { workflow: type.workflow === 'police' ? 'simple' : 'police' };
        const result = manage.updateType(guildId, a, fields);
        if (result.error) return fail(appView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, appView(guildId, a));
      }
      case 'del':
        if (!type) return show(interaction, homeView(guildId, userId));
        return show(interaction, confirmView(`**${type.name}** wirklich löschen? Alte Bewerbungen dafür bleiben mit \`/bewerbungen\` lesbar.`, `delyes:${a}`, `app:${a}`));
      case 'delyes': {
        const result = manage.deleteType(guildId, a);
        if (result.error) return fail(appView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, homeView(guildId, userId), `🗑️ **${result.name}** gelöscht.`);
      }

      // Fragen
      case 'qadd':
        return interaction.showModal(questionModal(a, interaction.values[0]));
      case 'qaddsubmit': {
        let fields;
        try {
          fields = { type: b, ...questionFromModal(interaction, b) };
        } catch (err) {
          return fail(appView(guildId, a), err.message);
        }
        const result = manage.addQuestion(guildId, a, fields);
        if (result.error) return fail(appView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, appView(guildId, a), '✅ Frage hinzugefügt.');
      }
      case 'qopen':
        return show(interaction, questionView(guildId, a, Number(interaction.values[0])));
      case 'qedit': {
        const q = type?.questions[Number(b) - 1];
        return q ? interaction.showModal(questionModal(a, q.type, q, Number(b))) : show(interaction, appView(guildId, a));
      }
      case 'qeditsubmit': {
        const q = type?.questions[Number(b) - 1];
        if (!q) return show(interaction, appView(guildId, a));
        let fields;
        try {
          fields = questionFromModal(interaction, q.type);
        } catch (err) {
          return fail(questionView(guildId, a, Number(b)), err.message);
        }
        const result = manage.updateQuestion(guildId, a, Number(b), fields);
        if (result.error) return fail(questionView(guildId, a, Number(b)), result.error);
        return show(interaction, questionView(guildId, a, Number(b)), '✅ Frage gespeichert.');
      }
      case 'qmove': {
        const target = Number(b) + (c === 'up' ? -1 : 1);
        const result = manage.moveQuestion(guildId, a, Number(b), target);
        if (result.error) return fail(appView(guildId, a), result.error);
        return show(interaction, questionView(guildId, a, target));
      }
      case 'qdel': {
        const result = manage.removeQuestion(guildId, a, Number(b));
        if (result.error) return fail(appView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, appView(guildId, a), `🗑️ Frage „${truncate(result.removed.label, 200)}“ entfernt.`);
      }

      // Panels
      case 'panels':
        return show(interaction, panelsView(guildId));
      case 'newpanel':
      case 'pedit': {
        const panel = action === 'pedit' ? panels.getPanel(guildId, a) : null;
        if (action === 'pedit' && !panel) return show(interaction, panelsView(guildId));
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(panel ? `dash:peditsubmit:${panel.id}` : 'dash:newpanelsubmit')
            .setTitle(panel ? truncate(`Panel – ${panel.name}`, 45) : 'Neues Panel')
            .addComponents(
              input('name', 'Name (nur für dich)', { required: true, max: 80, value: panel?.name, placeholder: 'z. B. Polizei' }),
              input('title', 'Überschrift im Panel', { max: 200, value: panel?.title, placeholder: 'leer = Name' }),
              input('description', 'Text im Panel', { style: TextInputStyle.Paragraph, max: 2000, value: panel?.description }),
              input('image', 'Bild-URL (optional)', { max: 500, value: panel?.image, placeholder: 'https://…' }),
            ),
        );
      }
      case 'newpanelsubmit':
      case 'peditsubmit': {
        const f = interaction.fields;
        const fields = { name: f.getTextInputValue('name'), title: f.getTextInputValue('title'), description: f.getTextInputValue('description'), image: f.getTextInputValue('image') };
        if (action === 'newpanelsubmit') {
          // Neues Panel: alle Bewerbungen vorauswählen, abwählen geht danach im Menü
          const result = panels.createPanel(guildId, { ...fields, types: store.types(guildId).slice(0, 25).map((t) => t.id) });
          if (result.error) return fail(panelsView(guildId), result.error);
          return show(interaction, panelView(guildId, result.panel.id), '✅ Panel angelegt. Wähle die Bewerbungen und poste es in einen Kanal.');
        }
        const result = panels.updatePanel(guildId, a, { ...fields, title: fields.title || fields.name });
        if (result.error) return fail(panelView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, panelView(guildId, a), '✅ Gespeichert.');
      }
      case 'openpanel':
        return show(interaction, panelView(guildId, interaction.values[0]));
      case 'panel':
        return show(interaction, panelView(guildId, a));
      case 'ptypes': {
        const result = panels.updatePanel(guildId, a, { types: interaction.values });
        if (result.error) return fail(panelView(guildId, a), result.error);
        refresh(interaction.guild);
        return show(interaction, panelView(guildId, a), '✅ Bewerbungen im Panel gespeichert.');
      }
      case 'ppost': {
        const panel = panels.getPanel(guildId, a);
        const channel = interaction.channels.first();
        if (!panel || !channel) return show(interaction, panelsView(guildId));
        if (!panels.activeTypes(guildId, panel).length) return fail(panelView(guildId, a), 'Im Panel ist keine Bewerbung mit Fragen. Wähle zuerst Bewerbungen aus.');
        try {
          await messages.postPanel(channel, panel.id);
        } catch (err) {
          return fail(panelView(guildId, a), `Ich kann in ${channel} nicht schreiben (${err.message}).`);
        }
        return show(interaction, panelView(guildId, a), `✅ Panel in ${channel} gepostet.`);
      }
      case 'pdel': {
        const panel = panels.getPanel(guildId, a);
        if (!panel) return show(interaction, panelsView(guildId));
        return show(interaction, confirmView(`Panel **${panel.name}** wirklich löschen? Gepostete Nachrichten werden ebenfalls entfernt.`, `pdelyes:${a}`, `panel:${a}`));
      }
      case 'pdelyes': {
        const result = await messages.deletePanel(interaction.guild, a);
        if (result.error) return fail(panelsView(guildId), result.error);
        return show(interaction, panelsView(guildId), `🗑️ Panel **${result.panel.name}** gelöscht.`);
      }
      default:
        return show(interaction, homeView(guildId, userId), 'Diese Ansicht ist veraltet.');
    }
  } catch (err) {
    console.error(`[dash:${action}]`, err);
    return show(interaction, homeView(guildId, userId), '❌ Da ist etwas schiefgelaufen.').catch(() => {});
  }
}

module.exports = { open, handle, homeView, appView, panelsView, panelView, questionView, describeQuestion, typeLine, parseLength, parseLines, yesNo };
