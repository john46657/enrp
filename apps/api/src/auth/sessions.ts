import { OWNER_ROLE, PERMISSION_KEYS, isPermission, type Permission } from '@emden/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { rolePermissions, roles, sessions, users } from '../db/schema.js';
import { randomToken, sha256Hex } from './tokens.js';

export interface SessionSettings {
  /** Nach so vielen Minuten ohne Aktivität endet die Sitzung. */
  idleMinutes: number;
  /** Spätestens nach so vielen Stunden endet die Sitzung, auch bei Aktivität. */
  maxHours: number;
}

export interface AuthenticatedUser {
  id: string;
  discordUserId: string;
  displayName: string;
  role: { key: string; name: string; rank: number };
  permissions: Permission[];
}

export interface AuthContext {
  sessionId: string;
  user: AuthenticatedUser;
}

// "Zuletzt gesehen" wird höchstens alle 5 Minuten geschrieben, um die Datenbank zu schonen.
const TOUCH_INTERVAL_MS = 5 * 60_000;
// 32 Byte als base64url = genau 43 Zeichen. Alles andere wird ohne Datenbankabfrage verworfen.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function createSession(
  db: Pick<Database, 'insert'>,
  userId: string,
  now: Date,
  settings: SessionSettings,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + settings.maxHours * 3_600_000);
  // Gespeichert wird nur der Hash: Ein Datenbankleck verrät keine gültigen Sitzungen.
  await db
    .insert(sessions)
    .values({ tokenHash: sha256Hex(token), userId, createdAt: now, lastSeenAt: now, expiresAt });
  return { token, expiresAt };
}

export async function loadPermissions(db: Database, roleKey: string): Promise<Permission[]> {
  if (roleKey === OWNER_ROLE) return [...PERMISSION_KEYS].sort();
  const rows = await db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleKey, roleKey));
  return rows
    .map((row) => row.key)
    .filter(isPermission)
    .sort();
}

/**
 * Prüft ein Sitzungstoken. Abgelaufene, untätige oder zu gesperrten Benutzern gehörende Sitzungen
 * werden dabei gelöscht. Rolle und Berechtigungen werden bei jeder Anfrage frisch gelesen, damit
 * Änderungen sofort wirken.
 */
export async function resolveSession(
  db: Database,
  token: string,
  now: Date,
  settings: SessionSettings,
): Promise<AuthContext | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      discordUserId: users.discordUserId,
      displayName: users.displayName,
      status: users.status,
      roleKey: roles.key,
      roleName: roles.name,
      roleRank: roles.rank,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.key, users.roleKey))
    .where(eq(sessions.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) return null;

  const idleLimit = now.getTime() - settings.idleMinutes * 60_000;
  if (
    row.expiresAt.getTime() <= now.getTime() ||
    row.lastSeenAt.getTime() <= idleLimit ||
    row.status !== 'active'
  ) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      discordUserId: row.discordUserId,
      displayName: row.displayName,
      role: { key: row.roleKey, name: row.roleName, rank: row.roleRank },
      permissions: await loadPermissions(db, row.roleKey),
    },
  };
}

export async function deleteSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Beendet alle Sitzungen eines Benutzers, z. B. wenn er gesperrt wird. */
export async function deleteUserSessions(db: Pick<Database, 'delete'>, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
