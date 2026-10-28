import { randomInt } from 'node:crypto';
import {
  and,
  announcements,
  codeRedemptions,
  desc,
  eq,
  giveawayEntries,
  giveaways,
  gt,
  maintenanceWindows,
  pollVotes,
  polls,
  rewardCodes,
  ruleAcceptances,
  ruleSets,
  sql,
  suggestionVotes,
  suggestions,
  type DbExecutor,
} from '@enrp/database';
import { AppError, errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { hmacHex, randomToken } from '../crypto';
import { assertFeature, assertNotKilled, isFlagEnabled } from '../flags';
import { getSetting } from '../settings';
import { getActiveLinkByDiscord } from './verification';

async function assertCommunityWritable(db: DbExecutor) {
  await assertNotKilled(db);
  if (await isFlagEnabled(db, 'maintenance_mode'))
    throw new AppError('SERVICE_UNAVAILABLE', 'Wartungsmodus aktiv – bitte später erneut versuchen.');
}

// ---------------------------------------------------------------------------
// Vorschläge
// ---------------------------------------------------------------------------

export async function createSuggestion(ctx: CoreContext, actor: Actor, input: { title: string; body: string }) {
  const user = requireUser(actor);
  await assertCommunityWritable(ctx.db);
  await assertFeature(ctx.db, 'suggestions');
  const [recent] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.authorDiscordId, user.discordUserId),
        sql`${suggestions.createdAt} > now() - interval '1 day'`,
      ),
    );
  if ((recent?.count ?? 0) >= 3) throw errors.conflict('Du kannst höchstens 3 Vorschläge pro Tag einreichen.');
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(suggestions)
      .values({ authorDiscordId: user.discordUserId, title: input.title, body: input.body })
      .returning();
    await writeAudit(
      tx,
      actor,
      { action: 'suggestion.create', resourceType: 'suggestion', resourceId: created!.id },
      ctx.now(),
    );
    return created!;
  });
  const settings = await getSetting(ctx.db, 'notifications');
  if (settings.suggestionChannelId) {
    await ctx.queue.enqueue('discord', 'suggestion.post', {
      suggestionId: row.id,
      channelId: settings.suggestionChannelId,
    });
  }
  return row;
}

export async function voteSuggestion(ctx: CoreContext, actor: Actor, suggestionId: string, value: 1 | -1 | 0) {
  const user = requireUser(actor);
  await assertCommunityWritable(ctx.db);
  const [s] = await ctx.db.select().from(suggestions).where(eq(suggestions.id, suggestionId));
  if (!s) throw errors.notFound('Vorschlag');
  if (s.status !== 'open' && s.status !== 'under_review')
    throw errors.invalidState('Für diesen Vorschlag kann nicht mehr abgestimmt werden.');
  if (value === 0) {
    await ctx.db
      .delete(suggestionVotes)
      .where(and(eq(suggestionVotes.suggestionId, s.id), eq(suggestionVotes.discordUserId, user.discordUserId)));
  } else {
    await ctx.db
      .insert(suggestionVotes)
      .values({ suggestionId: s.id, discordUserId: user.discordUserId, value })
      .onConflictDoUpdate({ target: [suggestionVotes.suggestionId, suggestionVotes.discordUserId], set: { value } });
  }
  return suggestionTally(ctx.db, s.id);
}

export async function suggestionTally(db: DbExecutor, suggestionId: string) {
  const [row] = await db
    .select({
      up: sql<number>`count(*) filter (where ${suggestionVotes.value} = 1)::int`,
      down: sql<number>`count(*) filter (where ${suggestionVotes.value} = -1)::int`,
    })
    .from(suggestionVotes)
    .where(eq(suggestionVotes.suggestionId, suggestionId));
  return { up: row?.up ?? 0, down: row?.down ?? 0 };
}

export async function setSuggestionStatus(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  status: 'open' | 'under_review' | 'accepted' | 'rejected' | 'implemented',
  reason: string,
) {
  requirePermission(actor, 'community:edit');
  const s = await getSuggestion(ctx.db, idOrNumber);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(suggestions)
      .set({ status, statusReason: reason, statusChangedBy: actorId(actor) })
      .where(eq(suggestions.id, s.id))
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'suggestion.status',
        resourceType: 'suggestion',
        resourceId: s.id,
        reason,
        before: { status: s.status },
        after: { status },
      },
      ctx.now(),
    );
    if (s.discordMessageId) await ctx.queue.enqueue('discord', 'suggestion.refresh', { suggestionId: s.id });
    return row!;
  });
}

export async function getSuggestion(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const [s] = await db
    .select()
    .from(suggestions)
    .where(isNumber ? eq(suggestions.number, Number(idOrNumber)) : eq(suggestions.id, idOrNumber));
  if (!s) throw errors.notFound('Vorschlag');
  return s;
}

export async function listSuggestions(db: DbExecutor, filter: { status?: string; page: number; pageSize: number }) {
  const where = filter.status ? eq(suggestions.status, filter.status as never) : undefined;
  const items = await db
    .select({
      suggestion: suggestions,
      up: sql<number>`(select count(*)::int from suggestion_votes v where v.suggestion_id = ${suggestions.id} and v.value = 1)`,
      down: sql<number>`(select count(*)::int from suggestion_votes v where v.suggestion_id = ${suggestions.id} and v.value = -1)`,
    })
    .from(suggestions)
    .where(where)
    .orderBy(desc(suggestions.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function attachSuggestionMessage(
  db: DbExecutor,
  suggestionId: string,
  channelId: string,
  messageId: string,
) {
  await db
    .update(suggestions)
    .set({ discordChannelId: channelId, discordMessageId: messageId })
    .where(eq(suggestions.id, suggestionId));
}

// ---------------------------------------------------------------------------
// Umfragen
// ---------------------------------------------------------------------------

export async function createPoll(
  ctx: CoreContext,
  actor: Actor,
  input: {
    question: string;
    options: string[];
    multipleChoice?: boolean;
    durationHours?: number;
    channelId?: string | null;
  },
) {
  requirePermission(actor, 'community:create');
  await assertFeature(ctx.db, 'polls');
  const options = [...new Set(input.options.map((o) => o.trim()).filter(Boolean))];
  if (options.length < 2 || options.length > 10)
    throw errors.badRequest('Eine Umfrage braucht 2 bis 10 verschiedene Antworten.');
  const closesAt = input.durationHours ? new Date(ctx.now().getTime() + input.durationHours * 3600_000) : null;
  const poll = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(polls)
      .values({
        question: input.question,
        options: options.map((label, i) => ({ id: String.fromCharCode(97 + i), label })),
        multipleChoice: input.multipleChoice ?? false,
        closesAt,
        discordChannelId: input.channelId ?? null,
        createdBy: actorId(actor),
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'poll.create',
        resourceType: 'poll',
        resourceId: row!.id,
        after: { question: input.question, options },
      },
      ctx.now(),
    );
    return row!;
  });
  if (poll.discordChannelId) await ctx.queue.enqueue('discord', 'poll.post', { pollId: poll.id });
  if (closesAt)
    await ctx.queue.enqueue(
      'maintenance',
      'poll.close',
      { pollId: poll.id },
      { delayMs: closesAt.getTime() - ctx.now().getTime(), jobId: `poll-close-${poll.id}` },
    );
  return poll;
}

export async function votePoll(ctx: CoreContext, actor: Actor, pollId: string, optionIds: string[]) {
  const user = requireUser(actor);
  await assertCommunityWritable(ctx.db);
  const [poll] = await ctx.db.select().from(polls).where(eq(polls.id, pollId));
  if (!poll) throw errors.notFound('Umfrage');
  if (poll.status !== 'open' || (poll.closesAt && poll.closesAt <= ctx.now()))
    throw errors.invalidState('Die Umfrage ist beendet.');
  const valid = new Set(poll.options.map((o) => o.id));
  const unique = [...new Set(optionIds)];
  if (!unique.length || unique.some((id) => !valid.has(id))) throw errors.badRequest('Ungültige Auswahl.');
  if (!poll.multipleChoice && unique.length > 1)
    throw errors.badRequest('Bei dieser Umfrage ist nur eine Antwort möglich.');
  await ctx.db
    .insert(pollVotes)
    .values({ pollId, discordUserId: user.discordUserId, optionIds: unique })
    .onConflictDoUpdate({ target: [pollVotes.pollId, pollVotes.discordUserId], set: { optionIds: unique } });
  return pollResults(ctx.db, pollId);
}

export async function pollResults(db: DbExecutor, pollId: string) {
  const [poll] = await db.select().from(polls).where(eq(polls.id, pollId));
  if (!poll) throw errors.notFound('Umfrage');
  const rows = await db.execute<{ option_id: string; count: number }>(
    sql`select unnest(option_ids) as option_id, count(*)::int as count from poll_votes where poll_id = ${pollId} group by 1`,
  );
  const [voters] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, pollId));
  return {
    poll,
    voters: voters?.count ?? 0,
    results: poll.options.map((o) => ({ ...o, votes: rows.rows.find((r) => r.option_id === o.id)?.count ?? 0 })),
  };
}

export async function closePoll(ctx: CoreContext, actor: Actor, pollId: string) {
  if (actor.kind !== 'system') requirePermission(actor, 'community:edit');
  const [row] = await ctx.db
    .update(polls)
    .set({ status: 'closed', closedAt: ctx.now() })
    .where(and(eq(polls.id, pollId), eq(polls.status, 'open')))
    .returning();
  if (!row) return null;
  await writeAudit(ctx.db, actor, { action: 'poll.close', resourceType: 'poll', resourceId: pollId }, ctx.now());
  if (row.discordMessageId) await ctx.queue.enqueue('discord', 'poll.refresh', { pollId });
  return row;
}

export async function listPolls(db: DbExecutor, filter: { status?: string; page: number; pageSize: number }) {
  const where = filter.status ? eq(polls.status, filter.status as never) : undefined;
  const items = await db
    .select({
      poll: polls,
      voters: sql<number>`(select count(*)::int from poll_votes v where v.poll_id = ${polls.id})`,
    })
    .from(polls)
    .where(where)
    .orderBy(desc(polls.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(polls)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function attachPollMessage(db: DbExecutor, pollId: string, channelId: string, messageId: string) {
  await db.update(polls).set({ discordChannelId: channelId, discordMessageId: messageId }).where(eq(polls.id, pollId));
}

// ---------------------------------------------------------------------------
// Giveaways
// ---------------------------------------------------------------------------

export async function createGiveaway(
  ctx: CoreContext,
  actor: Actor,
  input: {
    prize: string;
    description?: string;
    winnerCount: number;
    durationHours: number;
    requireVerified?: boolean;
    channelId?: string | null;
  },
) {
  requirePermission(actor, 'community:create');
  await assertFeature(ctx.db, 'giveaways');
  if (input.winnerCount < 1 || input.winnerCount > 20) throw errors.badRequest('1 bis 20 Gewinner.');
  if (input.durationHours < 0.1 || input.durationHours > 24 * 30)
    throw errors.badRequest('Dauer zwischen 6 Minuten und 30 Tagen.');
  const endsAt = new Date(ctx.now().getTime() + input.durationHours * 3600_000);
  const row = await ctx.db.transaction(async (tx) => {
    const [g] = await tx
      .insert(giveaways)
      .values({
        prize: input.prize,
        description: input.description ?? '',
        winnerCount: input.winnerCount,
        requireVerified: input.requireVerified ?? true,
        endsAt,
        discordChannelId: input.channelId ?? null,
        createdBy: actorId(actor),
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'giveaway.create',
        resourceType: 'giveaway',
        resourceId: g!.id,
        after: { prize: input.prize, winnerCount: input.winnerCount },
      },
      ctx.now(),
    );
    return g!;
  });
  if (row.discordChannelId) await ctx.queue.enqueue('discord', 'giveaway.post', { giveawayId: row.id });
  await ctx.queue.enqueue(
    'maintenance',
    'giveaway.draw',
    { giveawayId: row.id },
    { delayMs: endsAt.getTime() - ctx.now().getTime(), jobId: `giveaway-draw-${row.id}` },
  );
  return row;
}

export async function enterGiveaway(ctx: CoreContext, actor: Actor, giveawayId: string) {
  const user = requireUser(actor);
  await assertCommunityWritable(ctx.db);
  const [g] = await ctx.db.select().from(giveaways).where(eq(giveaways.id, giveawayId));
  if (!g) throw errors.notFound('Giveaway');
  if (g.status !== 'open' || g.endsAt <= ctx.now()) throw errors.invalidState('Das Giveaway ist beendet.');
  if (g.requireVerified && !(await getActiveLinkByDiscord(ctx.db, user.discordUserId))) {
    throw errors.forbidden('Für dieses Giveaway musst du verifiziert sein (/verify).');
  }
  const inserted = await ctx.db
    .insert(giveawayEntries)
    .values({ giveawayId, discordUserId: user.discordUserId })
    .onConflictDoNothing()
    .returning();
  const [count] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(giveawayEntries)
    .where(eq(giveawayEntries.giveawayId, giveawayId));
  return { entered: inserted.length > 0, alreadyEntered: inserted.length === 0, entries: count?.count ?? 0 };
}

/** Zieht Gewinner mit kryptografisch sicherem Zufall. Kann pro Giveaway nur einmal erfolgen. */
export async function drawGiveaway(ctx: CoreContext, actor: Actor, giveawayId: string) {
  if (actor.kind !== 'system') requirePermission(actor, 'community:edit');
  return ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(giveaways).where(eq(giveaways.id, giveawayId)).for('update');
    if (!g) throw errors.notFound('Giveaway');
    if (g.status !== 'open') throw errors.invalidState('Das Giveaway wurde bereits ausgelost oder abgebrochen.');
    const entries = await tx
      .select({ id: giveawayEntries.discordUserId })
      .from(giveawayEntries)
      .where(eq(giveawayEntries.giveawayId, giveawayId));
    const pool = entries.map((e) => e.id);
    const winners: string[] = [];
    while (winners.length < g.winnerCount && pool.length) {
      winners.push(pool.splice(randomInt(pool.length), 1)[0]!);
    }
    const [row] = await tx
      .update(giveaways)
      .set({ status: 'drawn', drawnAt: ctx.now(), drawnBy: actorId(actor), winners })
      .where(eq(giveaways.id, giveawayId))
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'giveaway.draw',
        resourceType: 'giveaway',
        resourceId: giveawayId,
        after: { winners, entries: entries.length },
      },
      ctx.now(),
    );
    if (g.discordChannelId) await ctx.queue.enqueue('discord', 'giveaway.result', { giveawayId });
    return row!;
  });
}

export async function cancelGiveaway(ctx: CoreContext, actor: Actor, giveawayId: string, reason: string) {
  requirePermission(actor, 'community:edit');
  const [row] = await ctx.db
    .update(giveaways)
    .set({ status: 'cancelled' })
    .where(and(eq(giveaways.id, giveawayId), eq(giveaways.status, 'open')))
    .returning();
  if (!row) throw errors.invalidState('Das Giveaway ist nicht mehr offen.');
  await writeAudit(
    ctx.db,
    actor,
    { action: 'giveaway.cancel', resourceType: 'giveaway', resourceId: giveawayId, reason },
    ctx.now(),
  );
  return row;
}

export async function listGiveaways(db: DbExecutor, filter: { status?: string; page: number; pageSize: number }) {
  const where = filter.status ? eq(giveaways.status, filter.status as never) : undefined;
  const items = await db
    .select({
      giveaway: giveaways,
      entries: sql<number>`(select count(*)::int from giveaway_entries e where e.giveaway_id = ${giveaways.id})`,
    })
    .from(giveaways)
    .where(where)
    .orderBy(desc(giveaways.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(giveaways)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function attachGiveawayMessage(db: DbExecutor, giveawayId: string, channelId: string, messageId: string) {
  await db
    .update(giveaways)
    .set({ discordChannelId: channelId, discordMessageId: messageId })
    .where(eq(giveaways.id, giveawayId));
}

// ---------------------------------------------------------------------------
// Ankündigungen, Changelog, Wartung
// ---------------------------------------------------------------------------

export async function createAnnouncement(
  ctx: CoreContext,
  actor: Actor,
  input: {
    kind?: 'general' | 'changelog' | 'maintenance';
    title: string;
    body: string;
    version?: string | null;
    channelId?: string | null;
    inGame?: boolean;
    publishAt?: Date | null;
  },
) {
  requirePermission(actor, 'announcements:create');
  if (input.publishAt && input.publishAt <= ctx.now())
    throw errors.badRequest('Der Veröffentlichungszeitpunkt muss in der Zukunft liegen.');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(announcements)
      .values({
        kind: input.kind ?? 'general',
        title: input.title,
        body: input.body,
        version: input.version ?? null,
        discordChannelId: input.channelId ?? null,
        inGame: input.inGame ?? false,
        status: input.publishAt ? 'scheduled' : 'draft',
        publishAt: input.publishAt ?? null,
        createdBy: actorId(actor),
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'announcement.create',
        resourceType: 'announcement',
        resourceId: row!.id,
        after: { title: row!.title, kind: row!.kind },
      },
      ctx.now(),
    );
    if (row!.publishAt) {
      await ctx.queue.enqueue(
        'maintenance',
        'announcement.publish',
        { announcementId: row!.id },
        { delayMs: row!.publishAt.getTime() - ctx.now().getTime(), jobId: `announcement-${row!.id}` },
      );
    }
    return row!;
  });
}

/** Veröffentlicht eine Ankündigung in Discord und/oder im Spiel. Idempotent. */
export async function publishAnnouncement(ctx: CoreContext, actor: Actor, id: string) {
  if (actor.kind !== 'system') requirePermission(actor, 'announcements:publish');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(announcements)
      .set({ status: 'published', publishedAt: ctx.now(), publishedBy: actorId(actor) })
      .where(and(eq(announcements.id, id), sql`${announcements.status} <> 'published'`))
      .returning();
    if (!row) {
      const [existing] = await tx.select().from(announcements).where(eq(announcements.id, id));
      if (!existing) throw errors.notFound('Ankündigung');
      return existing;
    }
    await writeAudit(
      tx,
      actor,
      { action: 'announcement.publish', resourceType: 'announcement', resourceId: id },
      ctx.now(),
    );
    const settings = await getSetting(tx, 'notifications');
    const channelId = row.discordChannelId ?? settings.announcementChannelId;
    if (channelId)
      await ctx.queue.enqueue(
        'discord',
        'announcement.post',
        { announcementId: id, channelId },
        { jobId: `announcement-post-${id}` },
      );
    return row;
  });
}

export async function listAnnouncements(
  db: DbExecutor,
  filter: { kind?: string; status?: string; page: number; pageSize: number },
) {
  const where = and(
    filter.kind ? eq(announcements.kind, filter.kind as never) : undefined,
    filter.status ? eq(announcements.status, filter.status as never) : undefined,
  );
  const items = await db
    .select()
    .from(announcements)
    .where(where)
    .orderBy(desc(announcements.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(announcements)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

/** Im Spiel anzuzeigende Ankündigungen (veröffentlicht, nach Zeitpunkt). */
export async function inGameAnnouncements(db: DbExecutor, since: Date) {
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      publishedAt: announcements.publishedAt,
    })
    .from(announcements)
    .where(
      and(eq(announcements.inGame, true), eq(announcements.status, 'published'), gt(announcements.publishedAt, since)),
    )
    .orderBy(announcements.publishedAt)
    .limit(10);
}

export async function scheduleMaintenance(
  ctx: CoreContext,
  actor: Actor,
  input: { title: string; message: string; startsAt: Date; endsAt: Date },
) {
  requirePermission(actor, 'announcements:publish');
  if (input.endsAt <= input.startsAt) throw errors.badRequest('Das Ende muss nach dem Beginn liegen.');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(maintenanceWindows)
      .values({ ...input, createdBy: actorId(actor) })
      .returning();
    await writeAudit(
      tx,
      actor,
      { action: 'maintenance.schedule', resourceType: 'maintenance', resourceId: row!.id, after: row },
      ctx.now(),
    );
    return row!;
  });
}

export async function updateMaintenanceStatus(
  ctx: CoreContext,
  actor: Actor,
  id: string,
  status: 'active' | 'completed' | 'cancelled',
) {
  requirePermission(actor, 'announcements:publish');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(maintenanceWindows).set({ status }).where(eq(maintenanceWindows.id, id)).returning();
    if (!row) throw errors.notFound('Wartungsfenster');
    await writeAudit(
      tx,
      actor,
      { action: `maintenance.${status}`, resourceType: 'maintenance', resourceId: id },
      ctx.now(),
    );
    return row;
  });
}

export async function listMaintenance(db: DbExecutor, limit = 50) {
  return db.select().from(maintenanceWindows).orderBy(desc(maintenanceWindows.startsAt)).limit(limit);
}

export async function currentMaintenance(db: DbExecutor, now: Date) {
  const [row] = await db
    .select()
    .from(maintenanceWindows)
    .where(
      sql`${maintenanceWindows.status} = 'active' or (${maintenanceWindows.status} = 'scheduled' and ${maintenanceWindows.startsAt} <= ${now} and ${maintenanceWindows.endsAt} > ${now})`,
    )
    .limit(1);
  const flag = await isFlagEnabled(db, 'maintenance_mode');
  return { active: flag || Boolean(row), window: row ?? null, flag };
}

// ---------------------------------------------------------------------------
// Regelwerk
// ---------------------------------------------------------------------------

export async function currentRules(db: DbExecutor) {
  const [row] = await db.select().from(ruleSets).where(eq(ruleSets.status, 'published'));
  return row ?? null;
}

export async function listRuleSets(db: DbExecutor) {
  return db.select().from(ruleSets).orderBy(desc(ruleSets.version));
}

export async function createRuleDraft(ctx: CoreContext, actor: Actor, input: { title: string; content: string }) {
  requirePermission(actor, 'rules:edit');
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rule_sets'))`);
    const [last] = await tx
      .select({ version: ruleSets.version })
      .from(ruleSets)
      .orderBy(desc(ruleSets.version))
      .limit(1);
    const [row] = await tx
      .insert(ruleSets)
      .values({
        version: (last?.version ?? 0) + 1,
        title: input.title,
        content: input.content,
        createdBy: actorId(actor),
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      { action: 'rules.draft', resourceType: 'rule_set', resourceId: row!.id, after: { version: row!.version } },
      ctx.now(),
    );
    return row!;
  });
}

/** Veröffentlicht eine Regelwerksversion. Bisherige Zustimmungen gelten nur für ihre Version. */
export async function publishRules(ctx: CoreContext, actor: Actor, id: string) {
  requirePermission(actor, 'rules:publish');
  return ctx.db.transaction(async (tx) => {
    const [draft] = await tx.select().from(ruleSets).where(eq(ruleSets.id, id));
    if (!draft) throw errors.notFound('Regelwerk');
    if (draft.status !== 'draft') throw errors.invalidState('Nur Entwürfe können veröffentlicht werden.');
    await tx.update(ruleSets).set({ status: 'archived' }).where(eq(ruleSets.status, 'published'));
    const [row] = await tx
      .update(ruleSets)
      .set({ status: 'published', publishedAt: ctx.now(), publishedBy: actorId(actor) })
      .where(eq(ruleSets.id, id))
      .returning();
    await writeAudit(
      tx,
      actor,
      { action: 'rules.publish', resourceType: 'rule_set', resourceId: id, after: { version: draft.version } },
      ctx.now(),
    );
    return row!;
  });
}

export async function acceptRules(ctx: CoreContext, actor: Actor) {
  const user = requireUser(actor);
  const rules = await currentRules(ctx.db);
  if (!rules) throw errors.notFound('Veröffentlichtes Regelwerk');
  await ctx.db
    .insert(ruleAcceptances)
    .values({ ruleSetId: rules.id, discordUserId: user.discordUserId })
    .onConflictDoNothing();
  return { version: rules.version };
}

export async function ruleAcceptanceStatus(db: DbExecutor, discordUserId: string) {
  const rules = await currentRules(db);
  if (!rules) return { rules: null, accepted: false };
  const [row] = await db
    .select()
    .from(ruleAcceptances)
    .where(and(eq(ruleAcceptances.ruleSetId, rules.id), eq(ruleAcceptances.discordUserId, discordUserId)));
  return { rules, accepted: Boolean(row), acceptedAt: row?.acceptedAt ?? null };
}

export async function ruleAcceptanceCount(db: DbExecutor, ruleSetId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ruleAcceptances)
    .where(eq(ruleAcceptances.ruleSetId, ruleSetId));
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Codes & Rewards
// ---------------------------------------------------------------------------

const CODE_PATTERN = /^[A-Z0-9-]{4,40}$/;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function hashCode(secret: string, code: string): string {
  return hmacHex(secret, `code:${normalizeCode(code)}`);
}

export async function createRewardCode(
  ctx: CoreContext,
  actor: Actor,
  input: {
    code?: string;
    description?: string;
    rewardType: string;
    rewardPayload?: Record<string, unknown>;
    maxRedemptions?: number | null;
    perUserLimit?: number;
    startsAt?: Date | null;
    expiresAt?: Date | null;
  },
) {
  requirePermission(actor, 'codes:create');
  const code = normalizeCode(
    input.code ??
      `RP-${randomToken(6)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, 'X')}`,
  );
  if (!CODE_PATTERN.test(code)) throw errors.badRequest('Codes bestehen aus 4–40 Zeichen A–Z, 0–9 und Bindestrich.');
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.rewardType))
    throw errors.badRequest('Ungültiger Reward-Typ (z. B. "cash", "item").');
  if (input.expiresAt && input.startsAt && input.expiresAt <= input.startsAt)
    throw errors.badRequest('Ablauf muss nach dem Start liegen.');
  if (input.maxRedemptions !== undefined && input.maxRedemptions !== null && input.maxRedemptions < 1)
    throw errors.badRequest('Maximale Einlösungen muss mindestens 1 sein.');
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rewardCodes)
      .values({
        codeHash: hashCode(ctx.config.hashSecret, code),
        hint: `${code.slice(0, 3)}…${code.slice(-2)}`,
        description: input.description ?? '',
        rewardType: input.rewardType,
        rewardPayload: input.rewardPayload ?? {},
        maxRedemptions: input.maxRedemptions ?? null,
        perUserLimit: input.perUserLimit ?? 1,
        startsAt: input.startsAt ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: actorId(actor),
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw errors.conflict('Dieser Code existiert bereits.');
    await writeAudit(
      tx,
      actor,
      {
        action: 'code.create',
        resourceType: 'reward_code',
        resourceId: created.id,
        after: { hint: created.hint, rewardType: created.rewardType, maxRedemptions: created.maxRedemptions },
      },
      ctx.now(),
    );
    return created;
  });
  // Der Klartext wird nur dieses eine Mal zurückgegeben.
  return { ...row, code };
}

export async function setRewardCodeStatus(
  ctx: CoreContext,
  actor: Actor,
  id: string,
  status: 'active' | 'disabled',
  reason: string,
) {
  requirePermission(actor, 'codes:edit');
  const [row] = await ctx.db.update(rewardCodes).set({ status }).where(eq(rewardCodes.id, id)).returning();
  if (!row) throw errors.notFound('Code');
  await writeAudit(
    ctx.db,
    actor,
    {
      action: `code.${status === 'active' ? 'enable' : 'disable'}`,
      resourceType: 'reward_code',
      resourceId: id,
      reason,
    },
    ctx.now(),
  );
  return row;
}

export async function listRewardCodes(db: DbExecutor, filter: { page: number; pageSize: number }) {
  const items = await db
    .select()
    .from(rewardCodes)
    .orderBy(desc(rewardCodes.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(rewardCodes);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export type RedeemResult =
  | { status: 'redeemed'; redemptionId: string; rewardType: string; rewardPayload: unknown; replayed: boolean }
  | {
      status: 'rejected';
      reason: 'invalid_code' | 'not_started' | 'expired' | 'disabled' | 'exhausted' | 'user_limit' | 'feature_disabled';
    };

/**
 * Löst einen Code für einen Spieler ein. Idempotent über den Idempotenzschlüssel des Spielservers:
 * Wiederholte Anfragen liefern dasselbe Ergebnis, ohne doppelt zu belohnen. Zähler und Limits werden
 * unter Zeilensperre geprüft, damit parallele Einlösungen das Limit nicht überschreiten.
 */
export async function redeemCode(
  ctx: CoreContext,
  input: { code: string; robloxUserId: number; idempotencyKey: string; serverId?: string | null },
): Promise<RedeemResult> {
  if (!(await isFlagEnabled(ctx.db, 'code_redemption')) || (await isFlagEnabled(ctx.db, 'kill_switch'))) {
    return { status: 'rejected', reason: 'feature_disabled' };
  }
  const normalized = normalizeCode(input.code);
  if (!CODE_PATTERN.test(normalized)) return { status: 'rejected', reason: 'invalid_code' };
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(codeRedemptions)
      .where(eq(codeRedemptions.idempotencyKey, input.idempotencyKey));
    if (previous) {
      const [code] = await tx.select().from(rewardCodes).where(eq(rewardCodes.id, previous.codeId));
      if (previous.robloxUserId !== input.robloxUserId || !code)
        return { status: 'rejected', reason: 'invalid_code' } as const;
      return {
        status: 'redeemed',
        redemptionId: previous.id,
        rewardType: code.rewardType,
        rewardPayload: code.rewardPayload,
        replayed: true,
      } as const;
    }
    const [code] = await tx
      .select()
      .from(rewardCodes)
      .where(eq(rewardCodes.codeHash, hashCode(ctx.config.hashSecret, normalized)))
      .for('update');
    if (!code) return { status: 'rejected', reason: 'invalid_code' } as const;
    if (code.status !== 'active') return { status: 'rejected', reason: 'disabled' } as const;
    if (code.startsAt && code.startsAt > now) return { status: 'rejected', reason: 'not_started' } as const;
    if (code.expiresAt && code.expiresAt <= now) return { status: 'rejected', reason: 'expired' } as const;
    if (code.maxRedemptions !== null && code.redemptionCount >= code.maxRedemptions)
      return { status: 'rejected', reason: 'exhausted' } as const;
    const [userCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(codeRedemptions)
      .where(and(eq(codeRedemptions.codeId, code.id), eq(codeRedemptions.robloxUserId, input.robloxUserId)));
    if ((userCount?.count ?? 0) >= code.perUserLimit) return { status: 'rejected', reason: 'user_limit' } as const;
    const [redemption] = await tx
      .insert(codeRedemptions)
      .values({
        codeId: code.id,
        robloxUserId: input.robloxUserId,
        idempotencyKey: input.idempotencyKey,
        serverId: input.serverId ?? null,
        redeemedAt: now,
      })
      .returning();
    await tx
      .update(rewardCodes)
      .set({ redemptionCount: sql`${rewardCodes.redemptionCount} + 1` })
      .where(eq(rewardCodes.id, code.id));
    return {
      status: 'redeemed',
      redemptionId: redemption!.id,
      rewardType: code.rewardType,
      rewardPayload: code.rewardPayload,
      replayed: false,
    } as const;
  });
}

export async function confirmRedemptionDelivered(
  db: DbExecutor,
  redemptionId: string,
  robloxUserId: number,
  now: Date,
) {
  const [row] = await db
    .update(codeRedemptions)
    .set({ deliveredAt: now })
    .where(
      and(
        eq(codeRedemptions.id, redemptionId),
        eq(codeRedemptions.robloxUserId, robloxUserId),
        sql`${codeRedemptions.deliveredAt} is null`,
      ),
    )
    .returning();
  return Boolean(row);
}

export async function communityStats(db: DbExecutor, since: Date) {
  const q = (table: string) => sql.raw(`select count(*)::int as c from ${table} where created_at >= `);
  const one = async (table: string) => {
    const r = await db.execute<{ c: number }>(sql`${q(table)}${since}`);
    return r.rows[0]?.c ?? 0;
  };
  const [redemptions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(codeRedemptions)
    .where(sql`${codeRedemptions.redeemedAt} >= ${since}`);
  const [votes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(sql`${pollVotes.updatedAt} >= ${since}`);
  return {
    suggestions: await one('suggestions'),
    polls: await one('polls'),
    giveaways: await one('giveaways'),
    tickets: await one('tickets'),
    reports: await one('reports'),
    pollVotes: votes?.count ?? 0,
    codeRedemptions: redemptions?.count ?? 0,
  };
}
