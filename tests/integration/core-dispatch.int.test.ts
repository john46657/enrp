import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { dispatch, game, getSetting, live, updateSetting, type RobloxServerActor } from '@enrp/core';
import { and, dispatchUnits, eq, recordEvents, serverCommands } from '@enrp/database';
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

const CALLER = 2001;
const OFFICER_ROBLOX = 2002;
const DISPATCHER = '500000000000000001';
const OFFICER = '500000000000000002';
const READER = '500000000000000003';
const MODERATOR = '500000000000000004';
const CHANNEL = '600000000000000001';

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function setupServer(ctx: TestContext) {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: 'Leitstelle-Test' }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-dispatch-${String(++nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  const actor: RobloxServerActor = { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
  const hb = await game.processHeartbeat(ctx, actor, {
    jobId: 'job-leitstelle',
    placeId: '123',
    teams: ['Polizei', 'Zivilisten'],
    players: [
      { userId: CALLER, username: 'Anrufer', team: 'Zivilisten', wanted: 2 },
      { userId: OFFICER_ROBLOX, username: 'Streife', team: 'Polizei', callsign: '12/1' },
    ],
    vehicles: [
      { model: 'Streifenwagen', ownerId: OFFICER_ROBLOX, plate: 'EN-P 1234', color: 'Blau' },
      { model: 'Golf', ownerId: CALLER, plate: 'EN-X999', color: 'Rot' },
    ],
  });
  return { admin, actor, serverId: hb.serverId };
}

const call = (id: string, text = 'Überfall auf die Tankstelle') => ({
  id,
  type: 'emergency_call' as const,
  data: {
    userId: CALLER,
    username: 'Anrufer',
    department: 'polizei',
    text,
    location: 'Tankstelle Nord',
    position: { x: 104.4, z: -55.6 },
    callNumber: 7,
  },
});

describe('Live-Lage aus dem Heartbeat', () => {
  it('liefert Spieler mit Team/Fahndung und Fahrzeuge mit Kennzeichensuche', async () => {
    const ctx = createTestContext();
    const { admin } = await setupServer(ctx);
    const players = await live.livePlayers(ctx.db, admin, ctx.now(), { team: 'polizei' });
    expect(players.items).toHaveLength(1);
    expect(players.items[0]).toMatchObject({ username: 'Streife', callsign: '12/1', wanted: 0, jailed: false });
    const wanted = await live.livePlayers(ctx.db, admin, ctx.now(), { q: 'anruf' });
    expect(wanted.items[0]?.wanted).toBe(2);
    const plate = await live.liveVehicles(ctx.db, admin, ctx.now(), { plate: 'enp1234' });
    expect(plate.items).toHaveLength(1);
    expect(plate.items[0]).toMatchObject({ model: 'Streifenwagen', ownerName: 'Streife' });
    // Ohne Recht keine Live-Daten
    const reader = await userWithRole(ctx, READER);
    await expectAppError(live.livePlayers(ctx.db, reader, ctx.now()), 'FORBIDDEN');
  });

  it('ältere Skripte ohne Live-Felder funktionieren weiter', async () => {
    const ctx = createTestContext();
    const { actor, admin } = await setupServer(ctx);
    await game.processHeartbeat(ctx, actor, {
      jobId: 'job-alt',
      placeId: '123',
      players: [{ userId: 3001, username: 'Alt' }],
    });
    const players = await live.livePlayers(ctx.db, admin, ctx.now(), { q: 'alt' });
    expect(players.items[0]).toMatchObject({ username: 'Alt', wanted: 0, jailed: false });
  });
});

describe('Ingame-Notruf → Einsatz', () => {
  it('legt genau einen Einsatz an und benachrichtigt Discord', async () => {
    const ctx = createTestContext();
    const { admin, actor } = await setupServer(ctx);
    await updateSetting(
      ctx,
      admin,
      'dispatch',
      { ...(await getSetting(ctx.db, 'dispatch')), channelId: CHANNEL },
      'Kanal einrichten',
    );
    const first = await game.processGameEvents(ctx, actor, {
      jobId: 'job-leitstelle',
      events: [call('call-0000000001')],
    });
    expect(first[0]).toMatchObject({ status: 'processed' });
    const again = await game.processGameEvents(ctx, actor, {
      jobId: 'job-leitstelle',
      events: [call('call-0000000001')],
    });
    expect(again[0]?.status).toBe('duplicate');

    const list = await dispatch.listIncidents(ctx.db, admin, { page: 1, pageSize: 20 });
    expect(list.total).toBe(1);
    const incident = list.items[0]!;
    expect(incident).toMatchObject({
      source: 'ingame',
      department: 'Polizei',
      status: 'open',
      callerRobloxId: CALLER,
      callNumber: 7,
      location: 'Tankstelle Nord · X 104 · Z -56',
    });
    expect(ctx.queue.jobs.filter((j) => j.name === 'dispatch.post')).toHaveLength(1);
  });

  it('Zuweisen benachrichtigt den Anrufer im Spiel genau einmal, Abschluss gibt Einheiten frei', async () => {
    const ctx = createTestContext();
    const { actor, serverId } = await setupServer(ctx);
    await game.processGameEvents(ctx, actor, { jobId: 'job-leitstelle', events: [call('call-0000000002')] });
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const officer = await userWithRole(ctx, OFFICER, 'dispatch');
    await dispatch.setOwnUnitStatus(ctx, officer, { status: 'available', callsign: 'Adler 12/1' });

    const assigned = await dispatch.assignUnit(ctx, dispatcher, '1', OFFICER);
    expect(assigned.status).toBe('assigned');
    expect(assigned.firstAssignedAt).not.toBeNull();
    advance(ctx, 30_000);
    await dispatch.assignUnit(ctx, dispatcher, '1'); // zweite Einheit: die Leitstelle selbst
    const messages = await ctx.db
      .select()
      .from(serverCommands)
      .where(and(eq(serverCommands.serverId, serverId), eq(serverCommands.type, 'message_player')));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ robloxUserId: CALLER });
    expect(messages[0]!.message).toContain('Adler 12/1');

    await dispatch.setStatus(ctx, officer, '1', 'on_scene');
    const [unit] = await ctx.db.select().from(dispatchUnits).where(eq(dispatchUnits.unitId, OFFICER));
    expect(unit?.status).toBe('on_scene');
    await dispatch.addNote(ctx, officer, '1', 'Täter flüchtig Richtung Norden');
    const closed = await dispatch.closeIncident(ctx, dispatcher, '1', 'Täter festgenommen');
    expect(closed).toMatchObject({ status: 'closed', report: 'Täter festgenommen' });
    const [freed] = await ctx.db.select().from(dispatchUnits).where(eq(dispatchUnits.unitId, OFFICER));
    expect(freed).toMatchObject({ status: 'available', incidentId: null });
    await expectAppError(dispatch.assignUnit(ctx, officer, '1'), 'BAD_REQUEST');

    const detail = await dispatch.getIncidentDetail(ctx, dispatcher, '1');
    expect(detail.assignments).toHaveLength(2);
    expect(detail.caller).toMatchObject({ robloxUserId: CALLER, online: true, team: 'Zivilisten' });
    expect(detail.events.map((e) => e.type)).toEqual(['created', 'assigned', 'assigned', 'status', 'note', 'closed']);
    const search = await dispatch.listIncidents(ctx.db, dispatcher, { q: 'festgenommen', page: 1, pageSize: 20 });
    expect(search.total).toBe(1);
  });

  it('prüft Rechte und Bereiche', async () => {
    const ctx = createTestContext();
    await setupServer(ctx);
    const reader = await userWithRole(ctx, READER, 'read_only');
    await expectAppError(dispatch.createIncident(ctx, reader, { title: 'Test', location: 'Bank' }), 'FORBIDDEN');
    const dispatcher = await userWithRole(ctx, DISPATCHER, 'dispatch');
    const created = await dispatch.createIncident(ctx, dispatcher, {
      title: 'Verkehrsunfall',
      location: 'Hauptstraße',
      priority: 1,
      department: 'Rettungsdienst',
    });
    expect(created).toMatchObject({ source: 'discord', priority: 1, department: 'Rettungsdienst' });
    await expectAppError(dispatch.assignUnit(ctx, reader, String(created.number)), 'FORBIDDEN');
    await expectAppError(
      dispatch.createIncident(ctx, dispatcher, { title: 'X', location: 'Y', department: 'Mafia' }),
      'BAD_REQUEST',
    );
    const notes = await ctx.db.select().from(recordEvents).where(eq(recordEvents.recordId, created.id));
    expect(notes).toHaveLength(1);
    const stats = await dispatch.stats(ctx.db, dispatcher, ctx.now(), 7);
    expect(stats).toMatchObject({ total: 1, open: 1 });
  });
});

describe('Mod-Calls aus dem Spiel', () => {
  it('Mod-Call anlegen, übernehmen (Spieler bekommt Rückmeldung), schließen', async () => {
    const ctx = createTestContext();
    const { admin, actor, serverId } = await setupServer(ctx);
    await updateSetting(
      ctx,
      admin,
      'dispatch',
      { ...(await getSetting(ctx.db, 'dispatch')), modCallChannelId: CHANNEL },
      'Kanal',
    );
    await game.processGameEvents(ctx, actor, {
      jobId: 'job-leitstelle',
      events: [
        {
          id: 'modcall-00000001',
          type: 'mod_call',
          data: { userId: CALLER, username: 'Anrufer', text: 'Jemand trollt' },
        },
      ],
    });
    expect(ctx.queue.jobs.some((j) => j.name === 'modcall.post')).toBe(true);
    const moderator = await userWithRole(ctx, MODERATOR, 'moderation');
    const claimed = await dispatch.claimModCall(ctx, moderator, '1');
    expect(claimed).toMatchObject({ status: 'claimed', claimedBy: MODERATOR });
    await expectAppError(dispatch.claimModCall(ctx, moderator, '1'), 'BAD_REQUEST');
    const [message] = await ctx.db
      .select()
      .from(serverCommands)
      .where(and(eq(serverCommands.serverId, serverId), eq(serverCommands.robloxUserId, CALLER)));
    expect(message?.message).toContain('Mod-Call');
    const closed = await dispatch.closeModCall(ctx, moderator, '1', 'Spieler verwarnt');
    expect(closed).toMatchObject({ status: 'closed', note: 'Spieler verwarnt' });
    const reader = await userWithRole(ctx, READER, 'read_only');
    await expectAppError(dispatch.listModCalls(ctx.db, reader, { page: 1, pageSize: 10 }), 'FORBIDDEN');
  });

  it('protokolliert Kills, Teamwechsel und Fahrzeuge als Spielereignisse', async () => {
    const ctx = createTestContext();
    const { actor, admin } = await setupServer(ctx);
    const results = await game.processGameEvents(ctx, actor, {
      jobId: 'job-leitstelle',
      events: [
        {
          id: 'kill-0000000001',
          type: 'player_killed',
          data: { userId: CALLER, killerId: OFFICER_ROBLOX, weapon: 'Taser' },
        },
        { id: 'team-0000000001', type: 'team_changed', data: { userId: CALLER, from: 'Zivilisten', to: 'Polizei' } },
        { id: 'veh-00000000001', type: 'vehicle_spawned', data: { userId: CALLER, model: 'Golf', plate: 'EN-X999' } },
      ],
    });
    expect(results.map((r) => r.status)).toEqual(['processed', 'processed', 'processed']);
    const events = await game.recentGameEvents(ctx.db, { type: 'vehicle_spawned' });
    expect(events).toHaveLength(1);
    expect(admin).toBeTruthy();
  });
});
