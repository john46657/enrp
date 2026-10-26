import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from '@emden-network/shared';
import { getGuildConfig, setAuditChannel, setGuildRole, writeAudit } from '@emden-network/core';
import type { Command } from '../context.js';
import { embed, formatDuration, sanitize, ts } from '../format.js';

export const system: Command = {
  data: new SlashCommandBuilder()
    .setName('system')
    .setDescription('Systemverwaltung')
    .addSubcommand((s) => s.setName('health').setDescription('Systemzustand'))
    .addSubcommand((s) =>
      s
        .setName('audit')
        .setDescription('Audit-Log durchsuchen')
        .addStringOption((o) => o.setName('filter').setDescription('Aktion (Präfix), z. B. faction. oder verification.').setMaxLength(48))
        .addUserOption((o) => o.setName('spieler').setDescription('Betroffener oder Auslöser')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('config')
        .setDescription('Konfiguration (nur Owner)')
        .addSubcommand((s) => s.setName('show').setDescription('Aktuelle Konfiguration'))
        .addSubcommand((s) =>
          s
            .setName('role')
            .setDescription('Discord-Rolle einer Berechtigungsrolle zuordnen')
            .addStringOption((o) =>
              o.setName('schluessel').setDescription('Berechtigungsrolle').setRequired(true).addChoices(...ROLE_KEYS.map((k) => ({ name: ROLE_LABELS[k], value: k }))),
            )
            .addRoleOption((o) => o.setName('rolle').setDescription('Discord-Rolle (leer = Zuordnung entfernen)')),
        )
        .addSubcommand((s) =>
          s
            .setName('auditchannel')
            .setDescription('Kanal für Audit-Benachrichtigungen')
            .addChannelOption((o) => o.setName('kanal').setDescription('Textkanal (leer = entfernen)').addChannelTypes(ChannelType.GuildText)),
        ),
    ),

  async execute(ctx) {
    const group = ctx.i.options.getSubcommandGroup(false);
    const sub = ctx.i.options.getSubcommand();
    const pool = ctx.services.pool;

    if (group === 'config') {
      await ctx.require('system.config');
      if (sub === 'show') {
        const cfg = await getGuildConfig(pool, ctx.guildId);
        const lines = ROLE_KEYS.map((k) => `${ROLE_LABELS[k]}: ${cfg.roleMap[k] ? `<@&${cfg.roleMap[k]}>` : '— nicht gesetzt —'}`);
        await ctx.reply({ embeds: [embed('Konfiguration', `${lines.join('\n')}\n\nAudit-Kanal: ${cfg.auditChannelId ? `<#${cfg.auditChannelId}>` : '—'}`)] });
        return;
      }
      if (sub === 'role') {
        const key = ctx.i.options.getString('schluessel', true) as RoleKey;
        const role = ctx.i.options.getRole('rolle');
        if (role?.managed || role?.id === ctx.guildId) {
          await ctx.reply('Diese Rolle kann nicht verwendet werden (verwaltete Rolle oder @everyone).');
          return;
        }
        await setGuildRole(pool, ctx.guildId, key, role?.id ?? null, ctx.actor.discordId);
        await writeAudit(pool, { actorType: 'discord_user', actorId: ctx.actor.discordId, action: 'system.config_changed', guildId: ctx.guildId, metadata: { key, roleId: role?.id ?? null } });
        await ctx.reply(`✅ ${ROLE_LABELS[key]} → ${role ? `<@&${role.id}>` : 'entfernt'}`);
        return;
      }
      if (sub === 'auditchannel') {
        const ch = ctx.i.options.getChannel('kanal');
        await setAuditChannel(pool, ctx.guildId, ch?.id ?? null, ctx.actor.discordId);
        await writeAudit(pool, { actorType: 'discord_user', actorId: ctx.actor.discordId, action: 'system.config_changed', guildId: ctx.guildId, metadata: { auditChannelId: ch?.id ?? null } });
        await ctx.reply(`✅ Audit-Kanal ${ch ? `<#${ch.id}>` : 'entfernt'}.`);
        return;
      }
    }

    if (sub === 'health') {
      await ctx.require('system.health');
      const t0 = Date.now();
      let db = 'OK';
      try {
        await pool.query('SELECT 1');
        db = `OK (${Date.now() - t0} ms)`;
      } catch {
        db = '❌ nicht erreichbar';
      }
      const outbox = await pool
        .query<{ pending: string; failed: string }>(`SELECT count(*) FILTER (WHERE status IN ('pending','processing')) AS pending, count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 day') AS failed FROM outbox_events`)
        .then((r) => r.rows[0]!, () => ({ pending: '?', failed: '?' }));
      const status = await ctx.services.game.status().catch(() => null);
      const e = embed('Systemzustand').addFields(
        { name: 'Datenbank', value: db, inline: true },
        { name: 'Gateway-Ping', value: `${ctx.i.client.ws.ping} ms`, inline: true },
        { name: 'Bot-Laufzeit', value: formatDuration(Math.round((Date.now() - ctx.services.startedAt.getTime()) / 1000)), inline: true },
        { name: 'Rollen-Warteschlange', value: `${outbox.pending} offen · ${outbox.failed} fehlgeschlagen (24 h)`, inline: true },
        { name: 'Roblox-Server', value: status ? `${status.servers} online · ${status.players} Spieler` : 'unbekannt', inline: true },
      );
      await ctx.reply({ embeds: [e] });
      return;
    }

    if (sub === 'audit') {
      await ctx.require('system.audit');
      const filter = ctx.i.options.getString('filter');
      const user = ctx.i.options.getUser('spieler');
      const { rows } = await pool.query<{ occurred_at: Date; actor_id: string | null; action: string; target_id: string | null; outcome: string; reason: string | null }>(
        `SELECT occurred_at, actor_id, action, target_id, outcome, reason FROM audit_logs
         WHERE ($1::text IS NULL OR action LIKE $1 || '%') AND ($2::text IS NULL OR actor_id = $2 OR target_id = $2)
         ORDER BY occurred_at DESC LIMIT 20`,
        [filter ? filter.replace(/[%_\\]/g, '') : null, user?.id ?? null],
      );
      const icon = (o: string) => (o === 'success' ? '✅' : o === 'denied' ? '⛔' : '❌');
      const lines = rows.map((r) => `${icon(r.outcome)} ${ts(r.occurred_at, 'f')} \`${r.action}\`${r.actor_id ? ` <@${r.actor_id}>` : ''}${r.target_id ? ` → ${r.target_id}` : ''}${r.reason ? ` – ${sanitize(r.reason).slice(0, 80)}` : ''}`);
      await ctx.reply({ embeds: [embed('Audit-Log', lines.join('\n').slice(0, 4000) || 'Keine Einträge.')] });
    }
  },
};
