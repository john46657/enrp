import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { actions, game, privateservers, type RobloxServerActor } from '@enrp/core';
import { accountLinks, auditEvents, discordUsers, eq, gameServers, privateServers, robloxUsers } from '@enrp/database';
import {
  closeDb,
  createTestContext,
  expectAppError,
  owner,
  resetDatabase,
  userWithRole,
  type TestContext,
} from './helpers';
import { botHeaders, cookiesOf, createTestApp, fakeOAuthFetch } from './api-helpers';

const OWNER_DISCORD = '540000000000000001';
const OWNER_ROBLOX = 5201;
const ADMIN_ROBLOX = 5202;
const OTHER_DISCORD = '540000000000000003';
const OTHER_ROBLOX = 5203;
const TARGET = 5204;
const MOD_DISCORD = '540000000000000005';
const VIP_ID = 'vip-1234-abcd';

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function serverActor(ctx: TestContext): Promise<RobloxServerActor> {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: `Privat ${++nonce}` }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-private-${String(nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  return { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
}

const players = [
  { userId: OWNER_ROBLOX, username: 'Besitzer' },
  { userId: ADMIN_ROBLOX, username: 'Helfer' },
  { userId: OTHER_ROBLOX, username: 'Fremder' },
  { userId: TARGET, username: 'Ziel' },
];

async function link(ctx: TestContext, discordId: string, robloxId: number, name: string) {
  await ctx.db.insert(discordUsers).values({ id: discordId, username: name }).onConflictDoNothing();
  await ctx.db.insert(robloxUsers).values({ id: robloxId, username: name }).onConflictDoNothing();
  await ctx.db.insert(accountLinks).values({ discordUserId: discordId, robloxUserId: robloxId });
}

async function setup(ctx: TestContext) {
  const server = await serverActor(ctx);
  const vip = await game.processHeartbeat(ctx, server, {
    jobId: 'job-vip',
    placeId: '123',
    privateServerId: VIP_ID,
    privateServerOwnerId: OWNER_ROBLOX,
    players,
  });
  const main = await game.processHeartbeat(ctx, server, { jobId: 'job-main', placeId: '123', players });
  await link(ctx, OWNER_DISCORD, OWNER_ROBLOX, 'besitzer');
  await link(ctx, OTHER_DISCORD, OTHER_ROBLOX, 'fremder');
  return { server, vip, main };
}

const cmd = (jobId: string, issuerId: number, action = 'heal') =>
  ({ jobId, issuerId, targetId: TARGET, targetName: 'Ziel', action }) as Parameters<
    typeof actions.staffCommandFromGame
  >[2];

describe('Privat-Server', () => {
  it('wird beim Heartbeat registriert; Teamsperre standardmäßig aus, im Hauptspiel keine Privat-Server-Daten', async () => {
    const ctx = createTestContext();
    const { vip, main } = await setup(ctx);
    expect(vip.privateServer).toMatchObject({ teamLock: false, teamFactions: {} });
    expect(main.privateServer).toBeNull();

    const rows = await ctx.db.select().from(privateServers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ privateServerId: VIP_ID, ownerRobloxId: OWNER_ROBLOX, admins: [] });
    const [srv] = await ctx.db.select().from(gameServers).where(eq(gameServers.jobId, 'job-vip'));
    expect(srv).toMatchObject({ serverType: 'private', privateServerId: VIP_ID });

    // Zweiter Heartbeat (auch neuer Server desselben VIP-Servers) legt nichts doppelt an
    const server = await serverActor(ctx);
    await game.processHeartbeat(ctx, server, {
      jobId: 'job-vip-2',
      placeId: '123',
      privateServerId: VIP_ID,
      privateServerOwnerId: OWNER_ROBLOX,
      players: [],
    });
    expect(await ctx.db.select().from(privateServers)).toHaveLength(1);
  });

  it('Besitzer sieht und verwaltet nur den eigenen, das Team alle; Einstellungen landen im Heartbeat', async () => {
    const ctx = createTestContext();
    const { server } = await setup(ctx);
    const ownerActor = await userWithRole(ctx, OWNER_DISCORD);
    const other = await userWithRole(ctx, OTHER_DISCORD);
    const mod = await userWithRole(ctx, MOD_DISCORD, 'moderation');

    const own = await privateservers.listPrivateServers(ctx.db, ownerActor);
    expect(own.items).toHaveLength(1);
    expect(own.items[0]).toMatchObject({ isOwner: true, ownerName: 'Besitzer', online: { jobId: 'job-vip' } });
    expect((await privateservers.listPrivateServers(ctx.db, other)).items).toHaveLength(0);
    expect((await privateservers.listPrivateServers(ctx.db, mod)).canViewAll).toBe(true);

    const id = own.items[0]!.id;
    await expectAppError(privateservers.getPrivateServer(ctx.db, other, id), 'NOT_FOUND');
    // Team mit Ansicht, aber ohne configure: sehen ja, ändern nein
    expect((await privateservers.getPrivateServer(ctx.db, mod, id)).canManage).toBe(false);
    await expectAppError(privateservers.updatePrivateServer(ctx, mod, id, { teamLock: true }), 'FORBIDDEN');
    await expectAppError(privateservers.updatePrivateServer(ctx, other, id, { teamLock: true }), 'NOT_FOUND');

    // Unbekannte Fraktion wird abgelehnt
    await expectAppError(
      privateservers.updatePrivateServer(ctx, ownerActor, id, { teamFactions: { Polizei: 'gibtsnicht' } }),
      'BAD_REQUEST',
    );

    // Teamsperre an ohne Zuordnung → Standard-Teams
    const locked = await privateservers.updatePrivateServer(ctx, ownerActor, id, {
      name: 'Mein RP',
      teamLock: true,
      admins: [ADMIN_ROBLOX, OWNER_ROBLOX, ADMIN_ROBLOX],
    });
    expect(locked).toMatchObject({
      name: 'Mein RP',
      teamLock: true,
      teamFactions: { Polizei: 'polizei', Feuerwehr: 'feuerwehr', Rettungsdienst: 'rettungsdienst' },
      admins: [ADMIN_ROBLOX],
    });
    const hb = await game.processHeartbeat(ctx, server, {
      jobId: 'job-vip',
      placeId: '123',
      privateServerId: VIP_ID,
      privateServerOwnerId: OWNER_ROBLOX,
      players,
    });
    expect(hb.privateServer).toMatchObject({ name: 'Mein RP', teamLock: true, teamFactions: { Polizei: 'polizei' } });

    // Eigene Zuordnung; Teamsperre aus → Spielserver bekommt keine Zuordnung
    await privateservers.updatePrivateServer(ctx, ownerActor, id, { teamFactions: { SEK: 'polizei' } });
    const off = await privateservers.updatePrivateServer(ctx, ownerActor, id, { teamLock: false });
    expect(off.teamFactions).toEqual({ SEK: 'polizei' });
    expect(privateservers.gameConfig(off)).toMatchObject({ teamLock: false, teamFactions: {} });

    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'private_server.update'));
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ actorId: OWNER_DISCORD, resourceId: id });

    // Team mit roblox_servers:configure darf ändern
    const admin = await owner(ctx);
    expect((await privateservers.updatePrivateServer(ctx, admin, id, { name: null })).name).toBeNull();
  });

  it('Besitzer und Admins dürfen Team-Befehle nur auf ihrem eigenen Privat-Server, nie im Hauptspiel', async () => {
    const ctx = createTestContext();
    const { server } = await setup(ctx);
    const [row] = await ctx.db.select().from(privateServers);
    const ownerActor = await userWithRole(ctx, OWNER_DISCORD);
    await privateservers.updatePrivateServer(ctx, ownerActor, row!.id, { admins: [ADMIN_ROBLOX] });

    // Besitzer auf dem eigenen Privat-Server
    const byOwner = await actions.staffCommandFromGame(ctx, server, cmd('job-vip', OWNER_ROBLOX, 'kick'));
    expect(byOwner).toMatchObject({ ok: true, command: { action: 'kick', robloxUserId: TARGET } });
    // Ernannter Admin (ohne Discord-Verknüpfung) ebenfalls
    const byAdmin = await actions.staffCommandFromGame(ctx, server, cmd('job-vip', ADMIN_ROBLOX));
    expect(byAdmin.ok).toBe(true);
    // Fremder Spieler nicht
    expect(await actions.staffCommandFromGame(ctx, server, cmd('job-vip', OTHER_ROBLOX))).toEqual({
      ok: false,
      error: 'Dafür fehlt dir die Berechtigung.',
    });
    // Im Hauptspiel haben Besitzer und Admin keine Rechte
    expect((await actions.staffCommandFromGame(ctx, server, cmd('job-main', OWNER_ROBLOX))).ok).toBe(false);
    expect(await actions.staffCommandFromGame(ctx, server, cmd('job-main', ADMIN_ROBLOX))).toEqual({
      ok: false,
      error: expect.stringContaining('/verify'),
    });

    // Auf einem fremden Privat-Server ebenfalls nicht
    await game.processHeartbeat(ctx, server, {
      jobId: 'job-vip-fremd',
      placeId: '123',
      privateServerId: 'vip-fremd',
      privateServerOwnerId: OTHER_ROBLOX,
      players,
    });
    expect((await actions.staffCommandFromGame(ctx, server, cmd('job-vip-fremd', OWNER_ROBLOX))).ok).toBe(false);

    // Audit kennzeichnet die Privat-Server-Rechte
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'player_action.kick'));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({
      privateServerStaff: { robloxUserId: OWNER_ROBLOX, username: 'Besitzer' },
    });
  });
});

describe('API: Privat-Server', () => {
  it('Liste, Detail und Einstellungen über die API mit Rechteprüfung', async () => {
    const ctx = createTestContext();
    const { app } = await createTestApp(ctx);
    await setup(ctx);
    const [row] = await ctx.db.select().from(privateServers);

    expect((await app.inject('/api/v1/private-servers')).statusCode).toBe(401);
    const none = await app.inject({ url: '/api/v1/private-servers', headers: botHeaders(MOD_DISCORD) });
    expect(none.json()).toEqual({ items: [], canViewAll: false });

    const mine = await app.inject({ url: '/api/v1/private-servers', headers: botHeaders(OWNER_DISCORD) });
    expect(mine.json().items).toHaveLength(1);
    expect(
      (await app.inject({ url: `/api/v1/private-servers/${row!.id}`, headers: botHeaders(OTHER_DISCORD) })).statusCode,
    ).toBe(404);

    const bad = await app.inject({
      method: 'PUT',
      url: `/api/v1/private-servers/${row!.id}`,
      headers: botHeaders(OWNER_DISCORD),
      payload: { admins: [-1] },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/private-servers/${row!.id}`,
      headers: botHeaders(OWNER_DISCORD),
      payload: { teamLock: true, teamFactions: { Polizei: 'polizei' }, admins: [ADMIN_ROBLOX] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ teamLock: true, admins: [ADMIN_ROBLOX], canManage: true });
    const foreign = await app.inject({
      method: 'PUT',
      url: `/api/v1/private-servers/${row!.id}`,
      headers: botHeaders(OTHER_DISCORD),
      payload: { teamLock: false },
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('Dashboard-Login für Privat-Server-Besitzer', () => {
  it('Besitzer ohne Team-Rechte dürfen sich anmelden und landen auf „Privat-Server“, andere nicht', async () => {
    const login = async (ctx: TestContext, discordId: string) => {
      const oauthFetch = fakeOAuthFetch({ discordId, robloxId: 1, robloxName: 'x' });
      const { app } = await createTestApp(ctx, oauthFetch.impl);
      const start = await app.inject('/api/v1/auth/discord/login');
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      const cb = await app.inject({
        url: `/api/v1/auth/discord/callback?code=c&state=${state}`,
        cookies: { enrp_oauth: cookiesOf(start).enrp_oauth! },
      });
      await app.close();
      return cb;
    };
    const ctx = createTestContext();
    await setup(ctx);
    const ok = await login(ctx, OWNER_DISCORD);
    expect(ok.headers.location).toMatch(/\/private-servers$/);
    expect(cookiesOf(ok).enrp_session).toBeTruthy();
    const denied = await login(ctx, OTHER_DISCORD);
    expect(denied.headers.location).toContain('error=kein_zugriff');
  });
});
