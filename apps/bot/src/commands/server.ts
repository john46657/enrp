import { SlashCommandBuilder } from 'discord.js';
import { AppError, BRAND, type RoleKey } from '@emden-network/shared';
import { ModerationService, getActiveLinkByDiscord, getGuildConfig } from '@emden-network/core';
import { resolveRoleKeys } from '@emden-network/shared';
import type { Command, CommandContext } from '../context.js';
import { embed, sanitize, ts } from '../format.js';

const STAFF: RoleKey[] = ['owner', 'management', 'moderator'];

/** Teammitglieder dürfen nur vom Owner moderiert werden. */
async function assertModeratable(ctx: CommandContext, targetId: string): Promise<void> {
  if (targetId === ctx.actor.discordId) throw new AppError('FORBIDDEN', 403, 'Selbstmoderation');
  const member = await ctx.i.guild!.members.fetch(targetId).catch(() => null);
  if (!member) return;
  const cfg = await getGuildConfig(ctx.services.pool, ctx.guildId);
  const targetRoles = resolveRoleKeys(member.roles.cache.keys(), cfg.roleMap);
  if (STAFF.some((r) => targetRoles.has(r)) && !ctx.actor.roles.has('owner')) throw new AppError('FORBIDDEN', 403, 'Ziel ist Teammitglied');
}

/** Roblox-ID aus Discord-Verknüpfung oder direkter Angabe */
async function resolveRobloxTarget(ctx: CommandContext): Promise<{ robloxUserId: string; label: string }> {
  const user = ctx.i.options.getUser('spieler');
  const raw = ctx.i.options.getString('roblox_id');
  if (user) {
    await assertModeratable(ctx, user.id);
    const link = await getActiveLinkByDiscord(ctx.services.pool, user.id);
    if (!link) throw new AppError('NOT_LINKED', 404, 'Ziel nicht verifiziert – roblox_id angeben');
    return { robloxUserId: link.robloxUserId, label: `<@${user.id}> (${link.robloxUsername ?? link.robloxUserId})` };
  }
  if (raw && /^[1-9][0-9]{0,18}$/.test(raw)) return { robloxUserId: raw, label: `Roblox-ID ${raw}` };
  throw new AppError('VALIDATION', 400, 'spieler oder roblox_id angeben');
}

export const server: Command = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Roblox-Server')
    .addSubcommand((s) => s.setName('status').setDescription('Serverstatus'))
    .addSubcommand((s) => s.setName('players').setDescription('Verifizierte Spieler online'))
    .addSubcommand((s) => s.setName('announce').setDescription('Ingame-Ankündigung').addStringOption((o) => o.setName('text').setDescription('Text').setRequired(true).setMaxLength(200)))
    .addSubcommand((s) =>
      s
        .setName('maintenance')
        .setDescription('Wartungsmodus')
        .addStringOption((o) => o.setName('status').setDescription('An oder aus').setRequired(true).addChoices({ name: 'an', value: 'an' }, { name: 'aus', value: 'aus' }))
        .addStringOption((o) => o.setName('nachricht').setDescription('Hinweis für Spieler').setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s.setName('restart-announce').setDescription('Neustart ankündigen').addIntegerOption((o) => o.setName('zeit').setDescription('Minuten bis zum Neustart').setRequired(true).setMinValue(1).setMaxValue(60)),
    ),
  async execute(ctx) {
    const sub = ctx.i.options.getSubcommand();
    const game = ctx.services.game;
    switch (sub) {
      case 'status': {
        await ctx.require('server.view');
        const s = await game.status();
        const e = embed(`${BRAND.name} – Serverstatus`).addFields(
          { name: 'Server online', value: String(s.servers), inline: true },
          { name: 'Spieler', value: String(s.players), inline: true },
          { name: 'Wartung', value: s.maintenance.enabled ? `Ja${s.maintenance.message ? ` – ${s.maintenance.message}` : ''}` : 'Nein', inline: true },
        );
        if (s.list.length) e.addFields({ name: 'Instanzen', value: s.list.slice(0, 10).map((x) => `\`${x.jobId.slice(0, 8)}\` ${x.players}/${x.maxPlayers ?? '?'} · ${ts(x.lastHeartbeatAt, 'R')}`).join('\n') });
        await ctx.reply({ embeds: [e] });
        return;
      }
      case 'players': {
        await ctx.require('moderation.case_view');
        const list = await game.onlinePlayers();
        const lines = list.slice(0, 50).map((p) => `• ${p.robloxUsername ?? p.robloxUserId}${p.discordId ? ` – <@${p.discordId}>` : ' (nicht verifiziert)'}`);
        await ctx.reply({ embeds: [embed(`Spieler online (${list.length})`, lines.join('\n') || 'Niemand online.')] });
        return;
      }
      case 'announce': {
        const job = await game.createJob(ctx.actor, ctx.guildId, 'announce', { message: sanitize(ctx.i.options.getString('text', true)) });
        await ctx.reply(`📢 Ankündigung an alle Server übermittelt (gültig bis ${ts(job.expiresAt, 't')}).`);
        return;
      }
      case 'maintenance': {
        const enabled = ctx.i.options.getString('status', true) === 'an';
        await game.setMaintenance(ctx.actor, ctx.guildId, enabled, ctx.i.options.getString('nachricht'));
        await ctx.reply(enabled ? '🛠️ Wartungsmodus aktiviert. Server übernehmen ihn mit dem nächsten Heartbeat (≤ 30 s).' : '✅ Wartungsmodus beendet.');
        return;
      }
      case 'restart-announce': {
        const minutes = ctx.i.options.getInteger('zeit', true);
        await game.createJob(ctx.actor, ctx.guildId, 'restart_announce', { minutes }, { ttlSeconds: 120 });
        await ctx.reply(`⏱️ Neustart in ${minutes} Minuten wurde angekündigt.`);
        return;
      }
    }
  },
};

export const gamekick: Command = {
  data: new SlashCommandBuilder()
    .setName('gamekick')
    .setDescription('Spieler aus dem Roblox-Spiel kicken')
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMinLength(3).setMaxLength(200))
    .addUserOption((o) => o.setName('spieler').setDescription('Verifizierter Discord-Nutzer'))
    .addStringOption((o) => o.setName('roblox_id').setDescription('Alternativ: Roblox-User-ID')),
  async execute(ctx) {
    await ctx.require('moderation.game_kick');
    const t = await resolveRobloxTarget(ctx);
    await ctx.services.game.createJob(ctx.actor, ctx.guildId, 'kick', { robloxUserId: t.robloxUserId, reason: sanitize(ctx.i.options.getString('grund', true)) }, { ttlSeconds: 120 });
    await ctx.reply(`👢 Kick für ${t.label} beauftragt. Ist der Spieler online, wird er innerhalb weniger Sekunden entfernt.`);
  },
};

const BAN_DURATIONS = [
  { name: '1 Stunde', value: 3600 },
  { name: '1 Tag', value: 86400 },
  { name: '7 Tage', value: 604800 },
  { name: '30 Tage', value: 2592000 },
  { name: 'Dauerhaft', value: 0 },
];

export const gameban: Command = {
  data: new SlashCommandBuilder()
    .setName('gameban')
    .setDescription('Spieler im Roblox-Spiel bannen')
    .addIntegerOption((o) => o.setName('dauer').setDescription('Dauer').setRequired(true).addChoices(...BAN_DURATIONS))
    .addStringOption((o) => o.setName('grund').setDescription('Grund (wird dem Spieler angezeigt)').setRequired(true).setMinLength(3).setMaxLength(200))
    .addUserOption((o) => o.setName('spieler').setDescription('Verifizierter Discord-Nutzer'))
    .addStringOption((o) => o.setName('roblox_id').setDescription('Alternativ: Roblox-User-ID')),
  async execute(ctx) {
    await ctx.require('moderation.game_ban');
    const t = await resolveRobloxTarget(ctx);
    const dauer = ctx.i.options.getInteger('dauer', true);
    await ctx.services.game.createJob(
      ctx.actor,
      ctx.guildId,
      'ban',
      { robloxUserId: t.robloxUserId, reason: sanitize(ctx.i.options.getString('grund', true)), durationSeconds: dauer === 0 ? null : dauer },
      { ttlSeconds: 600 },
    );
    await ctx.reply(`🔨 Bann für ${t.label} beauftragt (${BAN_DURATIONS.find((d) => d.value === dauer)?.name}). Ein Spielserver setzt ihn über die Roblox-Ban-API um.`);
  },
};

export const warn: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Mitglied verwarnen')
    .addUserOption((o) => o.setName('spieler').setDescription('Mitglied').setRequired(true))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMinLength(3).setMaxLength(500)),
  async execute(ctx) {
    const target = ctx.i.options.getUser('spieler', true);
    await assertModeratable(ctx, target.id);
    const reason = ctx.i.options.getString('grund', true);
    const id = await new ModerationService(ctx.services.pool).recordDiscordCase(ctx.actor, ctx.guildId, 'warn', target.id, reason);
    const dm = await target.send(`⚠️ Du wurdest auf ${BRAND.name} verwarnt (Fall #${id}). Grund: ${reason}`).then(() => true, () => false);
    await ctx.reply(`⚠️ <@${target.id}> verwarnt (Fall #${id}).${dm ? '' : ' DM konnte nicht zugestellt werden.'}`);
  },
};

const TIMEOUTS = [
  { name: '10 Minuten', value: 600 },
  { name: '1 Stunde', value: 3600 },
  { name: '1 Tag', value: 86400 },
  { name: '7 Tage', value: 604800 },
];

export const timeout: Command = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Discord-Timeout verhängen')
    .addUserOption((o) => o.setName('spieler').setDescription('Mitglied').setRequired(true))
    .addIntegerOption((o) => o.setName('dauer').setDescription('Dauer').setRequired(true).addChoices(...TIMEOUTS))
    .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMinLength(3).setMaxLength(500)),
  async execute(ctx) {
    const target = ctx.i.options.getUser('spieler', true);
    await assertModeratable(ctx, target.id);
    const seconds = ctx.i.options.getInteger('dauer', true);
    const reason = ctx.i.options.getString('grund', true);
    const member = await ctx.i.guild!.members.fetch(target.id).catch(() => null);
    if (!member?.moderatable) throw new AppError('FORBIDDEN', 403, 'Bot kann Mitglied nicht moderieren (Rollenhierarchie)');
    // Fall zuerst anlegen (inkl. Berechtigungsprüfung), dann Discord-Aktion ausführen.
    const id = await new ModerationService(ctx.services.pool).recordDiscordCase(ctx.actor, ctx.guildId, 'timeout', target.id, reason, seconds);
    await member.timeout(seconds * 1000, `${BRAND.name} Fall #${id}: ${reason}`.slice(0, 512));
    await ctx.reply(`🔇 <@${target.id}> erhält einen Timeout (Fall #${id}).`);
  },
};

export const caseCmd: Command = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Moderationsfälle')
    .addSubcommand((s) => s.setName('view').setDescription('Fall anzeigen').addIntegerOption((o) => o.setName('id').setDescription('Fallnummer').setRequired(true).setMinValue(1))),
  async execute(ctx) {
    const c = await new ModerationService(ctx.services.pool).getCase(ctx.actor, ctx.guildId, ctx.i.options.getInteger('id', true));
    const e = embed(`Fall #${c.id} – ${c.action}`).addFields(
      { name: 'Ziel', value: c.targetDiscordId ? `<@${c.targetDiscordId}>` : `Roblox-ID ${c.targetRobloxId}`, inline: true },
      { name: 'Moderator', value: c.moderatorDiscordId ? `<@${c.moderatorDiscordId}>` : '–', inline: true },
      { name: 'Status', value: c.status, inline: true },
      { name: 'Grund', value: sanitize(c.reason) },
      { name: 'Erstellt', value: ts(c.createdAt), inline: true },
      { name: 'Läuft ab', value: c.expiresAt ? ts(c.expiresAt) : '–', inline: true },
    );
    await ctx.reply({ embeds: [e] });
  },
};

export const serverCommands = [server, gamekick, gameban, warn, timeout, caseCmd];
