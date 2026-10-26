import { z } from 'zod';
import { robloxUserId } from './ids.js';

/** Schemas des Game-API-Vertrags (Roblox-Server <-> Backend). */

export const jobIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9{}-]+$/);
const eventId = z.string().min(8).max(64).regex(/^[A-Za-z0-9{}-]+$/);

export const heartbeatSchema = z.object({
  jobId: jobIdSchema,
  placeId: z.number().int().positive(),
  placeVersion: z.number().int().nonnegative().optional(),
  maxPlayers: z.number().int().nonnegative().max(700).optional(),
  players: z.array(robloxUserId).max(700),
  shuttingDown: z.boolean().optional(),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

const isoTime = z.iso.datetime({ offset: true });

const base = { eventId, occurredAt: isoTime };

export const gameEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('player.join'), robloxUserId }),
  z.object({ ...base, type: z.literal('player.leave'), robloxUserId }),
  z.object({ ...base, type: z.literal('duty.start'), robloxUserId, faction: z.enum(['polizei', 'feuerwehr', 'rettungsdienst']) }),
  z.object({ ...base, type: z.literal('duty.end'), robloxUserId }),
]);
export type GameEvent = z.infer<typeof gameEventSchema>;

export const gameEventsBatchSchema = z.object({
  jobId: jobIdSchema,
  events: z.array(gameEventSchema).min(1).max(50),
});

/** Admin-Aufträge: nur diese Typen und Felder sind erlaubt. Keine freien Lua-Befehle. */
export const commandPayloadSchemas = {
  announce: z.object({ message: z.string().min(1).max(200) }),
  kick: z.object({ robloxUserId, reason: z.string().min(3).max(200) }),
  ban: z.object({ robloxUserId, reason: z.string().min(3).max(200), durationSeconds: z.number().int().positive().max(60 * 60 * 24 * 365).nullable() }),
  unban: z.object({ robloxUserId }),
  restart_announce: z.object({ minutes: z.number().int().min(1).max(60) }),
} as const;
export type CommandType = keyof typeof commandPayloadSchemas;
export const COMMAND_TYPES = Object.keys(commandPayloadSchemas) as CommandType[];

/** Aufträge, die jeder aktive Server ausführt. */
export const BROADCAST_COMMANDS: ReadonlySet<CommandType> = new Set(['announce', 'kick', 'restart_announce']);

export const actionResultSchema = z.object({
  jobId: jobIdSchema,
  success: z.boolean(),
  message: z.string().max(500).optional(),
});
