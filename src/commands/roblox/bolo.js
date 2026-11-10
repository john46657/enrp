// /bolo – Fahndungen (Personen und Fahrzeuge). Eigene EN | POLIZEI-Daten, nicht aus dem Spiel.
const { SlashCommandBuilder } = require('discord.js');
const bolo = require('../../lib/game/bolo');
const permissions = require('../../lib/game/permissions');
const cloud = require('../../lib/roblox/openCloud');
const { findRobloxUser } = require('../../lib/applications/roblox');
const { embed, replyPrivate, truncate } = require('../../lib/util');

const id = (o) => o.setName('id').setDescription('BOLO-Nummer, z. B. B-0003 oder 3').setRequired(true).setAutocomplete(true).setMaxLength(12);
const duration = (o) => o.setName('dauer').setDescription('Gültigkeit, z. B. 12h, 3d (leer = unbefristet)').setMaxLength(10);

const builder = new SlashCommandBuilder()
  .setName('bolo')
  .setDescription('Fahndungen (BOLO) von EN | POLIZEI.')
  .addSubcommand((s) =>
    s
      .setName('person')
      .setDescription('Personen-BOLO anlegen.')
      .addStringOption((o) => o.setName('name').setDescription('Roblox-Name der Person').setRequired(true).setMaxLength(40))
      .addStringOption((o) => o.setName('grund').setDescription('Warum gesucht?').setRequired(true).setMaxLength(300))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Aussehen, Hinweise').setMaxLength(1000))
      .addStringOption((o) => duration(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('fahrzeug')
      .setDescription('Fahrzeug-BOLO anlegen.')
      .addStringOption((o) => o.setName('kennzeichen').setDescription('Kennzeichen').setRequired(true).setMaxLength(16))
      .addStringOption((o) => o.setName('grund').setDescription('Warum gesucht?').setRequired(true).setMaxLength(300))
      .addStringOption((o) => o.setName('modell').setDescription('Fahrzeugmodell').setMaxLength(60))
      .addStringOption((o) => o.setName('farbe').setDescription('Farbe').setMaxLength(30))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Weitere Hinweise').setMaxLength(1000))
      .addStringOption((o) => duration(o)),
  )
  .addSubcommand((s) =>
    s
      .setName('liste')
      .setDescription('BOLOs anzeigen (Standard: aktive).')
      .addStringOption((o) => o.setName('art').setDescription('Art').addChoices({ name: 'Personen', value: 'person' }, { name: 'Fahrzeuge', value: 'fahrzeug' })),
  )
  .addSubcommand((s) => s.setName('info').setDescription('BOLO mit Treffern und Verlauf.').addStringOption((o) => id(o)))
  .addSubcommand((s) =>
    s
      .setName('bearbeiten')
      .setDescription('Aktiven BOLO ändern.')
      .addStringOption((o) => id(o))
      .addStringOption((o) => o.setName('grund').setDescription('Neuer Grund').setMaxLength(300))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Neue Beschreibung').setMaxLength(1000))
      .addStringOption((o) => o.setName('modell').setDescription('Fahrzeugmodell').setMaxLength(60))
      .addStringOption((o) => o.setName('farbe').setDescription('Farbe').setMaxLength(30))
      .addStringOption((o) => o.setName('dauer').setDescription('Neue Gültigkeit ab jetzt, z. B. 6h (perm = unbefristet)').setMaxLength(10)),
  )
  .addSubcommand((s) =>
    s
      .setName('aufheben')
      .setDescription('BOLO aufheben (z. B. Person gefasst).')
      .addStringOption((o) => id(o))
      .addStringOption((o) => o.setName('grund').setDescription('Warum?').setRequired(true).setMaxLength(300)),
  )
  .addSubcommand((s) =>
    s.setName('suche').setDescription('In allen BOLOs suchen (auch Archiv).').addStringOption((o) => o.setName('text').setDescription('Name, Kennzeichen, Grund …').setRequired(true).setMaxLength(60)),
  )
  .addSubcommand((s) => s.setName('archiv').setDescription('Aufgehobene und abgelaufene BOLOs.'));

const VIEW_ONLY = ['liste', 'info', 'suche', 'archiv'];

function expiresAt(text) {
  if (!text) return null;
  const seconds = cloud.parseDuration(text); // wirft bei ungültiger Dauer
  return seconds ? Date.now() + seconds * 1000 : null;
}

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
        case 'person': {
          const name = o.getString('name').trim().replace(/^@/, '');
          if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return replyPrivate(interaction, '❌ Das ist kein gültiger Roblox-Name.');
          const user = await findRobloxUser(name).catch(() => null);
          const entry = bolo.create(
            guildId,
            {
              type: 'person',
              name,
              robloxId: user ? String(user.id) : null,
              robloxName: user?.name ?? name,
              reason: o.getString('grund').trim(),
              description: o.getString('beschreibung')?.trim() ?? '',
              expiresAt: expiresAt(o.getString('dauer')),
            },
            interaction.user.id,
          );
          await bolo.announce(interaction.guild, entry, `📢 Neuer Personen-BOLO von ${interaction.user}`);
          return replyPrivate(interaction, {
            content: `✅ BOLO **${entry.id}** angelegt.${user ? '' : ' ⚠️ Roblox-Konto nicht gefunden – Treffer nur über den Namen.'}`,
            embeds: [bolo.embedOf(guildId, entry)],
          });
        }
        case 'fahrzeug': {
          const plate = o.getString('kennzeichen').trim().toUpperCase();
          const entry = bolo.create(
            guildId,
            {
              type: 'fahrzeug',
              plate,
              model: o.getString('modell')?.trim() ?? null,
              color: o.getString('farbe')?.trim() ?? null,
              reason: o.getString('grund').trim(),
              description: o.getString('beschreibung')?.trim() ?? '',
              expiresAt: expiresAt(o.getString('dauer')),
            },
            interaction.user.id,
          );
          await bolo.announce(interaction.guild, entry, `📢 Neuer Fahrzeug-BOLO von ${interaction.user}`);
          return replyPrivate(interaction, { content: `✅ BOLO **${entry.id}** angelegt.`, embeds: [bolo.embedOf(guildId, entry)] });
        }
        case 'liste': {
          const list = bolo.list(guildId, { type: o.getString('art') });
          const lines = list.map((b) => `**${b.id}** ${bolo.label(b)} · ${truncate(b.reason, 70)}${b.expiresAt ? ` · bis <t:${Math.floor(b.expiresAt / 1000)}:R>` : ''}`);
          return replyPrivate(interaction, { embeds: [embed('danger').setTitle(`📢 Aktive BOLOs (${list.length})`).setDescription(truncate(lines.join('\n') || 'Keine aktiven BOLOs.', 4000))] });
        }
        case 'info':
          return replyPrivate(interaction, { embeds: [bolo.embedOf(guildId, bolo.getBolo(guildId, o.getString('id')), { full: true })] });
        case 'bearbeiten': {
          const entry = bolo.getBolo(guildId, o.getString('id'));
          const dauer = o.getString('dauer');
          const done = bolo.edit(
            guildId,
            entry,
            {
              reason: o.getString('grund')?.trim(),
              description: o.getString('beschreibung')?.trim(),
              model: o.getString('modell')?.trim(),
              color: o.getString('farbe')?.trim(),
              expiresAt: dauer ? expiresAt(dauer) : undefined,
            },
            interaction.user.id,
          );
          return replyPrivate(interaction, { content: `✏️ Geändert: ${done.join(', ')}`, embeds: [bolo.embedOf(guildId, entry)] });
        }
        case 'aufheben': {
          const entry = bolo.getBolo(guildId, o.getString('id'));
          bolo.cancel(guildId, entry, o.getString('grund').trim(), interaction.user.id);
          await bolo.announce(interaction.guild, entry, `⚪ BOLO aufgehoben von ${interaction.user}`);
          return replyPrivate(interaction, `✅ BOLO **${entry.id}** aufgehoben.`);
        }
        case 'suche': {
          const list = bolo.search(guildId, o.getString('text'));
          const lines = list.map((b) => `${bolo.STATUS[b.status]} **${b.id}** ${bolo.label(b)} · ${truncate(b.reason, 70)}`);
          return replyPrivate(interaction, { embeds: [embed().setTitle(`🔎 BOLO-Suche (${list.length})`).setDescription(truncate(lines.join('\n') || 'Nichts gefunden.', 4000))] });
        }
        case 'archiv': {
          const list = [...bolo.list(guildId, { status: 'aufgehoben' }), ...bolo.list(guildId, { status: 'abgelaufen' })].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
          const lines = list.map((b) => `${bolo.STATUS[b.status]} **${b.id}** ${bolo.label(b)} · ${truncate(b.closeReason ?? b.reason, 70)}`);
          return replyPrivate(interaction, { embeds: [embed().setTitle(`🗄️ BOLO-Archiv (${list.length})`).setDescription(truncate(lines.join('\n') || 'Archiv ist leer.', 4000))] });
        }
        default:
          return null;
      }
    } catch (err) {
      if (!(err instanceof bolo.BoloError) && !(err instanceof cloud.RobloxError)) throw err;
      return replyPrivate(interaction, `❌ ${err.message}`);
    }
  },

  async autocomplete(interaction) {
    if (!permissions.can(interaction.member, 'view')) return interaction.respond([]);
    const q = String(interaction.options.getFocused() ?? '').toLowerCase();
    const list = bolo.list(interaction.guildId, { status: 'alle' }).filter((b) => !q || `${b.id} ${bolo.label(b)}`.toLowerCase().includes(q));
    return interaction.respond(list.slice(0, 25).map((b) => ({ name: truncate(`${b.id} · ${bolo.STATUS[b.status]} · ${bolo.label(b)}`, 100), value: b.id })));
  },
};
