// /cad – Discord-CAD: Einsätze anlegen, zuweisen, Status, Notizen, Abschluss mit Bericht, Suche, Statistik, Einheiten.
const { SlashCommandBuilder } = require('discord.js');
const cad = require('../../lib/game/cad');
const permissions = require('../../lib/game/permissions');
const settings = require('../../lib/settings');
const { embed, replyPrivate, truncate } = require('../../lib/util');

const teams = settings.base.game.cadTeams.slice(0, 25).map((t) => ({ name: t, value: t }));
const number = (o) => o.setName('nummer').setDescription('Einsatznummer, z. B. E-0007 oder 7').setRequired(true).setAutocomplete(true).setMaxLength(12);

const builder = new SlashCommandBuilder()
  .setName('cad')
  .setDescription('CAD & Dispatch: Einsätze und Einheiten.')
  .addSubcommand((s) =>
    s
      .setName('neu')
      .setDescription('Neuen Einsatz anlegen (eigene Daten, nicht aus dem Spiel).')
      .addStringOption((o) => o.setName('titel').setDescription('Kurzbeschreibung').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('ort').setDescription('Ort').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Details').setMaxLength(1500))
      .addIntegerOption((o) => o.setName('prioritaet').setDescription('1 = hoch, 3 = niedrig').addChoices({ name: 'P1 · Hoch', value: 1 }, { name: 'P2 · Mittel', value: 2 }, { name: 'P3 · Niedrig', value: 3 }))
      .addStringOption((o) => o.setName('bereich').setDescription('Zuständiger Bereich').addChoices(...teams)),
  )
  .addSubcommand((s) =>
    s
      .setName('liste')
      .setDescription('Einsätze anzeigen (Standard: offene).')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter')
          .addChoices({ name: 'Offen (alle offenen)', value: 'offen' }, ...Object.entries(cad.STATUS).map(([value, s]) => ({ name: s.label, value })), { name: 'Alle', value: 'alle' }),
      )
      .addStringOption((o) => o.setName('quelle').setDescription('Herkunft').addChoices({ name: 'Ingame-Notrufe', value: 'ingame' }, { name: 'Discord-Einsätze', value: 'discord' }))
      .addStringOption((o) => o.setName('bereich').setDescription('Bereich').addChoices(...teams)),
  )
  .addSubcommand((s) => s.setName('info').setDescription('Einsatz mit Notizen und Verlauf.').addStringOption((o) => number(o)))
  .addSubcommand((s) =>
    s
      .setName('zuweisen')
      .setDescription('Einheit einem Einsatz zuweisen.')
      .addStringOption((o) => number(o))
      .addUserOption((o) => o.setName('einheit').setDescription('Person (leer = du selbst)')),
  )
  .addSubcommand((s) =>
    s
      .setName('status')
      .setDescription('Status eines Einsatzes ändern.')
      .addStringOption((o) => number(o))
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Neuer Status')
          .setRequired(true)
          .addChoices(...cad.OPEN.map((value) => ({ name: cad.STATUS[value].label, value }))),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('notiz')
      .setDescription('Notiz hinzufügen.')
      .addStringOption((o) => number(o))
      .addStringOption((o) => o.setName('text').setDescription('Notiz').setRequired(true).setMaxLength(500)),
  )
  .addSubcommand((s) =>
    s
      .setName('abschliessen')
      .setDescription('Einsatz abschließen.')
      .addStringOption((o) => number(o))
      .addStringOption((o) => o.setName('bericht').setDescription('Einsatzbericht').setMaxLength(1500)),
  )
  .addSubcommand((s) =>
    s.setName('suche').setDescription('In allen Einsätzen suchen.').addStringOption((o) => o.setName('text').setDescription('Suchbegriff').setRequired(true).setMaxLength(60)),
  )
  .addSubcommand((s) =>
    s
      .setName('statistik')
      .setDescription('Einsatz-Statistik.')
      .addIntegerOption((o) => o.setName('tage').setDescription('Zeitraum (Standard 7)').setMinValue(1).setMaxValue(90)),
  )
  .addSubcommand((s) =>
    s
      .setName('einheit')
      .setDescription('Eigenen Status und Rufnamen setzen.')
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Status')
          .setRequired(true)
          .addChoices(...Object.entries(cad.UNIT_STATUS).map(([value, name]) => ({ name, value }))),
      )
      .addStringOption((o) => o.setName('rufname').setDescription('z. B. Adler 12/1').setMaxLength(20)),
  )
  .addSubcommand((s) =>
    s
      .setName('einheiten')
      .setDescription('Alle Einheiten mit Status.')
      .addBooleanOption((o) => o.setName('alle').setDescription('Auch „Außer Dienst“')),
  );

const VIEW_ONLY = ['liste', 'info', 'suche', 'statistik', 'einheiten'];

module.exports = {
  data: builder,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const o = interaction.options;
    const guildId = interaction.guildId;
    const level = VIEW_ONLY.includes(sub) ? 'view' : 'dispatch';
    if (!permissions.can(interaction.member, level)) return replyPrivate(interaction, permissions.deny(level));

    try {
      switch (sub) {
        case 'neu': {
          const incident = cad.createIncident(
            guildId,
            {
              title: o.getString('titel').trim(),
              location: o.getString('ort').trim(),
              description: o.getString('beschreibung')?.trim() ?? '',
              priority: o.getInteger('prioritaet') ?? 2,
              team: o.getString('bereich') ?? settings.forGuild(guildId).game.cadTeams[0] ?? 'Polizei',
            },
            interaction.user.id,
          );
          await cad.postIncident(interaction.guild, incident);
          return replyPrivate(interaction, { content: `✅ Einsatz **${incident.number}** angelegt.`, embeds: [cad.incidentEmbed(guildId, incident)] });
        }
        case 'liste': {
          const list = cad.list(guildId, { status: o.getString('status') ?? 'offen', source: o.getString('quelle'), team: o.getString('bereich'), limit: 25 });
          return replyPrivate(interaction, { embeds: [embed().setTitle(`🗂️ Einsätze (${list.length})`).setDescription(truncate(list.map(cad.lineOf).join('\n') || 'Keine Einsätze.', 4000))] });
        }
        case 'info':
          return replyPrivate(interaction, { embeds: [cad.incidentEmbed(guildId, cad.getIncident(guildId, o.getString('nummer')), { full: true })] });
        case 'zuweisen': {
          const incident = cad.getIncident(guildId, o.getString('nummer'));
          const user = o.getUser('einheit') ?? interaction.user;
          await cad.assign(interaction.guild, incident, user.id, interaction.user.id);
          return replyPrivate(interaction, `🚓 ${user} ist bei **${incident.number}** eingeteilt.`);
        }
        case 'status': {
          const incident = cad.getIncident(guildId, o.getString('nummer'));
          await cad.setStatus(interaction.guild, incident, o.getString('status'), interaction.user.id);
          return replyPrivate(interaction, `Status von **${incident.number}**: ${cad.STATUS[incident.status].label}`);
        }
        case 'notiz': {
          const incident = cad.getIncident(guildId, o.getString('nummer'));
          await cad.addNote(interaction.guild, incident, o.getString('text'), interaction.user.id);
          return replyPrivate(interaction, `📝 Notiz zu **${incident.number}** gespeichert.`);
        }
        case 'abschliessen': {
          const incident = cad.getIncident(guildId, o.getString('nummer'));
          await cad.close(interaction.guild, incident, o.getString('bericht') ?? '', interaction.user.id);
          return replyPrivate(interaction, `✅ **${incident.number}** abgeschlossen.`);
        }
        case 'suche': {
          const list = cad.search(guildId, o.getString('text'));
          return replyPrivate(interaction, { embeds: [embed().setTitle(`🔎 Suche (${list.length})`).setDescription(truncate(list.map(cad.lineOf).join('\n') || 'Nichts gefunden.', 4000))] });
        }
        case 'statistik': {
          const days = o.getInteger('tage') ?? 7;
          const s = cad.stats(guildId, days);
          return replyPrivate(interaction, {
            embeds: [
              embed()
                .setTitle(`📊 CAD-Statistik · ${days} Tage`)
                .addFields(
                  { name: 'Einsätze', value: `${s.total} gesamt · ${s.open} offen · ${s.closed} abgeschlossen`, inline: false },
                  { name: 'Herkunft', value: `🎮 ${s.ingame} Ingame-Notrufe · 📝 ${s.discord} Discord`, inline: false },
                  { name: 'Bereiche', value: Object.entries(s.byTeam).map(([t, n]) => `${t}: ${n}`).join(' · ') || '—', inline: false },
                  { name: 'Ø bis Zuweisung', value: s.avgAssignMinutes === null ? '—' : `${s.avgAssignMinutes} Min.`, inline: true },
                  { name: 'Ø Einsatzdauer', value: s.avgDurationMinutes === null ? '—' : `${s.avgDurationMinutes} Min.`, inline: true },
                  { name: 'Top-Einheiten', value: s.topUnits.map(([id, n]) => `${cad.unitName(guildId, id)} · ${n}`).join('\n') || '—', inline: false },
                ),
            ],
          });
        }
        case 'einheit': {
          const unit = cad.setUnitStatus(guildId, interaction.user.id, o.getString('status'), o.getString('rufname'));
          return replyPrivate(interaction, `📻 ${unit.callsign ? `**${unit.callsign}** · ` : ''}${cad.UNIT_STATUS[unit.status]}`);
        }
        case 'einheiten': {
          const all = o.getBoolean('alle');
          const list = Object.entries(cad.units(guildId))
            .filter(([, u]) => all || u.status !== 'ausser_dienst')
            .sort(([, a], [, b]) => a.status.localeCompare(b.status));
          const lines = list.map(([id, u]) => {
            const ingame = cad.inGame(guildId, id);
            return `${cad.unitName(guildId, id)} · ${cad.UNIT_STATUS[u.status]}${u.incident ? ` · ${u.incident}` : ''}${ingame ? ` · 🎮 ${ingame}` : ''}`;
          });
          return replyPrivate(interaction, { embeds: [embed().setTitle(`📻 Einheiten (${list.length})`).setDescription(truncate(lines.join('\n') || 'Keine Einheiten im Dienst.', 4000))] });
        }
        default:
          return null;
      }
    } catch (err) {
      if (!(err instanceof cad.CadError)) throw err;
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
  },

  async autocomplete(interaction) {
    if (!permissions.can(interaction.member, 'view')) return interaction.respond([]);
    const q = String(interaction.options.getFocused() ?? '').toLowerCase();
    const list = Object.values(cad.incidents(interaction.guildId))
      .filter((i) => cad.OPEN.includes(i.status) || q)
      .filter((i) => !q || i.number.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25);
    return interaction.respond(list.map((i) => ({ name: truncate(`${i.number} · ${cad.STATUS[i.status].label} · ${i.title}`, 100), value: i.number })));
  },

  components: {
    cad: (interaction, args) => cad.handleComponent(interaction, args),
  },
};
