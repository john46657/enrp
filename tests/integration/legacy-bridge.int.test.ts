import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { legacy } from '@enrp/core';
import { auditEvents, eq, legacyRequests } from '@enrp/database';
import { closeDb, createTestContext, expectAppError, owner, resetDatabase, userWithRole } from './helpers';
import { botHeaders, createTestApp } from './api-helpers';

const COMMUNITY = '560000000000000001';
const NOBODY = '560000000000000002';
const FAST = { claimMs: 400, runMs: 400 };

beforeEach(resetDatabase);
afterAll(closeDb);

type App = Awaited<ReturnType<typeof createTestApp>>['app'];

/** Spielt den Bot: holt eine Anfrage ab und beantwortet sie. */
async function answerAsBot(app: App, respond: (request: { kind: string; name: string; payload: unknown }) => object) {
  const res = await app.inject({ method: 'GET', url: '/api/v1/bot/legacy/requests?wait=5', headers: botHeaders() });
  expect(res.statusCode).toBe(200);
  const { items } = res.json() as {
    items: Array<{ id: string; kind: string; name: string; payload: unknown; actorDiscordId: string }>;
  };
  for (const item of items) {
    const done = await app.inject({
      method: 'POST',
      url: `/api/v1/bot/legacy/requests/${item.id}/result`,
      headers: botHeaders(),
      payload: respond(item),
    });
    expect(done.statusCode).toBe(200);
  }
  return items;
}

describe('Altmodule im Dashboard (Brücke API ↔ Bot)', () => {
  it('Daten lesen: Anfrage wartet auf den Bot und liefert dessen Antwort', async () => {
    const { app, ctx } = await createTestApp();
    await userWithRole(ctx, COMMUNITY, 'community_management');
    const [res, claimed] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/legacy/live/applications', headers: botHeaders(COMMUNITY) }),
      answerAsBot(app, () => ({ ok: true, result: { records: [{ number: 'APP-0001' }], total: 1 } })),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { records: [{ number: 'APP-0001' }], total: 1 } });
    expect(claimed).toMatchObject([{ kind: 'live', name: 'applications', actorDiscordId: COMMUNITY }]);
    await app.close();
  });

  it('Aktion: Recht nötig, Audit-Eintrag, Fehlermeldung des Bots kommt im Dashboard an', async () => {
    const { app, ctx } = await createTestApp();
    await userWithRole(ctx, COMMUNITY, 'community_management');
    await userWithRole(ctx, NOBODY);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/legacy/actions/app-decide',
      headers: botHeaders(NOBODY),
      payload: { number: 'APP-0001', action: 'accept' },
    });
    expect(denied.statusCode).toBe(403);
    expect(await ctx.db.select().from(legacyRequests)).toHaveLength(0);

    const [ok, claimed] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/legacy/actions/app-decide',
        headers: botHeaders(COMMUNITY),
        payload: { number: 'APP-0001', action: 'accept', reason: 'Passt' },
      }),
      answerAsBot(app, () => ({ ok: true })),
    ]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ result: null });
    expect(claimed[0]).toMatchObject({ kind: 'action', name: 'app-decide', payload: { number: 'APP-0001' } });
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'legacy.app-decide'));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(COMMUNITY);

    const [failed] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/legacy/actions/app-decide',
        headers: botHeaders(COMMUNITY),
        payload: { number: 'APP-0001', action: 'accept' },
      }),
      answerAsBot(app, () => ({ ok: false, error: 'Diese Bewerbung wurde bereits entschieden: Angenommen.' })),
    ]);
    expect(failed.statusCode).toBe(400);
    expect(failed.json().error.message).toContain('bereits entschieden');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/legacy/actions/gibt-es-nicht',
      headers: botHeaders(COMMUNITY),
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it('Einstellungen: Recht je Bereich, unbekannte Bereiche und Zurücksetzen', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    const community = await userWithRole(ctx, COMMUNITY, 'community_management');

    // Community-Management darf Bewerbungen einrichten, aber keine allgemeinen Einstellungen ändern.
    await expectAppError(
      legacy.saveSettings(ctx, community, { changes: [{ path: 'tickets.maxOpenPerUser', value: 3 }] }, FAST),
      'FORBIDDEN',
    );
    await expectAppError(
      legacy.saveSettings(ctx, admin, { changes: [{ path: 'moderation.warnLimit', value: 3 }] }, FAST),
      'BAD_REQUEST',
    );
    await expectAppError(legacy.resetSettings(ctx, community, FAST), 'FORBIDDEN');
    expect(await ctx.db.select().from(legacyRequests)).toHaveLength(0);

    const saving = legacy.saveSettings(
      ctx,
      community,
      { changes: [{ path: 'applications.types.sek.enabled', value: false }] },
      FAST,
    );
    const [request] = await legacy.claimRequests(ctx, 2000);
    expect(request).toMatchObject({
      kind: 'settings',
      payload: { changes: [{ path: 'applications.types.sek.enabled', value: false }] },
    });
    await legacy.completeRequest(ctx, request!.id, { ok: true, result: { changed: 1 } });
    expect(await saving).toEqual({ changed: 1 });
  });

  it('Bot nicht erreichbar: verständlicher Fehler, die Anfrage wird später nicht mehr ausgeführt', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    await expectAppError(
      legacy.runAction(ctx, admin, 'ticket-panels-refresh', {}, { claimMs: 300, runMs: 300 }),
      'SERVICE_UNAVAILABLE',
    );
    expect(await legacy.claimRequests(ctx, 0)).toEqual([]);
    const [row] = await ctx.db.select().from(legacyRequests);
    expect(row!.status).toBe('failed');
    // Ein verspätetes Ergebnis wird nicht mehr angenommen.
    await expectAppError(legacy.completeRequest(ctx, row!.id, { ok: true }), 'NOT_FOUND');
  });

  it('Abholen und Ergebnis melden darf nur der Bot', async () => {
    const { app, ctx } = await createTestApp();
    const admin = await owner(ctx);
    const asUser = botHeaders((admin as { discordUserId: string }).discordUserId);
    const claim = await app.inject({ method: 'GET', url: '/api/v1/bot/legacy/requests?wait=0', headers: asUser });
    expect(claim.statusCode).toBe(403);
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/bot/legacy/requests/00000000-0000-4000-8000-000000000000/result',
      headers: asUser,
      payload: { ok: true },
    });
    expect(result.statusCode).toBe(403);
    await app.close();
  });

  it('Rechteprüfung für Buttons der Altmodule: einzelnes Recht statt Befehl', async () => {
    const { app, ctx } = await createTestApp();
    await userWithRole(ctx, COMMUNITY, 'community_management');
    const check = (actor: string, permission: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/permissions/check',
        headers: botHeaders(actor),
        payload: { permission },
      });
    expect((await check(COMMUNITY, 'applications:edit')).json()).toMatchObject({ allowed: true, source: 'permission' });
    expect((await check(COMMUNITY, 'tickets:edit')).json()).toMatchObject({ allowed: false });
    expect((await check(COMMUNITY, 'gibt:esnicht')).statusCode).toBe(400);
    await app.close();
  });
});

describe('Altmodule im Dashboard: Bot-Neustart', () => {
  it('eine getrennte Verbindung holt keine Anfragen mehr ab', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    const gone = new AbortController();
    const abandoned = legacy.claimRequests(ctx, 5000, gone.signal);
    gone.abort();
    const pending = legacy.readLive(ctx, admin, 'levels', { claimMs: 3000, runMs: 1000 });
    expect(await abandoned).toEqual([]);
    const [request] = await legacy.claimRequests(ctx, 2000);
    expect(request).toMatchObject({ kind: 'live', name: 'levels' });
    await legacy.completeRequest(ctx, request!.id, { ok: true, result: { total: 0 } });
    expect(await pending).toEqual({ total: 0 });
  });
});
