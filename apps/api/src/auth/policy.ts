import { OWNER_ROLE } from '@emden/shared';
import { HttpError } from '../errors.js';
import type { AuthenticatedUser } from './sessions.js';

/**
 * Regeln für die Verwaltung von Benutzern und Rollen. Grundsatz: Man verwaltet nur, was unter einem
 * steht – nie sich selbst, nie Gleichrangige, nie den Owner. Die Owner-Rolle gibt es nur über die
 * gesicherte Ersteinrichtung.
 */

export function forbidden(code: string, message: string): HttpError {
  return new HttpError(403, code, message);
}

export function assertCanAssignRole(actor: AuthenticatedUser, role: { key: string; rank: number }): void {
  if (role.key === OWNER_ROLE) {
    throw forbidden(
      'OWNER_ONLY_BOOTSTRAP',
      'Die Owner-Rolle wird nur über die gesicherte Ersteinrichtung vergeben.',
    );
  }
  if (role.rank >= actor.role.rank) {
    throw forbidden('RANK_TOO_HIGH', 'Du kannst nur Rollen vergeben, die unter deiner eigenen Rolle stehen.');
  }
}

export function assertCanManageUser(
  actor: AuthenticatedUser,
  target: { id: string; roleRank: number },
): void {
  if (target.id === actor.id) {
    throw forbidden('SELF_CHANGE', 'Die eigene Rolle und den eigenen Status kann man nicht selbst ändern.');
  }
  if (target.roleRank >= actor.role.rank) {
    throw forbidden(
      'RANK_TOO_HIGH',
      'Du kannst nur Benutzer verwalten, deren Rolle unter deiner eigenen steht.',
    );
  }
}

export function canEditRole(actor: AuthenticatedUser, role: { key: string; rank: number }): boolean {
  return actor.permissions.includes('roles.manage') && role.key !== OWNER_ROLE && role.rank < actor.role.rank;
}

export function canAssignRole(actor: AuthenticatedUser, role: { key: string; rank: number }): boolean {
  return actor.permissions.includes('users.manage') && role.key !== OWNER_ROLE && role.rank < actor.role.rank;
}

/** Nur Berechtigungen vergeben oder entziehen, die man selbst hat – sonst wäre Rechteausweitung möglich. */
export function assertCanEditRole(
  actor: AuthenticatedUser,
  role: { key: string; rank: number },
  changed: string[],
): void {
  if (role.key === OWNER_ROLE) {
    throw forbidden(
      'OWNER_ROLE_FIXED',
      'Der Owner hat immer alle Berechtigungen; das lässt sich nicht ändern.',
    );
  }
  if (role.rank >= actor.role.rank) {
    throw forbidden(
      'RANK_TOO_HIGH',
      'Du kannst nur Rollen bearbeiten, die unter deiner eigenen Rolle stehen.',
    );
  }
  const held: readonly string[] = actor.permissions;
  const notHeld = changed.filter((permission) => !held.includes(permission));
  if (notHeld.length > 0) {
    throw forbidden(
      'PERMISSION_NOT_HELD',
      `Du kannst nur Berechtigungen vergeben oder entziehen, die du selbst hast (betroffen: ${notHeld.join(', ')}).`,
    );
  }
}
