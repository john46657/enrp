// /spiel-admin – Admin-Center für die Spiel-Anbindung: Status, Verbindungstest, Schlüssel, Logs, Intervalle,
// Log-Kanäle, Live-Panel, Dispatch, BOLO, Berechtigungen und Privatserver-Discords.
// Schlüssel werden nur verschlüsselt gespeichert und nie wieder angezeigt (nur ein Fingerabdruck).
const crypto = require('node:crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const settings = require('../../lib/settings');
const secrets = require('../../lib/secrets');
const db = require('../../lib/db');
const cloud = require('../../lib/roblox/openCloud');
const links = require('../../lib/roblox/links');
const rights = require('../../lib/roblox/rights');
const auth = require('../../lib/web/auth');
const web = require('../../lib/web/server');
const live = require('../../lib/game/live');
const events = require('../../lib/game/events');
const outbox = require('../../lib/game/outbox');
const permissions = require('../../lib/game/permissions');
const livePanel = require('../../lib/game/livePanel');
const commands = require('../../lib/game/commands');
const { LOG_TYPES } = require('../../lib/game/protocol');
const { profileUrl } = require('../../lib/applications/roblox');
const { embed, replyPrivate, sendTo, truncate } = require('../../lib/util');

const textChannel = (o, name, description, required = false) =>
  o.setName(name).setDescription(description).setRequired(required).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

const builder = new SlashCommandBuilder()
  .setName('spiel-admin')
  .setDescription('Admin-Center der Spiel-Anbindung.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('uebersicht').setDescription('Status von Bridge, Spiel, Roblox-API und Daten.'))
  .addSubcommand((s) => s.setName('test').setDescription('Verbindung testen (Domain → Bot, Signatur, Roblox-API).'))
  .addSubcommand((s) => s.setName('bridge-schluessel').setDescription('Neuen Bridge-Schlüssel fürs Spiel-Skript erzeugen (wird einmal angezeigt).'))
  .addSubcommand((s) =>
    s
      .setName('api-key')
      .setDescription('Roblox-Open-Cloud-Key hinterlegen (optional, verschlüsselt).')
      .addBooleanOption((o) => o.setName('entfernen').setDescription('Gespeicherten Key löschen')),
  )
  .addSubcommand((s) =>
    s
      .setName('universe')
      .setDescription('Universe-ID des Spiels (für Statistik und Roblox-Ban-API).')
      .addStringOption((o) => o.setName('id').setDescription('Universe-ID (leer = entfernen)').setMaxLength(20)),
  )
  .addSubcommand((s) =>
    s
      .setName('api-logs')
      .setDescription('Letzte Anfragen an Bridge und Roblox-API.')
      .addStringOption((o) => o.setName('art').setDescription('Welche').addChoices({ name: 'Bridge (Spiel → Bot)', value: 'bridge' }, { name: 'Roblox-API', value: 'roblox' }, { name: 'Nur Fehler', value: 'errors' })),
  )
  .addSubcommand((s) =>
    s
      .setName('intervall')
      .setDescription('Wie oft das Spiel Daten schickt und nach Befehlen fragt.')
      .addIntegerOption((o) => o.setName('live_sekunden').setDescription('Live-Snapshot (10–60, Standard 15)').setMinValue(10).setMaxValue(60))
      .addIntegerOption((o) => o.setName('befehle_sekunden').setDescription('Befehle abholen (2–30, Standard 3)').setMinValue(2).setMaxValue(30)),
  )
  .addSubcommand((s) =>
    s
      .setName('logkanal')
      .setDescription('Kanal für eine Log-Art (ohne Kanal = aus).')
      .addStringOption((o) =>
        o
          .setName('art')
          .setDescription('Log-Art')
          .setRequired(true)
          .addChoices(...Object.entries(LOG_TYPES).map(([value, name]) => ({ name, value }))),
      )
      .addChannelOption((o) => textChannel(o, 'kanal', 'Kanal')),
  )
  .addSubcommand((s) =>
    s
      .setName('livepanel')
      .setDescription('Live-Status-Nachricht posten (aktualisiert sich jede Minute).')
      .addChannelOption((o) => textChannel(o, 'kanal', 'Kanal', true)),
  )
  .addSubcommand((s) =>
    s
      .setName('dispatch')
      .setDescription('Dispatch-Kanal für Einsätze und Rolle, die bei Notrufen markiert wird.')
      .addChannelOption((o) => textChannel(o, 'kanal', 'Kanal (leer = aus)'))
      .addRoleOption((o) => o.setName('rolle').setDescription('Wird bei Ingame-Notrufen und BOLO-Treffern markiert'))
      .addBooleanOption((o) => o.setName('rolle_entfernen').setDescription('Keine Rolle mehr markieren')),
  )
  .addSubcommand((s) =>
    s
      .setName('bolokanal')
      .setDescription('Kanal für BOLOs und Treffer (leer = aus).')
      .addChannelOption((o) => textChannel(o, 'kanal', 'Kanal')),
  )
  .addSubcommand((s) =>
    s
      .setName('berechtigung')
      .setDescription('Rolle einer Stufe zuordnen oder entfernen (ohne Angaben = Übersicht).')
      .addStringOption((o) =>
        o
          .setName('stufe')
          .setDescription('Stufe')
          .addChoices(...permissions.LEVELS.map((value) => ({ name: permissions.LABELS[value], value }))),
      )
      .addRoleOption((o) => o.setName('rolle').setDescription('Rolle'))
      .addBooleanOption((o) => o.setName('entfernen').setDescription('Rolle aus der Stufe entfernen')),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('privatserver')
      .setDescription('Privatserver-Discords verwalten (nur Haupt-Discord).')
      .addSubcommand((s) =>
        s
          .setName('verknuepfen')
          .setDescription('Gibt einem Discord die Rechte für die Privatserver eines Besitzers.')
          .addStringOption((o) => o.setName('discord_server_id').setDescription('ID des Privatserver-Discords (Bot muss dort sein)').setRequired(true).setMaxLength(20))
          .addStringOption((o) => o.setName('besitzer').setDescription('Roblox-Name des Privatserver-Besitzers').setRequired(true).setMaxLength(20))
          .addStringOption((o) => o.setName('name').setDescription('Anzeigename, z. B. „Polizei-RP Nord“').setRequired(true).setMaxLength(60)),
      )
      .addSubcommand((s) =>
        s
          .setName('entfernen')
          .setDescription('Nimmt einem Discord die Privatserver-Rechte.')
          .addStringOption((o) => o.setName('discord_server_id').setDescription('ID des Discord-Servers').setRequired(true).setMaxLength(20)),
      )
      .addSubcommand((s) => s.setName('liste').setDescription('Alle verknüpften Privatserver-Discords.')),
  );

// Diese Unterbefehle betreffen das ganze Spiel → nur im Haupt-Discord
const MAIN_ONLY = ['bridge-schluessel', 'api-key', 'universe', 'intervall', 'api-logs', 'test'];

const ago = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : 'nie');
const onOff = (ok) => (ok ? '🟢' : '🔴');

function overview(interaction) {
  const scope = links.scopeOf(interaction.guildId);
  const ws = web.status();
  const ls = live.status();
  const es = events.status();
  const health = cloud.healthReport();
  const keySource = auth.secretSource();
  const robloxKey = cloud.apiKeySource();
  const keyInfo = secrets.secretInfo(auth.SECRET_NAME);
  const result = embed()
    .setTitle('🛠️ Spiel-Anbindung · Übersicht')
    .addFields(
      {
        name: 'Bridge (Domain ↔ Bot)',
        value: truncate(
          [
            `${onOff(ws.running)} Webserver ${ws.running ? `läuft auf Port ${ws.port}` : `aus${ws.error ? ` – ${ws.error}` : ''}`}`,
            `Adresse: ${ws.publicUrl ?? '— (PUBLIC_URL in der .env setzen)'}`,
            `${onOff(Boolean(keySource))} Bridge-Schlüssel: ${keySource === 'env' ? 'aus .env' : keySource === 'discord' ? `per Discord (Fingerabdruck \`${keyInfo?.fingerprint}\`)` : 'fehlt → /spiel-admin bridge-schluessel'}`,
            `Anfragen: ${ws.requests} · abgelehnte Signaturen: ${ws.authFailures}${ws.lastAuthFailure ? ` (zuletzt ${ago(ws.lastAuthFailure.at)}: ${ws.lastAuthFailure.reason})` : ''}`,
          ].join('\n'),
          1024,
        ),
      },
      {
        name: 'Spiel',
        value: [
          `${onOff(ls.connected)} ${ls.connected ? 'verbunden' : 'keine aktuellen Daten'} · letzte Daten ${ago(ls.lastContactAt)}`,
          `Server online: ${scope.type === 'none' ? '—' : live.serversFor(scope).length} · Snapshots: ${ls.received} (${ls.rejected} ungültig)`,
          `Ereignisse: ${es.processed} verarbeitet · ${es.duplicates} doppelt · ${es.rejected} ungültig · ${es.failed} fehlgeschlagen · ${es.queued} wartend`,
          `Befehle unterwegs: ${outbox.pendingCount()} · Intervalle: Live ${cloud.gameConfig().liveSeconds ?? 15} s, Befehle ${cloud.gameConfig().syncSeconds ?? 3} s`,
        ].join('\n'),
      },
      {
        name: 'Roblox Open Cloud (optional)',
        value: truncate(
          [
            `Universe-ID: ${cloud.universeId() || '—'} · API-Key: ${robloxKey === 'env' ? 'aus .env' : robloxKey === 'discord' ? `per Discord (\`${secrets.secretInfo(cloud.API_KEY_SECRET)?.fingerprint}\`)` : 'keiner'}`,
            ...Object.entries(health).map(([area, h]) => `${h.lastError && (!h.lastOkAt || h.lastErrorAt > h.lastOkAt) ? '🔴' : '🟢'} ${area}: ${h.ok} ok · ${h.failed} Fehler · Ø ${h.avgMs} ms${h.lastError ? ` · ${h.lastError}` : ''}`),
          ].join('\n') || '—',
          1024,
        ),
      },
      {
        name: 'Dieser Discord',
        value: [
          `Bereich: ${scope.type === 'main' ? 'Haupt-Discord (ganzes Spiel)' : scope.type === 'private' ? `Privatserver „${scope.name}“` : 'nicht verknüpft'}`,
          `Deine Stufe: ${permissions.levelName(interaction.member)}`,
          `Verschlüsselung (ENRP_SECRET): ${secrets.canEncrypt() ? '🟢 eingerichtet' : '🔴 fehlt'}`,
        ].join('\n'),
      },
    );
  return result;
}

// Ende-zu-Ende-Test: Domain → Proxy → Bot, inklusive Signatur
async function selfTest() {
  const lines = [];
  const ws = web.status();
  lines.push(`${onOff(ws.running)} Webserver läuft${ws.running ? ` (Port ${ws.port})` : ''}`);
  const url = ws.publicUrl;
  if (!url) {
    lines.push('⚪ PUBLIC_URL fehlt in der .env – Domain-Test übersprungen');
  } else {
    try {
      const res = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(8000) });
      const body = await res.json().catch(() => null);
      lines.push(body?.service === 'enrp-bridge' ? '🟢 Domain erreicht den Bot (/health)' : `🔴 Domain antwortet, aber nicht dieser Bot (HTTP ${res.status}) – läuft dort ein anderes Programm?`);
    } catch (err) {
      lines.push(`🔴 Domain nicht erreichbar: ${err.message}`);
    }
    const secret = auth.bridgeSecret();
    if (secret) {
      const path = '/bridge/v1/bans';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomUUID();
      const signature = auth.sign(secret, { timestamp, nonce, method: 'GET', path, body: '' });
      try {
        const res = await fetch(new URL(path, url), {
          headers: { 'X-ENRP-Timestamp': timestamp, 'X-ENRP-Nonce': nonce, 'X-ENRP-Signature': signature },
          signal: AbortSignal.timeout(8000),
        });
        lines.push(res.status === 200 ? '🟢 Signierte Anfrage über die Domain klappt' : `🔴 Signierte Anfrage: HTTP ${res.status}`);
      } catch (err) {
        lines.push(`🔴 Signierte Anfrage: ${err.message}`);
      }
    } else {
      lines.push('🔴 Kein Bridge-Schlüssel – /spiel-admin bridge-schluessel');
    }
  }
  if (cloud.isConfigured()) {
    try {
      await cloud.getBan('1');
      lines.push('🟢 Roblox Open Cloud (Ban-API) erreichbar');
    } catch (err) {
      lines.push(`🔴 Roblox Open Cloud: ${err.message}`);
    }
  } else {
    lines.push('⚪ Roblox Open Cloud nicht eingerichtet (optional)');
  }
  try {
    const stats = await cloud.gameStats();
    lines.push(stats ? `🟢 Roblox-Statistik: ${stats.name} · ${stats.playing} online` : '⚪ Keine Universe-ID – Statistik übersprungen');
  } catch (err) {
    lines.push(`🔴 Roblox-Statistik: ${err.message}`);
  }
  return lines;
}

const privateServer = {
  async verknuepfen(interaction) {
    const guildId = interaction.options.getString('discord_server_id').trim();
    const guild = interaction.client.guilds.cache.get(guildId);
    if (!guild) return interaction.editReply('❌ Der Bot ist nicht auf diesem Discord-Server. Lade ihn zuerst dort ein und prüfe die ID.');
    let owner;
    try {
      owner = await commands.resolveAnyPlayer(interaction.options.getString('besitzer'));
    } catch (err) {
      return interaction.editReply(`❌ ${err.message}`);
    }
    const name = interaction.options.getString('name').trim();
    const previous = links.scopeOf(guildId);
    try {
      links.linkPrivateServer(guildId, { ownerId: owner.id, ownerName: owner.name, name, linkedBy: interaction.user.id });
    } catch (err) {
      return interaction.editReply(`❌ ${err.message}`);
    }
    if (previous.type === 'private' && previous.ownerId !== owner.id) await rights.clearGuild(guildId, previous.ownerId);
    rights.syncGuild(guild).catch((err) => console.error('[spielrechte]', err.message));
    await sendTo(guild, 'modLog', {
      embeds: [
        embed('success')
          .setTitle('🎮 Mit dem Spiel verknüpft')
          .setDescription(`Dieser Discord gehört jetzt zu den Privatservern von **${owner.name}** („${name}“). Euer Team kann dort \`/spiel\`, \`/ingame\`, \`/cad\` und \`/bolo\` nutzen.`),
      ],
    });
    await sendTo(interaction.guild, 'modLog', {
      embeds: [embed('success').setTitle('🎮 Privatserver verknüpft').setDescription(`${guild.name} (\`${guild.id}\`) ↔ [${owner.name}](${profileUrl(owner.id)}) „${name}“ – von ${interaction.user}`)],
    });
    return interaction.editReply(`✅ **${guild.name}** verwaltet jetzt die Privatserver von **${owner.name}** („${name}“).`);
  },

  async entfernen(interaction) {
    const guildId = interaction.options.getString('discord_server_id').trim();
    const previous = links.scopeOf(guildId);
    if (!links.unlinkPrivateServer(guildId)) return interaction.editReply('Dieser Discord-Server ist mit keinem Privatserver verknüpft.');
    if (previous.type === 'private') await rights.clearGuild(guildId, previous.ownerId);
    const guild = interaction.client.guilds.cache.get(guildId);
    if (guild) await sendTo(guild, 'modLog', { embeds: [embed('danger').setTitle('🎮 Verknüpfung mit dem Spiel entfernt')] });
    return interaction.editReply(`✅ Verknüpfung von \`${guildId}\` entfernt. Vergebene Spielrechte wurden zurückgenommen.`);
  },

  async liste(interaction) {
    const lines = links.listPrivateServers().map((link) => {
      const guild = interaction.client.guilds.cache.get(link.guildId);
      return `• **${link.name}** – ${guild ? guild.name : 'Bot nicht mehr dort'} (\`${link.guildId}\`) · Besitzer [${link.ownerName}](${profileUrl(link.ownerId)})`;
    });
    return interaction.editReply({ embeds: [embed().setTitle('🎮 Privatserver-Discords').setDescription(truncate(lines.join('\n') || 'Noch keine verknüpft.', 4000))] });
  },
};

module.exports = {
  data: builder,

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();
    const o = interaction.options;
    const scope = links.scopeOf(interaction.guildId);
    if (!permissions.can(interaction.member, 'admin')) return replyPrivate(interaction, permissions.deny('admin'));
    if ((group === 'privatserver' || MAIN_ONLY.includes(sub)) && scope.type !== 'main') {
      return replyPrivate(interaction, 'Das betrifft das ganze Spiel und geht nur im Haupt-Discord (`ROBLOX_MAIN_GUILD_IDS`).');
    }

    if (group === 'privatserver') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return privateServer[sub](interaction);
    }

    switch (sub) {
      case 'uebersicht':
        return replyPrivate(interaction, { embeds: [overview(interaction)] });

      case 'test': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return interaction.editReply({ embeds: [embed().setTitle('🧪 Verbindungstest').setDescription((await selfTest()).join('\n'))] });
      }

      case 'bridge-schluessel': {
        if (!secrets.canEncrypt()) return replyPrivate(interaction, `❌ Zum sicheren Speichern fehlt \`ENRP_SECRET\` (mind. ${secrets.MIN_SECRET_LENGTH} Zeichen) in der .env. Alternativ \`BRIDGE_SECRET\` direkt in die .env schreiben.`);
        let value;
        try {
          value = auth.rotateSecret(interaction.user.id);
        } catch (err) {
          return replyPrivate(interaction, `❌ ${err.message}`);
        }
        await sendTo(interaction.guild, 'modLog', { embeds: [embed('warning').setTitle('🔑 Bridge-Schlüssel erneuert').setDescription(`Von ${interaction.user}. Fingerabdruck \`${secrets.fingerprint(value)}\`.`)] });
        return replyPrivate(
          interaction,
          `🔑 **Neuer Bridge-Schlüssel** – wird nur jetzt angezeigt:\n||\`${value}\`||\n\n` +
            '1. In Roblox Studio im Skript **ENRPBridge** bei `BRIDGE_SECRET` eintragen.\n2. Spiel veröffentlichen, dann `/ingame neustart`.\n' +
            '⚠️ Bis dahin lehnt der Bot Anfragen der laufenden Server ab (alter Schlüssel). Teile den Schlüssel mit niemandem.',
        );
      }

      case 'api-key': {
        if (o.getBoolean('entfernen')) {
          const existed = secrets.deleteSecret(cloud.API_KEY_SECRET);
          return replyPrivate(interaction, existed ? '🗑️ Gespeicherter Roblox-API-Key gelöscht.' : 'Es war kein Key gespeichert.');
        }
        if (cloud.apiKeySource() === 'env') return replyPrivate(interaction, 'Der Roblox-API-Key kommt aus `ROBLOX_API_KEY` in der .env – dort ändern.');
        if (!secrets.canEncrypt()) return replyPrivate(interaction, `❌ Zum sicheren Speichern fehlt \`ENRP_SECRET\` (mind. ${secrets.MIN_SECRET_LENGTH} Zeichen) in der .env.`);
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId('spieladmin:apikey')
            .setTitle('Roblox Open Cloud API-Key')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('key').setLabel('API-Key (wird verschlüsselt gespeichert)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setMaxLength(4000),
              ),
            ),
        );
      }

      case 'universe': {
        const value = o.getString('id')?.trim() ?? '';
        if (value && !/^\d{1,20}$/.test(value)) return replyPrivate(interaction, '❌ Die Universe-ID besteht nur aus Ziffern.');
        if ((process.env.ROBLOX_UNIVERSE_ID ?? '').trim()) return replyPrivate(interaction, 'Die Universe-ID kommt aus `ROBLOX_UNIVERSE_ID` in der .env – dort ändern.');
        cloud.gameConfig().universeId = value || undefined;
        db.save();
        return replyPrivate(interaction, value ? `✅ Universe-ID \`${value}\` gespeichert.` : 'Universe-ID entfernt.');
      }

      case 'api-logs': {
        const kind = o.getString('art') ?? 'bridge';
        let lines;
        if (kind === 'bridge') {
          lines = web.recentRequests().slice(-25).reverse().map((r) => `${ago(r.at)} \`${r.route}\` → ${r.status} · ${r.ms} ms${r.note ? ` · ${r.note}` : ''}`);
        } else {
          const list = kind === 'errors' ? [...(db.data.apiLogs ?? []).filter((e) => e.error), ...web.recentRequests().filter((r) => r.status >= 400)] : cloud.recentRequests().concat(db.data.apiLogs ?? []);
          lines = list
            .sort((a, b) => b.at - a.at)
            .slice(0, 25)
            .map((e) => `${ago(e.at)} \`${e.method ?? ''} ${e.path ?? e.route}\` → ${e.status}${e.ms !== undefined ? ` · ${e.ms} ms` : ''}${e.error ? ` · ${truncate(e.error, 80)}` : e.note ? ` · ${e.note}` : ''}`);
        }
        return replyPrivate(interaction, { embeds: [embed().setTitle(`📒 API-Logs · ${kind}`).setDescription(truncate(lines.join('\n') || 'Keine Einträge.', 4000))] });
      }

      case 'intervall': {
        const liveSeconds = o.getInteger('live_sekunden');
        const syncSeconds = o.getInteger('befehle_sekunden');
        if (liveSeconds) cloud.gameConfig().liveSeconds = liveSeconds;
        if (syncSeconds) cloud.gameConfig().syncSeconds = syncSeconds;
        db.save();
        return replyPrivate(interaction, `⏱️ Live-Snapshot alle **${cloud.gameConfig().liveSeconds ?? 15} s**, Befehle alle **${cloud.gameConfig().syncSeconds ?? 3} s**. Die Server übernehmen das beim nächsten Abruf.`);
      }

      case 'logkanal': {
        const art = o.getString('art');
        const channel = o.getChannel('kanal');
        settings.set(interaction.guildId, `game.logs.${art}`, channel?.id ?? '');
        return replyPrivate(interaction, channel ? `✅ ${LOG_TYPES[art]} → ${channel}` : `${LOG_TYPES[art]}: aus.`);
      }

      case 'livepanel': {
        if (scope.type === 'none') return replyPrivate(interaction, 'Dieser Discord ist mit keinem Teil des Spiels verknüpft.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const message = await livePanel.post(interaction.guild, o.getChannel('kanal')).catch((err) => err);
        if (message instanceof Error) return interaction.editReply(`❌ ${message.message}`);
        return interaction.editReply(`✅ Live-Panel gepostet: ${message.url} – aktualisiert sich jede Minute.`);
      }

      case 'dispatch': {
        const channel = o.getChannel('kanal');
        const role = o.getRole('rolle');
        settings.set(interaction.guildId, 'game.dispatchChannel', channel?.id ?? '');
        if (role) settings.set(interaction.guildId, 'game.dispatchRole', role.id);
        if (o.getBoolean('rolle_entfernen')) settings.set(interaction.guildId, 'game.dispatchRole', '');
        const config = settings.forGuild(interaction.guildId).game;
        return replyPrivate(interaction, `📡 Dispatch: ${config.dispatchChannel ? `<#${config.dispatchChannel}>` : 'aus'} · Markieren: ${config.dispatchRole ? `<@&${config.dispatchRole}>` : 'niemanden'}`);
      }

      case 'bolokanal': {
        const channel = o.getChannel('kanal');
        settings.set(interaction.guildId, 'game.boloChannel', channel?.id ?? '');
        return replyPrivate(interaction, channel ? `✅ BOLOs → ${channel}` : 'BOLO-Kanal: aus.');
      }

      case 'berechtigung': {
        const level = o.getString('stufe');
        const role = o.getRole('rolle');
        if (level && role) {
          const current = [...permissions.rolesFor(interaction.guildId, level)];
          const next = o.getBoolean('entfernen') ? current.filter((id) => id !== role.id) : [...new Set([...current, role.id])];
          settings.set(interaction.guildId, `game.permissions.${level}`, next);
        } else if (level || role) {
          return replyPrivate(interaction, 'Bitte Stufe **und** Rolle angeben (oder beides leer für die Übersicht).');
        }
        const lines = permissions.LEVELS.map((l) => {
          const roles = permissions.rolesFor(interaction.guildId, l);
          return `**${permissions.LABELS[l]}**: ${roles.map((id) => `<@&${id}>`).join(' ') || (l === 'view' ? 'jeder (keine Rolle eingestellt)' : 'nur Staff')}`;
        });
        return replyPrivate(interaction, {
          embeds: [
            embed()
              .setTitle('🔐 Berechtigungen')
              .setDescription(
                `${lines.join('\n')}\n\nJede Stufe schließt die darunterliegenden ein. Staff-Rolle oder „Server verwalten“ = Admin.\n` +
                  'Einsicht: Live-Daten · Dispatch: CAD/BOLO · Moderation: PM, Kick, Jail, Heal, Kill, Respawn, Wanted, Team · Admin: Bann, Ansage, Neustart, freie Befehle, Admin-Center',
              ),
          ],
        });
      }
      default:
        return null;
    }
  },

  components: {
    async spieladmin(interaction, [action]) {
      if (action !== 'apikey' || !interaction.isModalSubmit()) return null;
      if (!permissions.can(interaction.member, 'admin') || links.scopeOf(interaction.guildId).type !== 'main') return replyPrivate(interaction, permissions.deny('admin'));
      const key = interaction.fields.getTextInputValue('key').trim();
      if (/\s/.test(key) || key.length < 20) return replyPrivate(interaction, '❌ Das sieht nicht wie ein API-Key aus.');
      secrets.setSecret(cloud.API_KEY_SECRET, key, interaction.user.id);
      await sendTo(interaction.guild, 'modLog', { embeds: [embed('warning').setTitle('🔑 Roblox-API-Key hinterlegt').setDescription(`Von ${interaction.user}. Fingerabdruck \`${secrets.fingerprint(key)}\`.`)] });
      return replyPrivate(interaction, `✅ Gespeichert (verschlüsselt). Fingerabdruck \`${secrets.fingerprint(key)}\`. Teste mit \`/spiel-admin test\`.`);
    },
  },
};
