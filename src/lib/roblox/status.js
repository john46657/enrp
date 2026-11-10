// Status-Anzeige des eigenen Roblox-Spiels (für /spiel status, /serverstatus und das Live-Panel).
// Kombiniert öffentliche Roblox-Zahlen (Besuche, Favoriten) mit den Live-Daten der Bridge (nur der eigene Bereich).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed, truncate } = require('../util');
const { forGuild } = require('../settings');
const cloud = require('./openCloud');
const links = require('./links');
const live = require('../game/live');
const auth = require('../web/auth');
const web = require('../web/server');

const number = (n) => Number(n ?? 0).toLocaleString('de-DE');

function bridgeLine() {
  const st = live.status();
  if (!auth.bridgeSecret()) return '⚪ Bridge nicht eingerichtet';
  if (!web.status().running) return `🔴 Bridge-Webserver aus${web.status().error ? ` (${web.status().error})` : ''}`;
  if (!st.lastContactAt) return '🟡 Bridge bereit – noch keine Daten vom Spiel';
  return st.connected ? `🟢 Spiel verbunden (letzte Daten <t:${Math.floor(st.lastContactAt / 1000)}:R>)` : `🔴 Keine Daten seit <t:${Math.floor(st.lastContactAt / 1000)}:R>`;
}

async function statusMessage(guildId, { openCalls = null } = {}) {
  const scope = links.scopeOf(guildId);
  const brand = forGuild(guildId).game.brand;
  let stats = null;
  let statsError = null;
  try {
    stats = await cloud.gameStats();
  } catch (err) {
    statsError = err.message;
  }

  const result = embed(live.status().connected ? 'success' : 'warning').setTitle(`🎮 ${stats?.name ?? brand}`);
  if (stats) result.setURL(stats.url);
  if (scope.type === 'private') result.setDescription(`Privatserver **${scope.name}** (Besitzer: ${scope.ownerName})`);

  if (scope.type !== 'none') {
    const t = live.totals(scope);
    result.addFields(
      { name: 'Server', value: number(t.servers), inline: true },
      { name: 'Spieler', value: `${number(t.players)}${t.capacity ? ` / ${number(t.capacity)}` : ''}`, inline: true },
      { name: 'Staff online', value: number(t.staff), inline: true },
      { name: 'Fahrzeuge', value: number(t.vehicles), inline: true },
      { name: 'Gesucht / Gefängnis', value: `${number(t.wanted)} / ${number(t.jailed)}`, inline: true },
      { name: 'Offene Notrufe', value: openCalls === null ? '—' : number(openCalls), inline: true },
    );
    const servers = live.serversFor(scope).slice(0, 8);
    if (servers.length) {
      result.addFields({
        name: 'Server im Überblick',
        value: truncate(servers.map((s) => `${live.serverLabel(s)} — ${s.players.length}/${s.maxPlayers} · ${s.players.filter((p) => p.staff).length} Staff · ${s.vehicles.length} 🚗`).join('\n'), 1024),
      });
    }
  }
  if (stats && scope.type !== 'private') {
    result.addFields(
      { name: 'Roblox gesamt online', value: number(stats.playing), inline: true },
      { name: 'Besuche', value: number(stats.visits), inline: true },
      { name: 'Favoriten', value: number(stats.favorites), inline: true },
    );
  }
  result.addFields(
    { name: 'Warteschlange', value: '— (gibt es bei Roblox nicht)', inline: true },
    { name: 'API-Status', value: truncate(`${bridgeLine()}\n${stats ? '🟢 Roblox-Statistik' : statsError ? `🔴 Roblox-Statistik: ${statsError}` : '⚪ Roblox-Statistik: keine Universe-ID'}`, 1024) },
    { name: 'Aktualisiert', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
  );
  return {
    embeds: [result],
    components: stats ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Spielen').setStyle(ButtonStyle.Link).setURL(stats.url))] : [],
  };
}

module.exports = { statusMessage, bridgeLine };
