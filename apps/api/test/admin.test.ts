import {
  apiErrorSchema,
  auditLogResponseSchema,
  rolesResponseSchema,
  userResponseSchema,
  usersResponseSchema,
} from '@emden/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createSession } from '../src/auth/sessions.js';
import type { DatabaseHandle } from '../src/db/database.js';
import { auditLog, sessions, users } from '../src/db/schema.js';
import { DASHBOARD, insertUser } from './support/auth.js';
import { createTestDatabase, resetDatabase } from './support/database.js';
import { testConfig } from './helpers.js';

type Who = 'owner' | 'administrator' | 'moderator' | 'support' | 'viewer';
const DISCORD: Record<Who, string> = {
  owner: '100000000000000001',
  administrator: '100000000000000002',
  moderator: '100000000000000003',
  support: '100000000000000004',
  viewer: '100000000000000005',
};

let handle: DatabaseHandle;
let app: FastifyInstance;
const ids = {} as Record<Who, string>;
const tokens = {} as Record<Who, string>;

beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});
beforeEach(async () => {
  await resetDatabase(handle);
  for (const who of Object.keys(DISCORD) as Who[]) {
    ids[who] = await insertUser(handle.db, {
      discordUserId: DISCORD[who],
      displayName: `Test ${who}`,
      roleKey: who,
    });
    tokens[who] = (
      await createSession(handle.db, ids[who], new Date(), { idleMinutes: 240, maxHours: 24 })
    ).token;
  }
  app = await buildApp(testConfig(), { db: handle, discord: null });
});
afterEach(async () => {
  await app.close();
});

/** Anfrage als bestimmte Person – wie der Browser über das Dashboard (gleicher Ursprung). */
function as(who: Who | null, options: InjectOptions) {
  return app.inject({
    ...options,
    cookies: who ? { en_session: tokens[who] } : {},
    headers: { origin: DASHBOARD, 'sec-fetch-site': 'same-origin', ...options.headers },
  });
}

function errorCode(res: { json: () => unknown }) {
  return apiErrorSchema.parse(res.json()).error.code;
}

const deniedAudits = async () =>
  (await handle.db.select().from(auditLog)).filter((row) => row.outcome === 'denied');

describe('Benutzerliste', () => {
  it('verlangt Anmeldung und die Berechtigung users.read', async () => {
    expect((await as(null, { url: '/users' })).statusCode).toBe(401);
    expect(errorCode(await as('viewer', { url: '/users' }))).toBe('FORBIDDEN');
    const res = await as('support', { url: '/users' });
    expect(res.statusCode).toBe(200);
    const { users: list } = usersResponseSchema.parse(res.json());
    // Sortiert nach Rang, höchste Rolle zuerst.
    expect(list.map((u) => u.role.key)).toEqual(['owner', 'administrator', 'moderator', 'support', 'viewer']);
  });

  it('gibt nur die vorgesehenen Felder aus – nichts Internes', async () => {
    const res = await as('administrator', { url: '/users' });
    const first = res.json().users[0];
    expect(Object.keys(first).sort()).toEqual(
      ['createdAt', 'discordUserId', 'displayName', 'id', 'lastLoginAt', 'role', 'status'].sort(),
    );
    expect(res.body).not.toMatch(/token|created_by|createdBy/);
  });
});

describe('Benutzer freischalten (POST /users)', () => {
  const body = (roleKey: string, discordUserId = '200000000000000001') => ({
    discordUserId,
    displayName: 'Neue Person',
    roleKey,
  });

  it('erlaubt Administratoren, Personen mit niedrigerer Rolle freizuschalten', async () => {
    const res = await as('administrator', { method: 'POST', url: '/users', payload: body('moderator') });
    expect(res.statusCode).toBe(201);
    const { user } = userResponseSchema.parse(res.json());
    expect(user).toMatchObject({
      discordUserId: '200000000000000001',
      role: { key: 'moderator' },
      status: 'active',
    });
    const [audit] = await handle.db.select().from(auditLog).where(eq(auditLog.action, 'user.create'));
    expect(audit).toMatchObject({ actorUserId: ids.administrator, outcome: 'success', targetId: user.id });
  });

  it.each([
    ['administrator', 'administrator', 'RANK_TOO_HIGH'],
    ['administrator', 'owner', 'OWNER_ONLY_BOOTSTRAP'],
    ['owner', 'owner', 'OWNER_ONLY_BOOTSTRAP'],
  ] as const)(
    'verbietet %s, die Rolle %s zu vergeben (%s) und protokolliert den Versuch',
    async (who, role, code) => {
      const res = await as(who, { method: 'POST', url: '/users', payload: body(role) });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe(code);
      expect(await deniedAudits()).toMatchObject([{ action: 'user.create', details: { reason: code } }]);
      expect(
        await handle.db.select().from(users).where(eq(users.discordUserId, '200000000000000001')),
      ).toEqual([]);
    },
  );

  it('verbietet es Rollen ohne users.manage', async () => {
    expect(errorCode(await as('moderator', { method: 'POST', url: '/users', payload: body('viewer') }))).toBe(
      'FORBIDDEN',
    );
  });

  it('meldet ungültige Eingaben feldgenau und ohne den eingegebenen Wert', async () => {
    const res = await as('administrator', {
      method: 'POST',
      url: '/users',
      payload: { discordUserId: 'nicht-geheim-aber-falsch', displayName: '', roleKey: 'viewer' },
    });
    expect(res.statusCode).toBe(400);
    const { error } = apiErrorSchema.parse(res.json());
    expect(error.fields?.map((f) => f.path).sort()).toEqual(['discordUserId', 'displayName']);
    expect(error.fields?.[0]?.message).toMatch(/[äöüÄÖÜß]|Ziffern|Namen/);
    expect(res.body).not.toContain('nicht-geheim-aber-falsch');
  });

  it('lehnt unbekannte Rollen und doppelte Discord-IDs ab', async () => {
    const unknownRole = await as('owner', { method: 'POST', url: '/users', payload: body('kaiser') });
    expect(unknownRole.statusCode).toBe(400);
    const duplicate = await as('owner', {
      method: 'POST',
      url: '/users',
      payload: body('viewer', DISCORD.viewer),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(errorCode(duplicate)).toBe('CONFLICT');
  });
});

describe('Benutzer ändern (PATCH /users/:id)', () => {
  const patch = (who: Who, target: Who, payload: Record<string, unknown>) =>
    as(who, { method: 'PATCH', url: `/users/${ids[target]}`, payload });

  it('ändert Rollen unterhalb der eigenen und protokolliert vorher und nachher', async () => {
    const res = await patch('administrator', 'viewer', { roleKey: 'support' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role.key).toBe('support');
    const [audit] = await handle.db.select().from(auditLog).where(eq(auditLog.action, 'user.update'));
    expect(audit?.details).toEqual({ roleFrom: 'viewer', roleTo: 'support' });
  });

  it('meldet gesperrte Benutzer sofort ab', async () => {
    const before = await as('moderator', { url: '/auth/me' });
    expect(before.statusCode).toBe(200);
    expect((await patch('administrator', 'moderator', { status: 'disabled' })).statusCode).toBe(200);
    expect(await handle.db.select().from(sessions).where(eq(sessions.userId, ids.moderator))).toEqual([]);
    expect((await as('moderator', { url: '/auth/me' })).statusCode).toBe(401);
  });

  it.each([
    ['administrator', 'administrator', {}, 'SELF_CHANGE'],
    ['administrator', 'owner', { status: 'disabled' }, 'RANK_TOO_HIGH'],
    ['moderator', 'viewer', { status: 'disabled' }, 'FORBIDDEN'],
    ['administrator', 'viewer', { roleKey: 'administrator' }, 'RANK_TOO_HIGH'],
    ['owner', 'administrator', { roleKey: 'owner' }, 'OWNER_ONLY_BOOTSTRAP'],
    ['owner', 'owner', { status: 'disabled' }, 'SELF_CHANGE'],
  ] as const)('verbietet: %s ändert %s %o (%s)', async (who, target, extra, code) => {
    const payload = who === target ? { displayName: 'Ich', ...extra } : extra;
    const res = await patch(who, target, payload);
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe(code);
    // Nichts wurde verändert.
    const [row] = await handle.db.select().from(users).where(eq(users.id, ids[target]));
    expect(row).toMatchObject({ roleKey: target, status: 'active' });
  });

  it('protokolliert abgelehnte Änderungsversuche', async () => {
    await patch('administrator', 'owner', { status: 'disabled' });
    expect(await deniedAudits()).toMatchObject([
      {
        action: 'user.update',
        actorUserId: ids.administrator,
        targetId: ids.owner,
        details: { reason: 'RANK_TOO_HIGH' },
      },
    ]);
  });

  it('der Owner kann Administratoren ernennen', async () => {
    const res = await patch('owner', 'moderator', { roleKey: 'administrator' });
    expect(res.json().user.role.key).toBe('administrator');
  });

  it('antwortet mit 400 bei leeren Änderungen und 404 bei unbekannten Benutzern', async () => {
    expect((await patch('owner', 'viewer', {})).statusCode).toBe(400);
    const unknown = await as('owner', {
      method: 'PATCH',
      url: '/users/00000000-0000-4000-8000-000000000000',
      payload: { status: 'disabled' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(
      (await as('owner', { method: 'PATCH', url: '/users/keine-uuid', payload: { status: 'x' } })).statusCode,
    ).toBe(400);
  });

  it('ist gegen Anfragen fremder Webseiten geschützt', async () => {
    const res = await as('owner', {
      method: 'PATCH',
      url: `/users/${ids.viewer}`,
      payload: { status: 'disabled' },
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(errorCode(res)).toBe('CSRF_REJECTED');
  });
});

describe('Rollen und Berechtigungen', () => {
  it('zeigt Rollen mit Berechtigungen und was die anfragende Person ändern darf', async () => {
    const res = await as('administrator', { url: '/roles' });
    const body = rolesResponseSchema.parse(res.json());
    expect(body.roles.map((r) => [r.key, r.editable, r.assignable])).toEqual([
      ['owner', false, false],
      ['administrator', false, false],
      ['moderator', true, true],
      ['support', true, true],
      ['viewer', true, true],
    ]);
    expect(body.roles[0]?.permissions).toHaveLength(body.permissions.length);
    expect(errorCode(await as('viewer', { url: '/roles' }))).toBe('FORBIDDEN');
  });

  const put = (who: Who, role: string, permissions: string[]) =>
    as(who, { method: 'PUT', url: `/roles/${role}/permissions`, payload: { permissions } });

  it('ändert Rollenrechte – die Änderung wirkt sofort für angemeldete Personen', async () => {
    const res = await put('administrator', 'moderator', ['users.read', 'roles.read', 'audit.read']);
    expect(res.statusCode).toBe(200);
    expect((await as('moderator', { url: '/auth/me' })).json().user.permissions).toContain('audit.read');
    expect((await as('moderator', { url: '/audit-log' })).statusCode).toBe(200);
    const [audit] = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'role.permissions_update'));
    expect(audit?.details).toEqual({ added: 'audit.read', removed: '' });
  });

  it.each([
    ['administrator', 'administrator', ['users.read'], 'RANK_TOO_HIGH'],
    ['owner', 'owner', [], 'OWNER_ROLE_FIXED'],
    ['moderator', 'viewer', ['users.read'], 'FORBIDDEN'],
  ] as const)('verbietet: %s bearbeitet %s (%s)', async (who, role, permissions, code) => {
    const res = await put(who, role, [...permissions]);
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe(code);
  });

  it('verhindert Rechteausweitung: Man vergibt nur Rechte, die man selbst hat', async () => {
    // Der Owner gibt Moderatoren das Recht, Rollen zu bearbeiten …
    expect((await put('owner', 'moderator', ['users.read', 'roles.read', 'roles.manage'])).statusCode).toBe(
      200,
    );
    // … ein Moderator darf Support aber trotzdem kein users.manage geben, weil er es selbst nicht hat.
    const res = await put('moderator', 'support', ['users.read', 'users.manage']);
    expect(errorCode(res)).toBe('PERMISSION_NOT_HELD');
    // Eigene Rechte darf er weitergeben.
    expect((await put('moderator', 'support', ['users.read', 'roles.read'])).statusCode).toBe(200);
  });

  it('lehnt unbekannte Berechtigungen ab', async () => {
    const res = await put('owner', 'viewer', ['users.read', 'alles.darf']);
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.fields?.[0]?.message).toContain('alles.darf');
  });
});

describe('Audit-Log lesen', () => {
  it('liefert die neuesten Einträge zuerst und blättert seitenweise', async () => {
    for (let i = 0; i < 5; i++) {
      await as('administrator', {
        method: 'PATCH',
        url: `/users/${ids.viewer}`,
        payload: { displayName: `Name ${i}` },
      });
    }
    const first = auditLogResponseSchema.parse(
      (await as('administrator', { url: '/audit-log?limit=2' })).json(),
    );
    expect(first.entries.map((e) => e.details.displayName)).toEqual(['Name 4', 'Name 3']);
    expect(first.entries[0]).toMatchObject({
      actionLabel: 'Benutzer geändert',
      actorLabel: 'Test administrator',
    });
    const second = auditLogResponseSchema.parse(
      (await as('administrator', { url: `/audit-log?limit=2&before=${first.nextBefore}` })).json(),
    );
    expect(second.entries.map((e) => e.details.displayName)).toEqual(['Name 2', 'Name 1']);
    const last = auditLogResponseSchema.parse(
      (await as('administrator', { url: `/audit-log?limit=2&before=${second.nextBefore}` })).json(),
    );
    expect(last.entries).toHaveLength(1);
    expect(last.nextBefore).toBeNull();
  });

  it('verlangt audit.read und prüft die Parameter', async () => {
    expect(errorCode(await as('moderator', { url: '/audit-log' }))).toBe('FORBIDDEN');
    expect((await as('owner', { url: '/audit-log?limit=1000' })).statusCode).toBe(400);
  });
});
