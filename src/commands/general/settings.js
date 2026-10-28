const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const settings = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { refreshPanels } = require('../../lib/tickets');
const appMessages = require('../../lib/applications/messages');
const stats = require('../../lib/stats');
const { isValidTimeZone } = require('../../lib/time');

const CHANNELS = {
  welcome: 'Willkommen',
  modLog: 'Mod-Log',
  ticketLog: 'Ticket-Log',
  levelUp: 'Level-Up',
};
const ROLES = {
  autoRole: 'Auto-Rolle',
  support: 'Support',
  staff: 'Staff',
};
const DAY_ORDER = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

// "mo-fr 15:00-23:00; sa,so 12:00-24:00" → [{ days, from, to }]
function parsePeriods(text) {
  return text.split(';').map((part) => {
    const match = part.trim().toLowerCase().match(/^([a-z,\s-]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!match) throw new Error(`„${part.trim()}“ verstehe ich nicht. Beispiel: \`mo-fr 15:00-23:00; sa,so 12:00-24:00\``);
    const days = [];
    for (const token of match[1].split(',').map((t) => t.trim()).filter(Boolean)) {
      const [start, end = start] = token.split('-').map((t) => t.trim());
      const a = DAY_ORDER.indexOf(start);
      const b = DAY_ORDER.indexOf(end);
      if (a < 0 || b < 0 || b < a) throw new Error(`Unbekannte Tage „${token}“. Erlaubt: ${DAY_ORDER.join(', ')}`);
      days.push(...DAY_ORDER.slice(a, b + 1));
    }
    const [from, to] = [match[2], match[3]].map((t) => t.padStart(5, '0'));
    for (const time of [from, to]) {
      const [h, m] = time.split(':').map(Number);
      if (h > 24 || m > 59 || (h === 24 && m > 0)) throw new Error(`Ungültige Uhrzeit „${time}“`);
    }
    return { days: [...new Set(days)], from, to };
  });
}

const formatPeriods = (periods) => periods.map((p) => `${p.days.join(',')} ${p.from}-${p.to}`).join('; ') || '—';
const channel = (id) => (id ? `<#${id}>` : '—');
const role = (id) => (id ? `<@&${id}>` : '—');
const onOff = (value) => (value ? '✅' : '❌');
const LEAVE_LABELS = { nothing: 'nichts', notify: 'Hinweis', close: 'schließen' };

// Eine Zeile je Ticket-Kategorie, abweichende Einstellungen werden angehängt.
function typeLine(x) {
  const extras = [
    x.enabled === false && 'deaktiviert',
    x.allowClaim === false && 'ohne Claim',
    x.allowOnBehalf === false && 'kein /ticket fuer',
    x.onlyTeamCanClose !== undefined && `nur Team schließt ${onOff(x.onlyTeamCanClose)}`,
    x.onCreatorLeave && `Verlassen: ${LEAVE_LABELS[x.onCreatorLeave]}`,
    x.autoClose && `Auto-Close ${x.autoClose.enabled ? `${x.autoClose.afterHours} Std.` : '❌'}`,
    x.autoTeamAlert && `Erinnerung ${x.autoTeamAlert.enabled ? `${x.autoTeamAlert.afterMinutes} Min.` : '❌'}`,
    x.closeForm?.length && `Formular ${x.closeForm.length} Feld(er)`,
    (x.openEmbed?.title || x.openEmbed?.description) && 'eigenes Eröffnungs-Embed',
  ].filter(Boolean);
  return (
    `${x.emoji} **${x.label}** – Kapazität ${x.capacity || '—'}, Team: ${x.roles?.length ? x.roles.map(role).join(' ') : 'Standard'}` +
    (extras.length ? ` · ${extras.join(' · ')}` : '')
  );
}

// Einstellungen dieses Servers (jeder Server hat seine eigenen).
function overview(guild) {
  const config = settings.forGuild(guild.id);
  const t = config.tickets;
  const changed = settings.overrideCount(guild.id);
  return embed()
    .setTitle(`⚙️ Einstellungen – ${guild.name}`)
    .setDescription(
      changed
        ? `${changed} Einstellung(en) wurden auf diesem Server geändert. \`/einstellungen zuruecksetzen\` stellt die config.json wieder her.`
        : 'Alle Werte kommen aus der config.json.',
    )
    .addFields(
      { name: 'Kanäle', value: Object.entries(CHANNELS).map(([k, l]) => `${l}: ${channel(config.channels[k])}`).join('\n'), inline: true },
      { name: 'Rollen', value: Object.entries(ROLES).map(([k, l]) => `${l}: ${role(config.roles[k])}`).join('\n'), inline: true },
      {
        name: 'Tickets',
        value: [
          `Kategorie: ${channel(t.categoryId)}`,
          `Claim-Kategorie: ${onOff(t.claimCategory.enabled)} ${channel(t.claimCategory.categoryId)}`,
          `Max. offen pro Nutzer: ${t.maxOpenPerUser || 'kein Limit'}`,
          `Kanalname: \`${t.channelName}\``,
          `Team markieren: ${onOff(t.pingTeam)} · Nur Team schließt: ${onOff(t.onlyTeamCanClose)}`,
          `Ersteller fügt hinzu: ${onOff(t.creatorCanAddUsers)} · Bei Verlassen: ${LEAVE_LABELS[t.onCreatorLeave] ?? t.onCreatorLeave}`,
          `Aktivitäten loggen: ${onOff(t.logging.activities)} · Transkripte: ${onOff(t.logging.transcripts)}`,
          `Auslastung anzeigen: ${onOff(t.panel.showLoad)}`,
          `Auto-Team-Alert: ${t.autoTeamAlert.enabled ? `nach ${t.autoTeamAlert.afterMinutes} Min.` : '❌'}`,
          `Auto-Unclaim: ${t.autoUnclaim.enabled ? `nach ${t.autoUnclaim.afterHours} Std.` : '❌'}`,
          `Auto-Close: ${t.autoClose?.enabled ? `nach ${t.autoClose.afterHours} Std. ohne Nachricht` : '❌'}`,
        ].join('\n'),
      },
      {
        name: 'Ticket-Kategorien',
        value: truncate(t.types.map(typeLine).join('\n'), 1024),
      },
      {
        name: 'Öffnungszeiten',
        value: `${onOff(t.openingHours.enabled)} ${t.openingHours.timezone}\n${formatPeriods(t.openingHours.periods)}`,
      },
      {
        name: 'Level-System',
        value:
          `${onOff(config.leveling.enabled)} · Cooldown ${config.leveling.cooldownSeconds}s\n` +
          (Object.entries(config.leveling.roleRewards)
            .sort(([a], [b]) => a - b)
            .map(([level, id]) => `Level ${level}: ${role(id)}`)
            .join('\n') || 'Keine Belohnungen'),
        inline: true,
      },
      {
        name: 'FiveM',
        value: `Adresse: ${config.fivem.address ? `\`${config.fivem.address}\`` : '—'}\nVerbinden: ${config.fivem.connectUrl || '—'}`,
        inline: true,
      },
      {
        name: 'Bewerbungen',
        value: truncate(
          `Bewerbungs-Kanal: ${channel(config.applications.channel)} · Qualifikations-Kanal: ${channel(config.applications.qualiChannel)}\n` +
            config.applications.types
              .map(
                (t) =>
                  `${t.emoji} **${t.name}** ${onOff(t.enabled)} · Panel ${t.panel} · Kanal ${channel(t.channels.open)} · ` +
                  `Manager ${t.roles.managers.map(role).join(' ') || '—'} · Wartezeit ${t.cooldownMinutes} Min. · Verlassen: ${t.onLeave}`,
              )
              .join('\n'),
          1024,
        ),
      },
      {
        name: 'Server-Statistiken',
        value: `${onOff(config.stats.enabled)} · Kategorie ${channel(config.stats.categoryId)}\n${config.stats.counters.map((c) => `\`${c.name}\``).join('\n') || '—'}`,
      },
      { name: 'Zeitzone', value: config.timezone, inline: true },
      { name: 'Willkommensnachricht', value: truncate(config.welcome.message, 1024) },
    );
}

// Optionen auslesen: [Optionsname, Einstellungspfad, Typ, Umwandlung?]
function collect(interaction, mapping) {
  const changes = [];
  for (const [option, path, type, transform = (v) => v] of mapping) {
    const raw = interaction.options[type](option);
    if (raw === null) continue;
    changes.push([path, transform(raw)]);
  }
  return changes;
}

const clearable = (value) => (value.trim() === '-' ? '' : value.trim());

const builder = new SlashCommandBuilder()
  .setName('einstellungen')
  .setDescription('Bot-Einstellungen direkt in Discord ändern.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('anzeigen').setDescription('Zeigt alle aktuellen Einstellungen.'))
  .addSubcommand((s) =>
    s
      .setName('kanal')
      .setDescription('Legt einen Kanal fest (ohne Kanal = entfernen).')
      .addStringOption((o) =>
        o
          .setName('typ')
          .setDescription('Welcher Kanal?')
          .setRequired(true)
          .addChoices(...Object.entries(CHANNELS).map(([value, name]) => ({ name, value }))),
      )
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  )
  .addSubcommand((s) =>
    s
      .setName('rolle')
      .setDescription('Legt eine Rolle fest (ohne Rolle = entfernen).')
      .addStringOption((o) =>
        o
          .setName('typ')
          .setDescription('Welche Rolle?')
          .setRequired(true)
          .addChoices(...Object.entries(ROLES).map(([value, name]) => ({ name, value }))),
      )
      .addRoleOption((o) => o.setName('rolle').setDescription('Rolle')),
  )
  .addSubcommand((s) =>
    s
      .setName('tickets')
      .setDescription('Ticket-Verhalten einstellen (nur angegebene Optionen werden geändert).')
      .addChannelOption((o) => o.setName('kategorie').setDescription('Discord-Kategorie für neue Tickets').addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption((o) =>
        o.setName('claim_kategorie').setDescription('Hierhin werden übernommene Tickets verschoben').addChannelTypes(ChannelType.GuildCategory),
      )
      .addBooleanOption((o) => o.setName('claim_verschieben').setDescription('Übernommene Tickets verschieben?'))
      .addIntegerOption((o) => o.setName('max_pro_nutzer').setDescription('Offene Tickets pro Nutzer (0 = kein Limit)').setMinValue(0).setMaxValue(50))
      .addBooleanOption((o) => o.setName('team_markieren').setDescription('Team beim Öffnen markieren?'))
      .addBooleanOption((o) => o.setName('nur_team_schliesst').setDescription('Darf nur das Team schließen?'))
      .addBooleanOption((o) => o.setName('ersteller_fuegt_hinzu').setDescription('Dürfen Ersteller Personen anfragen?'))
      .addStringOption((o) =>
        o.setName('bei_verlassen').setDescription('Wenn der Ersteller den Server verlässt').addChoices({ name: 'Nichts', value: 'nothing' }, { name: 'Hinweis im Ticket', value: 'notify' }, { name: 'Schließen', value: 'close' }),
      )
      .addStringOption((o) => o.setName('verlassen_text').setDescription('Hinweis/Grund beim Verlassen ({user} {username})').setMaxLength(500))
      .addBooleanOption((o) => o.setName('aktivitaeten_loggen').setDescription('Ticket-Aktivitäten in den Ticket-Log schreiben?'))
      .addBooleanOption((o) => o.setName('transkripte').setDescription('Verlauf beim Schließen speichern?'))
      .addBooleanOption((o) => o.setName('auslastung_anzeigen').setDescription('Auslastung im Panel anzeigen?'))
      .addStringOption((o) =>
        o.setName('kanalname').setDescription('z. B. %PREFIX% %USERNAME% – Platzhalter siehe README').setMaxLength(90),
      )
      .addIntegerOption((o) => o.setName('auto_alert_minuten').setDescription('Team erneut markieren nach X Minuten (0 = aus)').setMinValue(0).setMaxValue(10_080))
      .addIntegerOption((o) => o.setName('auto_unclaim_stunden').setDescription('Freigeben nach X Stunden Inaktivität (0 = aus)').setMinValue(0).setMaxValue(720))
      .addStringOption((o) => o.setName('auto_alert_text').setDescription('Text der Erinnerung ({user} {since}, - = Standard)').setMaxLength(500))
      .addIntegerOption((o) => o.setName('auto_close_stunden').setDescription('Schließen nach X Stunden ohne Nachricht (0 = aus)').setMinValue(0).setMaxValue(2160)),
  )
  .addSubcommand((s) =>
    s
      .setName('ticket-panel')
      .setDescription('Aussehen des Ticket-Panels (- = Feld leeren).')
      .addStringOption((o) => o.setName('titel').setDescription('Überschrift').setMaxLength(200))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Text unter der Überschrift').setMaxLength(1500))
      .addStringOption((o) => o.setName('banner').setDescription('Bild-URL (https://…)'))
      .addStringOption((o) => o.setName('fusszeile').setDescription('Kleiner Text ganz unten').setMaxLength(200))
      .addStringOption((o) => o.setName('platzhalter').setDescription('Text im Auswahlmenü').setMaxLength(150)),
  )
  .addSubcommand((s) =>
    s
      .setName('ticket-kategorie')
      .setDescription('Einstellungen einer Ticket-Kategorie.')
      .addStringOption((o) =>
        o
          .setName('kategorie')
          .setDescription('Welche Kategorie?')
          .setRequired(true)
          .addChoices(...settings.base.tickets.types.slice(0, 25).map((t) => ({ name: t.label, value: t.id }))),
      )
      .addIntegerOption((o) => o.setName('kapazitaet').setDescription('Plätze für die Auslastung (0 = ausblenden)').setMinValue(0).setMaxValue(1000))
      .addRoleOption((o) => o.setName('team_rolle').setDescription('Nur diese Rolle bearbeitet die Kategorie'))
      .addBooleanOption((o) => o.setName('standard_team').setDescription('Wieder die allgemeine Support-Rolle verwenden'))
      .addChannelOption((o) =>
        o.setName('discord_kategorie').setDescription('Eigene Discord-Kategorie für diese Tickets').addChannelTypes(ChannelType.GuildCategory),
      )
      .addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel').setMaxLength(500))
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Kategorie im Panel anbieten?'))
      .addBooleanOption((o) => o.setName('claimen').setDescription('Dürfen Tickets übernommen werden?'))
      .addBooleanOption((o) => o.setName('im_auftrag').setDescription('Darf das Team Tickets mit /ticket fuer öffnen?'))
      .addBooleanOption((o) => o.setName('nur_team_schliesst').setDescription('Ersteller kann nur um Schließung bitten, das Team stimmt zu'))
      .addStringOption((o) => o.setName('bei_verlassen').setDescription('Wenn der Ersteller den Server verlässt').addChoices({ name: 'Nichts', value: 'nothing' }, { name: 'Hinweis im Ticket', value: 'notify' }, { name: 'Schließen', value: 'close' }))
      .addStringOption((o) => o.setName('verlassen_text').setDescription('Hinweis/Grund beim Verlassen ({user} {username})').setMaxLength(500))
      .addIntegerOption((o) => o.setName('auto_close_stunden').setDescription('Schließen nach X Stunden ohne Nachricht (0 = aus)').setMinValue(0).setMaxValue(2160))
      .addIntegerOption((o) => o.setName('erinnerung_minuten').setDescription('Team erinnern, wenn niemand antwortet (0 = aus)').setMinValue(0).setMaxValue(10_080))
      .addStringOption((o) => o.setName('erinnerung_text').setDescription('Text der Erinnerung ({user} {since}, - = Standard)').setMaxLength(500))
      .addStringOption((o) => o.setName('eroeffnung_titel').setDescription('Titel des Eröffnungs-Embeds (- = Standard)').setMaxLength(200))
      .addStringOption((o) => o.setName('eroeffnung_text').setDescription('Text ({user} {username} {category} {number}, - = Standard)').setMaxLength(1500))
      .addStringOption((o) => o.setName('eroeffnung_bild').setDescription('Bild-URL im Eröffnungs-Embed (- = keins)'))
      .addBooleanOption((o) => o.setName('allgemein_verwenden').setDescription('Automationen und Schließ-Regeln wieder aus /einstellungen tickets')),
  )
  .addSubcommand((s) =>
    s
      .setName('ticket-formular')
      .setDescription('Formular beim Schließen einer Kategorie (max. 5 Felder).')
      .addStringOption((o) =>
        o
          .setName('kategorie')
          .setDescription('Welche Kategorie?')
          .setRequired(true)
          .addChoices(...settings.base.tickets.types.slice(0, 25).map((t) => ({ name: t.label, value: t.id }))),
      )
      .addIntegerOption((o) => o.setName('feld').setDescription('Feld 1–5').setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption((o) => o.setName('frage').setDescription('Frage / Label').setMaxLength(45))
      .addStringOption((o) =>
        o.setName('art').setDescription('Eingabefeld').addChoices({ name: 'Einzeiliger Text', value: 'short' }, { name: 'Mehrzeiliger Text', value: 'paragraph' }),
      )
      .addStringOption((o) => o.setName('platzhalter').setDescription('Platzhalter (- = keiner)').setMaxLength(100))
      .addIntegerOption((o) => o.setName('max_laenge').setDescription('Maximale Länge').setMinValue(1).setMaxValue(4000))
      .addBooleanOption((o) => o.setName('pflicht').setDescription('Pflichtfeld?'))
      .addBooleanOption((o) => o.setName('entfernen').setDescription('Dieses Feld löschen')),
  )
  .addSubcommand((s) =>
    s
      .setName('oeffnungszeiten')
      .setDescription('Wann das Team erreichbar ist.')
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Öffnungszeiten verwenden?'))
      .addStringOption((o) => o.setName('zeiten').setDescription('z. B. mo-fr 15:00-23:00; sa,so 12:00-24:00'))
      .addStringOption((o) => o.setName('zeitzone').setDescription('z. B. Europe/Berlin')),
  )
  .addSubcommand((s) =>
    s
      .setName('bewerbung')
      .setDescription('Einstellungen einer Bewerbungsart (nur angegebene Optionen werden geändert).')
      .addStringOption((o) =>
        o
          .setName('art')
          .setDescription('Welche Bewerbung?')
          .setRequired(true)
          .addChoices(...settings.base.applications.types.slice(0, 25).map((t) => ({ name: t.name, value: t.id }))),
      )
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Bewerbungen annehmen?'))
      .addStringOption((o) =>
        o.setName('panel').setDescription('In welchem Panel?').addChoices({ name: 'Bewerbungs-Panel', value: 'apply' }, { name: 'Qualifikations-Panel', value: 'quali' }),
      )
      .addChannelOption((o) => o.setName('kanal_offen').setDescription('Hier landen neue Bewerbungen').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('kanal_angenommen').setDescription('Kopie angenommener Bewerbungen').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('kanal_abgelehnt').setDescription('Kopie abgelehnter Bewerbungen').addChannelTypes(ChannelType.GuildText))
      .addRoleOption((o) => o.setName('manager_rolle').setDescription('Darf in Discord entscheiden'))
      .addRoleOption((o) => o.setName('ping_rolle').setDescription('Wird bei neuen Bewerbungen markiert'))
      .addRoleOption((o) => o.setName('annahme_rolle').setDescription('Bekommt man bei Annahme'))
      .addRoleOption((o) => o.setName('ausstehend_rolle').setDescription('Hat man, solange die Bewerbung offen ist'))
      .addRoleOption((o) => o.setName('erforderliche_rolle').setDescription('Ohne diese Rolle keine Bewerbung'))
      .addBooleanOption((o) => o.setName('rollen_leeren').setDescription('Alle Rollen-Einstellungen dieser Bewerbung leeren'))
      .addIntegerOption((o) => o.setName('wartezeit_minuten').setDescription('Wartezeit zwischen zwei Bewerbungen').setMinValue(0).setMaxValue(525_600))
      .addIntegerOption((o) => o.setName('zeitlimit_minuten').setDescription('Zeit zum Ausfüllen (5–10080)').setMinValue(5).setMaxValue(10_080))
      .addStringOption((o) =>
        o
          .setName('bei_verlassen')
          .setDescription('Was passiert, wenn der Bewerber den Server verlässt?')
          .addChoices({ name: 'Nichts', value: 'NONE' }, { name: 'Ablehnen', value: 'DENY' }, { name: 'Zurückziehen', value: 'WITHDRAW' }),
      )
      .addBooleanOption((o) => o.setName('team_threads').setDescription('Zu jeder Bewerbung einen Thread fürs Team öffnen?')),
  )
  .addSubcommand((s) =>
    s
      .setName('bewerbungs-kanaele')
      .setDescription('Standard-Kanäle für neue Bewerbungen (wenn eine Art keinen eigenen hat).')
      .addChannelOption((o) => o.setName('bewerbungen').setDescription('Für das Bewerbungs-Panel').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('qualifikationen').setDescription('Für das Qualifikations-Panel').addChannelTypes(ChannelType.GuildText)),
  )
  .addSubcommand((s) =>
    s
      .setName('willkommen')
      .setDescription('Willkommensnachricht ({user} {name} {server} {count}).')
      .addStringOption((o) => o.setName('nachricht').setDescription('Text der Nachricht').setMaxLength(1500).setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('level')
      .setDescription('Level-System einstellen.')
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Level-System an?'))
      .addIntegerOption((o) => o.setName('cooldown').setDescription('Sekunden zwischen XP-Vergaben').setMinValue(0).setMaxValue(3600))
      .addIntegerOption((o) => o.setName('belohnung_level').setDescription('Level für eine Rollen-Belohnung').setMinValue(1).setMaxValue(500))
      .addRoleOption((o) => o.setName('belohnung_rolle').setDescription('Rolle dafür (leer = Belohnung entfernen)')),
  )
  .addSubcommand((s) =>
    s
      .setName('fivem')
      .setDescription('Gameserver für /serverstatus (- = leeren).')
      .addStringOption((o) => o.setName('adresse').setDescription('IP:Port, z. B. 123.45.67.89:30120'))
      .addStringOption((o) => o.setName('verbinden_url').setDescription('z. B. https://cfx.re/join/abc123')),
  )
  .addSubcommand((s) =>
    s
      .setName('statistik')
      .setDescription('Server-Statistiken: Sprachkanäle mit Zählern (- = Standardname).')
      .addBooleanOption((o) => o.setName('aktiv').setDescription('Statistik-Kanäle anlegen und aktualisieren?'))
      .addChannelOption((o) => o.setName('kategorie').setDescription('Hier legt der Bot neue Statistik-Kanäle an').addChannelTypes(ChannelType.GuildCategory))
      .addStringOption((o) =>
        o
          .setName('art')
          .setDescription('Welche Statistik hinzufügen/ändern?')
          .addChoices(...Object.entries(stats.TYPES).map(([value, t]) => ({ name: t.label, value }))),
      )
      .addStringOption((o) => o.setName('name').setDescription('Kanalname mit {count}, z. B. 👥 Mitglieder: {count}').setMaxLength(90))
      .addBooleanOption((o) => o.setName('entfernen').setDescription('Diese Statistik und ihren Kanal löschen')),
  )
  .addSubcommand((s) =>
    s
      .setName('zeitzone')
      .setDescription('Zeitzone des Servers (Giveaway-Wochenplan, Abwesenheit, Transkripte, Statistiken).')
      .addStringOption((o) => o.setName('zone').setDescription('z. B. Europe/Berlin, Europe/Vienna, America/New_York').setRequired(true).setMaxLength(60)),
  )
  .addSubcommand((s) =>
    s
      .setName('zuruecksetzen')
      .setDescription('Verwirft alle in Discord geänderten Einstellungen dieses Servers.')
      .addBooleanOption((o) => o.setName('bestaetigen').setDescription('Wirklich zurücksetzen?').setRequired(true)),
  );

function changesFor(interaction, sub) {
  const o = interaction.options;
  switch (sub) {
    case 'kanal':
      return [[`channels.${o.getString('typ')}`, o.getChannel('kanal')?.id ?? '']];
    case 'rolle':
      return [[`roles.${o.getString('typ')}`, o.getRole('rolle')?.id ?? '']];
    case 'tickets': {
      const changes = collect(interaction, [
        ['kategorie', 'tickets.categoryId', 'getChannel', (c) => c.id],
        ['claim_kategorie', 'tickets.claimCategory.categoryId', 'getChannel', (c) => c.id],
        ['claim_verschieben', 'tickets.claimCategory.enabled', 'getBoolean'],
        ['max_pro_nutzer', 'tickets.maxOpenPerUser', 'getInteger'],
        ['team_markieren', 'tickets.pingTeam', 'getBoolean'],
        ['nur_team_schliesst', 'tickets.onlyTeamCanClose', 'getBoolean'],
        ['ersteller_fuegt_hinzu', 'tickets.creatorCanAddUsers', 'getBoolean'],
        ['bei_verlassen', 'tickets.onCreatorLeave', 'getString'],
        ['verlassen_text', 'tickets.leaveMessage', 'getString', clearable],
        ['auto_alert_text', 'tickets.autoTeamAlert.message', 'getString', clearable],
        ['aktivitaeten_loggen', 'tickets.logging.activities', 'getBoolean'],
        ['transkripte', 'tickets.logging.transcripts', 'getBoolean'],
        ['auslastung_anzeigen', 'tickets.panel.showLoad', 'getBoolean'],
        ['kanalname', 'tickets.channelName', 'getString', (v) => v.trim() || '%PREFIX%-%USERNAME%'],
      ]);
      const alert = o.getInteger('auto_alert_minuten');
      if (alert !== null) {
        changes.push(['tickets.autoTeamAlert.enabled', alert > 0]);
        if (alert > 0) changes.push(['tickets.autoTeamAlert.afterMinutes', alert]);
      }
      const unclaim = o.getInteger('auto_unclaim_stunden');
      if (unclaim !== null) {
        changes.push(['tickets.autoUnclaim.enabled', unclaim > 0]);
        if (unclaim > 0) changes.push(['tickets.autoUnclaim.afterHours', unclaim]);
      }
      const autoClose = o.getInteger('auto_close_stunden');
      if (autoClose !== null) changes.push(['tickets.autoClose', { enabled: autoClose > 0, afterHours: autoClose || 48 }]);
      return changes;
    }
    case 'ticket-panel': {
      const banner = o.getString('banner');
      if (banner && banner.trim() !== '-' && !/^https?:\/\/\S+$/.test(banner.trim())) throw new Error('Das Banner muss eine Bild-URL sein (https://…).');
      return collect(interaction, [
        ['titel', 'tickets.panel.title', 'getString', clearable],
        ['beschreibung', 'tickets.panel.description', 'getString', clearable],
        ['banner', 'tickets.panel.image', 'getString', clearable],
        ['fusszeile', 'tickets.panel.footer', 'getString', clearable],
        ['platzhalter', 'tickets.panel.placeholder', 'getString', (v) => clearable(v) || 'Wähle eine Kategorie …'],
      ]);
    }
    case 'ticket-kategorie': {
      const base = `tickets.types.${o.getString('kategorie')}`;
      const tickets = settings.forGuild(interaction.guildId).tickets;
      const type = tickets.types.find((t) => t.id === o.getString('kategorie'));
      const image = o.getString('eroeffnung_bild');
      if (image && image.trim() !== '-' && !/^https?:\/\/\S+$/.test(image.trim())) throw new Error('Das Bild muss eine URL sein (https://…).');

      const changes = [];
      // Zuerst zurücksetzen, damit danach angegebene Werte gelten.
      if (o.getBoolean('allgemein_verwenden')) {
        for (const key of ['onlyTeamCanClose', 'onCreatorLeave', 'leaveMessage', 'autoClose', 'autoTeamAlert']) changes.push([`${base}.${key}`, undefined]);
      }
      changes.push(
        ...collect(interaction, [
          ['kapazitaet', `${base}.capacity`, 'getInteger'],
          ['team_rolle', `${base}.roles`, 'getRole', (r) => [r.id]],
          ['discord_kategorie', `${base}.categoryId`, 'getChannel', (c) => c.id],
          ['beschreibung', `${base}.description`, 'getString'],
          ['aktiv', `${base}.enabled`, 'getBoolean'],
          ['claimen', `${base}.allowClaim`, 'getBoolean'],
          ['im_auftrag', `${base}.allowOnBehalf`, 'getBoolean'],
          ['nur_team_schliesst', `${base}.onlyTeamCanClose`, 'getBoolean'],
          ['bei_verlassen', `${base}.onCreatorLeave`, 'getString'],
          ['verlassen_text', `${base}.leaveMessage`, 'getString', clearable],
        ]),
      );
      if (o.getBoolean('standard_team')) changes.push([`${base}.roles`, []]);

      const autoClose = o.getInteger('auto_close_stunden');
      if (autoClose !== null) changes.push([`${base}.autoClose`, { enabled: autoClose > 0, afterHours: autoClose || 48 }]);
      const minutes = o.getInteger('erinnerung_minuten');
      const alertText = o.getString('erinnerung_text');
      if (minutes !== null || alertText !== null) {
        const current = { ...(type.autoTeamAlert ?? tickets.autoTeamAlert) };
        if (minutes !== null) Object.assign(current, { enabled: minutes > 0 }, minutes > 0 && { afterMinutes: minutes });
        if (alertText !== null) current.message = clearable(alertText);
        changes.push([`${base}.autoTeamAlert`, current]);
      }
      const embedOptions = { title: o.getString('eroeffnung_titel'), description: o.getString('eroeffnung_text'), image };
      if (Object.values(embedOptions).some((v) => v !== null)) {
        const current = { title: '', description: '', image: '', ...type.openEmbed };
        for (const [key, value] of Object.entries(embedOptions)) if (value !== null) current[key] = clearable(value);
        changes.push([`${base}.openEmbed`, current]);
      }
      return changes;
    }
    case 'ticket-formular': {
      const id = o.getString('kategorie');
      const type = settings.forGuild(interaction.guildId).tickets.types.find((t) => t.id === id);
      const form = structuredClone(type.closeForm ?? []);
      const index = Math.min(o.getInteger('feld') - 1, form.length);
      if (o.getBoolean('entfernen')) {
        if (index >= form.length) throw new Error(`Feld ${index + 1} gibt es nicht.`);
        form.splice(index, 1);
      } else {
        const field = { style: 'short', placeholder: '', maxLength: 500, required: true, ...form[index] };
        const values = {
          label: o.getString('frage'),
          style: o.getString('art'),
          placeholder: o.getString('platzhalter') === null ? null : clearable(o.getString('platzhalter')),
          maxLength: o.getInteger('max_laenge'),
          required: o.getBoolean('pflicht'),
        };
        for (const [key, value] of Object.entries(values)) if (value !== null) field[key] = value;
        if (!field.label) throw new Error('Ein neues Feld braucht eine `frage`.');
        form[index] = field;
      }
      return [[`tickets.types.${id}.closeForm`, form]];
    }
    case 'oeffnungszeiten': {
      const zone = o.getString('zeitzone')?.trim();
      if (zone) {
        if (!isValidTimeZone(zone)) throw new Error(`Unbekannte Zeitzone „${zone}“. Beispiel: Europe/Berlin`);
      }
      return collect(interaction, [
        ['aktiv', 'tickets.openingHours.enabled', 'getBoolean'],
        ['zeiten', 'tickets.openingHours.periods', 'getString', parsePeriods],
        ['zeitzone', 'tickets.openingHours.timezone', 'getString', (v) => v.trim()],
      ]);
    }
    case 'bewerbung': {
      const base = `applications.types.${o.getString('art')}`;
      const asList = (r) => [r.id];
      const changes = [];
      if (o.getBoolean('rollen_leeren')) {
        for (const key of ['managers', 'ping', 'acceptAdd', 'pending', 'required']) changes.push([`${base}.roles.${key}`, []]);
      }
      changes.push(
        ...collect(interaction, [
          ['aktiv', `${base}.enabled`, 'getBoolean'],
          ['panel', `${base}.panel`, 'getString'],
          ['kanal_offen', `${base}.channels.open`, 'getChannel', (c) => c.id],
          ['kanal_angenommen', `${base}.channels.accepted`, 'getChannel', (c) => c.id],
          ['kanal_abgelehnt', `${base}.channels.rejected`, 'getChannel', (c) => c.id],
          ['manager_rolle', `${base}.roles.managers`, 'getRole', asList],
          ['ping_rolle', `${base}.roles.ping`, 'getRole', asList],
          ['annahme_rolle', `${base}.roles.acceptAdd`, 'getRole', asList],
          ['ausstehend_rolle', `${base}.roles.pending`, 'getRole', asList],
          ['erforderliche_rolle', `${base}.roles.required`, 'getRole', asList],
          ['wartezeit_minuten', `${base}.cooldownMinutes`, 'getInteger'],
          ['zeitlimit_minuten', `${base}.timeLimitMinutes`, 'getInteger'],
          ['bei_verlassen', `${base}.onLeave`, 'getString'],
          ['team_threads', `${base}.teamThreads`, 'getBoolean'],
        ]),
      );
      return changes;
    }
    case 'bewerbungs-kanaele':
      return collect(interaction, [
        ['bewerbungen', 'applications.channel', 'getChannel', (c) => c.id],
        ['qualifikationen', 'applications.qualiChannel', 'getChannel', (c) => c.id],
      ]);
    case 'willkommen':
      return [['welcome.message', o.getString('nachricht')]];
    case 'level': {
      const changes = collect(interaction, [
        ['aktiv', 'leveling.enabled', 'getBoolean'],
        ['cooldown', 'leveling.cooldownSeconds', 'getInteger'],
      ]);
      const level = o.getInteger('belohnung_level');
      if (level !== null) changes.push([`leveling.roleRewards.${level}`, o.getRole('belohnung_rolle')?.id]);
      else if (o.getRole('belohnung_rolle')) throw new Error('Gib zur Belohnungs-Rolle auch `belohnung_level` an.');
      return changes;
    }
    case 'statistik': {
      const changes = collect(interaction, [
        ['aktiv', 'stats.enabled', 'getBoolean'],
        ['kategorie', 'stats.categoryId', 'getChannel', (c) => c.id],
      ]);
      const type = o.getString('art');
      if (!type) {
        if (o.getString('name') || o.getBoolean('entfernen')) throw new Error('Gib dazu die `art` an.');
        return changes;
      }
      const counters = structuredClone(settings.forGuild(interaction.guildId).stats.counters);
      const index = counters.findIndex((c) => c.type === type);
      if (o.getBoolean('entfernen')) {
        if (index < 0) throw new Error('Diese Statistik ist nicht eingerichtet.');
        counters.splice(index, 1);
      } else {
        const name = o.getString('name');
        const counter = { type, name: name && name.trim() !== '-' ? name.trim() : stats.TYPES[type].name };
        if (!counter.name.includes('{count}')) throw new Error('Der Name braucht `{count}` für die Zahl.');
        if (index < 0) counters.push(counter);
        else counters[index] = counter;
      }
      changes.push(['stats.counters', counters]);
      return changes;
    }
    case 'zeitzone': {
      const zone = o.getString('zone').trim();
      if (!isValidTimeZone(zone)) throw new Error(`Unbekannte Zeitzone „${zone}“. Beispiele: Europe/Berlin, Europe/Vienna, America/New_York`);
      return [['timezone', zone]];
    }
    case 'fivem':
      return collect(interaction, [
        ['adresse', 'fivem.address', 'getString', (v) => clearable(v).replace(/^https?:\/\//, '')],
        ['verbinden_url', 'fivem.connectUrl', 'getString', clearable],
      ]);
    default:
      return [];
  }
}

module.exports = {
  data: builder,
  parsePeriods,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'anzeigen') return replyPrivate(interaction, { embeds: [overview(interaction.guild)] });

    if (sub === 'zuruecksetzen') {
      if (!interaction.options.getBoolean('bestaetigen')) return replyPrivate(interaction, 'Abgebrochen.');
      settings.reset(interaction.guildId);
      await replyPrivate(interaction, '♻️ Alle Einstellungen dieses Servers kommen jetzt wieder aus der config.json.');
      await appMessages.refreshPanels(interaction.guild);
      return refreshPanels(interaction.guild);
    }

    let changes;
    try {
      changes = changesFor(interaction, sub);
    } catch (err) {
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
    if (!changes.length) return replyPrivate(interaction, 'Du hast keine Option angegeben – es wurde nichts geändert.');

    for (const [path, value] of changes) settings.set(interaction.guildId, path, value);
    await replyPrivate(interaction, {
      content: `✅ ${changes.length} Einstellung(en) für diesen Server gespeichert. Gilt sofort, ohne Neustart.`,
      embeds: [overview(interaction.guild)],
    });
    if (sub.startsWith('ticket') || sub === 'oeffnungszeiten') await refreshPanels(interaction.guild);
    if (sub === 'bewerbung') await appMessages.refreshPanels(interaction.guild);
    if (sub === 'statistik') await stats.updateStats(interaction.guild);
  },
};
