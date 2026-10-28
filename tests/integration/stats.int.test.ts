import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { stats, verification } from '@enrp/core';
import { gameServers, moderationActions, playSessions, tickets } from '@enrp/database';
import { closeDb, createTestContext, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const H = 3600_000;

describe('Statistiken', () => {
  it('Spieler pro Stunde, Spitzenzeit, Moderation und Ticket-Bearbeitungszeiten', async () => {
    const ctx = createTestContext();
    const now = ctx.now(); // 2026-06-01T12:00Z (Montag, 14 Uhr deutscher Zeit)
    for (const [id, name] of [
      [1, 'A'],
      [2, 'B'],
    ] as const)
      await verification.upsertRobloxUser(ctx.db, { id, username: name }, now);
    const [server] = await ctx.db.insert(gameServers).values({ jobId: 'j', placeId: '1' }).returning();
    // A spielt 10–12 Uhr UTC, B 11:30 bis jetzt (offen).
    await ctx.db.insert(playSessions).values([
      {
        robloxUserId: 1,
        serverId: server!.id,
        joinedAt: new Date(now.getTime() - 2 * H),
        leftAt: now,
        durationSeconds: 7200,
      },
      { robloxUserId: 2, serverId: server!.id, joinedAt: new Date(now.getTime() - 0.5 * H) },
    ]);
    const activity = await stats.playerActivity(ctx.db, new Date(now.getTime() - 3 * H), now);
    const byHour = Object.fromEntries(activity.hourly.map((h) => [h.hour, h.players]));
    expect(byHour['2026-06-01T09:00:00.000Z']).toBe(0);
    expect(byHour['2026-06-01T10:00:00.000Z']).toBe(1);
    expect(byHour['2026-06-01T11:00:00.000Z']).toBe(2);
    expect(activity.peak).toEqual({ hour: '2026-06-01T11:00:00.000Z', players: 2 });
    expect(activity.peaks).toContainEqual({ weekday: 1, hour: 13, avgPlayers: 2 });
    expect(activity).toMatchObject({ uniquePlayers: 2, sessions: 2, playSeconds: 7200 + 1800 });

    await ctx.db.insert(moderationActions).values([
      { type: 'warn', platform: 'discord', targetDiscordId: '9', moderatorId: 'm', reason: 'x', status: 'active' },
      { type: 'warn', platform: 'discord', targetDiscordId: '9', moderatorId: 'm', reason: 'y', status: 'active' },
      { type: 'ban', platform: 'roblox', moderatorId: 'm', reason: 'z', status: 'active', targetRobloxId: 1 },
    ]);
    const moderation = await stats.moderationCounts(ctx.db, new Date(0));
    expect(moderation).toEqual([
      { type: 'warn', platform: 'discord', count: 2 },
      { type: 'ban', platform: 'roblox', count: 1 },
    ]);

    const since = new Date(now.getTime() - 24 * H);
    await ctx.db.insert(tickets).values([
      {
        subject: 'a',
        creatorDiscordId: '1',
        createdAt: new Date(now.getTime() - 3 * H),
        closedAt: new Date(now.getTime() - 2 * H),
        status: 'closed',
      },
      {
        subject: 'b',
        creatorDiscordId: '1',
        createdAt: new Date(now.getTime() - 4 * H),
        closedAt: new Date(now.getTime() - 1 * H),
        status: 'closed',
      },
      { subject: 'c', creatorDiscordId: '1', createdAt: new Date(now.getTime() - 1 * H) },
    ]);
    expect(await stats.ticketTimes(ctx.db, since)).toEqual({
      opened: 3,
      closed: 2,
      openNow: 1,
      avgCloseSeconds: 7200,
      medianCloseSeconds: 7200,
    });
  });
});
