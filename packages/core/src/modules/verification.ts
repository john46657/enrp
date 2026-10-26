import {
  accountLinks,
  and,
  desc,
  discordUsers,
  eq,
  gt,
  isNull,
  oauthStates,
  profileEvents,
  robloxUsers,
  sql,
  verifications,
  type DbExecutor,
} from '@enrp/database';
import { AppError, errors } from '@enrp/shared';
import { type Actor, type UserActor, actorId, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { randomToken, safeEqual, sha256Hex } from '../crypto';
import { assertFeature, assertNotKilled } from '../flags';
import { getSetting } from '../settings';
import { isUniqueViolation } from '../util';

export type OAuthPurpose = 'dashboard_login' | 'verify_start' | 'verify_discord' | 'roblox_verify';

const STATE_TTL_MS: Record<OAuthPurpose, number> = {
  dashboard_login: 10 * 60_000,
  verify_start: 15 * 60_000,
  verify_discord: 10 * 60_000,
  roblox_verify: 10 * 60_000,
};

/** Legt einen einmalig verwendbaren OAuth-Zustand an und liefert den Klartext-State. */
export async function createOAuthState(
  db: DbExecutor,
  now: Date,
  input: {
    purpose: OAuthPurpose;
    discordUserId?: string | null;
    codeVerifier?: string;
    nonce?: string | null;
    redirectPath?: string | null;
    browserBinding?: string | null;
  },
): Promise<{ state: string; expiresAt: Date }> {
  const state = randomToken(32);
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS[input.purpose]);
  await db.insert(oauthStates).values({
    stateHash: sha256Hex(state),
    purpose: input.purpose,
    discordUserId: input.discordUserId ?? null,
    codeVerifier: input.codeVerifier ?? '',
    nonce: input.nonce ?? null,
    redirectPath: input.redirectPath ?? null,
    browserBindingHash: input.browserBinding ? sha256Hex(input.browserBinding) : null,
    expiresAt,
  });
  return { state, expiresAt };
}

/**
 * Verbraucht einen OAuth-Zustand atomar (Schutz gegen Replay). Ist der Zustand an einen Browser gebunden,
 * muss das Bindungs-Cookie passen (Schutz gegen CSRF/Login-Fixation).
 */
export async function consumeOAuthState(
  db: DbExecutor,
  now: Date,
  purpose: OAuthPurpose,
  state: string | undefined,
  browserBinding?: string | null,
) {
  if (!state || state.length > 200) throw new AppError('BAD_REQUEST', 'Ungültiger oder fehlender state-Parameter.');
  const [row] = await db
    .update(oauthStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthStates.stateHash, sha256Hex(state)),
        eq(oauthStates.purpose, purpose),
        isNull(oauthStates.consumedAt),
        gt(oauthStates.expiresAt, now),
      ),
    )
    .returning();
  if (!row)
    throw new AppError(
      'GONE',
      'Dieser Link ist abgelaufen oder wurde bereits verwendet. Bitte starte den Vorgang neu.',
    );
  if (row.browserBindingHash) {
    if (!browserBinding || !safeEqual(row.browserBindingHash, sha256Hex(browserBinding))) {
      throw new AppError('CSRF_FAILED', 'Der Vorgang wurde in einem anderen Browser gestartet. Bitte starte ihn neu.');
    }
  }
  return row;
}

export async function upsertDiscordUser(
  db: DbExecutor,
  user: { id: string; username: string; globalName?: string | null; avatarHash?: string | null },
  now = new Date(),
) {
  await db
    .insert(discordUsers)
    .values({
      id: user.id,
      username: user.username,
      globalName: user.globalName ?? null,
      avatarHash: user.avatarHash ?? null,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: discordUsers.id,
      set: {
        username: user.username,
        globalName: user.globalName ?? null,
        avatarHash: user.avatarHash ?? null,
        lastSeenAt: now,
      },
    });
}

/** Legt einen Roblox-Nutzer an oder aktualisiert Namen; Namensänderungen landen in der Profilhistorie. */
export async function upsertRobloxUser(
  db: DbExecutor,
  user: { id: number; username: string; displayName?: string | null; accountCreatedAt?: Date | null },
  now = new Date(),
) {
  const [existing] = await db.select().from(robloxUsers).where(eq(robloxUsers.id, user.id));
  if (!existing) {
    await db
      .insert(robloxUsers)
      .values({
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
        accountCreatedAt: user.accountCreatedAt ?? null,
      })
      .onConflictDoNothing();
    return;
  }
  if (
    existing.username !== user.username ||
    (user.displayName !== undefined && existing.displayName !== user.displayName)
  ) {
    await db
      .update(robloxUsers)
      .set({
        username: user.username,
        displayName: user.displayName ?? existing.displayName,
        accountCreatedAt: user.accountCreatedAt ?? existing.accountCreatedAt,
      })
      .where(eq(robloxUsers.id, user.id));
    if (existing.username !== user.username) {
      await db.insert(profileEvents).values({
        robloxUserId: user.id,
        type: 'roblox.username_changed',
        summary: `Roblox-Name geändert: ${existing.username} → ${user.username}`,
        createdAt: now,
      });
    }
  }
}

export async function getActiveLinkByDiscord(db: DbExecutor, discordUserId: string) {
  const [row] = await db
    .select({ link: accountLinks, roblox: robloxUsers })
    .from(accountLinks)
    .innerJoin(robloxUsers, eq(robloxUsers.id, accountLinks.robloxUserId))
    .where(and(eq(accountLinks.discordUserId, discordUserId), eq(accountLinks.status, 'active')));
  return row ?? null;
}

export async function getActiveLinkByRoblox(db: DbExecutor, robloxUserId: number) {
  const [row] = await db
    .select()
    .from(accountLinks)
    .where(and(eq(accountLinks.robloxUserId, robloxUserId), eq(accountLinks.status, 'active')));
  return row ?? null;
}

/** Zeitpunkt, ab dem eine Person nach dem selbst aufgehobenen Link erneut verifizieren darf. */
async function cooldownUntil(db: DbExecutor, discordUserId: string, hours: number): Promise<Date | null> {
  if (hours <= 0) return null;
  const [last] = await db
    .select({ revokedAt: accountLinks.revokedAt, revokedBy: accountLinks.revokedBy })
    .from(accountLinks)
    .where(and(eq(accountLinks.discordUserId, discordUserId), eq(accountLinks.status, 'revoked')))
    .orderBy(desc(accountLinks.revokedAt))
    .limit(1);
  if (!last?.revokedAt || last.revokedBy !== discordUserId) return null;
  return new Date(last.revokedAt.getTime() + hours * 3600_000);
}

const MAX_STARTS_PER_HOUR = 5;

/** /verify: erzeugt einen persönlichen, kurzlebigen Verifizierungslink. */
export async function startVerification(ctx: CoreContext, actor: Actor) {
  const user = requireUser(actor);
  await assertNotKilled(ctx.db);
  await assertFeature(ctx.db, 'verification');
  const now = ctx.now();
  if (await getActiveLinkByDiscord(ctx.db, user.discordUserId)) {
    throw errors.conflict(
      'Dein Discord-Konto ist bereits verknüpft. Hebe die Verknüpfung zuerst mit /verify unlink auf.',
    );
  }
  const settings = await getSetting(ctx.db, 'verification');
  const until = await cooldownUntil(ctx.db, user.discordUserId, settings.unlinkCooldownHours);
  if (until && until > now) {
    throw new AppError('CONFLICT', `Du kannst dich erst ab ${until.toISOString()} erneut verifizieren.`, {
      until: until.toISOString(),
    });
  }
  const [recent] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(oauthStates)
    .where(
      and(
        eq(oauthStates.discordUserId, user.discordUserId),
        eq(oauthStates.purpose, 'verify_start'),
        gt(oauthStates.createdAt, new Date(now.getTime() - 3600_000)),
      ),
    );
  if ((recent?.count ?? 0) >= MAX_STARTS_PER_HOUR) {
    throw new AppError('RATE_LIMITED', 'Zu viele Verifizierungsversuche. Bitte versuche es in einer Stunde erneut.');
  }
  return createOAuthState(ctx.db, now, { purpose: 'verify_start', discordUserId: user.discordUserId });
}

export interface RobloxIdentity {
  id: number;
  username: string;
  displayName?: string | null;
  accountCreatedAt?: Date | null;
}

const selfActor = (discordUserId: string): UserActor => ({
  kind: 'user',
  discordUserId,
  roleIds: [],
  via: 'dashboard',
  subject: { isOwner: false, grants: [] },
});

/** Schließt die Verifizierung ab: Kontoverknüpfung anlegen und ausschließlich die Rolle „Verifiziert“ anfordern. */
export async function completeVerification(ctx: CoreContext, discordUserId: string, roblox: RobloxIdentity) {
  const now = ctx.now();
  try {
    const link = await ctx.db.transaction(async (tx) => {
      await upsertRobloxUser(tx, roblox, now);
      const existingDiscord = await getActiveLinkByDiscord(tx, discordUserId);
      if (existingDiscord) {
        if (existingDiscord.link.robloxUserId === roblox.id) return existingDiscord.link;
        throw errors.conflict('Dein Discord-Konto ist bereits mit einem anderen Roblox-Konto verknüpft.');
      }
      const existingRoblox = await getActiveLinkByRoblox(tx, roblox.id);
      if (existingRoblox) {
        throw errors.conflict(
          'Dieses Roblox-Konto ist bereits mit einem anderen Discord-Konto verknüpft. Wende dich an das Team.',
        );
      }
      const [created] = await tx
        .insert(accountLinks)
        .values({ discordUserId, robloxUserId: roblox.id, verifiedAt: now })
        .returning();
      await tx
        .insert(verifications)
        .values({ discordUserId, robloxUserId: roblox.id, outcome: 'success', createdAt: now });
      await tx.insert(profileEvents).values({
        discordUserId,
        robloxUserId: roblox.id,
        type: 'link.created',
        summary: `Roblox-Konto ${roblox.username} (${roblox.id}) verknüpft`,
        actorId: discordUserId,
        createdAt: now,
      });
      await writeAudit(
        tx,
        selfActor(discordUserId),
        {
          action: 'verification.link',
          resourceType: 'account_link',
          resourceId: created!.id,
          after: { discordUserId, robloxUserId: roblox.id },
        },
        now,
      );
      return created!;
    });
    const settings = await getSetting(ctx.db, 'verification');
    const roleId = settings.verifiedRoleId ?? ctx.config.verifiedRoleId;
    if (roleId && ctx.config.guildId) {
      await ctx.queue.enqueue(
        'discord',
        'role.add',
        { guildId: ctx.config.guildId, userId: discordUserId, roleId, reason: 'Roblox-Verifizierung' },
        { jobId: `verify-role-${link.id}` },
      );
    }
    return link;
  } catch (err) {
    if (isUniqueViolation(err))
      throw errors.conflict('Das Konto wurde parallel verknüpft. Bitte prüfe /verify status.');
    throw err;
  }
}

export async function recordVerificationFailure(
  db: DbExecutor,
  discordUserId: string,
  reason: string,
  robloxUserId?: number,
) {
  await db
    .insert(verifications)
    .values({
      discordUserId,
      robloxUserId: robloxUserId ?? null,
      outcome: 'failed',
      failureReason: reason.slice(0, 300),
    });
}

export async function verificationStatus(db: DbExecutor, discordUserId: string) {
  const active = await getActiveLinkByDiscord(db, discordUserId);
  const [lastAttempt] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.discordUserId, discordUserId))
    .orderBy(desc(verifications.createdAt))
    .limit(1);
  return {
    verified: Boolean(active),
    roblox: active
      ? { id: active.roblox.id, username: active.roblox.username, displayName: active.roblox.displayName }
      : null,
    verifiedAt: active?.link.verifiedAt ?? null,
    lastAttempt: lastAttempt
      ? { outcome: lastAttempt.outcome, at: lastAttempt.createdAt, reason: lastAttempt.failureReason }
      : null,
  };
}

/**
 * Hebt eine Verknüpfung auf. Eigene Verknüpfung: nur wenn erlaubt, danach gilt eine Wartezeit.
 * Fremde Verknüpfung: nur mit verification:delete und Begründung.
 */
export async function unlinkAccount(ctx: CoreContext, actor: Actor, input: { discordUserId?: string; reason: string }) {
  const user = requireUser(actor);
  await assertNotKilled(ctx.db);
  const target = input.discordUserId ?? user.discordUserId;
  const self = target === user.discordUserId;
  if (self) {
    const settings = await getSetting(ctx.db, 'verification');
    if (!settings.allowSelfUnlink)
      throw errors.forbidden('Das selbstständige Aufheben ist deaktiviert. Bitte eröffne ein Ticket.');
  } else {
    requirePermission(actor, 'verification:delete');
  }
  const now = ctx.now();
  const link = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(accountLinks)
      .set({ status: 'revoked', revokedAt: now, revokedBy: user.discordUserId, revokeReason: input.reason })
      .where(and(eq(accountLinks.discordUserId, target), eq(accountLinks.status, 'active')))
      .returning();
    if (!row) throw errors.notFound('Aktive Kontoverknüpfung');
    await tx.insert(profileEvents).values({
      discordUserId: target,
      robloxUserId: row.robloxUserId,
      type: 'link.revoked',
      summary: self ? 'Verknüpfung selbst aufgehoben' : 'Verknüpfung durch das Team aufgehoben',
      data: input.reason,
      actorId: user.discordUserId,
      createdAt: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: 'verification.unlink',
        resourceType: 'account_link',
        resourceId: row.id,
        reason: input.reason,
        before: { status: 'active' },
        after: { status: 'revoked' },
      },
      now,
    );
    return row;
  });
  const settings = await getSetting(ctx.db, 'verification');
  const roleId = settings.verifiedRoleId ?? ctx.config.verifiedRoleId;
  if (roleId && ctx.config.guildId) {
    await ctx.queue.enqueue('discord', 'role.remove', {
      guildId: ctx.config.guildId,
      userId: target,
      roleId,
      reason: 'Kontoverknüpfung aufgehoben',
    });
  }
  return { link, actorId: actorId(actor) };
}

export async function listLinks(
  db: DbExecutor,
  filter: { status?: 'active' | 'revoked'; page: number; pageSize: number; q?: string },
) {
  const where = and(
    filter.status ? eq(accountLinks.status, filter.status) : undefined,
    filter.q
      ? sql`(${accountLinks.discordUserId} = ${filter.q} or ${robloxUsers.username} ilike ${`%${filter.q.replace(/[\\%_]/g, '')}%`} or ${robloxUsers.id}::text = ${filter.q})`
      : undefined,
  );
  const items = await db
    .select({
      id: accountLinks.id,
      status: accountLinks.status,
      discordUserId: accountLinks.discordUserId,
      discordUsername: discordUsers.username,
      robloxUserId: accountLinks.robloxUserId,
      robloxUsername: robloxUsers.username,
      verifiedAt: accountLinks.verifiedAt,
      revokedAt: accountLinks.revokedAt,
      revokeReason: accountLinks.revokeReason,
    })
    .from(accountLinks)
    .innerJoin(robloxUsers, eq(robloxUsers.id, accountLinks.robloxUserId))
    .leftJoin(discordUsers, eq(discordUsers.id, accountLinks.discordUserId))
    .where(where)
    .orderBy(desc(accountLinks.verifiedAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountLinks)
    .innerJoin(robloxUsers, eq(robloxUsers.id, accountLinks.robloxUserId))
    .where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function listVerificationAttempts(db: DbExecutor, limit = 100) {
  return db.select().from(verifications).orderBy(desc(verifications.createdAt)).limit(limit);
}
