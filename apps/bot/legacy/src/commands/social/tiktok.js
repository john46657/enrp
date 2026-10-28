const crypto = require('node:crypto');
const { SlashCommandBuilder, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const settings = require('../../lib/settings');
const { replyPrivate, embed, truncate } = require('../../lib/util');
const tiktok = require('../../lib/tiktok/service');

const isAdmin = (member) => member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageGuild);
const canAnnounce = (member) => isAdmin(member) || settings.forGuild(member.guild.id).tiktok.manualRoles.some((id) => member.roles.cache.has(id));
const ADMIN_ONLY = new Set(['add', 'remove', 'channel', 'role']);
const ts = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : '—');
const STATUS = { live: '🔴 live', offline: '⚫ offline', unknown: '❔ unbekannt' };

// Rate-Limit je Nutzer: 10 Befehle pro Minute, 3 manuelle Ankündigungen pro Stunde.
const usage = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (usage.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now);
  usage.set(key, list);
  return false;
}

const pending = new Map(); // Token → { guildId, userId, url, expiresAt } für die Vorschau

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tiktok-live')
    .setDescription('TikTok-LIVE-Benachrichtigungen verwalten.')
    .addSubcommand((s) => s.setName('add').setDescription('Creator zur Überwachung hinzufügen (nur Admins).').addStringOption((o) => o.setName('username').setDescription('TikTok-Name, z. B. @name').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('Creator aus der Überwachung entfernen (nur Admins).').addStringOption((o) => o.setName('username').setDescription('TikTok-Name').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('list').setDescription('Alle Creator und ihren zuletzt bekannten Status anzeigen.'))
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Kanal für LIVE-Benachrichtigungen festlegen (nur Admins).')
        .addChannelOption((o) => o.setName('channel').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) => s.setName('role').setDescription('Rolle, die bei neuen LIVEs erwähnt wird (ohne Rolle = keine Erwähnung).').addRoleOption((o) => o.setName('role').setDescription('Rolle')))
    .addSubcommand((s) => s.setName('test').setDescription('Testnachricht senden (täuscht keinen echten Livestream vor).'))
    .addSubcommand((s) => s.setName('announce').setDescription('Einen TikTok-Livestream manuell ankündigen.').addStringOption((o) => o.setName('link').setDescription('https://www.tiktok.com/@name/live').setRequired(true).setMaxLength(300)))
    .addSubcommand((s) => s.setName('status').setDescription('Überwachungsstatus, letzte Prüfung und Verbindungsfehler.'))
    .addSubcommand((s) => s.setName('settings').setDescription('Aktive Einstellungen anzeigen.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { member, guild } = interaction;
    if (limited(`cmd:${interaction.user.id}`, 10, 60_000)) return replyPrivate(interaction, 'Zu viele Befehle – bitte kurz warten.');
    const announcer = canAnnounce(member);
    if (ADMIN_ONLY.has(sub) && !isAdmin(member)) return replyPrivate(interaction, 'Nur Admins („Server verwalten“) dürfen das ändern.');
    if (!ADMIN_ONLY.has(sub) && !announcer) return replyPrivate(interaction, 'Dafür fehlt dir die Berechtigung.');
    const cfg = settings.forGuild(guild.id).tiktok;

    try {
      switch (sub) {
        case 'add': {
          const creator = tiktok.addCreator(guild.id, interaction.options.getString('username'), interaction.user.id);
          return replyPrivate(interaction, `✅ [@${creator.username}](${tiktok.profileUrl(creator.username)}) wird jetzt überwacht.${cfg.provider === 'none' ? '\n-# Hinweis: Es ist keine automatische Erkennung verbunden – Ankündigungen gehen nur manuell (`/tiktok-live announce`).' : ''}`);
        }
        case 'remove':
          tiktok.removeCreator(guild.id, interaction.options.getString('username'));
          return replyPrivate(interaction, '🗑️ Creator entfernt.');
        case 'channel':
          settings.set(guild.id, 'tiktok.channel', interaction.options.getChannel('channel').id);
          return replyPrivate(interaction, `✅ LIVE-Benachrichtigungen gehen nach ${interaction.options.getChannel('channel')}.`);
        case 'role': {
          const role = interaction.options.getRole('role');
          if (role && (role.id === guild.id || role.managed)) return replyPrivate(interaction, 'Diese Rolle kann nicht verwendet werden.');
          settings.set(guild.id, 'tiktok.role', role?.id ?? '');
          return replyPrivate(interaction, role ? `✅ Bei neuen LIVEs wird ${role} erwähnt.` : '✅ Bei neuen LIVEs wird niemand erwähnt.');
        }
        case 'list': {
          const creators = Object.values(tiktok.dataOf(guild.id).creators);
          if (!creators.length) return replyPrivate(interaction, 'Es werden noch keine Creator überwacht (`/tiktok-live add`).');
          const lines = creators.map(
            (c) => `${c.enabled ? '' : '⏸️ '}[@${c.username}](${tiktok.profileUrl(c.username)}) – ${STATUS[c.status] ?? c.status} · zuletzt erfolgreich geprüft ${ts(c.lastSuccessAt)}${c.lastError ? `\n-# ⚠️ ${c.lastError}` : ''}`,
          );
          return replyPrivate(interaction, { embeds: [embed().setTitle('🎵 Überwachte TikTok-Creator').setDescription(truncate(lines.join('\n'), 4000))] });
        }
        case 'status': {
          const p = tiktok.providerStatus(guild.id);
          const errors = tiktok.dataOf(guild.id).events.filter((e) => e.level === 'error').slice(0, 5);
          return replyPrivate(interaction, {
            embeds: [
              embed(p.connected ? 'success' : 'warning')
                .setTitle('📡 TikTok-LIVE-Status')
                .addFields(
                  { name: 'Modul', value: cfg.enabled ? '✅ aktiv' : '❌ aus', inline: true },
                  { name: 'Erkennung', value: `${p.connected ? '🟢 verbunden' : '🔴 nicht verbunden'}\n${p.label}`, inline: true },
                  { name: 'Letzte erfolgreiche Prüfung', value: ts(p.lastSuccessAt), inline: true },
                  { name: 'Details', value: p.detail },
                  { name: 'Letzte Fehler', value: truncate(errors.map((e) => `${ts(e.at)} ${e.message}`).join('\n') || 'Keine', 1024) },
                ),
            ],
          });
        }
        case 'settings': {
          const admin = isAdmin(member);
          return replyPrivate(interaction, {
            embeds: [
              embed()
                .setTitle('⚙️ TikTok-LIVE-Einstellungen')
                .addFields(
                  { name: 'Aktiv', value: cfg.enabled ? '✅' : '❌', inline: true },
                  { name: 'Kanal', value: cfg.channel ? `<#${cfg.channel}>` : '—', inline: true },
                  { name: 'Rolle', value: cfg.role ? `<@&${cfg.role}>` : 'keine Erwähnung', inline: true },
                  { name: 'Erkennung', value: cfg.provider, inline: true },
                  { name: 'LIVE-Ende-Meldung', value: cfg.endMessages ? `✅ nach ${cfg.endGraceMinutes} Min. Toleranz` : '❌', inline: true },
                  ...(admin ? [{ name: 'Prüfintervall', value: `${Math.max(60, cfg.pollSeconds)} s`, inline: true }] : []),
                ),
            ],
          });
        }
        case 'test': {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await tiktok.sendTest(guild, interaction.user.tag);
          return interaction.editReply('🧪 Testnachricht gesendet (als Test gekennzeichnet, ohne Erwähnung).');
        }
        case 'announce': {
          if (!cfg.enabled) return replyPrivate(interaction, 'TikTok LIVE ist auf diesem Server deaktiviert.');
          const { url, username } = tiktok.parseLiveUrl(interaction.options.getString('link'));
          if (limited(`announce:${interaction.user.id}`, 3, 3_600_000)) return replyPrivate(interaction, 'Du kannst höchstens 3 Livestreams pro Stunde ankündigen.');
          const token = crypto.randomBytes(8).toString('hex');
          pending.set(token, { guildId: guild.id, userId: interaction.user.id, url, expiresAt: Date.now() + 5 * 60_000 });
          return replyPrivate(interaction, {
            content: '👀 **Vorschau** – so sieht die Ankündigung aus:',
            embeds: [tiktok.liveEmbed(guild.id, { username, url, manual: true, by: interaction.user.tag })],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tiktok:publish:${token}`).setLabel('Veröffentlichen').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`tiktok:cancel:${token}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
              ),
            ],
          });
        }
      }
    } catch (err) {
      return interaction.deferred ? interaction.editReply(`❌ ${err.message}`) : replyPrivate(interaction, `❌ ${err.message}`);
    }
  },

  components: {
    async tiktok(interaction, [action, token]) {
      const entry = pending.get(token);
      pending.delete(token);
      if (action === 'cancel') return interaction.update({ content: 'Abgebrochen.', embeds: [], components: [] });
      if (!entry || entry.expiresAt < Date.now() || entry.userId !== interaction.user.id || entry.guildId !== interaction.guildId) {
        return interaction.update({ content: 'Die Vorschau ist abgelaufen – bitte `/tiktok-live announce` erneut ausführen.', embeds: [], components: [] });
      }
      if (!canAnnounce(interaction.member)) return interaction.update({ content: 'Dafür fehlt dir die Berechtigung.', embeds: [], components: [] });
      try {
        await tiktok.announceManual(interaction.guild, { url: entry.url, by: interaction.user.id, byTag: interaction.user.tag });
        return interaction.update({ content: '✅ Livestream angekündigt (als manuell gekennzeichnet).', embeds: [], components: [] });
      } catch (err) {
        return interaction.update({ content: `❌ ${err.message}`, embeds: [], components: [] });
      }
    },
  },
};
