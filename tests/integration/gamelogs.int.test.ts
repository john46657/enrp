import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { actions, bolo, game, getSetting, updateSetting, type RobloxServerActor } from '@enrp/core';
import { eq, serverCommands } from '@enrp/database';
import { formatLogEntry, gameLogMessage, updateLivePanel } from '@enrp/worker/gamelogs';
import { closeDb, createTestContext, owner, resetDatabase, userWithRole, type TestContext } from './helpers';

const KILLER = 4101;
const VICTIM = 4102;
const OFFICER = 4103;
const CH = {
  kill: '620000000000000001',
  vehicle: '620000000000000002',
  join: '620000000000000003',
  action: '620000000000000004',
  panel: '620000000000000005',
};

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function setup(ctx: TestContext) {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: 'Log-Test' }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-logs-${String(++nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  const actor: RobloxServerActor = { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
  const hb = await game.processHeartbeat(ctx, actor, {
    jobId: 'job-logs',
    placeId: '123',
    teams: ['Polizei', 'Zivilisten'],
    players: [
      { userId: KILLER, username: 'Taeter', team: 'Zivilisten' },
      { userId: VICTIM, username: 'Opfer', team: 'Zivilisten' },
      { userId: OFFICER, username: 'Streife', team: 'Polizei' },
    ],
    vehicles: [{ model: 'Golf', ownerId: KILLER, plate: 'EN-T 1' }],
  });
  return { admin, actor, serverId: hb.serverId };
}

describe('Spiel-Logs nach Discord', () => {
  it('sammelt Ereignisse pro Kanal, ergänzt Namen, ignoriert Duplikate und ausgeschaltete Kategorien', async () => {
    const ctx = createTestContext();
    const { admin, actor } = await setup(ctx);
    // Ohne eingestellte Kanäle: nichts
    await game.processGameEvents(ctx, actor, {
      jobId: 'job-logs',
      events: [{ id: 'evt-log-0001', type: 'player_killed', data: { userId: VICTIM, username: 'Opfer' } }],
    });
    expect(ctx.queue.jobs.filter((j) => j.name === 'gamelog.post')).toHaveLength(0);

    await updateSetting(
      ctx,
      admin,
      'game_logs',
      {
        ...(await getSetting(ctx.db, 'game_logs')),
        killChannelId: CH.kill,
        vehicleChannelId: CH.vehicle,
        joinChannelId: CH.join,
      },
      'Test',
    );
    const batch = {
      jobId: 'job-logs',
      events: [
        {
          id: 'evt-log-0002',
          type: 'player_killed' as const,
          data: { userId: VICTIM, username: 'Opfer', killerId: KILLER, killerName: 'Taeter', weapon: 'Messer' },
        },
        {
          id: 'evt-log-0003',
          type: 'vehicle_spawned' as const,
          data: { model: 'Golf', plate: 'EN-T 1', userId: KILLER, username: 'Taeter' },
        },
        { id: 'evt-log-0004', type: 'player_left' as const, data: { userId: VICTIM } },
        {
          id: 'evt-log-0005',
          type: 'team_changed' as const,
          data: { userId: KILLER, from: 'Zivilisten', to: 'Polizei' },
        },
      ],
    };
    await game.processGameEvents(ctx, actor, batch);
    await game.processGameEvents(ctx, actor, batch); // Wiederholung → keine neuen Logs
    const jobs = ctx.queue.jobs.filter((j) => j.name === 'gamelog.post');
    expect(jobs.map((j) => (j.data as { channelId: string }).channelId).sort()).toEqual(
      [CH.kill, CH.vehicle, CH.join].sort(),
    );
    const join = jobs.find((j) => (j.data as { channelId: string }).channelId === CH.join)!.data as {
      entries: Array<{ type: string; at: string; data: Record<string, unknown> }>;
      server: { jobId: string; serverType: string };
    };
    expect(join.entries[0]!.data.username).toBe('Opfer');
    const kill = jobs.find((j) => (j.data as { channelId: string }).channelId === CH.kill)!.data as typeof join;
    expect(formatLogEntry(kill.entries[0]!)).toBe('💀 **Taeter** hat **Opfer** getötet (Messer)');
    const msg = gameLogMessage(join.server, join.entries);
    expect(msg.embed.description).toContain('hat den Server verlassen');
    expect(msg.embed.footer).toContain('Öffentlich');
  });

  it('Spielertexte werden entschärft (keine Erwähnungen, Links, Formatierung)', () => {
    const line = formatLogEntry({
      type: 'vehicle_spawned',
      at: new Date().toISOString(),
      data: { model: '@everyone **x** https://evil.example', plate: 'A' },
    });
    expect(line).not.toContain('@everyone');
    expect(line).not.toContain('https://');
    expect(line).toContain('\\*\\*x\\*\\*');
  });

  it('Privat-Server-Admins erscheinen mit (entschärftem) Roblox-Namen statt Discord-Erwähnung', () => {
    const line = formatLogEntry({
      type: 'player_action',
      at: new Date().toISOString(),
      data: { action: 'kick', username: 'Ziel', userId: 1, by: 'x', issuerName: '@everyone', reason: 'Test' },
    });
    expect(line).toContain('(Privat-Server)');
    expect(line).not.toContain('@everyone');
    expect(line).not.toContain('<@');
  });

  it('Aktionen an Spielern landen im Aktions-Log', async () => {
    const ctx = createTestContext();
    const { admin } = await setup(ctx);
    await updateSetting(
      ctx,
      admin,
      'game_logs',
      { ...(await getSetting(ctx.db, 'game_logs')), actionChannelId: CH.action },
      'Test',
    );
    const moderator = await userWithRole(ctx, '520000000000000001', 'moderation');
    await actions.createPlayerAction(ctx, moderator, VICTIM, { action: 'jail', minutes: 5, reason: 'Überfall' });
    const job = ctx.queue.jobs.find((j) => j.name === 'gamelog.post')!;
    const entry = (job.data as { entries: Array<{ type: string; at: string; data: Record<string, unknown> }> })
      .entries[0]!;
    expect(formatLogEntry(entry)).toBe(
      '🔒 Gefängnis: **Opfer** · 5 Min. · von <@520000000000000001> · Grund: Überfall',
    );
  });
});

describe('Fahndungsalarm im Spiel', () => {
  it('warnt Spieler der Polizei-Teams auf dem Server, abschaltbar', async () => {
    const ctx = createTestContext();
    const { admin, serverId } = await setup(ctx);
    const dispatcher = await userWithRole(ctx, '520000000000000002', 'dispatch');
    await bolo.createBolo(ctx, dispatcher, { kind: 'vehicle', plate: 'ENT1', reason: 'Gestohlen' });
    const messages = await ctx.db.select().from(serverCommands).where(eq(serverCommands.serverId, serverId));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'message_player', robloxUserId: OFFICER });
    expect(messages[0]!.message).toContain('Kennzeichen ENT1');

    await updateSetting(
      ctx,
      admin,
      'dispatch',
      { ...(await getSetting(ctx.db, 'dispatch')), boloIngameAlert: false },
      'Test',
    );
    await bolo.createBolo(ctx, dispatcher, { kind: 'person', robloxUserId: KILLER, reason: 'Haftbefehl' });
    expect(await ctx.db.select().from(serverCommands).where(eq(serverCommands.serverId, serverId))).toHaveLength(1);
  });
});

describe('Live-Panel', () => {
  it('legt die Nachricht einmal an, bearbeitet sie danach und legt sie bei Fehler neu an', async () => {
    const ctx = createTestContext();
    const { admin } = await setup(ctx);
    expect((await updateLivePanel(ctx)).status).toBe('off');
    await updateSetting(ctx, admin, 'live_panel', { channelId: CH.panel, showPlayers: true }, 'Test');
    expect((await updateLivePanel(ctx)).status).toBe('sent');
    expect((await updateLivePanel(ctx)).status).toBe('edited');
    const sent = ctx.discord.calls.find((c) => c.method === 'sendMessage')!;
    const embed = (sent.args[1] as { embed: { fields: Array<{ name: string; value: string }> } }).embed;
    expect(embed.fields.find((f) => f.name === '👥 Spieler')?.value).toBe('3');
    expect(embed.fields.find((f) => f.name === 'Spieler online')?.value).toContain('Streife');
    ctx.discord.failNext = 'editMessage';
    expect((await updateLivePanel(ctx)).status).toBe('sent');
  });
});
