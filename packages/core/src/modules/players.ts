import {
  accountLinks,
  and,
  desc,
  discordUsers,
  eq,
  factionMemberships,
  factions,
  moderationActions,
  or,
  playSessions,
  profileEvents,
  reports,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, hasPermission, requirePermission } from '../actor';
import { dutyTotals, getActiveDuty } from './duty';
import { getActiveMembership } from './factions';

export type PlayerRef = { discordUserId: string } | { robloxUserId: number };

async function resolveRef(db: DbExecutor, ref: PlayerRef) {
  if ('discordUserId' in ref) {
    const [row] = await db
      .select({ link: accountLinks })
      .from(accountLinks)
      .where(and(eq(accountLinks.discordUserId, ref.discordUserId), eq(accountLinks.status, 'active')));
    return { discordUserId: ref.discordUserId, robloxUserId: row?.link.robloxUserId ?? null, link: row?.link ?? null };
  }
  const [row] = await db
    .select()
    .from(accountLinks)
    .where(and(eq(accountLinks.robloxUserId, ref.robloxUserId), eq(accountLinks.status, 'active')));
  return { discordUserId: row?.discordUserId ?? null, robloxUserId: ref.robloxUserId, link: row ?? null };
}

/**
 * Spielerprofil. Öffentliche Daten (Name, Fraktion, Spiel- und Dienstzeit) sieht jede Person mit players:view
 * sowie die Person selbst; interne Daten (Moderation, Reports, Historie, Discord-ID) nur mit player_private:view.
 */
export async function getPlayerProfile(db: DbExecutor, actor: Actor, ref: PlayerRef, now = new Date()) {
  const resolved = await resolveRef(db, ref);
  const self =
    actor.kind === 'user' && resolved.discordUserId !== null && actor.discordUserId === resolved.discordUserId;
  if (!self) requirePermission(actor, 'players:view');
  const canPrivate = hasPermission(actor, 'player_private:view');

  const [roblox] = resolved.robloxUserId
    ? await db.select().from(robloxUsers).where(eq(robloxUsers.id, resolved.robloxUserId))
    : [];
  const [discord] = resolved.discordUserId
    ? await db.select().from(discordUsers).where(eq(discordUsers.id, resolved.discordUserId))
    : [];
  if (!roblox && !discord) throw errors.notFound('Spieler');

  const membership = roblox ? await getActiveMembership(db, roblox.id) : null;
  const activeDuty = roblox ? await getActiveDuty(db, roblox.id) : null;
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86400_000);
  const duty = roblox
    ? {
        total: await dutyTotals(db, { robloxUserId: roblox.id }),
        week: (await dutyTotals(db, { robloxUserId: roblox.id, since: weekAgo })).totalSeconds,
        month: (await dutyTotals(db, { robloxUserId: roblox.id, since: monthAgo })).totalSeconds,
      }
    : null;
  const [openPlay] = roblox
    ? await db
        .select()
        .from(playSessions)
        .where(and(eq(playSessions.robloxUserId, roblox.id), sql`${playSessions.leftAt} is null`))
    : [];

  const profile = {
    roblox: roblox
      ? { id: roblox.id, username: roblox.username, displayName: roblox.displayName, lastSeenAt: roblox.lastSeenAt }
      : null,
    verified: Boolean(resolved.link),
    verifiedAt: resolved.link?.verifiedAt ?? null,
    faction: membership
      ? {
          key: membership.faction.key,
          name: membership.faction.name,
          color: membership.faction.color,
          since: membership.membership.joinedAt,
        }
      : null,
    playtimeSeconds:
      (roblox?.totalPlaytimeSeconds ?? 0) +
      (openPlay ? Math.max(0, Math.round((now.getTime() - openPlay.joinedAt.getTime()) / 1000)) : 0),
    online: Boolean(openPlay),
    duty: duty && {
      onDuty: activeDuty ? { factionKey: activeDuty.faction.key, since: activeDuty.session.startedAt } : null,
      totalSeconds: duty.total.totalSeconds,
      sessions: duty.total.sessions,
      weekSeconds: duty.week,
      monthSeconds: duty.month,
      perFaction: duty.total.perFaction.map((f) => ({
        factionKey: f.factionKey,
        factionName: f.factionName,
        seconds: f.seconds,
      })),
    },
    discord:
      discord && (canPrivate || self)
        ? { id: discord.id, username: discord.username, globalName: discord.globalName }
        : null,
    private: null as null | Awaited<ReturnType<typeof loadPrivate>>,
    canViewPrivate: canPrivate,
  };
  if (canPrivate) profile.private = await loadPrivate(db, resolved.discordUserId, resolved.robloxUserId);
  return profile;
}

async function loadPrivate(db: DbExecutor, discordUserId: string | null, robloxUserId: number | null) {
  const subjectCondition = or(
    discordUserId ? eq(moderationActions.targetDiscordId, discordUserId) : undefined,
    robloxUserId ? eq(moderationActions.targetRobloxId, robloxUserId) : undefined,
  );
  const moderation = await db
    .select()
    .from(moderationActions)
    .where(subjectCondition)
    .orderBy(desc(moderationActions.createdAt))
    .limit(50);
  const relatedReports = await db
    .select()
    .from(reports)
    .where(
      or(
        discordUserId ? eq(reports.reportedDiscordId, discordUserId) : undefined,
        robloxUserId ? eq(reports.reportedRobloxId, robloxUserId) : undefined,
      ),
    )
    .orderBy(desc(reports.createdAt))
    .limit(50);
  const history = await profileHistory(db, discordUserId, robloxUserId, 50);
  const factionHistory = robloxUserId
    ? await db
        .select({
          factionName: factions.name,
          joinedAt: factionMemberships.joinedAt,
          endedAt: factionMemberships.endedAt,
          endReason: factionMemberships.endReason,
        })
        .from(factionMemberships)
        .innerJoin(factions, eq(factions.id, factionMemberships.factionId))
        .where(eq(factionMemberships.robloxUserId, robloxUserId))
        .orderBy(desc(factionMemberships.joinedAt))
    : [];
  return { moderation, reports: relatedReports, history, factionHistory };
}

export async function profileHistory(
  db: DbExecutor,
  discordUserId: string | null,
  robloxUserId: number | null,
  limit = 100,
) {
  if (!discordUserId && !robloxUserId) return [];
  return db
    .select()
    .from(profileEvents)
    .where(
      or(
        discordUserId ? eq(profileEvents.discordUserId, discordUserId) : undefined,
        robloxUserId ? eq(profileEvents.robloxUserId, robloxUserId) : undefined,
      ),
    )
    .orderBy(desc(profileEvents.createdAt))
    .limit(limit);
}

export async function getProfileHistory(db: DbExecutor, actor: Actor, ref: PlayerRef) {
  const resolved = await resolveRef(db, ref);
  const self = actor.kind === 'user' && actor.discordUserId === resolved.discordUserId;
  if (!self) requirePermission(actor, 'player_private:view');
  return profileHistory(db, resolved.discordUserId, resolved.robloxUserId);
}

export async function searchPlayers(
  db: DbExecutor,
  actor: Actor,
  filter: {
    q?: string;
    factionKey?: string;
    verified?: boolean;
    page: number;
    pageSize: number;
    sort?: 'playtime' | 'name' | 'lastSeen';
  },
) {
  requirePermission(actor, 'players:view');
  const q = filter.q?.trim();
  const where = and(
    q
      ? or(
          sql`${robloxUsers.username} ilike ${`%${q.replace(/[\\%_]/g, '')}%`}`,
          sql`${robloxUsers.displayName} ilike ${`%${q.replace(/[\\%_]/g, '')}%`}`,
          /^\d+$/.test(q) ? sql`${robloxUsers.id}::text = ${q} or ${accountLinks.discordUserId} = ${q}` : undefined,
        )
      : undefined,
    filter.factionKey ? eq(factions.key, filter.factionKey) : undefined,
    filter.verified === true
      ? sql`${accountLinks.id} is not null`
      : filter.verified === false
        ? sql`${accountLinks.id} is null`
        : undefined,
  );
  const order =
    filter.sort === 'name'
      ? robloxUsers.username
      : filter.sort === 'lastSeen'
        ? desc(robloxUsers.lastSeenAt)
        : desc(robloxUsers.totalPlaytimeSeconds);
  const base = () =>
    db
      .select({
        robloxUserId: robloxUsers.id,
        username: robloxUsers.username,
        displayName: robloxUsers.displayName,
        playtimeSeconds: robloxUsers.totalPlaytimeSeconds,
        lastSeenAt: robloxUsers.lastSeenAt,
        verified: sql<boolean>`${accountLinks.id} is not null`,
        discordUserId: accountLinks.discordUserId,
        factionKey: factions.key,
        factionName: factions.name,
      })
      .from(robloxUsers)
      .leftJoin(accountLinks, and(eq(accountLinks.robloxUserId, robloxUsers.id), eq(accountLinks.status, 'active')))
      .leftJoin(
        factionMemberships,
        and(eq(factionMemberships.robloxUserId, robloxUsers.id), eq(factionMemberships.status, 'active')),
      )
      .leftJoin(factions, eq(factions.id, factionMemberships.factionId));
  const items = await base()
    .where(where)
    .orderBy(order)
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(robloxUsers)
    .leftJoin(accountLinks, and(eq(accountLinks.robloxUserId, robloxUsers.id), eq(accountLinks.status, 'active')))
    .leftJoin(
      factionMemberships,
      and(eq(factionMemberships.robloxUserId, robloxUsers.id), eq(factionMemberships.status, 'active')),
    )
    .leftJoin(factions, eq(factions.id, factionMemberships.factionId))
    .where(where);
  const canPrivate = hasPermission(actor, 'player_private:view');
  return {
    items: items.map((i) => ({ ...i, discordUserId: canPrivate ? i.discordUserId : null })),
    total: total?.count ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

/** Öffentliche Rangliste nach Gesamtspielzeit. */
export async function playtimeLeaderboard(db: DbExecutor, limit = 10) {
  const rows = await db
    .select({ robloxUserId: robloxUsers.id, username: robloxUsers.username, seconds: robloxUsers.totalPlaytimeSeconds })
    .from(robloxUsers)
    .where(sql`${robloxUsers.totalPlaytimeSeconds} > 0`)
    .orderBy(desc(robloxUsers.totalPlaytimeSeconds))
    .limit(Math.min(limit, 100));
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

export async function findRobloxUserByName(db: DbExecutor, username: string) {
  const [row] = await db
    .select()
    .from(robloxUsers)
    .where(sql`lower(${robloxUsers.username}) = lower(${username})`);
  return row ?? null;
}
