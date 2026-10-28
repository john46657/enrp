import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureBootstrapOwner } from '../src/auth/bootstrap.js';
import { createSession } from '../src/auth/sessions.js';
import type { DatabaseHandle } from '../src/db/database.js';
import { auditLog, sessions, users } from '../src/db/schema.js';
import { runMaintenance } from '../src/maintenance.js';
import { insertUser } from './support/auth.js';
import { createTestDatabase, resetDatabase } from './support/database.js';

const OWNER_ID = '333333333333333333';
let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});
beforeEach(async () => {
  await resetDatabase(handle);
});

const owners = () => handle.db.select().from(users).where(eq(users.roleKey, 'owner'));

describe('Ersteinrichtung des Owners (OWNER_DISCORD_USER_ID)', () => {
  it('legt den ersten Owner an und protokolliert das', async () => {
    expect(await ensureBootstrapOwner(handle.db, OWNER_ID)).toBe('created');
    expect(await owners()).toMatchObject([{ discordUserId: OWNER_ID, status: 'active' }]);
    expect(await handle.db.select().from(auditLog)).toMatchObject([
      { action: 'owner.bootstrap', actorType: 'system', details: { result: 'created' } },
    ]);
  });

  it('ist idempotent und erzeugt keinen zweiten Owner, auch nicht mit einer anderen ID', async () => {
    await ensureBootstrapOwner(handle.db, OWNER_ID);
    expect(await ensureBootstrapOwner(handle.db, OWNER_ID)).toBe('owner_exists');
    expect(await ensureBootstrapOwner(handle.db, '444444444444444444')).toBe('owner_exists');
    expect(await owners()).toHaveLength(1);
  });

  it('befördert eine bereits freigeschaltete Person, solange es noch keinen Owner gibt', async () => {
    await insertUser(handle.db, { discordUserId: OWNER_ID, roleKey: 'viewer', status: 'disabled' });
    expect(await ensureBootstrapOwner(handle.db, OWNER_ID)).toBe('promoted');
    expect(await owners()).toMatchObject([{ discordUserId: OWNER_ID, status: 'active' }]);
  });
});

describe('Aufräumen nach Aufbewahrungsregeln', () => {
  const settings = { session: { idleMinutes: 240, maxHours: 24 }, auditRetentionDays: 365 };

  it('löscht abgelaufene und untätige Sitzungen, behält aktive', async () => {
    const userId = await insertUser(handle.db, { discordUserId: OWNER_ID });
    const now = new Date('2026-10-28T12:00:00Z');
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    await createSession(handle.db, userId, hoursAgo(1), settings.session); // aktiv
    await createSession(handle.db, userId, hoursAgo(5), settings.session); // 5 h untätig
    await createSession(handle.db, userId, hoursAgo(25), settings.session); // abgelaufen

    expect(await runMaintenance(handle.db, now, settings)).toEqual({ sessions: 2, auditEntries: 0 });
    const left = await handle.db.select().from(sessions);
    expect(left.map((s) => s.createdAt.toISOString())).toEqual([hoursAgo(1).toISOString()]);
    // Ein zweiter Lauf hat nichts mehr zu tun.
    expect(await runMaintenance(handle.db, now, settings)).toEqual({ sessions: 0, auditEntries: 0 });
  });

  it('löscht Audit-Einträge erst nach Ablauf der Aufbewahrungsfrist', async () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    for (const occurredAt of [daysAgo(1), daysAgo(364), daysAgo(366)]) {
      await handle.db.insert(auditLog).values({
        occurredAt,
        actorType: 'system',
        actorLabel: 'Test',
        action: 'test.event',
        outcome: 'success',
      });
    }
    expect(await runMaintenance(handle.db, now, settings)).toEqual({ sessions: 0, auditEntries: 1 });
    expect(await handle.db.select().from(auditLog)).toHaveLength(2);
  });
});
