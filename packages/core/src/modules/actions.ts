import { z } from 'zod';
import { serverCommands } from '@enrp/database';
import { PLAYER_ACTIONS, errors, type PlayerAction } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { SERVER_COMMAND_TTL_SECONDS } from './game';
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
) {
  requirePermission(actor, HEAVY.has(input.action) ? 'player_actions:delete' : 'player_actions:edit');
  const now = ctx.now();
  const online = await findOnlinePlayer(ctx.db, now, robloxUserId);
  if (!online) throw errors.badRequest('Der Spieler ist gerade auf keinem Server.');
  if (input.action === 'team') {
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
    action: input.action,
    status: command.status,
    player: { userId: robloxUserId, username: online.player.username },
    server: { id: online.server.id, jobId: online.server.jobId },
  };
}
