const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../../../config.json');
const settings = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');
const { refreshPanels } = require('../../lib/tickets');

const CHANNELS = {
  welcome: 'Willkommen',
  modLog: 'Mod-Log',
  ticketLog: 'Ticket-Log',
  whitelistReview: 'Whitelist-Bewerbungen',
  levelUp: 'Level-Up',
};
const ROLES = {
  autoRole: 'Auto-Rolle',
  whitelisted: 'Whitelist',
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

function overview() {
  const t = config.tickets;
  return embed()
    .setTitle('⚙️ Einstellungen')
    .setDescription(
      settings.overrideCount()
        ? `${settings.overrideCount()} Einstellung(en) wurden in Discord geändert. \`/einstellungen zuruecksetzen\` stellt die config.json wieder her.`
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
          `Ersteller fügt hinzu: ${onOff(t.creatorCanAddUsers)} · Schließen bei Verlassen: ${onOff(t.onCreatorLeave === 'close')}`,
          `Aktivitäten loggen: ${onOff(t.logging.activities)} · Transkripte: ${onOff(t.logging.transcripts)}`,
          `Auslastung anzeigen: ${onOff(t.panel.showLoad)}`,
          `Auto-Team-Alert: ${t.autoTeamAlert.enabled ? `nach ${t.autoTeamAlert.afterMinutes} Min.` : '❌'}`,
          `Auto-Unclaim: ${t.autoUnclaim.enabled ? `nach ${t.autoUnclaim.afterHours} Std.` : '❌'}`,
        ].join('\n'),
      },
      {
        name: 'Ticket-Kategorien',
        value: t.types
          .map((x) => `${x.emoji} **${x.label}** – Kapazität ${x.capacity || '—'}, Team: ${x.roles?.length ? x.roles.map(role).join(' ') : 'Standard'}`)
          .join('\n'),
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
      .addBooleanOption((o) => o.setName('schliessen_bei_verlassen').setDescription('Ticket schließen, wenn der Ersteller den Server verlässt?'))
      .addBooleanOption((o) => o.setName('aktivitaeten_loggen').setDescription('Ticket-Aktivitäten in den Ticket-Log schreiben?'))
      .addBooleanOption((o) => o.setName('transkripte').setDescription('Verlauf beim Schließen speichern?'))
      .addBooleanOption((o) => o.setName('auslastung_anzeigen').setDescription('Auslastung im Panel anzeigen?'))
      .addStringOption((o) =>
        o.setName('kanalname').setDescription('z. B. %PREFIX% %USERNAME% – Platzhalter siehe README').setMaxLength(90),
      )
      .addIntegerOption((o) => o.setName('auto_alert_minuten').setDescription('Team erneut markieren nach X Minuten (0 = aus)').setMinValue(0).setMaxValue(10_080))
      .addIntegerOption((o) => o.setName('auto_unclaim_stunden').setDescription('Freigeben nach X Stunden Inaktivität (0 = aus)').setMinValue(0).setMaxValue(720)),
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
          .addChoices(...config.tickets.types.slice(0, 25).map((t) => ({ name: t.label, value: t.id }))),
      )
      .addIntegerOption((o) => o.setName('kapazitaet').setDescription('Plätze für die Auslastung (0 = ausblenden)').setMinValue(0).setMaxValue(1000))
      .addRoleOption((o) => o.setName('team_rolle').setDescription('Nur diese Rolle bearbeitet die Kategorie'))
      .addBooleanOption((o) => o.setName('standard_team').setDescription('Wieder die allgemeine Support-Rolle verwenden'))
      .addChannelOption((o) =>
        o.setName('discord_kategorie').setDescription('Eigene Discord-Kategorie für diese Tickets').addChannelTypes(ChannelType.GuildCategory),
      )
      .addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel').setMaxLength(500)),
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
      .setName('zuruecksetzen')
      .setDescription('Verwirft alle in Discord geänderten Einstellungen.')
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
        ['schliessen_bei_verlassen', 'tickets.onCreatorLeave', 'getBoolean', (v) => (v ? 'close' : 'nothing')],
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
      const changes = collect(interaction, [
        ['kapazitaet', `${base}.capacity`, 'getInteger'],
        ['team_rolle', `${base}.roles`, 'getRole', (r) => [r.id]],
        ['discord_kategorie', `${base}.categoryId`, 'getChannel', (c) => c.id],
        ['beschreibung', `${base}.description`, 'getString'],
      ]);
      if (o.getBoolean('standard_team')) changes.push([`${base}.roles`, []]);
      return changes;
    }
    case 'oeffnungszeiten': {
      const zone = o.getString('zeitzone')?.trim();
      if (zone) {
        try {
          new Intl.DateTimeFormat('de-DE', { timeZone: zone });
        } catch {
          throw new Error(`Unbekannte Zeitzone „${zone}“. Beispiel: Europe/Berlin`);
        }
      }
      return collect(interaction, [
        ['aktiv', 'tickets.openingHours.enabled', 'getBoolean'],
        ['zeiten', 'tickets.openingHours.periods', 'getString', parsePeriods],
        ['zeitzone', 'tickets.openingHours.timezone', 'getString', (v) => v.trim()],
      ]);
    }
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
    if (sub === 'anzeigen') return replyPrivate(interaction, { embeds: [overview()] });

    if (sub === 'zuruecksetzen') {
      if (!interaction.options.getBoolean('bestaetigen')) return replyPrivate(interaction, 'Abgebrochen.');
      settings.reset();
      await replyPrivate(interaction, '♻️ Alle Einstellungen kommen jetzt wieder aus der config.json.');
      return refreshPanels(interaction.guild);
    }

    let changes;
    try {
      changes = changesFor(interaction, sub);
    } catch (err) {
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
    if (!changes.length) return replyPrivate(interaction, 'Du hast keine Option angegeben – es wurde nichts geändert.');

    for (const [path, value] of changes) settings.set(path, value);
    await replyPrivate(interaction, {
      content: `✅ ${changes.length} Einstellung(en) gespeichert. Gilt sofort, ohne Neustart.`,
      embeds: [overview()],
    });
    if (sub.startsWith('ticket') || sub === 'oeffnungszeiten') await refreshPanels(interaction.guild);
  },
};
