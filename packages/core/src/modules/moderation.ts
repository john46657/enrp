import {
  and,
  appeals,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  moderationActions,
  or,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { can } from '@enrp/permissions';
import { AppError, errors, type ModerationType } from '@enrp/shared';
import { type Actor, actorId, hasPermission, requirePermission, requireUser } from '../actor';
import { loadSubject } from '../access';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { assertNotKilled } from '../flags';
import { getSetting } from '../settings';
import { addRecordEvent } from './support';
import { getActiveLinkByDiscord, getActiveLinkByRoblox } from './verification';

/** Discord erlaubt Timeouts von höchstens 28 Tagen. */
export const MAX_DISCORD_TIMEOUT_SECONDS = 28 * 86400;

export interface ModerationInput {
  type: Exclude<ModerationType, 'unban'>;
  platform: 'discord' | 'roblox';
  targetDiscordId?: string | null;
  targetRobloxId?: number | null;
  reason: string;
  durationSeconds?: number | null;
  relatedReportId?: string | null;
}

const LABEL: Record<ModerationType, string> = {
  warn: 'verwarnt',
  timeout: 'getimeoutet',
  kick: 'gekickt',
  ban: 'gebannt',
  unban: 'entbannt',
  note: 'notiert',
};

async function resolveTargets(
  db: DbExecutor,
  input: { targetDiscordId?: string | null; targetRobloxId?: number | null },
) {
  let discordId = input.targetDiscordId ?? null;
  let robloxId = input.targetRobloxId ?? null;
  if (discordId && !robloxId) robloxId = (await getActiveLinkByDiscord(db, discordId))?.link.robloxUserId ?? null;
  if (robloxId && !discordId) discordId = (await getActiveLinkByRoblox(db, robloxId))?.discordUserId ?? null;
  return { discordId, robloxId };
}

/**
 * Schutzregeln: keine Selbstsanktion, Owner sind geschützt, Teammitglieder (mit Moderationsrechten)
 * dürfen nur mit moderation:approve sanktioniert werden, permanente Banns erfordern moderation:approve.
 */
async function assertMayModerate(
  ctx: CoreContext,
  actor: Actor,
  targetDiscordId: string | null,
  type: ModerationType,
  durationSeconds: number | null,
) {
  const user = requireUser(actor);
  if (targetDiscordId === user.discordUserId)
    throw new AppError('SELF_ACTION_FORBIDDEN', 'Du kannst keine Moderationsaktion gegen dich selbst ausführen.');
  if (!targetDiscordId) return;
  if (ctx.config.ownerDiscordIds.includes(targetDiscordId))
    throw errors.forbidden('Owner können nicht sanktioniert werden.');
  if (type === 'note') return;
  let targetRoles: string[] = [];
  if (ctx.discord.configured && ctx.config.guildId) {
    targetRoles = (await ctx.discord.getMember(ctx.config.guildId, targetDiscordId).catch(() => null))?.roleIds ?? [];
  }
  const targetSubject = await loadSubject(ctx.db, ctx.config, targetDiscordId, targetRoles);
  if (can(targetSubject, 'moderation:create') && !hasPermission(actor, 'moderation:approve')) {
    throw errors.forbidden(
      'Teammitglieder mit Moderationsrechten können nur mit „moderation:approve“ sanktioniert werden.',
    );
  }
  if (type === 'ban' && !durationSeconds && !hasPermission(actor, 'moderation:approve')) {
    throw errors.forbidden(
      'Permanente Banns erfordern „moderation:approve“. Gib eine Dauer an oder lass den Bann freigeben.',
    );
  }
}

async function executeDiscord(
  ctx: CoreContext,
  type: ModerationType,
  discordId: string,
  reason: string,
  expiresAt: Date | null,
) {
  const guildId = ctx.config.guildId;
  if (!guildId || !ctx.discord.configured) throw new Error('Discord-Integration nicht konfiguriert');
  const auditReason = reason.slice(0, 400);
  switch (type) {
    case 'timeout':
      return ctx.discord.timeout(guildId, discordId, expiresAt, auditReason);
    case 'kick':
      return ctx.discord.kick(guildId, discordId, auditReason);
    case 'ban':
      return ctx.discord.ban(guildId, discordId, auditReason);
    default:
      return undefined;
  }
}

export async function createModerationAction(ctx: CoreContext, actor: Actor, input: ModerationInput) {
  await assertNotKilled(ctx.db);
  requirePermission(actor, 'moderation:create');
  const now = ctx.now();
  const duration = input.durationSeconds ?? null;
  if (input.type === 'timeout') {
    if (input.platform !== 'discord') throw errors.badRequest('Timeouts gibt es nur auf Discord.');
    if (!duration || duration < 60 || duration > MAX_DISCORD_TIMEOUT_SECONDS)
      throw errors.badRequest('Timeouts müssen zwischen 1 Minute und 28 Tagen dauern.');
  }
  if (duration !== null && duration < 60) throw errors.badRequest('Die Dauer muss mindestens 1 Minute betragen.');
  const targets = await resolveTargets(ctx.db, input);
  if (input.platform === 'discord' && !targets.discordId)
    throw errors.badRequest('Für Discord-Aktionen wird ein Discord-Nutzer benötigt.');
  if (input.platform === 'roblox' && !targets.robloxId)
    throw errors.badRequest('Für Roblox-Aktionen wird ein (verknüpftes) Roblox-Konto benötigt.');
  if (input.platform === 'roblox' && targets.robloxId && actor.kind === 'user') {
    const ownLink = await getActiveLinkByDiscord(ctx.db, actor.discordUserId);
    if (ownLink?.link.robloxUserId === targets.robloxId)
      throw new AppError('SELF_ACTION_FORBIDDEN', 'Du kannst dich nicht selbst sanktionieren.');
  }
  await assertMayModerate(ctx, actor, targets.discordId, input.type, duration);

  const expiresAt = duration ? new Date(now.getTime() + duration * 1000) : null;
  const needsExecution = input.type === 'timeout' || input.type === 'kick' || input.type === 'ban';
  const initialStatus = needsExecution ? 'pending_execution' : 'active';

  const action = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(moderationActions)
      .values({
        type: input.type,
        platform: input.platform,
        targetDiscordId: targets.discordId,
        targetRobloxId: targets.robloxId,
        moderatorId: actorId(actor),
        reason: input.reason,
        expiresAt,
        status: initialStatus,
        relatedReportId: input.relatedReportId ?? null,
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: `moderation.${input.type}`,
        resourceType: 'moderation_action',
        resourceId: row!.id,
        reason: input.reason,
        after: row,
      },
      now,
    );
    if (input.relatedReportId) {
      await addRecordEvent(tx, {
        recordType: 'report',
        recordId: input.relatedReportId,
        type: 'moderation',
        actorId: actorId(actor),
        data: { actionId: row!.id, type: input.type },
        at: now,
      });
    }
    return row!;
  });

  let final = action;
  if (needsExecution && input.platform === 'discord') {
    // DM vor Kick/Bann, danach ist der Nutzer ggf. nicht mehr erreichbar.
    await notifyTarget(ctx, action.targetDiscordId, input.type, input.reason, expiresAt);
    try {
      await executeDiscord(ctx, input.type, targets.discordId!, input.reason, expiresAt);
      [final] = (await ctx.db
        .update(moderationActions)
        .set({ status: input.type === 'kick' ? 'completed' : 'active', executedAt: ctx.now() })
        .where(eq(moderationActions.id, action.id))
        .returning()) as [typeof action];
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      [final] = (await ctx.db
        .update(moderationActions)
        .set({ status: 'failed', executionError: message })
        .where(eq(moderationActions.id, action.id))
        .returning()) as [typeof action];
      ctx.logger.warn({ actionId: action.id, err: message }, 'Discord-Moderationsaktion fehlgeschlagen');
    }
  } else if (input.type === 'warn' || input.type === 'note') {
    if (input.type === 'warn') await notifyTarget(ctx, action.targetDiscordId, 'warn', input.reason, null);
  }
  // Roblox-Aktionen werden von Spielservern abgeholt und mit Players:BanAsync bzw. Kick ausgeführt.
  await logToChannel(ctx, final);
  return final;
}

async function notifyTarget(
  ctx: CoreContext,
  discordId: string | null,
  type: ModerationType,
  reason: string,
  expiresAt: Date | null,
) {
  if (!discordId || !ctx.discord.configured) return;
  await ctx.discord
    .sendDirectMessage(discordId, {
      embed: {
        title: `Du wurdest ${LABEL[type]}`,
        description: `**Grund:** ${reason}${expiresAt ? `\n**Bis:** <t:${Math.floor(expiresAt.getTime() / 1000)}:F>` : ''}\n\nEinspruch ist mit /appeal create möglich.`,
        color: '#dc2626',
      },
    })
    .catch(() => false);
}

async function logToChannel(ctx: CoreContext, action: typeof moderationActions.$inferSelect) {
  const settings = await getSetting(ctx.db, 'notifications');
  if (!settings.moderationLogChannelId) return;
  await ctx.queue.enqueue('discord', 'message.send', {
    channelId: settings.moderationLogChannelId,
    embed: {
      title: `🛡️ ${action.type.toUpperCase()} #${action.number} (${action.platform})`,
      description: `**Ziel:** ${action.targetDiscordId ? `<@${action.targetDiscordId}>` : ''} ${action.targetRobloxId ? `Roblox ${action.targetRobloxId}` : ''}\n**Moderator:** ${/^\d+$/.test(action.moderatorId) ? `<@${action.moderatorId}>` : action.moderatorId}\n**Grund:** ${action.reason}\n**Status:** ${action.status}${action.executionError ? `\n**Fehler:** ${action.executionError}` : ''}`,
      color: action.status === 'failed' ? '#f59e0b' : '#dc2626',
    },
  });
}

export async function getModerationAction(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const [row] = await db
    .select()
    .from(moderationActions)
    .where(isNumber ? eq(moderationActions.number, Number(idOrNumber)) : eq(moderationActions.id, idOrNumber));
  if (!row) throw errors.notFound('Moderationsaktion');
  return row;
}

/** Hebt eine Aktion auf (Unban, Timeout beenden, Verwarnung zurücknehmen). */
export async function revokeModerationAction(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  reason: string,
  opts: { viaAppeal?: string } = {},
) {
  await assertNotKilled(ctx.db);
  const user = requireUser(actor);
  if (!opts.viaAppeal) requirePermission(actor, 'moderation:edit');
  const action = await getModerationAction(ctx.db, idOrNumber);
  if (action.targetDiscordId === user.discordUserId)
    throw new AppError('SELF_ACTION_FORBIDDEN', 'Du kannst Aktionen gegen dich selbst nicht aufheben.');
  if (!['active', 'pending_execution', 'failed'].includes(action.status))
    throw errors.invalidState(`Die Aktion ist bereits ${action.status}.`);
  const now = ctx.now();
  if (action.platform === 'discord' && action.status === 'active' && action.targetDiscordId && ctx.config.guildId) {
    if (action.type === 'ban')
      await ctx.discord.unban(ctx.config.guildId, action.targetDiscordId, reason.slice(0, 400));
    if (action.type === 'timeout')
      await ctx.discord.timeout(ctx.config.guildId, action.targetDiscordId, null, reason.slice(0, 400));
  }
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(moderationActions)
      .set({ status: 'revoked', revokedAt: now, revokedBy: user.discordUserId, revokeReason: reason })
      .where(
        and(
          eq(moderationActions.id, action.id),
          inArray(moderationActions.status, ['active', 'pending_execution', 'failed']),
        ),
      )
      .returning();
    if (!row) throw errors.invalidState('Die Aktion wurde parallel geändert.');
    if (action.type === 'ban') {
      await tx.insert(moderationActions).values({
        type: 'unban',
        platform: action.platform,
        targetDiscordId: action.targetDiscordId,
        targetRobloxId: action.targetRobloxId,
        moderatorId: user.discordUserId,
        reason,
        // Roblox-Entbannungen führt der nächste Spielserver mit Players:UnbanAsync aus.
        status: action.platform === 'roblox' ? 'pending_execution' : 'completed',
        executedAt: action.platform === 'discord' ? now : null,
      });
    }
    await writeAudit(
      tx,
      actor,
      {
        action: 'moderation.revoke',
        resourceType: 'moderation_action',
        resourceId: action.id,
        reason,
        before: { status: action.status },
        after: { status: 'revoked' },
        metadata: opts.viaAppeal ? { appealId: opts.viaAppeal } : null,
      },
      now,
    );
    return row;
  });
}

/** /mod unban: hebt den aktiven Bann einer Person auf. */
export async function unbanTarget(
  ctx: CoreContext,
  actor: Actor,
  input: { platform: 'discord' | 'roblox'; targetDiscordId?: string; targetRobloxId?: number; reason: string },
) {
  requirePermission(actor, 'moderation:edit');
  const targets = await resolveTargets(ctx.db, input);
  const [ban] = await ctx.db
    .select()
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.type, 'ban'),
        eq(moderationActions.platform, input.platform),
        inArray(moderationActions.status, ['active', 'pending_execution']),
        input.platform === 'discord'
          ? eq(moderationActions.targetDiscordId, targets.discordId ?? '')
          : eq(moderationActions.targetRobloxId, targets.robloxId ?? 0),
      ),
    )
    .orderBy(desc(moderationActions.createdAt))
    .limit(1);
  if (!ban) {
    if (input.platform === 'discord' && targets.discordId && ctx.config.guildId && ctx.discord.configured) {
      // Bann außerhalb des Systems (z. B. direkt in Discord) – trotzdem aufheben und protokollieren.
      await ctx.discord.unban(ctx.config.guildId, targets.discordId, input.reason.slice(0, 400));
      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(moderationActions)
          .values({
            type: 'unban',
            platform: 'discord',
            targetDiscordId: targets.discordId,
            moderatorId: actorId(actor),
            reason: input.reason,
            status: 'completed',
            executedAt: ctx.now(),
          })
          .returning();
        await writeAudit(
          tx,
          actor,
          { action: 'moderation.unban', resourceType: 'moderation_action', resourceId: row!.id, reason: input.reason },
          ctx.now(),
        );
        return row!;
      });
    }
    throw errors.notFound('Aktiver Bann');
  }
  return revokeModerationAction(ctx, actor, ban.id, input.reason);
}

export async function listModerationActions(
  db: DbExecutor,
  actor: Actor,
  filter: {
    targetDiscordId?: string;
    targetRobloxId?: number;
    moderatorId?: string;
    type?: string[];
    status?: string[];
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  },
) {
  requirePermission(actor, 'moderation:view');
  const where = and(
    filter.targetDiscordId || filter.targetRobloxId
      ? or(
          filter.targetDiscordId ? eq(moderationActions.targetDiscordId, filter.targetDiscordId) : undefined,
          filter.targetRobloxId ? eq(moderationActions.targetRobloxId, filter.targetRobloxId) : undefined,
        )
      : undefined,
    filter.moderatorId ? eq(moderationActions.moderatorId, filter.moderatorId) : undefined,
    filter.type?.length ? inArray(moderationActions.type, filter.type as never[]) : undefined,
    filter.status?.length ? inArray(moderationActions.status, filter.status as never[]) : undefined,
    filter.from ? sql`${moderationActions.createdAt} >= ${filter.from}` : undefined,
    filter.to ? sql`${moderationActions.createdAt} <= ${filter.to}` : undefined,
  );
  const items = await db
    .select()
    .from(moderationActions)
    .where(where)
    .orderBy(desc(moderationActions.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(moderationActions)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

/** Eigene Moderationshistorie (für /appeal und Profil). */
export async function ownModerationActions(db: DbExecutor, discordUserId: string) {
  return db
    .select()
    .from(moderationActions)
    .where(and(eq(moderationActions.targetDiscordId, discordUserId), sql`${moderationActions.type} <> 'note'`))
    .orderBy(desc(moderationActions.createdAt))
    .limit(25);
}

/** Worker: abgelaufene Timeouts/Banns/Verwarnungen markieren und befristete Discord-Banns aufheben. */
export async function expireModerationActions(ctx: CoreContext): Promise<{ expired: number; failed: number }> {
  const now = ctx.now();
  const due = await ctx.db
    .select()
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.status, 'active'),
        isNotNull(moderationActions.expiresAt),
        lt(moderationActions.expiresAt, now),
      ),
    )
    .limit(100);
  let expired = 0;
  let failed = 0;
  for (const action of due) {
    try {
      if (
        action.type === 'ban' &&
        action.platform === 'discord' &&
        action.targetDiscordId &&
        ctx.config.guildId &&
        ctx.discord.configured
      ) {
        await ctx.discord.unban(ctx.config.guildId, action.targetDiscordId, 'Befristeter Bann abgelaufen');
      }
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(moderationActions)
          .set({ status: 'expired' })
          .where(and(eq(moderationActions.id, action.id), eq(moderationActions.status, 'active')));
        await writeAudit(
          tx,
          { kind: 'system', name: 'worker' },
          { action: 'moderation.expire', resourceType: 'moderation_action', resourceId: action.id },
          now,
        );
      });
      expired++;
    } catch (err) {
      failed++;
      ctx.logger.warn(
        { actionId: action.id, err: (err as Error).message },
        'Ablauf einer Moderationsaktion fehlgeschlagen',
      );
    }
  }
  return { expired, failed };
}

// ---------------------------------------------------------------------------
// Einsprüche
// ---------------------------------------------------------------------------

export async function createAppeal(ctx: CoreContext, actor: Actor, input: { actionId: string; statement: string }) {
  const user = requireUser(actor);
  const action = await getModerationAction(ctx.db, input.actionId);
  if (action.targetDiscordId !== user.discordUserId)
    throw errors.forbidden('Du kannst nur gegen Aktionen Einspruch einlegen, die dich betreffen.');
  if (action.type === 'note' || action.type === 'unban')
    throw errors.badRequest('Gegen diese Aktion ist kein Einspruch möglich.');
  if (action.status === 'revoked') throw errors.invalidState('Die Aktion wurde bereits aufgehoben.');
  const [open] = await ctx.db
    .select()
    .from(appeals)
    .where(and(eq(appeals.actionId, action.id), eq(appeals.status, 'open')));
  if (open) throw errors.conflict('Zu dieser Aktion gibt es bereits einen offenen Einspruch.');
  const [decided] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(appeals)
    .where(eq(appeals.actionId, action.id));
  if ((decided?.count ?? 0) >= 2) throw errors.conflict('Zu dieser Aktion wurden bereits zwei Einsprüche entschieden.');
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(appeals)
      .values({ actionId: action.id, appellantDiscordId: user.discordUserId, statement: input.statement })
      .returning();
    await addRecordEvent(tx, {
      recordType: 'appeal',
      recordId: row!.id,
      type: 'created',
      actorId: user.discordUserId,
      body: input.statement,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      { action: 'appeal.create', resourceType: 'appeal', resourceId: row!.id, metadata: { actionId: action.id } },
      now,
    );
    return row!;
  });
}

/** Einspruch entscheiden. Weder die betroffene Person noch der ursprüngliche Moderator dürfen entscheiden. */
export async function decideAppeal(
  ctx: CoreContext,
  actor: Actor,
  appealId: string,
  decision: 'accept' | 'reject',
  reason: string,
) {
  const user = requireUser(actor);
  requirePermission(actor, 'appeals:approve');
  const [appeal] = await ctx.db.select().from(appeals).where(eq(appeals.id, appealId));
  if (!appeal) throw errors.notFound('Einspruch');
  if (appeal.status !== 'open') throw errors.invalidState('Der Einspruch wurde bereits entschieden.');
  const action = await getModerationAction(ctx.db, appeal.actionId);
  if (appeal.appellantDiscordId === user.discordUserId)
    throw new AppError('SELF_ACTION_FORBIDDEN', 'Du kannst nicht über deinen eigenen Einspruch entscheiden.');
  if (action.moderatorId === user.discordUserId)
    throw new AppError(
      'SELF_ACTION_FORBIDDEN',
      'Über Einsprüche gegen eigene Moderationsaktionen entscheidet eine andere Person.',
    );
  if (decision === 'accept' && ['active', 'pending_execution', 'failed'].includes(action.status)) {
    await revokeModerationAction(ctx, actor, action.id, `Einspruch angenommen: ${reason}`, { viaAppeal: appeal.id });
  }
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(appeals)
      .set({
        status: decision === 'accept' ? 'accepted' : 'rejected',
        reviewerId: user.discordUserId,
        decisionReason: reason,
        decidedAt: now,
      })
      .where(and(eq(appeals.id, appeal.id), eq(appeals.status, 'open')))
      .returning();
    if (!updated) throw errors.invalidState('Der Einspruch wurde parallel entschieden.');
    await addRecordEvent(tx, {
      recordType: 'appeal',
      recordId: appeal.id,
      type: decision,
      actorId: user.discordUserId,
      body: reason,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      { action: `appeal.${decision}`, resourceType: 'appeal', resourceId: appeal.id, reason },
      now,
    );
    return updated;
  });
  if (ctx.discord.configured) {
    await ctx.discord
      .sendDirectMessage(appeal.appellantDiscordId, {
        embed: {
          title: decision === 'accept' ? 'Einspruch angenommen' : 'Einspruch abgelehnt',
          description: `Aktion #${action.number}\n**Begründung:** ${reason}`,
          color: decision === 'accept' ? '#16a34a' : '#dc2626',
        },
      })
      .catch(() => false);
  }
  return row;
}

export async function listAppeals(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string; page: number; pageSize: number },
) {
  requirePermission(actor, 'appeals:view');
  const where = filter.status ? eq(appeals.status, filter.status as never) : undefined;
  const items = await db
    .select({ appeal: appeals, action: moderationActions })
    .from(appeals)
    .innerJoin(moderationActions, eq(moderationActions.id, appeals.actionId))
    .where(where)
    .orderBy(desc(appeals.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appeals)
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

// ---------------------------------------------------------------------------
// Roblox-Ausführung
// ---------------------------------------------------------------------------

/** Ausstehende Roblox-Sanktionen für Spielserver (Bann, Kick, Entbannung). */
export async function pendingRobloxSanctions(db: DbExecutor, limit = 50) {
  return db
    .select({
      id: moderationActions.id,
      number: moderationActions.number,
      type: moderationActions.type,
      robloxUserId: moderationActions.targetRobloxId,
      reason: moderationActions.reason,
      expiresAt: moderationActions.expiresAt,
    })
    .from(moderationActions)
    .where(and(eq(moderationActions.platform, 'roblox'), eq(moderationActions.status, 'pending_execution')))
    .orderBy(moderationActions.createdAt)
    .limit(limit);
}

export async function acknowledgeRobloxSanction(
  ctx: CoreContext,
  actor: Actor,
  actionId: string,
  result: { success: boolean; error?: string },
) {
  const action = await getModerationAction(ctx.db, actionId);
  if (action.platform !== 'roblox' || action.status !== 'pending_execution') return { status: 'ignored' as const };
  const status = !result.success ? 'failed' : action.type === 'ban' ? 'active' : 'completed';
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(moderationActions)
      .set({
        status,
        executedAt: result.success ? ctx.now() : null,
        executionError: result.error?.slice(0, 500) ?? null,
      })
      .where(and(eq(moderationActions.id, action.id), eq(moderationActions.status, 'pending_execution')));
    await writeAudit(
      tx,
      actor,
      { action: 'moderation.roblox_ack', resourceType: 'moderation_action', resourceId: action.id, after: { status } },
      ctx.now(),
    );
  });
  return { status };
}

/** Prüft beim Betreten des Spiels, ob ein aktiver Roblox-Bann besteht. */
export async function activeRobloxBan(db: DbExecutor, robloxUserId: number, now: Date) {
  const [ban] = await db
    .select()
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.platform, 'roblox'),
        eq(moderationActions.type, 'ban'),
        eq(moderationActions.targetRobloxId, robloxUserId),
        inArray(moderationActions.status, ['active', 'pending_execution']),
        sql`(${moderationActions.expiresAt} is null or ${moderationActions.expiresAt} > ${now})`,
      ),
    )
    .limit(1);
  return ban ?? null;
}
