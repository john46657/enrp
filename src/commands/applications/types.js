// /bewerbungsart: Bewerbungsarten, Fragen, Texte, Rollen, Bewerbungsphasen und Dienstnummern direkt in Discord
// bearbeiten. Alle Änderungen gelten nur für den jeweiligen Server.
const { ActionRowBuilder, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const settings = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { parseLocalDate } = require('../../lib/time');
const store = require('../../lib/applications/store');
const flow = require('../../lib/applications/flow');
const { merge } = require('../../lib/applications/normalize');
const { validateType, QUESTION_TYPES, formatDuration } = require('../../lib/applications/forms');
const { refreshPanels } = require('../../lib/applications/messages');
const { respondTypes, findType } = require('../../lib/applications/choices');
const { formatNumber } = require('../../lib/applications/serviceNumbers');

const ROLE_LISTS = {
  managers: 'Manager (dürfen entscheiden)',
  ping: 'Ping bei neuen Bewerbungen',
  required: 'Erforderlich für die Bewerbung',
  blocked: 'Gesperrt für die Bewerbung',
  acceptAdd: 'Bei Annahme geben',
  acceptRemove: 'Bei Annahme nehmen',
  rejectAdd: 'Bei Ablehnung geben',
  rejectRemove: 'Bei Ablehnung nehmen',
  pending: 'Ausstehend (solange offen)',
  removeOnSubmit: 'Beim Einreichen nehmen',
};
const MESSAGE_FIELDS = { start: 'Startnachricht', finish: 'Abschlussnachricht', accept: 'Annahme', reject: 'Ablehnung' };
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|<a?:\w+:\d+>)/u;
const MAX_TYPES = 25;

const artOption = (o) => o.setName('art').setDescription('Welche Bewerbungsart?').setRequired(true).setAutocomplete(true);
const typeChoices = (o) => o.addChoices(...Object.entries(QUESTION_TYPES).map(([value, name]) => ({ name, value })));

const data = new SlashCommandBuilder()
  .setName('bewerbungsart')
  .setDescription('Bewerbungsarten, Fragen, Texte, Phasen und Dienstnummern bearbeiten.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('erstellen')
      .setDescription('Legt eine neue Bewerbungsart an (Fragen fügst du danach hinzu).')
      .addStringOption((o) => o.setName('schluessel').setDescription('Kurzer Schlüssel, z. B. hundestaffel (a-z, 0-9, _ -)').setRequired(true).setMinLength(2).setMaxLength(24))
      .addStringOption((o) => o.setName('name').setDescription('Anzeigename, z. B. Hundestaffel').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji fürs Panel'))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel').setMaxLength(300))
      .addStringOption((o) =>
        o.setName('panel').setDescription('In welchem Panel? (Standard: Qualifikationen)').addChoices({ name: 'Bewerbungs-Panel', value: 'apply' }, { name: 'Qualifikations-Panel', value: 'quali' }),
      )
      .addStringOption((o) =>
        o
          .setName('ablauf')
          .setDescription('Statusablauf (Standard: einfach)')
          .addChoices({ name: 'Einfach: offen → angenommen/abgelehnt', value: 'simple' }, { name: 'Polizei: mit Prüfung, Gespräch, Entscheidung', value: 'police' }),
      )
      .addStringOption((o) => o.setName('praefix').setDescription('Präfix der Bewerbungsnummer, z. B. HS → HS-0001').setMaxLength(8)),
  )
  .addSubcommand((s) =>
    s
      .setName('bearbeiten')
      .setDescription('Ändert Name, Emoji, Beschreibung, Ablauf, Präfix oder Formular-Art.')
      .addStringOption(artOption)
      .addStringOption((o) => o.setName('name').setDescription('Anzeigename').setMaxLength(80))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji fürs Panel'))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel (- = leeren)').setMaxLength(300))
      .addStringOption((o) =>
        o
          .setName('ablauf')
          .setDescription('Statusablauf')
          .addChoices({ name: 'Einfach: offen → angenommen/abgelehnt', value: 'simple' }, { name: 'Polizei: mit Prüfung, Gespräch, Entscheidung', value: 'police' }),
      )
      .addStringOption((o) => o.setName('praefix').setDescription('Präfix der Bewerbungsnummer').setMaxLength(8))
      .addStringOption((o) =>
        o
          .setName('formular')
          .setDescription('Wie werden die Fragen gestellt?')
          .addChoices({ name: 'Per Direktnachricht', value: 'DM' }, { name: 'Im Browser (Web-Formular, braucht WEB_URL)', value: 'WEB' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('loeschen')
      .setDescription('Löscht eine Bewerbungsart auf diesem Server (eingegangene Bewerbungen bleiben erhalten).')
      .addStringOption(artOption)
      .addBooleanOption((o) => o.setName('bestaetigen').setDescription('Wirklich löschen?').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('anzeigen').setDescription('Zeigt alle Einstellungen und Fragen einer Bewerbungsart.').addStringOption(artOption))
  .addSubcommand((s) => s.setName('texte').setDescription('Start-, Abschluss-, Annahme- und Ablehnungstext bearbeiten.').addStringOption(artOption))
  .addSubcommand((s) =>
    s
      .setName('frage-hinzufuegen')
      .setDescription('Fügt eine Frage hinzu.')
      .addStringOption(artOption)
      .addStringOption((o) => typeChoices(o.setName('typ').setDescription('Art der Frage').setRequired(true)))
      .addStringOption((o) => o.setName('frage').setDescription('Text der Frage').setRequired(true).setMaxLength(200))
      .addBooleanOption((o) => o.setName('pflicht').setDescription('Muss beantwortet werden? (Standard: ja)'))
      .addIntegerOption((o) => o.setName('min').setDescription('Freitext: Mindestlänge').setMinValue(0).setMaxValue(5000))
      .addIntegerOption((o) => o.setName('max').setDescription('Freitext: Höchstlänge').setMinValue(1).setMaxValue(5000))
      .addStringOption((o) => o.setName('optionen').setDescription('Auswahl: "A; B; C" · Rollen-Auswahl: "Streife = @Rolle; SEK = @Rolle"').setMaxLength(2000))
      .addBooleanOption((o) => o.setName('mehrfach').setDescription('Auswahl: mehrere Optionen erlauben?'))
      .addStringOption((o) => o.setName('hinweis').setDescription('Zusatztext unter der Frage').setMaxLength(500))
      .addIntegerOption((o) => o.setName('position').setDescription('An welcher Stelle? (Standard: am Ende)').setMinValue(1).setMaxValue(50)),
  )
  .addSubcommand((s) =>
    s
      .setName('frage-bearbeiten')
      .setDescription('Ändert eine Frage (nur angegebene Optionen).')
      .addStringOption(artOption)
      .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer der Frage (siehe /bewerbungsart anzeigen)').setRequired(true).setMinValue(1).setMaxValue(50))
      .addStringOption((o) => o.setName('frage').setDescription('Text der Frage').setMaxLength(200))
      .addBooleanOption((o) => o.setName('pflicht').setDescription('Muss beantwortet werden?'))
      .addIntegerOption((o) => o.setName('min').setDescription('Freitext: Mindestlänge (0 = keine)').setMinValue(0).setMaxValue(5000))
      .addIntegerOption((o) => o.setName('max').setDescription('Freitext: Höchstlänge').setMinValue(1).setMaxValue(5000))
      .addStringOption((o) => o.setName('optionen').setDescription('Auswahl: "A; B; C" · Rollen-Auswahl: "Streife = @Rolle; SEK = @Rolle"').setMaxLength(2000))
      .addBooleanOption((o) => o.setName('mehrfach').setDescription('Auswahl: mehrere Optionen erlauben?'))
      .addStringOption((o) => o.setName('hinweis').setDescription('Zusatztext unter der Frage (- = leeren)').setMaxLength(500)),
  )
  .addSubcommand((s) =>
    s
      .setName('frage-entfernen')
      .setDescription('Entfernt eine Frage.')
      .addStringOption(artOption)
      .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer der Frage').setRequired(true).setMinValue(1).setMaxValue(50)),
  )
  .addSubcommand((s) =>
    s
      .setName('frage-verschieben')
      .setDescription('Verschiebt eine Frage an eine andere Stelle.')
      .addStringOption(artOption)
      .addIntegerOption((o) => o.setName('nummer').setDescription('Nummer der Frage').setRequired(true).setMinValue(1).setMaxValue(50))
      .addIntegerOption((o) => o.setName('position').setDescription('Neue Stelle').setRequired(true).setMinValue(1).setMaxValue(50)),
  )
  .addSubcommand((s) =>
    s
      .setName('rollen')
      .setDescription('Rollen-Listen einer Bewerbungsart pflegen.')
      .addStringOption(artOption)
      .addStringOption((o) =>
        o
          .setName('liste')
          .setDescription('Welche Rollen-Liste?')
          .setRequired(true)
          .addChoices(...Object.entries(ROLE_LISTS).map(([value, name]) => ({ name, value }))),
      )
      .addStringOption((o) =>
        o
          .setName('aktion')
          .setDescription('Was tun?')
          .setRequired(true)
          .addChoices({ name: 'Rolle hinzufügen', value: 'add' }, { name: 'Rolle entfernen', value: 'remove' }, { name: 'Liste leeren', value: 'clear' }),
      )
      .addRoleOption((o) => o.setName('rolle').setDescription('Rolle (nicht nötig beim Leeren)'))
      .addStringOption((o) =>
        o.setName('erforderlich_modus').setDescription('Erforderliche Rollen: alle oder eine?').addChoices({ name: 'Alle nötig', value: 'all' }, { name: 'Eine genügt', value: 'any' }),
      )
      .addStringOption((o) =>
        o.setName('gesperrt_modus').setDescription('Gesperrte Rollen: sperrt eine oder erst alle zusammen?').addChoices({ name: 'Eine genügt', value: 'any' }, { name: 'Erst alle zusammen', value: 'all' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('phase')
      .setDescription('Bewerbungsphase: automatisch öffnen/schließen und Plätze begrenzen (- = leeren).')
      .addStringOption(artOption)
      .addStringOption((o) => o.setName('oeffnet').setDescription('z. B. 24.12.2026 18:00 (deutsche Zeit)'))
      .addStringOption((o) => o.setName('schliesst').setDescription('z. B. 31.12.2026 23:59 (deutsche Zeit)'))
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

// ---------- Hilfen ----------

const clearable = (value) => (value.trim() === '-' ? '' : value.trim());

function slug(text) {
  const map = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  return (
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => map[c])
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'frage'
  );
}

function uniqueKey(questions, label) {
  const base = slug(label);
  let key = base;
  for (let i = 2; questions.some((q) => q.key === key); i++) key = `${base.slice(0, 21)}_${i}`;
  return key;
}

// "A; B; C" → [{ label }] · bei Rollen-Auswahl "Streife = @Rolle; …" → [{ label, roleId }]
function parseOptions(text, questionType) {
  const parts = text
    .split(/[;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('Gib mindestens eine Option an, getrennt mit `;`.');
  return parts.map((part) => {
    if (questionType !== 'ROLE') return { label: part };
    const match = part.match(/^(.+?)\s*=\s*(?:<@&(\d+)>|(\d{15,25}))$/);
    if (!match) throw new Error(`„${part}“ verstehe ich nicht. Bei Rollen-Auswahl: \`Streife = @Rolle; SEK = @Rolle\``);
    return { label: match[1].trim(), roleId: match[2] ?? match[3] };
  });
}

function describeQuestion(q, index) {
  const details = [QUESTION_TYPES[q.type], q.required === false ? 'optional' : 'Pflicht'];
  if (q.type === 'TEXT' && (q.min || q.max)) details.push(`${q.min ?? 0}–${q.max ?? 5000} Zeichen`);
  if (q.options) details.push(`${q.multiple ? 'Mehrfach' : 'Einfach'}: ${q.options.map((o) => (o.roleId ? `${o.label} → <@&${o.roleId}>` : o.label)).join(', ')}`);
  return `**${index + 1}.** ${q.label}\n*${details.join(' · ')}*`;
}

const roleList = (ids) => ids.map((id) => `<@&${id}>`).join(' ') || '—';
const when = (value) => (store.toMs(value) ? `<t:${Math.floor(store.toMs(value) / 1000)}:f>` : '—');

function overview(guildId, type) {
  const phase = store.phaseOf(guildId, type);
  const sn = type.serviceNumber ?? {};
  const states = { open: '🟢 offen', disabled: '🔴 deaktiviert', before: '🟡 öffnet noch', after: '🔴 Phase beendet', full: '🔴 alle Plätze vergeben' };
  return embed()
    .setTitle(`${type.emoji} ${type.name}`)
    .setDescription(type.description || null)
    .addFields(
      {
        name: 'Allgemein',
        value: [
          `Schlüssel \`${type.id}\` · Nummern \`${type.numberPrefix}-0001\` · Panel: ${type.panel === 'apply' ? 'Bewerbungen' : 'Qualifikationen'}`,
          `Ablauf: ${type.workflow === 'police' ? 'Polizei (mit Zwischenschritten)' : 'einfach'} · Formular: ${type.mode === 'WEB' ? 'Browser' : 'Direktnachricht'}`,
          `Zeitlimit ${formatDuration(type.timeLimitMinutes)} · Wartezeit ${formatDuration(type.cooldownMinutes)} · Beim Verlassen: ${type.onLeave}`,
        ].join('\n'),
      },
      {
        name: 'Bewerbungsphase',
        value: `${states[phase.state]}\nÖffnet: ${when(type.phase?.opensAt)} · Schließt: ${when(type.phase?.closesAt)} · Plätze: ${phase.max ? `${phase.used}/${phase.max}` : 'unbegrenzt'}`,
      },
      {
        name: 'Dienstnummer',
        value: sn.enabled
          ? `✅ Format \`${sn.format}\` → z. B. **${formatNumber(sn, sn.start ?? 1)}** · Bereich ${sn.start}–${sn.end || '∞'}\nNickname: ${sn.nickname ? `\`${sn.nickname}\`` : 'unverändert'} · Freigeben beim Verlassen: ${sn.releaseOnLeave === false ? '❌' : '✅'}`
          : '❌ aus',
      },
      {
        name: 'Rollen',
        value: truncate(
          Object.entries(ROLE_LISTS)
            .filter(([key]) => type.roles[key].length)
            .map(([key, label]) => `${label}: ${roleList(type.roles[key])}`)
            .join('\n') || 'Keine Rollen eingestellt.',
          1024,
        ),
      },
      { name: `Fragen (${type.questions.length})`, value: truncate(type.questions.map(describeQuestion).join('\n') || 'Noch keine Fragen – `/bewerbungsart frage-hinzufuegen`.', 1024) },
    );
}

// Prüft die geänderte Art und speichert die genannten Felder für diesen Server.
function saveType(guildId, type, changes) {
  const candidate = merge(type, {});
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((target, key) => (target[key] ??= {}), candidate)[last] = value;
  }
  // Ohne Fragen kann sich niemand bewerben – erlaubt, solange die Art noch eingerichtet wird.
  const problems = validateType(candidate).filter((p) => !p.endsWith('keine Fragen'));
  if (problems.length) throw new Error(problems.join('\n'));
  for (const [path, value] of Object.entries(changes)) settings.set(guildId, `applications.types.${type.id}.${path}`, value);
}

function checkEmoji(emoji) {
  if (emoji && !EMOJI.test(emoji.trim())) throw new Error('Das Emoji muss ein normales Emoji (z. B. 🚓) oder ein Server-Emoji sein.');
  return emoji?.trim();
}

// ---------- Unterbefehle ----------

async function run(interaction) {
  const o = interaction.options;
  const guildId = interaction.guildId;
  const sub = o.getSubcommand();
  const types = store.types(guildId);

  if (sub === 'erstellen') {
    const id = o.getString('schluessel').trim().toLowerCase();
    if (types.some((t) => t.id === id)) throw new Error(`Den Schlüssel \`${id}\` gibt es schon.`);
    if (types.length >= MAX_TYPES) throw new Error(`Mehr als ${MAX_TYPES} Bewerbungsarten gehen nicht.`);
    const own = { id, name: o.getString('name').trim() };
    const emoji = checkEmoji(o.getString('emoji'));
    if (emoji) own.emoji = emoji;
    for (const [option, key] of [['beschreibung', 'description'], ['panel', 'panel'], ['ablauf', 'workflow']]) {
      if (o.getString(option)) own[key] = o.getString(option).trim();
    }
    if (o.getString('praefix')) own.numberPrefix = o.getString('praefix').trim().toUpperCase();
    else if (own.workflow === 'police') own.numberPrefix = 'APP';
    const type = merge(settings.forGuild(guildId).applications.defaults, own);
    const problems = validateType(type).filter((p) => !p.endsWith('keine Fragen'));
    if (problems.length) throw new Error(problems.join('\n'));
    settings.set(guildId, 'applications.types', [...types, type]);
    await refreshPanels(interaction.guild);
    return {
      content: `✅ **${type.name}** angelegt. Als Nächstes: \`/bewerbungsart frage-hinzufuegen\`, dann mit \`/einstellungen bewerbung\` Kanal und Rollen setzen.`,
      embeds: [overview(guildId, store.typeById(guildId, id))],
    };
  }

  const type = findType(guildId, o.getString('art'));
  if (!type) throw new Error(`Die Bewerbungsart „${o.getString('art')}“ gibt es auf diesem Server nicht.`);
  const done = (content) => ({ content, embeds: [overview(guildId, store.typeById(guildId, type.id))] });

  switch (sub) {
    case 'anzeigen':
      return { embeds: [overview(guildId, type)] };

    case 'loeschen': {
      if (!o.getBoolean('bestaetigen')) return { content: 'Abgebrochen.' };
      const open = store.openOf(guildId, (r) => r.type === type.id).length;
      if (open) throw new Error(`Es gibt noch ${open} offene Bewerbung(en) für **${type.name}**. Entscheide sie zuerst (\`/bewerbungen offen\`).`);
      await flow.cancelForType(interaction.client, guildId, type.id);
      settings.set(guildId, 'applications.types', types.filter((t) => t.id !== type.id));
      await refreshPanels(interaction.guild);
      return { content: `🗑️ **${type.name}** gelöscht. Bereits entschiedene Bewerbungen bleiben in der Statistik und im Verlauf.` };
    }

    case 'bearbeiten': {
      const changes = {};
      if (o.getString('name')) changes.name = o.getString('name').trim();
      const emoji = checkEmoji(o.getString('emoji'));
      if (emoji) changes.emoji = emoji;
      if (o.getString('beschreibung') !== null) changes.description = clearable(o.getString('beschreibung'));
      if (o.getString('ablauf') && o.getString('ablauf') !== type.workflow) {
        if (store.openOf(guildId, (r) => r.type === type.id).length) throw new Error('Der Ablauf lässt sich nur ändern, wenn keine Bewerbung dieser Art offen ist.');
        changes.workflow = o.getString('ablauf');
      }
      if (o.getString('praefix')) changes.numberPrefix = o.getString('praefix').trim().toUpperCase();
      if (o.getString('formular')) changes.mode = o.getString('formular');
      if (!Object.keys(changes).length) throw new Error('Du hast keine Option angegeben – es wurde nichts geändert.');
      saveType(guildId, type, changes);
      await refreshPanels(interaction.guild);
      const webHint = changes.mode === 'WEB' && !require('../../lib/web').enabled() ? '\n⚠️ Der Web-Teil ist nicht aktiv (WEB_URL fehlt in der .env) – bis dahin kommen die Fragen weiter per DM.' : '';
      return done(`✅ Gespeichert.${webHint}`);
    }

    case 'frage-hinzufuegen': {
      if (type.questions.length >= 50) throw new Error('Mehr als 50 Fragen gehen nicht.');
      const questionType = o.getString('typ');
      const question = { key: uniqueKey(type.questions, o.getString('frage')), type: questionType, label: o.getString('frage').trim(), required: o.getBoolean('pflicht') ?? true };
      if (questionType === 'TEXT') {
        if (o.getInteger('min')) question.min = o.getInteger('min');
        question.max = o.getInteger('max') ?? 1000;
        if (question.min > question.max) throw new Error('Die Mindestlänge ist größer als die Höchstlänge.');
      }
      if (questionType === 'CHOICE' || questionType === 'ROLE') {
        if (!o.getString('optionen')) throw new Error('Für eine Auswahl-Frage brauchst du `optionen`, z. B. `Täglich; Mehrmals pro Woche; Selten`.');
        question.options = parseOptions(o.getString('optionen'), questionType);
        question.multiple = o.getBoolean('mehrfach') ?? false;
      }
      if (o.getString('hinweis')) question.description = o.getString('hinweis').trim();
      const questions = [...type.questions];
      questions.splice(Math.min((o.getInteger('position') ?? questions.length + 1) - 1, questions.length), 0, question);
      saveType(guildId, type, { questions });
      await flow.cancelForType(interaction.client, guildId, type.id);
      return done(`✅ Frage hinzugefügt (${questions.length} Fragen).`);
    }

    case 'frage-bearbeiten':
    case 'frage-entfernen':
    case 'frage-verschieben': {
      const index = o.getInteger('nummer') - 1;
      if (!type.questions[index]) throw new Error(`Frage ${index + 1} gibt es nicht – **${type.name}** hat ${type.questions.length} Fragen.`);
      const questions = structuredClone(type.questions);
      let text;
      if (sub === 'frage-entfernen') {
        questions.splice(index, 1);
        text = '🗑️ Frage entfernt.';
      } else if (sub === 'frage-verschieben') {
        const [moved] = questions.splice(index, 1);
        questions.splice(Math.min(o.getInteger('position') - 1, questions.length), 0, moved);
        text = '↕️ Frage verschoben.';
      } else {
        const q = questions[index];
        if (o.getString('frage')) q.label = o.getString('frage').trim();
        if (o.getBoolean('pflicht') !== null) q.required = o.getBoolean('pflicht');
        if (o.getInteger('min') !== null) q.min = o.getInteger('min') || undefined;
        if (o.getInteger('max') !== null) q.max = o.getInteger('max');
        if (q.type === 'TEXT' && q.min > (q.max ?? 5000)) throw new Error('Die Mindestlänge ist größer als die Höchstlänge.');
        if (o.getString('optionen')) {
          if (q.type !== 'CHOICE' && q.type !== 'ROLE') throw new Error('Optionen gibt es nur bei Auswahl-Fragen.');
          q.options = parseOptions(o.getString('optionen'), q.type);
        }
        if (o.getBoolean('mehrfach') !== null) q.multiple = o.getBoolean('mehrfach');
        if (o.getString('hinweis') !== null) q.description = clearable(o.getString('hinweis')) || undefined;
        text = '✅ Frage geändert.';
      }
      saveType(guildId, type, { questions: JSON.parse(JSON.stringify(questions)) });
      await flow.cancelForType(interaction.client, guildId, type.id);
      return done(text);
    }

    case 'rollen': {
      const key = o.getString('liste');
      const action = o.getString('aktion');
      const role = o.getRole('rolle');
      if (action !== 'clear' && !role) throw new Error('Gib die Rolle an.');
      if (role?.id === interaction.guildId) throw new Error('@everyone kann hier nicht verwendet werden.');
      const current = type.roles[key];
      const next = action === 'clear' ? [] : action === 'add' ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id);
      const changes = { [`roles.${key}`]: next };
      if (o.getString('erforderlich_modus')) changes['roles.requiredMode'] = o.getString('erforderlich_modus');
      if (o.getString('gesperrt_modus')) changes['roles.blockedMode'] = o.getString('gesperrt_modus');
      saveType(guildId, type, changes);
      return done(`✅ ${ROLE_LISTS[key]}: ${roleList(next)}`);
    }

    case 'phase': {
      const changes = {};
      for (const [option, key] of [['oeffnet', 'opensAt'], ['schliesst', 'closesAt']]) {
        const raw = o.getString(option);
        if (raw !== null) changes[`phase.${key}`] = clearable(raw) ? parseLocalDate(raw) : null;
      }
      if (o.getInteger('plaetze') !== null) changes['phase.maxApplications'] = o.getInteger('plaetze');
      if (!Object.keys(changes).length) throw new Error('Du hast keine Option angegeben – es wurde nichts geändert.');
      const opens = 'phase.opensAt' in changes ? changes['phase.opensAt'] : store.toMs(type.phase?.opensAt);
      const closes = 'phase.closesAt' in changes ? changes['phase.closesAt'] : store.toMs(type.phase?.closesAt);
      if (opens && closes && closes <= opens) throw new Error('Die Phase muss nach dem Öffnen schließen.');
      saveType(guildId, type, changes);
      await refreshPanels(interaction.guild);
      return done('✅ Bewerbungsphase gespeichert. Das Panel aktualisiert sich automatisch, wenn die Phase öffnet oder schließt.');
    }

    case 'dienstnummer': {
      const changes = {};
      const mapping = [
        ['aktiv', 'enabled', 'getBoolean'],
        ['format', 'format', 'getString', (v) => v.trim()],
        ['stellen', 'digits', 'getInteger'],
        ['start', 'start', 'getInteger'],
        ['ende', 'end', 'getInteger'],
        ['nickname', 'nickname', 'getString', clearable],
        ['freigeben_bei_verlassen', 'releaseOnLeave', 'getBoolean'],
      ];
      for (const [option, key, getter, transform = (v) => v] of mapping) {
        const raw = o[getter](option);
        if (raw !== null) changes[`serviceNumber.${key}`] = transform(raw);
      }
      if (!Object.keys(changes).length) throw new Error('Du hast keine Option angegeben – es wurde nichts geändert.');
      const next = { ...type.serviceNumber, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k.split('.')[1], v])) };
      if (next.end > 0 && next.end < next.start) throw new Error('Die letzte Nummer ist kleiner als die erste.');
      saveType(guildId, type, changes);
      return done('✅ Dienstnummer-Automatik gespeichert.');
    }

    default:
      throw new Error('Unbekannter Unterbefehl.');
  }
}

module.exports = {
  data,
  parseOptions,
  autocomplete: (interaction) => respondTypes(interaction),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'texte') {
      const type = findType(interaction.guildId, interaction.options.getString('art'));
      if (!type) return replyPrivate(interaction, 'Diese Bewerbungsart gibt es auf diesem Server nicht.');
      const modal = new ModalBuilder().setCustomId(`apptype:texts:${type.id}`).setTitle(truncate(`Texte – ${type.name}`, 45));
      for (const [key, label] of Object.entries(MESSAGE_FIELDS)) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true).setValue(truncate(type.messages[key], 4000)),
          ),
        );
      }
      return interaction.showModal(modal);
    }
    try {
      return await replyPrivate(interaction, await run(interaction));
    } catch (err) {
      if (err.name !== 'Error') throw err;
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
  },

  components: {
    // Formular aus /bewerbungsart texte
    async apptype(interaction, [action, typeId]) {
      if (action !== 'texts') return replyPrivate(interaction, 'Diese Aktion ist veraltet.');
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return replyPrivate(interaction, 'Dafür brauchst du „Server verwalten“.');
      const type = store.typeById(interaction.guildId, typeId);
      if (!type) return replyPrivate(interaction, 'Diese Bewerbungsart gibt es nicht mehr.');
      for (const key of Object.keys(MESSAGE_FIELDS)) {
        const text = interaction.fields.getTextInputValue(key).trim();
        if (text !== type.messages[key]) settings.set(interaction.guildId, `applications.types.${type.id}.messages.${key}`, text);
      }
      return replyPrivate(interaction, `✅ Texte für **${type.name}** gespeichert. Variablen: \`{applicant}\` \`{applicationName}\` \`{number}\` \`{user}\` \`{reason}\` \`{questionCount}\` \`{timeLimit}\` \`{serviceNumber}\``);
    },
  },
};
