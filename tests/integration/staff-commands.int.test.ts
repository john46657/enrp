import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { actions, game, type RobloxServerActor } from '@enrp/core';
import { accountLinks, auditEvents, discordUsers, eq, robloxUsers } from '@enrp/database';
import { closeDb, createTestContext, owner, resetDatabase, userWithRole, type TestContext } from './helpers';

const MOD_DISCORD = '530000000000000001';
const MOD_ROBLOX = 5101;
const PLAYER_DISCORD = '530000000000000002';
const PLAYER_ROBLOX = 5102;
const TARGET = 5103;

beforeEach(resetDatabase);
afterAll(closeDb);

let nonce = 0;
async function setup(ctx: TestContext) {
  const admin = await owner(ctx);
  const key = await game.createRobloxApiKey(ctx, admin, { name: 'Team-Befehle' }, 'Einrichtung');
  const auth = await game.authenticateRobloxRequest(
    ctx.db,
    {
      bearer: key.key,
      timestamp: String(Math.floor(ctx.now().getTime() / 1000)),
      nonce: `nonce-staff-${String(++nonce).padStart(8, '0')}`,
    },
    ctx.now(),
  );
  const actor: RobloxServerActor = { kind: 'roblox_server', apiKeyId: auth.apiKeyId };
  await game.processHeartbeat(ctx, actor, {
    jobId: 'job-staff',
    placeId: '123',
    players: [
      { userId: MOD_ROBLOX, username: 'Moderator' },
      { userId: PLAYER_ROBLOX, username: 'Normalo' },
      { userId: TARGET, username: 'Ziel' },
    ],
  });
  for (const [discordId, robloxId, name] of [
    [MOD_DISCORD, MOD_ROBLOX, 'mod'],
    [PLAYER_DISCORD, PLAYER_ROBLOX, 'normalo'],
  ] as const) {
    await ctx.db.insert(discordUsers).values({ id: discordId, username: name }).onConflictDoNothing();
    await ctx.db.insert(robloxUsers).values({ id: robloxId, username: name }).onConflictDoNothing();
    await ctx.db.insert(accountLinks).values({ discordUserId: discordId, robloxUserId: robloxId });
  }
  await userWithRole(ctx, MOD_DISCORD, 'moderation');
  return actor;
}

const cmd = (issuerId: number, extra: Record<string, unknown>) =>
  ({ jobId: 'job-staff', issuerId, targetId: TARGET, targetName: 'Ziel', ...extra }) as Parameters<
    typeof actions.staffCommandFromGame
  >[2];

describe('Team-Befehle im Spiel-Chat', () => {
  it('prüft Verknüpfung und Rechte, führt erlaubte Befehle aus und protokolliert sie', async () => {
    const ctx = createTestContext();
    const server = await setup(ctx);

    const unlinked = await actions.staffCommandFromGame(ctx, server, cmd(TARGET, { action: 'heal' }));
    expect(unlinked).toEqual({ ok: false, error: expect.stringContaining('/verify') });

    const forbidden = await actions.staffCommandFromGame(ctx, server, cmd(PLAYER_ROBLOX, { action: 'kick' }));
    expect(forbidden).toEqual({ ok: false, error: 'Dafür fehlt dir die Berechtigung.' });

    const missing = await actions.staffCommandFromGame(ctx, server, cmd(MOD_ROBLOX, { action: 'jail' }));
    expect(missing.ok).toBe(false);

    const jail = await actions.staffCommandFromGame(ctx, server, cmd(MOD_ROBLOX, { action: 'jail', minutes: 3 }));
    expect(jail).toMatchObject({
      ok: true,
      command: { type: 'player_action', action: 'jail', robloxUserId: TARGET, payload: { minutes: 3 } },
    });
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'player_action.jail'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: MOD_DISCORD, reason: 'Team-Befehl im Spiel (jail)' });

    // Unbekannter Server wird abgelehnt
    await expect(
      actions.staffCommandFromGame(ctx, server, { ...cmd(MOD_ROBLOX, { action: 'heal' }), jobId: 'gibtsnicht' }),
    ).rejects.toThrow();
  });

  it('widerrufene Verknüpfung gibt keine Rechte mehr', async () => {
    const ctx = createTestContext();
    const server = await setup(ctx);
    await ctx.db.update(accountLinks).set({ status: 'revoked' }).where(eq(accountLinks.robloxUserId, MOD_ROBLOX));
    const res = await actions.staffCommandFromGame(ctx, server, cmd(MOD_ROBLOX, { action: 'heal' }));
    expect(res.ok).toBe(false);
  });
});
