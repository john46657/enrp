import { z } from 'zod';
import { accountLinks, and, eq, memberRoleCache, serverCommands } from '@enrp/database';
import { AppError, PLAYER_ACTIONS, errors, type PlayerAction } from '@enrp/shared';
import { buildUserActor } from '../access';
import { type Actor, type RobloxServerActor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { SERVER_COMMAND_TTL_SECONDS, getServerByJobId } from './game';
import { queueActionLog } from './gamelogs';
import { findOnlinePlayer, onlineServers } from './live';

/**
 * Aktionen an einzelnen Spielern im Spiel (Gefängnis, Fahndungsstufe, Heilen, Töten, Respawn, Team, Nachricht,
 * Kick). Die Plattform sucht den Server, auf dem der Spieler gerade ist, und legt dort einen Server-Befehl
 * „player_action“ an; das Spiel holt ihn ab, führt ihn aus und bestätigt. Jede Aktion steht mit Grund im Audit-Log.
 */

export const ACTION_LABEL: Record<PlayerAction, string> = {
  jail: 'Ins Gefängnis',
  unjail: 'Aus dem Gefängnis entlassen',
  heal: 'Heilen',
  kill: 'Töten',
  respawn: 'Respawn',
  wanted: 'Fahndungsstufe setzen',
  team: 'Team setzen',
  pm: 'Private Nachricht',
  kick: 'Vom Server kicken',
};

/** Töten und Kicken greifen stärker ein und brauchen player_actions:delete. */
const HEAVY = new Set<PlayerAction>(['kill', 'kick']);

export const playerActionSchema = z
  .object({
    action: z.enum(PLAYER_ACTIONS),
    reason: z.string().trim().min(3).max(300),
    minutes: z.number().int().min(1).max(120).optional(),
    level: z.number().int().min(0).max(5).optional(),
    team: z.string().trim().min(1).max(40).optional(),
    message: z.string().trim().min(1).max(300).optional(),
  })
  .superRefine((v, c) => {
    const need = (field: 'minutes' | 'level' | 'team' | 'message', label: string) => {
      if (v[field] === undefined) c.addIssue({ code: 'custom', path: [field], message: `${label} fehlt.` });
    };
    if (v.action === 'jail') need('minutes', 'Dauer in Minuten');
    if (v.action === 'wanted') need('level', 'Fahndungsstufe');
    if (v.action === 'team') need('team', 'Team');
    if (v.action === 'pm') need('message', 'Nachricht');
  });
export type PlayerActionInput = z.infer<typeof playerActionSchema>;

export async function createPlayerAction(
  ctx: CoreContext,
  actor: Actor,
  robloxUserId: number,
  input: PlayerActionInput,
  /** Bekannter Server (Team-Befehl im Spiel): keine Suche in der Live-Lage nötig. */
  known?: { server: { id: string; jobId: string; serverType: string }; username: string },
) {
  requirePermission(actor, HEAVY.has(input.action) ? 'player_actions:delete' : 'player_actions:edit');
  const now = ctx.now();
  const online = known
    ? { server: known.server, player: { username: known.username } }
    : await findOnlinePlayer(ctx.db, now, robloxUserId);
  if (!online) throw errors.badRequest('Der Spieler ist gerade auf keinem Server.');
  if (input.action === 'team' && !known) {
    const live = (await onlineServers(ctx.db, now)).find((s) => s.server.id === online.server.id)?.live;
    if (live?.teams.length && !live.teams.some((t) => t.toLowerCase() === input.team!.toLowerCase()))
      throw errors.badRequest(`Team „${input.team}“ gibt es auf diesem Server nicht (${live.teams.join(', ')}).`);
  }
  const payload: Record<string, unknown> = {};
  if (input.minutes !== undefined) payload.minutes = input.minutes;
  if (input.level !== undefined) payload.level = input.level;
  if (input.team !== undefined) payload.team = input.team;
  const message = input.action === 'pm' ? input.message! : input.action === 'kick' ? input.reason : null;

  const command = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(serverCommands)
      .values({
        serverId: online.server.id,
        type: 'player_action',
        robloxUserId,
        action: input.action,
        payload,
        message,
        reason: input.reason,
        createdBy: actorId(actor),
        createdAt: now,
        expiresAt: new Date(now.getTime() + SERVER_COMMAND_TTL_SECONDS * 1000),
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: `player_action.${input.action}`,
        resourceType: 'roblox_user',
        resourceId: String(robloxUserId),
        reason: input.reason,
        after: { commandId: row!.id, serverId: online.server.id, ...payload, message },
      },
      now,
    );
    return row!;
  });
  ctx.realtime.publish('servers', 'server.command', { count: 1, type: 'player_action' });
  await queueActionLog(
    ctx,
    actor,
    { action: input.action, robloxUserId, username: online.player.username, reason: input.reason, details: payload },
    { jobId: online.server.jobId, serverType: online.server.serverType },
  );
  return {
    id: command.id,
    command: {
      id: command.id,
      type: command.type,
      robloxUserId,
      message: command.message,
      action: command.action,
      payload: command.payload ?? {},
    },
    action: input.action,
    status: command.status,
    player: { userId: robloxUserId, username: online.player.username },
    server: { id: online.server.id, jobId: online.server.jobId },
  };
}

// ---------------------------------------------------------------------------
// Team-Befehle im Spiel-Chat (:jail, :kick, …)
// ---------------------------------------------------------------------------

export const staffCommandSchema = z.object({
  jobId: z.string().min(1).max(100),
  /** Wer den Befehl im Chat geschrieben hat. */
  issuerId: z.number().int().positive(),
  targetId: z.number().int().positive(),
  targetName: z.string().min(1).max(40),
  action: z.enum(PLAYER_ACTIONS),
  reason: z.string().trim().max(300).optional(),
  minutes: z.number().int().min(1).max(120).optional(),
  level: z.number().int().min(0).max(5).optional(),
  team: z.string().trim().min(1).max(40).optional(),
  message: z.string().trim().min(1).max(300).optional(),
});

/**
 * Handelnde Person zu einem Roblox-Konto: nur über eine aktive Verknüpfung mit Discord (/verify). Rechte kommen aus
 * den Rollenbindungen und den Discord-Rollen (zwischengespeichert, bei Bedarf frisch von Discord geladen).
 */
export async function actorFromRoblox(ctx: CoreContext, robloxUserId: number) {
  const [link] = await ctx.db
    .select({ discordUserId: accountLinks.discordUserId })
    .from(accountLinks)
    .where(and(eq(accountLinks.robloxUserId, robloxUserId), eq(accountLinks.status, 'active')));
  if (!link) return null;
  const [cached] = await ctx.db
    .select()
    .from(memberRoleCache)
    .where(eq(memberRoleCache.discordUserId, link.discordUserId));
  let roleIds = cached?.roleIds ?? [];
  const stale = !cached || ctx.now().getTime() - cached.fetchedAt.getTime() > 5 * 60_000;
  if (stale && ctx.discord.configured && ctx.config.guildId) {
    try {
      const member = await ctx.discord.getMember(ctx.config.guildId, link.discordUserId);
      roleIds = member?.roleIds ?? [];
      const value = { roleIds, inGuild: Boolean(member), fetchedAt: ctx.now() };
      await ctx.db
        .insert(memberRoleCache)
        .values({ discordUserId: link.discordUserId, ...value })
        .onConflictDoUpdate({ target: memberRoleCache.discordUserId, set: value });
    } catch (err) {
      ctx.logger.warn({ err: (err as Error).message }, 'Discord-Rollen für Team-Befehl nicht ladbar');
    }
  }
  return buildUserActor(ctx.db, ctx.config, { discordUserId: link.discordUserId, roleIds, via: 'game' });
}

/**
 * Team-Befehl aus dem Spiel-Chat. Antwort an den Server: ok + Befehl (wird sofort ausgeführt) oder eine
 * verständliche Ablehnung, die dem Schreibenden angezeigt wird. Rechte und Audit wie im Dashboard.
 */
export async function staffCommandFromGame(
  ctx: CoreContext,
  server: RobloxServerActor,
  input: z.infer<typeof staffCommandSchema>,
) {
  const row = await getServerByJobId(ctx.db, input.jobId);
  if (!row || row.apiKeyId !== server.apiKeyId) throw errors.badRequest('Unbekannter Server.');
  const actor = await actorFromRoblox(ctx, input.issuerId);
  if (!actor) return { ok: false as const, error: 'Dein Roblox-Konto ist nicht mit Discord verknüpft (/verify).' };
  const parsed = playerActionSchema.safeParse({
    action: input.action,
    reason: input.reason && input.reason.length >= 3 ? input.reason : `Team-Befehl im Spiel (${input.action})`,
    minutes: input.minutes,
    level: input.level,
    team: input.team,
    message: input.message,
  });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Ungültiger Befehl.' };
  try {
    const result = await createPlayerAction(ctx, actor, input.targetId, parsed.data, {
      server: { id: row.id, jobId: row.jobId, serverType: row.serverType },
      username: input.targetName,
    });
    return { ok: true as const, command: result.command };
  } catch (err) {
    if (err instanceof AppError && err.code === 'FORBIDDEN')
      return { ok: false as const, error: 'Dafür fehlt dir die Berechtigung.' };
    if (err instanceof AppError) return { ok: false as const, error: err.message };
    throw err;
  }
}
