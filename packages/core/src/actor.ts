import { can, type ResourceContext, type Subject } from '@enrp/permissions';
import { AppError, type ActorType, errors } from '@enrp/shared';

export interface UserActor {
  kind: 'user';
  discordUserId: string;
  roleIds: string[];
  via: 'dashboard' | 'bot';
  subject: Subject;
  sessionId?: string;
}

export interface ServiceActor {
  kind: 'service';
  name: 'bot' | 'worker';
}

export interface RobloxServerActor {
  kind: 'roblox_server';
  apiKeyId: string;
  jobId?: string;
}

export interface SystemActor {
  kind: 'system';
  name: string;
}

export type Actor = UserActor | ServiceActor | RobloxServerActor | SystemActor;

export const systemActor = (name: string): SystemActor => ({ kind: 'system', name });

/** Kennung für Spalten wie created_by: Discord-ID bei Personen, sonst "typ:name". */
export function actorId(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return actor.discordUserId;
    case 'service':
      return `service:${actor.name}`;
    case 'roblox_server':
      return `roblox-key:${actor.apiKeyId}`;
    case 'system':
      return `system:${actor.name}`;
  }
}

export function actorTypeOf(actor: Actor): ActorType {
  return actor.kind === 'user' ? 'user' : actor.kind;
}

export function requireUser(actor: Actor): UserActor {
  if (actor.kind !== 'user') throw errors.unauthenticated('Diese Aktion erfordert eine angemeldete Person.');
  return actor;
}

/** Systemprozesse (Worker, Automatisierungen) gelten als vertrauenswürdig; Personen brauchen die Berechtigung. */
export function hasPermission(actor: Actor, permission: string, resource?: ResourceContext): boolean {
  if (actor.kind === 'system') return true;
  if (actor.kind !== 'user') return false;
  return can(actor.subject, permission, resource);
}

export function requirePermission(actor: Actor, permission: string, resource?: ResourceContext): void {
  if (actor.kind === 'service' || actor.kind === 'roblox_server') {
    throw new AppError('FORBIDDEN', 'Dienstkonten dürfen diese Aktion nicht ohne handelnde Person ausführen.');
  }
  if (!hasPermission(actor, permission, resource)) {
    throw errors.forbidden(`Dir fehlt die Berechtigung „${permission}“.`, { permission });
  }
}
