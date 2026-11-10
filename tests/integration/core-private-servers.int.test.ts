import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  game,
  getSetting,
  privateServers,
  updateSetting,
  verification,
  type RobloxServerActor,
  type UserActor,
} from '@enrp/core';
import { auditEvents, eq } from '@enrp/database';
import {
  closeDb,
  createTestContext,
  expectAppError,
  GUILD_ID,
  owner,
  resetDatabase,
  userWithRole,
  type TestContext,
} from './helpers';

const PS_GUILD = '920000000000000001';
const OTHER_GUILD = '920000000000000002';
const OWNER_ROBLOX = 6001;
const POLICE_ROBLOX = 6002;
const GUEST_ROBLOX = 6003;
const POLICE_DISCORD = '820000000000000001';
const NOACCOUNT_DISCORD = '820000000000000002';
const PS_ADMIN = '820000000000000003';
const PS_TEAM = '820000000000000004';
const PS_MEMBER = '820000000000000005';
const POLICE_ROLE = '830000000000000001';
const TEAM_ROLE = '830000000000000002';
const LOG_CHANNEL = '840000000000000001';
const bot = { kind: 'service', name: 'bot' } as const;

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function serverActor(ctx: TestContext) {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: 'PS-Test' }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-ps-${String(++nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  const actor: RobloxServerActor = { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
  return { admin, actor };
}

/** Privatserver des Besitzers (und optional ein öffentlicher Server) mit Spielern. */
function privateHeartbeat(ctx: TestContext, actor: RobloxServerActor) {
  return game.processHeartbeat(ctx, actor, {
    jobId: 'job-private',
    placeId: '123',
    privateServerId: 'ps-abc',
    privateServerOwnerId: OWNER_ROBLOX,
    teams: ['Polizei', 'Zivilisten'],
    players: [
      { userId: OWNER_ROBLOX, username: 'Besitzer', team: 'Zivilisten' },
      { userId: POLICE_ROBLOX, username: 'Polizist', team: 'Polizei' },
      { userId: GUEST_ROBLOX, username: 'Gast', team: 'Zivilisten' },
    ],
  });
}
function publicHeartbeat(ctx: TestContext, actor: RobloxServerActor, players: number[]) {
  return game.processHeartbeat(ctx, actor, {
    jobId: 'job-public',
    placeId: '123',
    players: players.map((userId) => ({ userId, username: `Spieler${userId}` })),
  });
}

/** Person, die im Privatserver-Discord handelt (so wie der Bot sie meldet). */
async function guildActor(
  ctx: TestContext,
  discordUserId: string,
  guild: { admin?: boolean; roleIds?: string[] } = {},
) {
  const base = await userWithRole(ctx, discordUserId);
  return {
    ...base,
    roleIds: [],
    guild: { id: PS_GUILD, admin: guild.admin ?? false, roleIds: guild.roleIds ?? [] },
  } satisfies UserActor;
}

async function setup(ctx: TestContext) {
  const { admin, actor } = await serverActor(ctx);
  await privateHeartbeat(ctx, actor); // Besitzer ist damit bekannt
  const link = await privateServers.linkGuild(
    ctx,
    admin,
    { guildId: PS_GUILD, name: 'Bereitschaftspolizei RP', ownerUsername: 'besitzer' },
    'Partner-Community',
  );
  return { admin, actor, link };
}

describe('Privatserver-Discords: Verknüpfung', () => {
  it('verknüpft über den Besitzernamen, verhindert Doppelungen und den Haupt-Discord, prüft Rechte', async () => {
    const ctx = createTestContext();
    const { admin, link } = await setup(ctx);
    expect(link).toMatchObject({
      guildId: PS_GUILD,
      ownerRobloxId: OWNER_ROBLOX,
      ownerName: 'Besitzer',
      teamLock: false,
    });

    await expectAppError(
      privateServers.linkGuild(ctx, admin, { guildId: PS_GUILD, name: 'Nochmal', ownerRobloxId: 999 }, 'x'),
      'CONFLICT',
    );
    await expectAppError(
      privateServers.linkGuild(
        ctx,
        admin,
        { guildId: OTHER_GUILD, name: 'Gleicher Besitzer', ownerRobloxId: OWNER_ROBLOX },
        'x',
      ),
      'CONFLICT',
    );
    await expectAppError(
      privateServers.linkGuild(ctx, admin, { guildId: GUILD_ID, name: 'Haupt', ownerRobloxId: 1234 }, 'x'),
      'BAD_REQUEST',
    );
    await expectAppError(
      privateServers.linkGuild(ctx, admin, { guildId: OTHER_GUILD, name: 'Unbekannt', ownerUsername: 'Niemand' }, 'x'),
      'BAD_REQUEST',
    );
    const reader = await userWithRole(ctx, '820000000000000099', 'read_only');
    await expectAppError(
      privateServers.linkGuild(ctx, reader, { guildId: OTHER_GUILD, name: 'X', ownerRobloxId: 1 }, 'x'),
      'FORBIDDEN',
    );
    // Auch der Owner kann aus einem Privatserver-Discord heraus nichts verknüpfen
    const ownerInGuild = { ...admin, guild: { id: PS_GUILD, admin: true, roleIds: [] } } as UserActor;
    await expectAppError(
      privateServers.linkGuild(ctx, ownerInGuild, { guildId: OTHER_GUILD, name: 'X', ownerRobloxId: 1 }, 'x'),
      'FORBIDDEN',
    );

    const list = await privateServers.listLinks(ctx, admin);
    expect(list.items).toEqual([expect.objectContaining({ id: link.id, serversOnline: 1, grantedPeople: 0 })]);
  });
});

describe('Spielrechte und Teamsperre', () => {
  it('Rolle → Recht nur mit verifiziertem Konto; Abgleich ergänzt und entfernt; Heartbeat liefert Rechte', async () => {
    const ctx = createTestContext();
    const { admin, actor, link } = await setup(ctx);
    const psAdmin = await guildActor(ctx, PS_ADMIN, { admin: true });
    await privateServers.updateGuildSettings(ctx, psAdmin, { logChannelId: LOG_CHANNEL });
    await privateServers.setRightRole(ctx, psAdmin, 'polizei', POLICE_ROLE);
    await expectAppError(privateServers.setRightRole(ctx, psAdmin, 'mafia', POLICE_ROLE), 'BAD_REQUEST');
    const member = await guildActor(ctx, PS_MEMBER);
    await expectAppError(privateServers.setRightRole(ctx, member, 'sek', POLICE_ROLE), 'FORBIDDEN');

    await verification.upsertDiscordUser(ctx.db, { id: POLICE_DISCORD, username: 'polizist' });
    await verification.completeVerification(ctx, POLICE_DISCORD, { id: POLICE_ROBLOX, username: 'Polizist' });
    ctx.queue.take();

    const sync = await privateServers.syncGrants(ctx, bot, link.id, {
      full: true,
      members: [
        { discordUserId: POLICE_DISCORD, roleIds: [POLICE_ROLE] },
        { discordUserId: NOACCOUNT_DISCORD, roleIds: [POLICE_ROLE] },
      ],
    });
    expect(sync).toEqual({ added: 1, removed: 0, missingAccount: [NOACCOUNT_DISCORD] });
    const log = ctx.queue.take('message.send');
    expect(log).toHaveLength(1);
    expect(String((log[0]!.data.embed as { description: string }).description)).toContain('kein verifiziertes');

    // Teamsperre aus (Standard): Rechte werden geliefert, aber keine gesperrten Teams
    let hb = await privateHeartbeat(ctx, actor);
    expect(hb.privateServer).toEqual({
      name: 'Bereitschaftspolizei RP',
      teamLock: false,
      teamRights: {},
      fallbackTeam: 'Zivilisten',
      rights: {
        [String(POLICE_ROBLOX)]: ['polizei'],
        [String(OWNER_ROBLOX)]: ['ausbilder', 'flugstaffel', 'polizei', 'sek'],
      },
    });
    // Teamsperre an
    await privateServers.updateGuildSettings(ctx, psAdmin, { teamLock: true });
    hb = await privateHeartbeat(ctx, actor);
    expect(hb.privateServer).toMatchObject({ teamLock: true, teamRights: { Polizei: 'polizei' } });
    // Öffentliche Server: nie Teamsperre
    const pub = await publicHeartbeat(ctx, actor, [POLICE_ROBLOX]);
    expect(pub.privateServer).toBeNull();

    // Rolle weg (Teilabgleich nur für diese Person) → Recht weg
    const partial = await privateServers.syncGrants(ctx, bot, link.id, {
      full: false,
      members: [{ discordUserId: POLICE_DISCORD, roleIds: [] }],
    });
    expect(partial).toMatchObject({ added: 0, removed: 1 });
    hb = await privateHeartbeat(ctx, actor);
    expect(hb.privateServer!.rights[String(POLICE_ROBLOX)]).toBeUndefined();

    // Wieder vergeben, dann Verknüpfung entfernen → alle Rechte weg, Heartbeat ohne Privatserver-Daten
    await privateServers.syncGrants(ctx, bot, link.id, {
      full: true,
      members: [{ discordUserId: POLICE_DISCORD, roleIds: [POLICE_ROLE] }],
    });
    await privateServers.unlinkGuild(ctx, admin, link.id, 'Partnerschaft beendet');
    hb = await privateHeartbeat(ctx, actor);
    expect(hb.privateServer).toBeNull();
    await expectAppError(privateServers.syncGrants(ctx, bot, link.id, { full: true, members: [] }), 'CONFLICT');
    await expectAppError(privateServers.guildStatus(ctx, psAdmin), 'FORBIDDEN');

    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.resourceType, 'private_server_link'));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'private_server.link',
        'private_server.right_role',
        'private_server.rights_sync',
        'private_server.unlink',
      ]),
    );
    // Abgleich nur durch den Bot
    await expectAppError(privateServers.syncGrants(ctx, admin, link.id, { full: true, members: [] }), 'FORBIDDEN');
  });
});

describe('Aktionen des Privatserver-Teams', () => {
  it('nur auf eigenen Privatservern, nie am Besitzer, mit Team-Rolle oder „Server verwalten“', async () => {
    const ctx = createTestContext();
    const { actor, link } = await setup(ctx);
    await publicHeartbeat(ctx, actor, [7001]);
    const psAdmin = await guildActor(ctx, PS_ADMIN, { admin: true });
    const member = await guildActor(ctx, PS_MEMBER);
    const team = await guildActor(ctx, PS_TEAM, { roleIds: [TEAM_ROLE] });

    // Ohne Team-Rolle darf nur „Server verwalten“
    await expectAppError(privateServers.guildAction(ctx, team, GUEST_ROBLOX, { action: 'heal' }, 'Test'), 'FORBIDDEN');
    await privateServers.updateGuildSettings(ctx, psAdmin, { teamRoleId: TEAM_ROLE });
    await expectAppError(privateServers.updateGuildSettings(ctx, team, { teamLock: true }), 'FORBIDDEN');
    await expectAppError(
      privateServers.guildAction(ctx, member, GUEST_ROBLOX, { action: 'heal' }, 'Test'),
      'FORBIDDEN',
    );

    const kicked = await privateServers.guildAction(ctx, team, GUEST_ROBLOX, { action: 'kick' }, 'Trollt');
    expect(kicked.command).toMatchObject({ type: 'kick', robloxUserId: GUEST_ROBLOX });
    const jailed = await privateServers.guildAction(ctx, team, GUEST_ROBLOX, { action: 'jail', minutes: 5 }, 'RP');
    expect(jailed.server.jobId).toBe('job-private');

    await expectAppError(privateServers.guildAction(ctx, team, OWNER_ROBLOX, { action: 'kick' }, 'Nein'), 'FORBIDDEN');
    // Spieler auf einem öffentlichen Server ist tabu
    await expectAppError(privateServers.guildAction(ctx, team, 7001, { action: 'heal' }, 'Fremd'), 'FORBIDDEN');

    const status = await privateServers.guildStatus(ctx, team);
    expect(status.servers.map((s) => s.server.jobId)).toEqual(['job-private']);
    expect(status.servers[0]!.players).toHaveLength(3);
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'ingame.kick'));
    expect(audit[0]?.metadata).toMatchObject({ guildId: PS_GUILD, privateServerLinkId: link.id });

    // Aus einem nicht verknüpften Discord geht nichts
    const stranger = { ...team, guild: { id: OTHER_GUILD, admin: true, roleIds: [] } };
    await expectAppError(privateServers.guildStatus(ctx, stranger), 'FORBIDDEN');
    // Und Rollen aus dem Privatserver-Discord geben keine Plattform-Rechte
    expect(team.subject.grants).toEqual([]);
    expect((await getSetting(ctx.db, 'private_servers')).fallbackTeam).toBe('Zivilisten');
  });

  it('Rechte-Liste und Team-Zuordnung sind einstellbar', async () => {
    const ctx = createTestContext();
    const { admin, actor } = await setup(ctx);
    await updateSetting(
      ctx,
      admin,
      'private_servers',
      {
        rights: ['polizei', 'swat'],
        teamRights: ['Polizei=polizei', 'SWAT Team=swat'],
        fallbackTeam: 'Bürger',
        ownerHasAllRights: false,
      },
      'Anpassung',
    );
    const psAdmin = await guildActor(ctx, PS_ADMIN, { admin: true });
    await privateServers.updateGuildSettings(ctx, psAdmin, { teamLock: true });
    const hb = await privateHeartbeat(ctx, actor);
    expect(hb.privateServer).toMatchObject({
      teamRights: { Polizei: 'polizei', 'SWAT Team': 'swat' },
      fallbackTeam: 'Bürger',
      rights: {},
    });
  });
});
