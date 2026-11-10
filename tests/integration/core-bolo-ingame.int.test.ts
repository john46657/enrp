import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bolo, game, getSetting, ingame, updateSetting, type RobloxServerActor } from '@enrp/core';
import { and, auditEvents, eq, serverCommands } from '@enrp/database';
import { boloHitMessage } from '@enrp/worker/dispatch-messages';
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

const SUSPECT = 4001;
const OFFICER_ROBLOX = 4002;
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

/** Heartbeat mit Verdächtigem (optional) und Polizist samt Fahrzeugen. */
function heartbeat(ctx: TestContext, actor: RobloxServerActor, opts: { suspectOnline?: boolean; plate?: string } = {}) {
  return game.processHeartbeat(ctx, actor, {
    jobId: 'job-bolo',
    placeId: '123',
    teams: ['Polizei', 'Zivilisten', 'Gefängnis'],
    players: [
      ...(opts.suspectOnline === false ? [] : [{ userId: SUSPECT, username: 'Flucht_Fritz', team: 'Zivilisten' }]),
      { userId: OFFICER_ROBLOX, username: 'Streife', team: 'Polizei' },
    ],
    vehicles: [
      { model: 'Streifenwagen', ownerId: OFFICER_ROBLOX, plate: 'EN-P 1234' },
      ...(opts.plate ? [{ model: 'Golf', ownerId: SUSPECT, plate: opts.plate, color: 'Schwarz' }] : []),
    ],
  });
}

describe('Fahndungen (BOLO)', () => {
  it('Kennzeichen-BOLO: Treffer aus dem Heartbeat, Abklingzeit, Discord-Meldung, Erledigen', async () => {
    const ctx = createTestContext();
    const { admin, actor } = await serverActor(ctx);
    await updateSetting(
      ctx,
      admin,
      'dispatch',
      { ...(await getSetting(ctx.db, 'dispatch')), channelId: CHANNEL, boloHitCooldownMinutes: 5 },
      'Kanal einrichten',
    );
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const created = await bolo.createBolo(ctx, dispatcher, {
      kind: 'vehicle',
      plate: 'en-x 999',
      vehicleDescription: 'schwarzer Golf',
      reason: 'Fluchtfahrzeug nach Überfall',
      priority: 1,
    });
    expect(created).toMatchObject({ number: 1, plate: 'EN-X 999', plateNormalized: 'ENX999', hitCount: 0 });

    // Heartbeat ohne das Fahrzeug: kein Treffer
    await heartbeat(ctx, actor);
    expect(ctx.queue.jobs.filter((j) => j.name === 'bolo.hit')).toHaveLength(0);

    // Fahrzeug taucht auf (andere Schreibweise des Kennzeichens) → genau ein Treffer
    await heartbeat(ctx, actor, { plate: 'EN X-999' });
    let hits = ctx.queue.take('bolo.hit');
    expect(hits).toHaveLength(1);
    // Discord-Meldung: Ziel, Fahrzeug, Besitzer und Button „Erledigt“; Spielernamen ohne Formatierung
    const { message } = await boloHitMessage(ctx, String(hits[0]!.data.boloId));
    expect(message.embed.title).toBe('🔎 Fahndungstreffer · BOLO #1');
    const fields = Object.fromEntries(message.embed.fields.map((f) => [f.name, f.value]));
    expect(fields).toMatchObject({ Treffer: '1', Fahrzeug: 'Golf [EN X-999] · Schwarz' });
    expect(fields['Besitzer im Spiel']).toContain('Flucht\\_Fritz');
    expect(message.buttons).toEqual([expect.objectContaining({ customId: `bolo:resolve:${created.id}` })]);
    const afterHit = await bolo.getBolo(ctx.db, '1');
    expect(afterHit).toMatchObject({ hitCount: 1 });
    expect(afterHit.lastHit).toMatchObject({
      jobId: 'job-bolo',
      vehicle: { model: 'Golf', ownerName: 'Flucht_Fritz' },
      player: { userId: SUSPECT, team: 'Zivilisten' },
    });

    // Innerhalb der Abklingzeit kein weiterer Treffer, danach schon
    advance(ctx, 60_000);
    await heartbeat(ctx, actor, { plate: 'EN-X999' });
    expect(ctx.queue.take('bolo.hit')).toHaveLength(0);
    advance(ctx, 5 * 60_000);
    await heartbeat(ctx, actor, { plate: 'EN-X999' });
    hits = ctx.queue.take('bolo.hit');
    expect(hits).toHaveLength(1);
    expect((await bolo.getBolo(ctx.db, '1')).hitCount).toBe(2);

    // Erledigen: keine Treffer mehr, doppeltes Erledigen wird abgelehnt
    const resolved = await bolo.resolveBolo(ctx, dispatcher, '1', 'Fahrer festgenommen');
    expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: DISPATCHER, resolveNote: 'Fahrer festgenommen' });
    await expectAppError(bolo.resolveBolo(ctx, dispatcher, '1'), 'CONFLICT');
    advance(ctx, 10 * 60_000);
    await heartbeat(ctx, actor, { plate: 'EN-X999' });
    expect(ctx.queue.take('bolo.hit')).toHaveLength(0);

    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.resourceType, 'bolo'));
    expect(audit.map((a) => a.action).sort()).toEqual(['bolo.create', 'bolo.resolve']);
  });

  it('Personen-BOLO per Benutzername, Sofort-Treffer beim Anlegen, Ablauf, Suche und Rechte', async () => {
    const ctx = createTestContext();
    const { actor } = await serverActor(ctx);
    await heartbeat(ctx, actor); // Verdächtiger ist online und damit bekannt
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const created = await bolo.createBolo(ctx, dispatcher, {
      kind: 'person',
      username: 'flucht_fritz',
      reason: 'Haftbefehl wegen Raub',
      expiresInHours: 1,
    });
    expect(created).toMatchObject({ robloxUserId: SUSPECT, personName: 'Flucht_Fritz', hitCount: 1 });
    expect(ctx.queue.take('bolo.hit')).toHaveLength(1);

    // Unbekannter Name ohne ID wird abgelehnt, mit ID geht es
    await expectAppError(
      bolo.createBolo(ctx, dispatcher, { kind: 'person', username: 'Niemand', reason: 'Test' }),
      'BAD_REQUEST',
    );
    const byId = await bolo.createBolo(ctx, dispatcher, {
      kind: 'person',
      robloxUserId: 9999,
      reason: 'Zeuge gesucht',
    });
    expect(byId).toMatchObject({ robloxUserId: 9999, personName: null, hitCount: 0 });

    const search = await bolo.listBolos(ctx.db, dispatcher, { q: 'raub' });
    expect(search.items.map((b) => b.number)).toEqual([1]);
    const byPlateSearch = await bolo.listBolos(ctx.db, dispatcher, { q: '9999' });
    expect(byPlateSearch.items.map((b) => b.number)).toEqual([2]);

    // Nach Ablauf: Status „expired“, keine Treffer mehr
    advance(ctx, 2 * 3_600_000);
    await heartbeat(ctx, actor);
    expect((await bolo.getBolo(ctx.db, '1')).status).toBe('expired');
    expect(ctx.queue.take('bolo.hit')).toHaveLength(0);
    const active = await bolo.listBolos(ctx.db, dispatcher, { status: ['active'] });
    expect(active.items.map((b) => b.number)).toEqual([2]);

    const reader = await userWithRole(ctx, READER, 'read_only');
    await expectAppError(
      bolo.createBolo(ctx, reader, { kind: 'vehicle', plate: 'AB-123', reason: 'Test' }),
      'FORBIDDEN',
    );
    await expectAppError(bolo.resolveBolo(ctx, reader, '2'), 'FORBIDDEN');
    expect((await bolo.listBolos(ctx.db, reader, {})).total).toBe(2); // read_only darf dispatch:view
  });
});

describe('Ingame-Aktionen', () => {
  it('legt die Aktion für den Server des Spielers an, liefert sie mit Parametern aus und protokolliert sie', async () => {
    const ctx = createTestContext();
    const { actor } = await serverActor(ctx);
    const hb = await heartbeat(ctx, actor);
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');

    const jail = await ingame.createPlayerAction(ctx, dispatcher, SUSPECT, { action: 'jail', minutes: 10 }, 'Raub');
    expect(jail.command).toMatchObject({
      type: 'jail',
      robloxUserId: SUSPECT,
      params: { minutes: 10 },
      status: 'pending',
    });
    expect(jail.command.message).toContain('10 Minute');
    advance(ctx, 1000);
    const team = await ingame.createPlayerAction(
      ctx,
      dispatcher,
      SUSPECT,
      { action: 'team', team: 'gefängnis' },
      'Inhaftiert',
    );
    expect(team.command.params).toEqual({ team: 'Gefängnis' }); // Schreibweise aus dem Spiel übernommen

    // Spielserver holt beide Befehle ab (mit Parametern) und bestätigt sie
    const { commands } = await game.pollServerCommands(ctx, actor, 'job-bolo');
    expect(commands.map((c) => [c.type, c.params])).toEqual([
      ['jail', { minutes: 10 }],
      ['team', { team: 'Gefängnis' }],
    ]);
    await game.acknowledgeServerCommand(ctx, actor, commands[0]!.id, { jobId: 'job-bolo', success: true });
    await game.acknowledgeServerCommand(ctx, actor, commands[1]!.id, {
      jobId: 'job-bolo',
      success: false,
      error: 'Team nicht gefunden',
    });

    const history = await ingame.listPlayerActions(ctx.db, dispatcher, { robloxUserId: SUSPECT });
    expect(history.items.map((a) => [a.type, a.status, a.username])).toEqual([
      ['team', 'failed', 'Flucht_Fritz'],
      ['jail', 'succeeded', 'Flucht_Fritz'],
    ]);
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'ingame.jail'));
    expect(audit[0]).toMatchObject({ resourceType: 'roblox_user', resourceId: String(SUSPECT), reason: 'Raub' });
    expect(hb.serverId).toBe(jail.server.id);
  });

  it('prüft Rechte, Grenzen, Teams und ob der Spieler online ist', async () => {
    const ctx = createTestContext();
    const { actor } = await serverActor(ctx);
    await heartbeat(ctx, actor);
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const moderator = await userWithRole(ctx, MODERATOR, 'moderation');
    const reader = await userWithRole(ctx, READER, 'read_only');

    await expectAppError(ingame.createPlayerAction(ctx, reader, SUSPECT, { action: 'heal' }, 'Test'), 'FORBIDDEN');
    // Töten nur mit ingame_actions:approve (Moderation), nicht für die Leitstelle
    await expectAppError(ingame.createPlayerAction(ctx, dispatcher, SUSPECT, { action: 'kill' }, 'Test'), 'FORBIDDEN');
    const killed = await ingame.createPlayerAction(ctx, moderator, SUSPECT, { action: 'kill' }, 'Bugusing');
    expect(killed.command.type).toBe('kill');

    await expectAppError(
      ingame.createPlayerAction(ctx, dispatcher, SUSPECT, { action: 'jail', minutes: 120 }, 'Zu lang'),
      'BAD_REQUEST',
    ); // Standard-Höchstdauer 60 Minuten
    await expectAppError(
      ingame.createPlayerAction(ctx, dispatcher, SUSPECT, { action: 'team', team: 'Mafia' }, 'Test'),
      'BAD_REQUEST',
    );
    await expectAppError(ingame.createPlayerAction(ctx, dispatcher, 777, { action: 'heal' }, 'Offline'), 'BAD_REQUEST');

    // Spieler verlässt das Spiel → keine Aktion mehr möglich
    advance(ctx, 30_000);
    await heartbeat(ctx, actor, { suspectOnline: false });
    await expectAppError(
      ingame.createPlayerAction(ctx, dispatcher, SUSPECT, { action: 'wanted', level: 3 }, 'Test'),
      'BAD_REQUEST',
    );
    const pending = await ctx.db
      .select()
      .from(serverCommands)
      .where(and(eq(serverCommands.robloxUserId, SUSPECT), eq(serverCommands.type, 'wanted')));
    expect(pending).toHaveLength(0);
    await expectAppError(ingame.listPlayerActions(ctx.db, reader), 'FORBIDDEN');
  });
});
