import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  automations,
  community,
  decideApproval,
  game,
  moderation,
  privacy,
  retention,
  support,
  verification,
  setFlag,
  systemActor,
} from '@enrp/core';
import { discordUsers, eq, moderationActions, robloxUsers, rewardCodes } from '@enrp/database';
import { advance, closeDb, createTestContext, expectAppError, owner, resetDatabase, userWithRole } from './helpers';

const MOD = '600000000000000001';
const MOD2 = '600000000000000002';
const USER = '600000000000000003';
const OTHER = '600000000000000004';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('Moderation', () => {
  it('Schutzregeln, Discord-Ausführung, Fehlerfall und Einsprüche ohne Selbstprüfung', async () => {
    const ctx = createTestContext();
    const mod = await userWithRole(ctx, MOD, 'moderation');
    const mod2 = await userWithRole(ctx, MOD2, 'moderation');
    const user = await userWithRole(ctx, USER);
    ctx.discord.setMember(USER);
    ctx.discord.setMember(MOD2);

    await expectAppError(
      moderation.createModerationAction(ctx, mod, {
        type: 'warn',
        platform: 'discord',
        targetDiscordId: MOD,
        reason: 'selbst',
      }),
      'SELF_ACTION_FORBIDDEN',
    );
    // Teammitglieder sind ohne moderation:approve geschützt.
    await expectAppError(
      moderation.createModerationAction(ctx, mod, {
        type: 'warn',
        platform: 'discord',
        targetDiscordId: MOD2,
        reason: 'Kollege',
      }),
      'FORBIDDEN',
    );
    // Permanente Banns erfordern moderation:approve.
    await expectAppError(
      moderation.createModerationAction(ctx, mod, {
        type: 'ban',
        platform: 'discord',
        targetDiscordId: USER,
        reason: 'perma',
      }),
      'FORBIDDEN',
    );
    await expectAppError(
      moderation.createModerationAction(ctx, mod, {
        type: 'timeout',
        platform: 'discord',
        targetDiscordId: USER,
        reason: 'x',
        durationSeconds: 30 * 86400,
      }),
      'BAD_REQUEST',
    );

    const timeout = await moderation.createModerationAction(ctx, mod, {
      type: 'timeout',
      platform: 'discord',
      targetDiscordId: USER,
      reason: 'Spam',
      durationSeconds: 3600,
    });
    expect(timeout.status).toBe('active');
    expect(ctx.discord.calls.find((c) => c.method === 'timeout')).toBeTruthy();

    ctx.discord.failNext = 'ban';
    const failed = await moderation.createModerationAction(ctx, mod, {
      type: 'ban',
      platform: 'discord',
      targetDiscordId: USER,
      reason: 'Cheats',
      durationSeconds: 86400,
    });
    expect(failed.status).toBe('failed');
    expect(failed.executionError).toContain('Discord-Fehler');

    // Einspruch: nur Betroffene, Prüfung nicht durch den ursprünglichen Moderator.
    await expectAppError(
      moderation.createAppeal(ctx, mod2, { actionId: timeout.id, statement: 'nicht meins' }),
      'FORBIDDEN',
    );
    const appeal = await moderation.createAppeal(ctx, user, {
      actionId: timeout.id,
      statement: 'Das war ein Missverständnis.',
    });
    await expectAppError(
      moderation.createAppeal(ctx, user, { actionId: timeout.id, statement: 'doppelt' }),
      'CONFLICT',
    );
    await expectAppError(
      moderation.decideAppeal(ctx, mod, appeal.id, 'accept', 'eigene Aktion'),
      'SELF_ACTION_FORBIDDEN',
    );
    await moderation.decideAppeal(ctx, mod2, appeal.id, 'accept', 'berechtigt');
    const [revoked] = await ctx.db.select().from(moderationActions).where(eq(moderationActions.id, timeout.id));
    expect(revoked!.status).toBe('revoked');
    expect(ctx.discord.calls.filter((c) => c.method === 'timeout')).toHaveLength(2); // Aufhebung = Timeout entfernen
  });

  it('Roblox-Banns werden vom Spielserver ausgeführt und beim Betreten durchgesetzt', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    await ctx.db.insert(robloxUsers).values({ id: 777, username: 'Cheater' });
    const ban = await moderation.createModerationAction(ctx, admin, {
      type: 'ban',
      platform: 'roblox',
      targetRobloxId: 777,
      reason: 'Exploits',
    });
    expect(ban.status).toBe('pending_execution');
    expect((await game.playerAccess(ctx, 777)).allowed).toBe(false);
    const pending = await moderation.pendingRobloxSanctions(ctx.db);
    expect(pending.map((p) => p.id)).toEqual([ban.id]);
    await moderation.acknowledgeRobloxSanction(ctx, { kind: 'roblox_server', apiKeyId: 'k' }, ban.id, {
      success: true,
    });
    expect(await moderation.pendingRobloxSanctions(ctx.db)).toHaveLength(0);
    await moderation.unbanTarget(ctx, admin, { platform: 'roblox', targetRobloxId: 777, reason: 'Einspruch' });
    expect((await game.playerAccess(ctx, 777)).allowed).toBe(true);
    // Die Entbannung wird ebenfalls an den Spielserver übergeben.
    expect((await moderation.pendingRobloxSanctions(ctx.db)).map((p) => p.type)).toEqual(['unban']);
  });
});

describe('Codes & Rewards', () => {
  it('idempotente Einlösung, Limits und keine doppelten Belohnungen bei parallelen Anfragen', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    const created = await community.createRewardCode(ctx, admin, {
      code: 'SOMMER-2026',
      rewardType: 'cash',
      rewardPayload: { amount: 500 },
      maxRedemptions: 2,
    });
    expect(created.code).toBe('SOMMER-2026');
    // Klartext wird nicht gespeichert.
    const [stored] = await ctx.db.select().from(rewardCodes);
    expect(JSON.stringify(stored)).not.toContain('SOMMER-2026');

    const first = await community.redeemCode(ctx, { code: 'sommer-2026', robloxUserId: 1, idempotencyKey: 'k1' });
    expect(first).toMatchObject({ status: 'redeemed', replayed: false });
    const replay = await community.redeemCode(ctx, { code: 'sommer-2026', robloxUserId: 1, idempotencyKey: 'k1' });
    expect(replay).toMatchObject({ status: 'redeemed', replayed: true });
    expect(
      await community.redeemCode(ctx, { code: 'SOMMER-2026', robloxUserId: 1, idempotencyKey: 'k2' }),
    ).toMatchObject({ reason: 'user_limit' });

    // Parallel: 5 Spieler, nur noch 1 Einlösung frei.
    const results = await Promise.all(
      [2, 3, 4, 5, 6].map((id) =>
        community.redeemCode(ctx, { code: 'SOMMER-2026', robloxUserId: id, idempotencyKey: `p${id}` }),
      ),
    );
    expect(results.filter((r) => r.status === 'redeemed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && r.reason === 'exhausted')).toHaveLength(4);

    expect(await community.redeemCode(ctx, { code: 'GIBTSNICHT', robloxUserId: 1, idempotencyKey: 'x' })).toMatchObject(
      { reason: 'invalid_code' },
    );
    const expiring = await community.createRewardCode(ctx, admin, {
      code: 'KURZ-1',
      rewardType: 'item',
      expiresAt: new Date(ctx.now().getTime() + 60_000),
    });
    advance(ctx, 120_000);
    expect(
      await community.redeemCode(ctx, { code: expiring.code, robloxUserId: 1, idempotencyKey: 'e' }),
    ).toMatchObject({ reason: 'expired' });
    await setFlag(ctx, admin, { key: 'code_redemption', enabled: false, reason: 'Pause' });
    expect(
      await community.redeemCode(ctx, { code: 'SOMMER-2026', robloxUserId: 9, idempotencyKey: 'f' }),
    ).toMatchObject({ reason: 'feature_disabled' });
  });

  it('Umfragen, Vorschläge und Giveaways', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    const user = await userWithRole(ctx, USER);
    const poll = await community.createPoll(ctx, admin, { question: 'Neues Fahrzeug?', options: ['Ja', 'Nein', 'Ja'] });
    expect(poll.options).toHaveLength(2);
    await expectAppError(community.votePoll(ctx, user, poll.id, ['a', 'b']), 'BAD_REQUEST');
    await community.votePoll(ctx, user, poll.id, ['b']);
    const results = await community.votePoll(ctx, user, poll.id, ['a']);
    expect(results.results.map((r) => r.votes)).toEqual([1, 0]);

    const suggestion = await community.createSuggestion(ctx, user, {
      title: 'Mehr Server',
      body: 'Bitte einen zweiten Server.',
    });
    expect(await community.voteSuggestion(ctx, user, suggestion.id, 1)).toEqual({ up: 1, down: 0 });
    await expectAppError(community.setSuggestionStatus(ctx, user, suggestion.id, 'accepted', 'x'), 'FORBIDDEN');
    await community.setSuggestionStatus(ctx, admin, String(suggestion.number), 'accepted', 'Gute Idee');

    const giveaway = await community.createGiveaway(ctx, admin, { prize: 'VIP', winnerCount: 1, durationHours: 1 });
    await expectAppError(community.enterGiveaway(ctx, user, giveaway.id), 'FORBIDDEN'); // nicht verifiziert
    await verification.upsertDiscordUser(ctx.db, { id: USER, username: 'u' });
    await verification.completeVerification(ctx, USER, { id: 42, username: 'User42' });
    expect(await community.enterGiveaway(ctx, user, giveaway.id)).toMatchObject({ entered: true });
    expect(await community.enterGiveaway(ctx, user, giveaway.id)).toMatchObject({ alreadyEntered: true });
    const drawn = await community.drawGiveaway(ctx, systemActor('worker'), giveaway.id);
    expect(drawn.winners).toEqual([USER]);
    await expectAppError(community.drawGiveaway(ctx, systemActor('worker'), giveaway.id), 'INVALID_STATE');
  });
});

describe('Tickets & Reports', () => {
  it('interne Notizen sind nur für Berechtigte sichtbar, Ersteller sehen nur eigene Tickets', async () => {
    const ctx = createTestContext();
    const mod = await userWithRole(ctx, MOD, 'moderation');
    const user = await userWithRole(ctx, USER);
    const other = await userWithRole(ctx, OTHER);
    const ticket = await support.createTicket(ctx, user, {
      subject: 'Hilfe beim Verifizieren',
      body: 'Es klappt nicht.',
    });
    await support.addTicketMessage(ctx, mod, ticket.id, { body: 'Intern: Nutzer bekannt', internal: true });
    await expectAppError(support.addTicketMessage(ctx, user, ticket.id, { body: 'x', internal: true }), 'FORBIDDEN');
    const asUser = await support.getTicketDetail(ctx.db, user, String(ticket.number));
    expect(asUser.events.some((e) => e.internal)).toBe(false);
    const asMod = await support.getTicketDetail(ctx.db, mod, ticket.id);
    expect(asMod.events.some((e) => e.internal)).toBe(true);
    await expectAppError(support.getTicketDetail(ctx.db, other, ticket.id), 'FORBIDDEN');
    expect((await support.listTickets(ctx.db, other, { page: 1, pageSize: 10 })).total).toBe(0);

    await support.updateTicket(ctx, mod, ticket.id, { action: 'claim' });
    await expectAppError(support.updateTicket(ctx, user, ticket.id, { action: 'claim' }), 'FORBIDDEN');
    const closed = await support.updateTicket(ctx, user, ticket.id, { action: 'close', reason: 'Hat sich erledigt' });
    expect(closed.status).toBe('closed');

    const report = await support.createReport(ctx, user, {
      reportedDiscordId: OTHER,
      description: 'Beleidigung im Voice',
      ruleReference: '§2',
    });
    await expectAppError(support.updateReport(ctx, mod, report.id, { status: 'resolved' }), 'BAD_REQUEST');
    const resolved = await support.updateReport(ctx, mod, report.id, {
      status: 'resolved',
      resolution: 'Verwarnung ausgesprochen',
    });
    expect(resolved.status).toBe('resolved');
    await expectAppError(
      support.createCase(ctx, mod, {
        title: 'Fall',
        summary: 'x',
        references: [{ kind: 'url', value: 'http://unsicher.example' }],
      }),
      'BAD_REQUEST',
    );
  });
});

describe('Datenschutz & Aufbewahrung', () => {
  it('Löschung erst nach Vier-Augen-Freigabe, Moderationsdaten bleiben erhalten', async () => {
    const ctx = createTestContext();
    const admin1 = await userWithRole(ctx, MOD, 'owner');
    const admin2 = await userWithRole(ctx, MOD2, 'owner');
    const admin = await owner(ctx);
    await verification.upsertDiscordUser(ctx.db, { id: USER, username: 'loeschmich' });
    await verification.completeVerification(ctx, USER, { id: 4242, username: 'Loesch' });
    await moderation.createModerationAction(ctx, admin, {
      type: 'warn',
      platform: 'discord',
      targetDiscordId: USER,
      reason: 'Regel 1',
    });

    const exported = await privacy.exportSubject(ctx, admin1, { discordUserId: USER, reason: 'Auskunftsersuchen' });
    const data = (await privacy.getPrivacyExport(ctx, admin1, exported.id)) as {
      robloxAccount: unknown[];
      moderationActions: unknown[];
    };
    expect(data.robloxAccount).toHaveLength(1);
    expect(data.moderationActions).toHaveLength(1);

    const { approval, preview } = await privacy.requestDeletion(ctx, admin1, {
      discordUserId: USER,
      reason: 'Löschantrag per Ticket',
    });
    expect(preview).toMatchObject({ accountLinks: 1, robloxAccount: 1 });
    // Bis zur Freigabe ist nichts gelöscht.
    expect(await ctx.db.select().from(discordUsers).where(eq(discordUsers.id, USER))).toHaveLength(1);
    await expectAppError(decideApproval(ctx, admin1, approval.id, 'approve', 'selbst'), 'SELF_ACTION_FORBIDDEN');
    await decideApproval(ctx, admin2, approval.id, 'approve', 'geprüft');
    expect(await ctx.db.select().from(discordUsers).where(eq(discordUsers.id, USER))).toHaveLength(0);
    expect(await ctx.db.select().from(robloxUsers).where(eq(robloxUsers.id, 4242))).toHaveLength(0);
    expect(
      await ctx.db.select().from(moderationActions).where(eq(moderationActions.targetDiscordId, USER)),
    ).toHaveLength(1);

    advance(ctx, 8 * 86400_000);
    const preview2 = await retention.retentionPreview(ctx.db, new Date(Date.now() + 400 * 86400_000));
    expect(preview2.find((p) => p.key === 'privacy_exports')!.rows).toBe(1);
    const applied = await retention.applyRetention({ ...ctx, now: () => new Date(Date.now() + 400 * 86400_000) });
    expect(applied.privacy_exports).toBe(1);
    await expectAppError(privacy.getPrivacyExport(ctx, admin1, exported.id), 'INVALID_STATE');
  });
});

describe('Automatisierungen', () => {
  it('Cooldown verhindert Wiederholung, Vorfälle werden dedupliziert, Tiefe ist begrenzt', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    await automations.createAutomation(
      ctx,
      admin,
      {
        name: 'Backups prüfen',
        trigger: 'backup_failed',
        conditions: { threshold: 2 },
        action: 'create_incident',
        cooldownSeconds: 600,
      },
      'Einrichtung',
    );
    expect(await automations.fireTrigger(ctx, 'backup_failed', { count: 1, summary: 'ein Fehler' })).toEqual([]);
    const first = await automations.fireTrigger(ctx, 'backup_failed', { count: 2, summary: 'zwei Fehler' });
    expect(first[0]!.status).toBe('succeeded');
    const second = await automations.fireTrigger(ctx, 'backup_failed', { count: 3, summary: 'drei Fehler' });
    expect(second[0]!.status).toBe('skipped_cooldown');
    advance(ctx, 11 * 60_000);
    const third = await automations.fireTrigger(ctx, 'backup_failed', { count: 4, summary: 'vier' });
    expect(third[0]).toMatchObject({ status: 'succeeded', details: { deduplicated: true } });
    expect(await automations.fireTrigger(ctx, 'backup_failed', { count: 9, summary: 'tief', depth: 5 })).toEqual([]);
    // Zu kurze Cooldowns werden abgelehnt (Schutz gegen Alarmfluten).
    await expect(
      automations.createAutomation(
        ctx,
        admin,
        { name: 'Zu oft', trigger: 'service_down', action: 'create_incident', cooldownSeconds: 1 },
        'x',
      ),
    ).rejects.toThrow();
  });
});
