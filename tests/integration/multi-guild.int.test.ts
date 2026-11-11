import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildUserActor,
  game,
  getSetting,
  guilds,
  hasPermission,
  moderation,
  permissionsAdmin,
  updateSetting,
  type RobloxServerActor,
} from '@enrp/core';
import { auditEvents, eq, moderationActions, privateServers } from '@enrp/database';
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
import { botHeaders, createTestApp } from './api-helpers';
import { updateLivePanel } from '@enrp/worker/gamelogs';

const PS_GUILD = '910000000000000001';
const OTHER_GUILD = '910000000000000002';
const MAIN_DISPATCH = '610000000000000001';
const MAIN_MODCALL = '610000000000000002';
const MAIN_JOIN_LOG = '610000000000000003';
const PS_DISPATCH = '620000000000000001';
const PS_PING = '620000000000000002';
const PS_MODCALL = '620000000000000003';
const PS_JOIN_LOG = '620000000000000004';
const PS_MOD = '550000000000000001';
const TARGET = '550000000000000002';
const OWNER_ROBLOX = 5301;

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function serverActor(ctx: TestContext): Promise<RobloxServerActor> {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: `Discords ${++nonce}` }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-guilds-${String(nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  return { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
}

async function setup(ctx: TestContext) {
  const admin = await owner(ctx);
  const server = await serverActor(ctx);
  const players = [{ userId: OWNER_ROBLOX, username: 'Besitzer' }];
  await game.processHeartbeat(ctx, server, {
    jobId: 'job-vip',
    placeId: '1',
    privateServerId: 'vip-guild',
    privateServerOwnerId: OWNER_ROBLOX,
    players,
  });
  await game.processHeartbeat(ctx, server, { jobId: 'job-main', placeId: '1', players: [] });
  const [ps] = await ctx.db.select().from(privateServers);
  await updateSetting(
    ctx,
    admin,
    'dispatch',
    { ...(await getSetting(ctx.db, 'dispatch')), channelId: MAIN_DISPATCH, modCallChannelId: MAIN_MODCALL },
    'Kanäle',
  );
  await updateSetting(
    ctx,
    admin,
    'game_logs',
    { ...(await getSetting(ctx.db, 'game_logs')), joinChannelId: MAIN_JOIN_LOG },
    'Logs',
  );
  await guilds.registerGuild(ctx, { id: PS_GUILD, name: 'VIP-Discord' });
  await guilds.updateGuild(ctx, admin, PS_GUILD, {
    privateServerId: ps!.id,
    syncBans: true,
    channels: {
      dispatchChannelId: PS_DISPATCH,
      dispatchPingRoleId: PS_PING,
      modCallChannelId: PS_MODCALL,
      gameLogs: { joinChannelId: PS_JOIN_LOG },
    },
  });
  return { admin, server, ps: ps! };
}

const call = (id: string) => ({
  id,
  type: 'emergency_call' as const,
  data: { userId: OWNER_ROBLOX, username: 'Besitzer', department: 'polizei', text: 'Hilfe', location: 'Bank' },
});

describe('Mehrere Discord-Server', () => {
  it('Bot meldet weitere Discords; Haupt-Discord wird nicht gespeichert; Einstellungen nur mit settings:edit', async () => {
    const ctx = createTestContext();
    expect(await guilds.registerGuild(ctx, { id: GUILD_ID, name: 'Haupt' })).toEqual({ main: true });
    const reg = await guilds.registerGuild(ctx, { id: OTHER_GUILD, name: 'Partner' });
    expect(reg).toMatchObject({ main: false, guild: { id: OTHER_GUILD, kind: 'other', syncBans: false } });
    await guilds.markGuildLeft(ctx, OTHER_GUILD);
    expect((await guilds.getGuild(ctx.db, OTHER_GUILD)).botPresent).toBe(false);
    await guilds.registerGuild(ctx, { id: OTHER_GUILD, name: 'Partner neu' });
    expect(await guilds.getGuild(ctx.db, OTHER_GUILD)).toMatchObject({ botPresent: true, name: 'Partner neu' });

    const reader = await userWithRole(ctx, '550000000000000009', 'read_only');
    await expectAppError(guilds.updateGuild(ctx, reader, OTHER_GUILD, { syncBans: true }), 'FORBIDDEN');
    const admin = await owner(ctx);
    await expectAppError(guilds.updateGuild(ctx, admin, OTHER_GUILD, { kind: 'private_server' }), 'BAD_REQUEST');
    const updated = await guilds.updateGuild(
      ctx,
      admin,
      OTHER_GUILD,
      { channels: { dispatchChannelId: null, livePanelChannelId: '630000000000000001' } },
      'Panel',
    );
    expect(updated.channels).toEqual({ livePanelChannelId: '630000000000000001' });
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'discord_guild.update'));
    expect(audit.length).toBeGreaterThan(0);
    const list = await guilds.listGuilds(ctx, admin);
    expect(list).toMatchObject({ mainGuildId: GUILD_ID, items: [{ id: OTHER_GUILD }] });
  });

  it('Notrufe, Mod-Calls und Logs eines Privat-Servers gehen in dessen Discord, Hauptspiel bleibt im Haupt-Discord', async () => {
    const ctx = createTestContext();
    const { server, admin, ps } = await setup(ctx);

    await game.processGameEvents(ctx, server, { jobId: 'job-vip', events: [call('call-vip-0000001')] });
    await game.processGameEvents(ctx, server, { jobId: 'job-main', events: [call('call-main-000001')] });
    const posts = ctx.queue.jobs.filter((j) => j.name === 'dispatch.post').map((j) => j.data);
    expect(posts).toEqual([
      expect.objectContaining({ channelId: PS_DISPATCH, pingRoleId: PS_PING }),
      expect.objectContaining({ channelId: MAIN_DISPATCH }),
    ]);

    await game.processGameEvents(ctx, server, {
      jobId: 'job-vip',
      events: [{ id: 'modcall-vip-0001', type: 'mod_call', data: { userId: OWNER_ROBLOX, username: 'B', text: 'x' } }],
    });
    expect(ctx.queue.jobs.find((j) => j.name === 'modcall.post')!.data).toMatchObject({ channelId: PS_MODCALL });

    await game.processGameEvents(ctx, server, {
      jobId: 'job-vip',
      events: [{ id: 'join-vip-000001', type: 'player_joined', data: { userId: 1, username: 'Neu' } }],
    });
    const logChannels = ctx.queue.jobs
      .filter((j) => j.name === 'gamelog.post')
      .map((j) => (j.data as { channelId: string }).channelId)
      .sort();
    expect(logChannels).toEqual([MAIN_JOIN_LOG, PS_JOIN_LOG].sort());

    // Discord deaktiviert → wieder Haupt-Discord
    await guilds.updateGuild(ctx, admin, PS_GUILD, { active: false });
    const target = await guilds.dispatchTarget(ctx, (await guilds.guildForJobId(ctx.db, 'job-vip'))?.id);
    expect(target.channelId).toBe(MAIN_DISPATCH);
    // Ein Privat-Server kann nur einem Discord zugeordnet sein
    await guilds.registerGuild(ctx, { id: OTHER_GUILD, name: 'Zweiter' });
    await expectAppError(guilds.updateGuild(ctx, admin, OTHER_GUILD, { privateServerId: ps.id }), 'CONFLICT');
  });

  it('Rechte gelten je Discord getrennt', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    await guilds.registerGuild(ctx, { id: PS_GUILD, name: 'VIP-Discord' });
    await permissionsAdmin.bindRole(
      ctx,
      admin,
      { roleId: 'moderation', discordUserId: PS_MOD, guildId: PS_GUILD },
      'Moderator im VIP-Discord',
    );
    await expectAppError(
      permissionsAdmin.bindRole(ctx, admin, { roleId: 'moderation', discordUserId: PS_MOD, guildId: OTHER_GUILD }, 'x'),
      'BAD_REQUEST',
    );
    const inGuild = await buildUserActor(ctx.db, ctx.config, {
      discordUserId: PS_MOD,
      roleIds: [],
      via: 'bot',
      guildId: PS_GUILD,
    });
    const inMain = await buildUserActor(ctx.db, ctx.config, { discordUserId: PS_MOD, roleIds: [], via: 'bot' });
    const elsewhere = await buildUserActor(ctx.db, ctx.config, {
      discordUserId: PS_MOD,
      roleIds: [],
      via: 'bot',
      guildId: OTHER_GUILD,
    });
    expect(hasPermission(inGuild, 'moderation:create')).toBe(true);
    expect(hasPermission(inMain, 'moderation:create')).toBe(false);
    expect(hasPermission(elsewhere, 'moderation:create')).toBe(false);
  });

  it('Discord-Banns gelten im eigenen Discord; „global“ auch in Discords mit Banns-Übernahme', async () => {
    const ctx = createTestContext();
    const { admin } = await setup(ctx);
    await guilds.registerGuild(ctx, { id: OTHER_GUILD, name: 'Ohne Übernahme' });
    await permissionsAdmin.bindRole(
      ctx,
      admin,
      { roleId: 'moderation', discordUserId: PS_MOD, guildId: PS_GUILD },
      'x',
    );
    const mod = await buildUserActor(ctx.db, ctx.config, {
      discordUserId: PS_MOD,
      roleIds: [],
      via: 'bot',
      guildId: PS_GUILD,
    });

    const kick = await moderation.createModerationAction(ctx, mod, {
      type: 'kick',
      platform: 'discord',
      targetDiscordId: TARGET,
      reason: 'Spam im VIP-Discord',
    });
    expect(kick).toMatchObject({ status: 'completed', guildId: PS_GUILD, global: false });
    const kicks = ctx.discord.calls.filter((c) => c.method === 'kick');
    expect(kicks.map((c) => c.args[0])).toEqual([PS_GUILD]);

    await expectAppError(
      moderation.createModerationAction(ctx, mod, {
        type: 'ban',
        platform: 'discord',
        targetDiscordId: TARGET,
        reason: 'global versucht',
        durationSeconds: 3600,
        global: true,
      }),
      'FORBIDDEN',
    );
    await expectAppError(
      moderation.createModerationAction(ctx, mod, {
        type: 'warn',
        platform: 'roblox',
        targetRobloxId: 999,
        reason: 'Roblox aus dem VIP-Discord',
      }),
      'FORBIDDEN',
    );

    const ban = await moderation.createModerationAction(ctx, admin, {
      type: 'ban',
      platform: 'discord',
      targetDiscordId: TARGET,
      reason: 'Globaler Bann',
      durationSeconds: 3600,
      global: true,
    });
    expect(ban).toMatchObject({ status: 'active', guildId: null, global: true });
    const bans = ctx.discord.calls.filter((c) => c.method === 'ban').map((c) => c.args[0]);
    expect(bans).toEqual([GUILD_ID, PS_GUILD]);

    await moderation.revokeModerationAction(ctx, admin, String(ban.number), 'Aufgehoben');
    const unbans = ctx.discord.calls.filter((c) => c.method === 'unban').map((c) => c.args[0]);
    expect(unbans).toEqual([GUILD_ID, PS_GUILD]);
    const rows = await ctx.db.select().from(moderationActions).where(eq(moderationActions.type, 'unban'));
    expect(rows[0]).toMatchObject({ global: true });
  });

  it('API: Bot meldet Discords, Kopfzeile x-actor-guild wählt die Rechte, Verwaltung über /discord-guilds', async () => {
    const ctx = createTestContext();
    const { app } = await createTestApp(ctx);
    const service = botHeaders();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/bot/guilds',
      headers: service,
      payload: { id: PS_GUILD, name: 'VIP' },
    });
    expect(reg.statusCode).toBe(200);
    const asUser = await app.inject({
      method: 'POST',
      url: '/api/v1/bot/guilds',
      headers: botHeaders(PS_MOD),
      payload: { id: OTHER_GUILD, name: 'x' },
    });
    expect(asUser.statusCode).toBe(403);

    const admin = await owner(ctx);
    await permissionsAdmin.bindRole(
      ctx,
      admin,
      { roleId: 'moderation', discordUserId: PS_MOD, guildId: PS_GUILD },
      'x',
    );
    const url = '/api/v1/moderation/actions?pageSize=1';
    expect((await app.inject({ url, headers: botHeaders(PS_MOD) })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { ...botHeaders(PS_MOD), 'x-actor-guild': PS_GUILD } })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ url, headers: { ...botHeaders(PS_MOD), 'x-actor-guild': 'kaputt' } })).statusCode).toBe(
      400,
    );

    const list = await app.inject({ url: '/api/v1/discord-guilds', headers: botHeaders('100000000000000001') });
    expect(list.json()).toMatchObject({ items: [{ id: PS_GUILD, name: 'VIP' }] });
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/v1/discord-guilds/${PS_GUILD}`,
      headers: botHeaders('100000000000000001'),
      payload: { channels: { dispatchChannelId: 'kein-kanal' } },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/discord-guilds/${PS_GUILD}`,
      headers: botHeaders('100000000000000001'),
      payload: { syncBans: true, channels: { modCallChannelId: PS_MODCALL } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ syncBans: true, channels: { modCallChannelId: PS_MODCALL } });
    await app.close();
  });

  it('Live-Panel im Discord des Privat-Servers zeigt nur dessen Server', async () => {
    const ctx = createTestContext();
    const { admin } = await setup(ctx);
    await guilds.updateGuild(ctx, admin, PS_GUILD, {
      channels: { livePanelChannelId: '640000000000000001', livePanelShowPlayers: true },
    });
    const result = await updateLivePanel(ctx);
    expect(result.guilds).toEqual({ [PS_GUILD]: 'sent' });
    const sent = ctx.discord.calls.filter((c) => c.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[0]).toBe('640000000000000001');
    const embed = (sent[0]!.args[1] as { embed: { title: string; fields: Array<{ name: string; value: string }> } })
      .embed;
    expect(embed.title).toContain('Privat-Server');
    expect(embed.fields.find((f) => f.name.includes('Server'))?.value).toBe('1');
    // Zweiter Lauf bearbeitet dieselbe Nachricht
    await updateLivePanel(ctx);
    expect(ctx.discord.calls.filter((c) => c.method === 'editMessage')).toHaveLength(1);
  });
});
