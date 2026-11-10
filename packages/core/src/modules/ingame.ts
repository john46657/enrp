import { z } from 'zod';
import { and, desc, eq, inArray, robloxUsers, serverCommands, type DbExecutor } from '@enrp/database';
import { PLAYER_ACTIONS, errors, type PlayerAction } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting } from '../settings';
import { SERVER_COMMAND_TTL_SECONDS } from './game';
import { type LiveServer, findOnlinePlayer, liveTeams } from './live';

/**
 * Ingame-Aktionen an einem einzelnen Spieler: Heilen, Töten, Respawn, Gefängnis, Fahndungsstufe, Team.
 * Sie laufen über dieselbe Befehlswarteschlange wie Nachrichten an Server: Der Spielserver, auf dem der Spieler gerade
 * ist, holt den Befehl ab, führt ihn aus und bestätigt ihn. Kick und Bann im Spiel laufen über die Moderation
 * (/mod … platform roblox), damit sie als Sanktion mit Einspruchsmöglichkeit gespeichert werden.
 */

export const ACTION_LABEL: Record<PlayerAction, string> = {
  heal: 'Heilen',
  kill: 'Töten',
  respawn: 'Respawn',
  jail: 'Gefängnis',
  unjail: 'Aus dem Gefängnis entlassen',
  wanted: 'Fahndungsstufe setzen',
  team: 'Team wechseln',
};

export const playerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('heal') }),
  z.object({ action: z.literal('kill') }),
  z.object({ action: z.literal('respawn') }),
  z.object({ action: z.literal('jail'), minutes: z.number().int().min(1).max(240) }),
  z.object({ action: z.literal('unjail') }),
  z.object({ action: z.literal('wanted'), level: z.number().int().min(0).max(5) }),
  z.object({ action: z.literal('team'), team: z.string().trim().min(1).max(40) }),
]);
export type PlayerActionInput = z.infer<typeof playerActionSchema>;

/** Töten greift am stärksten ins Spiel ein und braucht deshalb ein eigenes Recht. */
export const requiredPermission = (action: PlayerAction) =>
  action === 'kill' ? ('ingame_actions:approve' as const) : ('ingame_actions:edit' as const);

/** Für Anzeige und Spiel: Parameter je Aktion (ohne das Feld „action“). */
function paramsOf(input: QueuedAction): Record<string, unknown> | null {
  const { action: _action, ...rest } = input;
  return Object.keys(rest).length ? rest : null;
}

/** Text, den der Spieler im Spiel sieht (keine Namen des Teams, nur der Grund). */
function playerNotice(input: PlayerActionInput, reason: string) {
  switch (input.action) {
    case 'jail':
      return `Du bist für ${input.minutes} Minute(n) im Gefängnis. Grund: ${reason}`;
    case 'unjail':
      return 'Du wurdest aus dem Gefängnis entlassen.';
    case 'wanted':
      return input.level > 0 ? `Deine Fahndungsstufe ist jetzt ${input.level}.` : 'Deine Fahndung wurde aufgehoben.';
    case 'team':
      return `Du wurdest ins Team „${input.team}“ versetzt. Grund: ${reason}`;
    case 'kill':
    case 'respawn':
    case 'heal':
      return `${ACTION_LABEL[input.action]} durch das Team. Grund: ${reason}`;
  }
}

/** Aktion oder Kick (Kick nur für Privatserver-Teams, siehe privateServers.ts). */
export type QueuedAction = PlayerActionInput | { action: 'kick' };

/**
 * Prüft Grenzen (Gefängnisdauer, Team) und legt den Befehl samt Audit-Eintrag für den Server des Spielers an.
 * Rechte prüft der Aufrufer. `scope` begrenzt, auf welchen Servern der Spieler sein darf (Privatserver-Teams).
 */
export async function queuePlayerAction(
  ctx: CoreContext,
  actor: Actor,
  robloxUserId: number,
  input: QueuedAction,
  reason: string,
  options: {
    scope?: (server: LiveServer) => boolean;
    scopeError?: string;
    audit?: Record<string, unknown>;
  } = {},
) {
  const now = ctx.now();
  if (input.action === 'jail') {
    const { maxJailMinutes } = await getSetting(ctx.db, 'dispatch');
    if (input.minutes > maxJailMinutes)
      throw errors.badRequest(`Höchstens ${maxJailMinutes} Minuten Gefängnis (Einstellung „maxJailMinutes“).`);
  }
  const online = await findOnlinePlayer(ctx.db, now, robloxUserId);
  if (!online) throw errors.badRequest('Der Spieler ist gerade auf keinem Server online.');
  if (options.scope && !options.scope(online.server))
    throw errors.forbidden(options.scopeError ?? 'Der Spieler ist nicht auf einem deiner Server.');
  if (input.action === 'team') {
    const wanted = input.team;
    const teams = await liveTeams(ctx.db, now);
    const match = teams.find((t) => t.toLowerCase() === wanted.toLowerCase());
    if (teams.length && !match) throw errors.badRequest(`Unbekanntes Team „${wanted}“. Vorhanden: ${teams.join(', ')}`);
    if (match) input = { ...input, team: match };
  }
  const params = paramsOf(input);
  const notice =
    input.action === 'kick' ? `Du wurdest vom Privatserver entfernt. Grund: ${reason}` : playerNotice(input, reason);
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(serverCommands)
      .values({
        serverId: online.server.id,
        type: input.action,
        robloxUserId,
        message: notice.slice(0, 300),
        params,
        reason,
        createdBy: actorId(actor),
        createdAt: now,
        expiresAt: new Date(now.getTime() + SERVER_COMMAND_TTL_SECONDS * 1000),
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: `ingame.${input.action}`,
        resourceType: 'roblox_user',
        resourceId: robloxUserId,
        reason,
        after: { commandId: created!.id, serverId: online.server.id, params },
        metadata: options.audit,
      },
      now,
    );
    return created!;
  });
  ctx.realtime.publish('servers', 'server.command', { count: 1, type: input.action });
  return {
    command: row,
    player: { userId: online.player.userId, username: online.player.username, team: online.player.team ?? null },
    server: online.server,
  };
}

/**
 * Legt eine Ingame-Aktion für den Server an, auf dem der Spieler gerade ist. Ist er nirgends online, schlägt die
 * Aktion fehl – sie wird nicht für später gespeichert, weil sich die Lage im Spiel bis dahin geändert hat.
 */
export async function createPlayerAction(
  ctx: CoreContext,
  actor: Actor,
  robloxUserId: number,
  input: PlayerActionInput,
  reason: string,
) {
  requirePermission(actor, requiredPermission(input.action));
  return queuePlayerAction(ctx, actor, robloxUserId, input, reason);
}

/** Verlauf der Ingame-Aktionen an einem Spieler (bzw. aller Spieler) mit Ergebnis. */
export async function listPlayerActions(
  db: DbExecutor,
  actor: Actor,
  filter: { robloxUserId?: number; limit?: number } = {},
) {
  requirePermission(actor, 'ingame_actions:view');
  const rows = await db
    .select({
      id: serverCommands.id,
      type: serverCommands.type,
      robloxUserId: serverCommands.robloxUserId,
      username: robloxUsers.username,
      params: serverCommands.params,
      reason: serverCommands.reason,
      status: serverCommands.status,
      error: serverCommands.error,
      createdBy: serverCommands.createdBy,
      createdAt: serverCommands.createdAt,
      completedAt: serverCommands.completedAt,
    })
    .from(serverCommands)
    .leftJoin(robloxUsers, eq(robloxUsers.id, serverCommands.robloxUserId))
    .where(
      and(
        inArray(serverCommands.type, [...PLAYER_ACTIONS, 'kick']),
        filter.robloxUserId ? eq(serverCommands.robloxUserId, filter.robloxUserId) : undefined,
      ),
    )
    .orderBy(desc(serverCommands.createdAt))
    .limit(Math.min(filter.limit ?? 25, 100));
  return { items: rows };
}
