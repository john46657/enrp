import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { actions, bolo, game, getSetting, updateSetting, type RobloxServerActor } from '@enrp/core';
import { auditEvents, eq, recordEvents, serverCommands } from '@enrp/database';
import {
  advance,
  closeDb,
  createTestContext,
  expectAppError,
  owner,
  resetDatabase,
  userWithRole,
  type TestContext,
} from './helpers';

const SUSPECT = 3001;
const OFFICER_ROBLOX = 3002;
const DISPATCHER = '510000000000000001';
const MODERATOR = '510000000000000002';
const READER = '510000000000000003';
const CHANNEL = '610000000000000001';

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function serverActor(ctx: TestContext) {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: 'BOLO-Test' }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-bolo-${String(++nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  const actor: RobloxServerActor = { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
  return { admin, actor };
}

const heartbeat = (ctx: TestContext, actor: RobloxServerActor, opts: { suspect?: boolean; plate?: string } = {}) =>
  game.processHeartbeat(ctx, actor, {
    jobId: 'job-bolo',
    placeId: '123',
    teams: ['Polizei', 'Zivilisten'],
    players: [
      { userId: OFFICER_ROBLOX, username: 'Streife', team: 'Polizei' },
      ...(opts.suspect ? [{ userId: SUSPECT, username: 'Verdacht', team: 'Zivilisten' }] : []),
    ],
    vehicles: opts.plate ? [{ model: 'Golf', ownerId: SUSPECT, plate: opts.plate, color: 'Rot' }] : [],
  });

describe('Fahndungen (BOLO)', () => {
  it('Treffer über Heartbeat mit Abklingzeit, Alarm nach Discord, Aufheben beendet Treffer', async () => {
    const ctx = createTestContext();
    const { admin, actor } = await serverActor(ctx);
    await updateSetting(
      ctx,
      admin,
      'dispatch',
      { ...(await getSetting(ctx.db, 'dispatch')), channelId: CHANNEL },
      'Test',
    );
    await heartbeat(ctx, actor);
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');

    const b = await bolo.createBolo(ctx, dispatcher, {
      kind: 'vehicle',
      plate: 'en-x 999',
      reason: 'Flucht nach Unfall',
    });
    expect(b).toMatchObject({ plate: 'ENX999', status: 'active', hitCount: 0 });
    expect(ctx.queue.jobs.filter((j) => j.name === 'bolo.post')).toHaveLength(1);
    await expectAppError(
      bolo.createBolo(ctx, dispatcher, { kind: 'vehicle', plate: 'ENX-999', reason: 'Doppelt' }),
      'BAD_REQUEST',
    );

    // Fahrzeug taucht auf (anders geschrieben) → genau ein Treffer
    await heartbeat(ctx, actor, { suspect: true, plate: 'EN-X999' });
    advance(ctx, 30_000);
    await heartbeat(ctx, actor, { suspect: true, plate: 'EN-X999' });
    let current = await bolo.getBolo(ctx.db, String(b.number));
    expect(current.hitCount).toBe(1);
    expect(current.lastHit).toMatchObject({ model: 'Golf', ownerName: 'Verdacht' });
    expect(ctx.queue.jobs.filter((j) => j.name === 'bolo.hit')).toHaveLength(1);

    // Nach 10 Minuten erneut gesichtet → zweiter Alarm
    advance(ctx, 600_000);
    await heartbeat(ctx, actor, { suspect: true, plate: 'EN-X999' });
    current = await bolo.getBolo(ctx.db, b.id);
    expect(current.hitCount).toBe(2);

    const detail = await bolo.getBoloDetail(ctx, dispatcher, b.id);
    expect(detail.events.map((e) => e.type)).toEqual(['created', 'hit', 'hit']);

    await bolo.clearBolo(ctx, dispatcher, String(b.number), 'Sichergestellt');
    await expectAppError(bolo.clearBolo(ctx, dispatcher, b.id), 'BAD_REQUEST');
    advance(ctx, 700_000);
    await heartbeat(ctx, actor, { suspect: true, plate: 'EN-X999' });
    expect((await bolo.getBolo(ctx.db, b.id)).hitCount).toBe(2);
    const list = await bolo.listBolos(ctx.db, dispatcher, { status: ['active'], page: 1, pageSize: 10 });
    expect(list.items).toHaveLength(0);
  });

  it('Personenfahndung trifft sofort, wenn der Spieler schon online ist; Rechte', async () => {
    const ctx = createTestContext();
    const { actor } = await serverActor(ctx);
    await heartbeat(ctx, actor, { suspect: true });
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const reader = await userWithRole(ctx, READER);
    await expectAppError(
      bolo.createBolo(ctx, reader, { kind: 'person', robloxUserId: SUSPECT, reason: 'Gesucht' }),
      'FORBIDDEN',
    );
    const b = await bolo.createBolo(ctx, dispatcher, { kind: 'person', robloxUserId: SUSPECT, reason: 'Haftbefehl' });
    expect(b.hitCount).toBe(1);
    expect(b.lastHit).toMatchObject({ username: 'Verdacht', team: 'Zivilisten' });
    const listed = await bolo.listBolos(ctx.db, dispatcher, { page: 1, pageSize: 10 });
    expect(listed.items[0]).toMatchObject({ username: 'Verdacht' });
  });
});

describe('Aktionen an Spielern im Spiel', () => {
  it('legt einen Befehl auf dem richtigen Server an, prüft Rechte, Pflichtfelder und Team', async () => {
    const ctx = createTestContext();
    const { actor } = await serverActor(ctx);
    const hb = await heartbeat(ctx, actor, { suspect: true });
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const moderator = await userWithRole(ctx, MODERATOR, 'moderation');
    const reader = await userWithRole(ctx, READER);

    const jail = actions.playerActionSchema.parse({ action: 'jail', minutes: 10, reason: 'Banküberfall' });
    const result = await actions.createPlayerAction(ctx, dispatcher, SUSPECT, jail);
    expect(result).toMatchObject({ action: 'jail', player: { userId: SUSPECT, username: 'Verdacht' } });

    // Pflichtfelder je Aktion
    expect(actions.playerActionSchema.safeParse({ action: 'jail', reason: 'ohne Dauer' }).success).toBe(false);
    expect(actions.playerActionSchema.safeParse({ action: 'team', reason: 'ohne Team' }).success).toBe(false);

    // Töten/Kicken nur mit player_actions:delete (Leitstelle hat das nicht, Moderation schon)
    const kill = actions.playerActionSchema.parse({ action: 'kill', reason: 'Bug-Abuse' });
    await expectAppError(actions.createPlayerAction(ctx, dispatcher, SUSPECT, kill), 'FORBIDDEN');
    await expectAppError(actions.createPlayerAction(ctx, reader, SUSPECT, jail), 'FORBIDDEN');
    await actions.createPlayerAction(ctx, moderator, SUSPECT, kill);

    // Unbekanntes Team und Spieler offline
    await expectAppError(
      actions.createPlayerAction(ctx, moderator, SUSPECT, { action: 'team', team: 'Feuerwehr', reason: 'Test' }),
      'BAD_REQUEST',
    );
    await expectAppError(actions.createPlayerAction(ctx, moderator, 9999, jail), 'BAD_REQUEST');

    // Server holt die Befehle mit Aktion und Werten ab
    const polled = await game.pollServerCommands(ctx, actor, 'job-bolo');
    expect(polled.commands).toEqual([
      expect.objectContaining({
        type: 'player_action',
        action: 'jail',
        robloxUserId: SUSPECT,
        payload: { minutes: 10 },
      }),
      expect.objectContaining({ type: 'player_action', action: 'kill', payload: {} }),
    ]);
    const rows = await ctx.db.select().from(serverCommands).where(eq(serverCommands.serverId, hb.serverId));
    expect(rows).toHaveLength(2);
    const audits = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'player_action.jail'));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.reason).toBe('Banküberfall');
    // Fahndungsereignisse sind getrennt von Aktionen
    expect(await ctx.db.select().from(recordEvents).where(eq(recordEvents.recordType, 'bolo'))).toHaveLength(0);
  });
});
