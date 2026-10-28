import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { duty, factionsModule, game, verification, type RobloxServerActor, updateSetting, setFlag } from '@enrp/core';
import { accountLinks, dutySessions, eq, robloxUsers } from '@enrp/database';
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

const PLAYER = 1001;
const PLAYER2 = 1002;
const DISCORD = '400000000000000001';
const POLICE_LEAD = '400000000000000009';

beforeEach(resetDatabase);
afterAll(closeDb);

async function setupServer(ctx: TestContext) {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: 'Test-Server' }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    { bearer: key.key, timestamp: String(Math.floor(ctx.now().getTime() / 1000)), nonce: 'nonce-0000000000000001' },
    ctx.now(),
  );
  const actor: RobloxServerActor = { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
  const hb = await game.processHeartbeat(ctx, actor, {
    jobId: 'job-1',
    placeId: '123',
    players: [
      { userId: PLAYER, username: 'MaxMuster' },
      { userId: PLAYER2, username: 'ErikaMuster' },
    ],
  });
  return { key, actor, serverId: hb.serverId, admin };
}

describe('Roblox-Serverauthentifizierung', () => {
  it('prüft Schlüssel, Zeitfenster und Nonce (Replay-Schutz)', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    const { key } = await game.createRobloxApiKey(ctx, admin, { name: 'S', allowedPlaceIds: ['555'] }, 'x');
    const ts = String(Math.floor(ctx.now().getTime() / 1000));
    await expectAppError(
      game.authenticateRobloxRequest(ctx.db, { bearer: 'falsch', timestamp: ts, nonce: 'n'.repeat(20) }, ctx.now()),
      'UNAUTHENTICATED',
    );
    await expectAppError(
      game.authenticateRobloxRequest(
        ctx.db,
        { bearer: key, timestamp: String(Number(ts) - 1000), nonce: 'a'.repeat(20), placeId: '555' },
        ctx.now(),
      ),
      'INVALID_SIGNATURE',
    );
    await expectAppError(
      game.authenticateRobloxRequest(
        ctx.db,
        { bearer: key, timestamp: ts, nonce: 'b'.repeat(20), placeId: '999' },
        ctx.now(),
      ),
      'FORBIDDEN',
    );
    await game.authenticateRobloxRequest(
      ctx.db,
      { bearer: key, timestamp: ts, nonce: 'c'.repeat(20), placeId: '555' },
      ctx.now(),
    );
    await expectAppError(
      game.authenticateRobloxRequest(
        ctx.db,
        { bearer: key, timestamp: ts, nonce: 'c'.repeat(20), placeId: '555' },
        ctx.now(),
      ),
      'REPLAY_DETECTED',
    );
    const keys = await game.listRobloxApiKeys(ctx.db);
    await game.revokeRobloxApiKey(ctx, admin, keys[0]!.id, 'kompromittiert');
    await expectAppError(
      game.authenticateRobloxRequest(
        ctx.db,
        { bearer: key, timestamp: ts, nonce: 'd'.repeat(20), placeId: '555' },
        ctx.now(),
      ),
      'UNAUTHENTICATED',
    );
  });
});

describe('Fraktionen und Dienstsystem', () => {
  it('Dienst nur für Mitglieder, Serverzeit maßgeblich, idempotente Ereignisse', async () => {
    const ctx = createTestContext();
    const { actor, admin } = await setupServer(ctx);

    // Ohne Mitgliedschaft wird der Dienstbeginn abgelehnt.
    let results = await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-00000001', type: 'duty_start', data: { userId: PLAYER } }],
    });
    expect(results[0]).toMatchObject({ status: 'rejected', result: { reason: 'not_member' } });

    await factionsModule.assignFaction(ctx, admin, { robloxUserId: PLAYER, factionKey: 'polizei', reason: 'Aufnahme' });
    // Gefälschter Zeitstempel (1 Stunde in der Vergangenheit) wird ignoriert und markiert.
    const fake = new Date(ctx.now().getTime() - 3600_000).toISOString();
    results = await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-00000002', type: 'duty_start', occurredAt: fake, data: { userId: PLAYER } }],
    });
    expect(results[0]!.status).toBe('processed');
    const [session] = await ctx.db.select().from(dutySessions).where(eq(dutySessions.robloxUserId, PLAYER));
    expect(session!.startedAt.toISOString()).toBe(ctx.now().toISOString());
    expect(session!.flags).toContain('clock_skew');

    // Doppelte Zustellung desselben Ereignisses ändert nichts.
    results = await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-00000002', type: 'duty_start', data: { userId: PLAYER } }],
    });
    expect(results[0]!.status).toBe('duplicate');

    advance(ctx, 45 * 60_000);
    results = await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-00000003', type: 'duty_end', data: { userId: PLAYER } }],
    });
    expect(results[0]).toMatchObject({ status: 'processed', result: { status: 'ended', durationSeconds: 2700 } });

    const totals = await duty.dutyTotals(ctx.db, { robloxUserId: PLAYER });
    expect(totals.totalSeconds).toBe(2700);
    const board = await duty.dutyLeaderboard(ctx.db, {});
    expect(board[0]).toMatchObject({ robloxUserId: PLAYER, seconds: 2700, rank: 1 });
  });

  it('Versetzung beendet laufenden Dienst; Fraktionsverwaltung wirkt nur in eigener Fraktion', async () => {
    const ctx = createTestContext();
    const { actor, admin } = await setupServer(ctx);
    await factionsModule.assignFaction(ctx, admin, {
      robloxUserId: PLAYER,
      factionKey: 'feuerwehr',
      reason: 'Aufnahme',
    });
    await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-10000001', type: 'duty_start', data: { userId: PLAYER } }],
    });

    const police = await factionsModule.getFaction(ctx.db, 'polizei');
    const lead = await userWithRole(ctx, POLICE_LEAD);
    lead.subject.grants = [{ permission: 'factions:edit', factionIds: [police.id] }];
    // Versetzung aus der Feuerwehr erfordert auch Rechte für die Feuerwehr.
    await expectAppError(
      factionsModule.assignFaction(ctx, lead, { robloxUserId: PLAYER, factionKey: 'polizei', reason: 'x' }),
      'FORBIDDEN',
    );
    await factionsModule.assignFaction(ctx, lead, { robloxUserId: PLAYER2, factionKey: 'polizei', reason: 'Aufnahme' });

    advance(ctx, 10 * 60_000);
    await factionsModule.assignFaction(ctx, admin, { robloxUserId: PLAYER, factionKey: 'polizei', reason: 'Wechsel' });
    expect(await duty.getActiveDuty(ctx.db, PLAYER)).toBeNull();
    const history = await factionsModule.membershipHistory(ctx.db, { robloxUserId: PLAYER });
    expect(history.map((h) => [h.faction.key, h.membership.status])).toEqual([
      ['polizei', 'active'],
      ['feuerwehr', 'ended'],
    ]);
    await expectAppError(
      factionsModule.assignFaction(ctx, admin, { robloxUserId: PLAYER, factionKey: 'polizei', reason: 'doppelt' }),
      'CONFLICT',
    );
  });

  it('Heartbeat schließt Sessions verschwundener Spieler; Watchdog schließt Sessions bei Server-Timeout', async () => {
    const ctx = createTestContext();
    const { actor, admin } = await setupServer(ctx);
    await factionsModule.assignFaction(ctx, admin, {
      robloxUserId: PLAYER,
      factionKey: 'rettungsdienst',
      reason: 'Aufnahme',
    });
    await factionsModule.assignFaction(ctx, admin, {
      robloxUserId: PLAYER2,
      factionKey: 'polizei',
      reason: 'Aufnahme',
    });
    await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [
        { id: 'evt-20000001', type: 'duty_start', data: { userId: PLAYER } },
        { id: 'evt-20000002', type: 'duty_start', data: { userId: PLAYER2 } },
      ],
    });
    advance(ctx, 20 * 60_000);
    // PLAYER2 fehlt im Heartbeat → Spiel- und Dienstsession werden geschlossen, Spielzeit gutgeschrieben.
    await game.processHeartbeat(ctx, actor, {
      jobId: 'job-1',
      placeId: '123',
      players: [{ userId: PLAYER, username: 'MaxMuster' }],
    });
    expect(await duty.getActiveDuty(ctx.db, PLAYER2)).toBeNull();
    const [p2] = await ctx.db.select().from(robloxUsers).where(eq(robloxUsers.id, PLAYER2));
    expect(p2!.totalPlaytimeSeconds).toBe(1200);

    // Server meldet sich nicht mehr → Session endet zum letzten Heartbeat.
    const lastHeartbeat = ctx.now();
    advance(ctx, 30 * 60_000);
    const closed = await duty.closeStaleDutySessions(ctx);
    expect(closed.serverTimeout).toBe(1);
    const [s] = await ctx.db.select().from(dutySessions).where(eq(dutySessions.robloxUserId, PLAYER));
    expect(s!.endedAt!.toISOString()).toBe(lastHeartbeat.toISOString());
    expect(s!.flags).toContain('server_timeout');
    expect(await game.markStaleServers(ctx, 180)).toBe(1);
  });

  it('Korrekturen erfordern Recht, Begründung und plausible Zeiten', async () => {
    const ctx = createTestContext();
    const { actor, admin } = await setupServer(ctx);
    await factionsModule.assignFaction(ctx, admin, { robloxUserId: PLAYER, factionKey: 'polizei', reason: 'Aufnahme' });
    await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-30000001', type: 'duty_start', data: { userId: PLAYER } }],
    });
    advance(ctx, 3600_000);
    await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-30000002', type: 'duty_end', data: { userId: PLAYER } }],
    });
    const [session] = await ctx.db.select().from(dutySessions).where(eq(dutySessions.robloxUserId, PLAYER));

    const reader = await userWithRole(ctx, '400000000000000010', 'read_only');
    await expectAppError(
      duty.correctDutySession(ctx, reader, session!.id, { invalidate: true }, 'Missbrauch'),
      'FORBIDDEN',
    );
    await expectAppError(
      duty.correctDutySession(
        ctx,
        admin,
        session!.id,
        { endedAt: new Date(ctx.now().getTime() + 3600_000) },
        'Zukunft',
      ),
      'BAD_REQUEST',
    );
    const corrected = await duty.correctDutySession(
      ctx,
      admin,
      session!.id,
      { startedAt: new Date(session!.startedAt.getTime() + 600_000) },
      'AFK zu Beginn',
    );
    expect(corrected.durationSeconds).toBe(3000);
    expect(corrected.flags).toContain('corrected');
    expect((await duty.listCorrections(ctx.db, session!.id)).length).toBe(1);

    await setFlag(ctx, admin, { key: 'duty_tracking', enabled: false, reason: 'Test' });
    const res = await game.processGameEvents(ctx, actor, {
      jobId: 'job-1',
      events: [{ id: 'evt-30000003', type: 'duty_start', data: { userId: PLAYER } }],
    });
    expect(res[0]).toMatchObject({ status: 'rejected' });
    await updateSetting(
      ctx,
      admin,
      'duty',
      { maxSessionHours: 1, clockSkewToleranceSeconds: 60, serverTimeoutSeconds: 120 },
      'kurz',
    );
  });
});

describe('Verifizierung', () => {
  it('vollständiger Ablauf: Start, einmaliger State, Verknüpfung, nur Rolle „Verifiziert“', async () => {
    const ctx = createTestContext({ verifiedRoleId: '500000000000000001' });
    const user = await userWithRole(ctx, DISCORD);
    const start = await verification.startVerification(ctx, user);
    const consumed = await verification.consumeOAuthState(ctx.db, ctx.now(), 'verify_start', start.state);
    expect(consumed.discordUserId).toBe(DISCORD);
    await expectAppError(verification.consumeOAuthState(ctx.db, ctx.now(), 'verify_start', start.state), 'GONE');

    // Browserbindung
    const bound = await verification.createOAuthState(ctx.db, ctx.now(), {
      purpose: 'roblox_verify',
      discordUserId: DISCORD,
      codeVerifier: 'v',
      browserBinding: 'cookie-a',
    });
    await expectAppError(
      verification.consumeOAuthState(ctx.db, ctx.now(), 'roblox_verify', bound.state, 'cookie-b'),
      'CSRF_FAILED',
    );

    await verification.upsertDiscordUser(ctx.db, { id: DISCORD, username: 'max' });
    await verification.completeVerification(ctx, DISCORD, { id: PLAYER, username: 'MaxMuster' });
    const roleJobs = ctx.queue.take('role.add');
    expect(roleJobs).toHaveLength(1);
    expect(roleJobs[0]!.data).toMatchObject({ userId: DISCORD, roleId: '500000000000000001' });
    expect(await verification.verificationStatus(ctx.db, DISCORD)).toMatchObject({
      verified: true,
      roblox: { id: PLAYER },
    });

    // Ein Roblox-Konto kann nicht mit zwei Discord-Konten verknüpft werden.
    const other = '400000000000000002';
    await verification.upsertDiscordUser(ctx.db, { id: other, username: 'other' });
    await expectAppError(
      verification.completeVerification(ctx, other, { id: PLAYER, username: 'MaxMuster' }),
      'CONFLICT',
    );
    await expectAppError(verification.startVerification(ctx, user), 'CONFLICT');

    // Aufheben → Wartezeit
    await verification.unlinkAccount(ctx, user, { reason: 'Kontowechsel' });
    expect(ctx.queue.take('role.remove')).toHaveLength(1);
    await expectAppError(verification.startVerification(ctx, user), 'CONFLICT');
    advance(ctx, 25 * 3600_000);
    await verification.startVerification(ctx, user);
    const links = await ctx.db.select().from(accountLinks);
    expect(links.map((l) => l.status)).toEqual(['revoked']);
  });

  it('Kill-Switch und deaktivierte Verifizierung blockieren den Start', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    const user = await userWithRole(ctx, DISCORD);
    await setFlag(ctx, admin, { key: 'verification', enabled: false, reason: 'Wartung' });
    await expectAppError(verification.startVerification(ctx, user), 'FEATURE_DISABLED');
    await setFlag(ctx, admin, { key: 'kill_switch', enabled: true, reason: 'Notfall' });
    await expectAppError(verification.startVerification(ctx, user), 'KILL_SWITCH_ACTIVE');
  });
});

describe('Servertyp und Server-Befehle', () => {
  it('speichert den Servertyp aus dem Heartbeat', async () => {
    const ctx = createTestContext();
    const { actor } = await setupServer(ctx);
    await game.processHeartbeat(ctx, actor, {
      jobId: 'job-vip',
      placeId: '123',
      privateServerId: 'ps-1',
      privateServerOwnerId: 777,
      players: [],
    });
    await game.processHeartbeat(ctx, actor, { jobId: 'job-res', placeId: '123', privateServerId: 'ps-2', players: [] });
    const servers = await game.listServers(ctx.db);
    const byJob = Object.fromEntries(servers.map((s) => [s.jobId, s]));
    expect(byJob['job-1']).toMatchObject({ serverType: 'public', privateServerOwnerId: null });
    expect(byJob['job-vip']).toMatchObject({ serverType: 'private', privateServerOwnerId: 777 });
    expect(byJob['job-res']).toMatchObject({ serverType: 'reserved', privateServerOwnerId: null });
  });

  it('liefert Befehle aus, bestätigt sie einmalig und lässt alte verfallen', async () => {
    const ctx = createTestContext();
    const { actor, serverId, admin } = await setupServer(ctx);
    await game.createServerCommand(ctx, admin, { serverId }, { type: 'message_server', message: 'Hallo' }, 'Test');
    const first = await game.pollServerCommands(ctx, actor, 'job-1');
    expect(first.commands).toHaveLength(1);
    expect(first.commands[0]).toMatchObject({ type: 'message_server', message: 'Hallo' });
    // Unbestätigt → wird erneut geliefert (Server führt per ID nur einmal aus).
    expect((await game.pollServerCommands(ctx, actor, 'job-1')).commands).toHaveLength(1);
    const id = first.commands[0]!.id;
    expect(await game.acknowledgeServerCommand(ctx, actor, id, { jobId: 'job-1', success: true })).toEqual({
      status: 'succeeded',
    });
    expect(await game.acknowledgeServerCommand(ctx, actor, id, { jobId: 'job-1', success: true })).toEqual({
      status: 'ignored',
    });
    expect((await game.pollServerCommands(ctx, actor, 'job-1')).commands).toHaveLength(0);

    await game.createServerCommand(ctx, admin, { allOnline: true }, { type: 'shutdown' }, 'Update');
    advance(ctx, (game.SERVER_COMMAND_TTL_SECONDS + 1) * 1000);
    expect((await game.pollServerCommands(ctx, actor, 'job-1')).commands).toHaveLength(0);
    const all = await game.listServerCommands(ctx.db);
    expect(all.map((c) => c.status).sort()).toEqual(['expired', 'succeeded']);
  });

  it('Heartbeat liefert offene Befehle mit; Rechte werden geprüft', async () => {
    const ctx = createTestContext();
    const { actor, serverId } = await setupServer(ctx);
    const mod = await userWithRole(ctx, DISCORD, 'moderation');
    await game.createServerCommand(
      ctx,
      mod,
      { serverId },
      { type: 'message_player', robloxUserId: PLAYER, message: 'Bitte melden' },
      'Hinweis',
    );
    await expectAppError(
      game.createServerCommand(ctx, mod, { serverId }, { type: 'shutdown' }, 'Neustart'),
      'FORBIDDEN',
    );
    const reader = await userWithRole(ctx, POLICE_LEAD, 'read_only');
    await expectAppError(
      game.createServerCommand(ctx, reader, { serverId }, { type: 'message_server', message: 'x' }, 'x'),
      'FORBIDDEN',
    );
    const hb = await game.processHeartbeat(ctx, actor, { jobId: 'job-1', placeId: '123', players: [] });
    expect(hb.commands).toEqual([
      expect.objectContaining({ type: 'message_player', robloxUserId: PLAYER, message: 'Bitte melden' }),
    ]);
    const detail = await game.getServerDetail(ctx.db, serverId);
    expect(detail.server.jobId).toBe('job-1');
    expect(detail.commands).toHaveLength(1);
  });
});
