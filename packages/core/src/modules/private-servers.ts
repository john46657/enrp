import { z } from 'zod';
import {
  accountLinks,
  and,
  eq,
  inArray,
  privateServerGrants,
  privateServerLinks,
  privateServerRightRoles,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, type UserActor, actorId, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting, type SettingValue } from '../settings';
import { playerActionSchema, queuePlayerAction } from './ingame';
import { onlineServers, type LiveServer } from './live';

/**
 * Privatserver-Discords. Der Haupt-Discord (bzw. das Dashboard) verknüpft einen Discord-Server mit dem Roblox-Besitzer
 * von Privatservern. Das Team dieses Discords kann dann
 *  - nur die Privatserver dieses Besitzers sehen und steuern (nie den Besitzer selbst),
 *  - Spielrechte über eigene Discord-Rollen vergeben (verifiziertes Roblox-Konto nötig),
 *  - die Teamsperre für seine Privatserver ein- und ausschalten (Standard: jeder darf in jedes Team).
 * Im Hauptspiel und auf öffentlichen Servern gibt es nie eine Teamsperre.
 *
 * Wer in einem Privatserver-Discord etwas darf, entscheidet dieser Discord selbst: „Server verwalten“ für
 * Einstellungen, zusätzlich die eingestellte Team-Rolle für Aktionen. Der Bot meldet beides (vertrauenswürdig über
 * das Service-Token); Rollen aus diesem Discord zählen nie für Plattform-Rechte.
 */

type Link = typeof privateServerLinks.$inferSelect;
type PrivateSettings = SettingValue<'private_servers'>;

const snowflake = z.string().regex(/^\d{15,22}$/);

export const linkSchema = z
  .object({
    guildId: snowflake,
    name: z.string().trim().min(2).max(60),
    ownerRobloxId: z.number().int().positive().optional(),
    ownerUsername: z.string().trim().min(3).max(20).optional(),
  })
  .refine((v) => v.ownerRobloxId || v.ownerUsername, { message: 'Roblox-ID oder Benutzername des Besitzers angeben.' });

/** „Polizei=polizei“ → { Polizei: 'polizei' } */
export function teamRightsMap(settings: Pick<PrivateSettings, 'teamRights'>): Record<string, string> {
  return Object.fromEntries(
    settings.teamRights.map((entry) => {
      const index = entry.lastIndexOf('=');
      return [entry.slice(0, index).trim(), entry.slice(index + 1).trim()];
    }),
  );
}

export const isOwnPrivateServer = (link: Pick<Link, 'ownerRobloxId'>) => (server: LiveServer) =>
  server.serverType === 'private' && server.privateServerOwnerId === link.ownerRobloxId;

async function getLink(db: DbExecutor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw errors.notFound('Privatserver-Verknüpfung');
  const [row] = await db.select().from(privateServerLinks).where(eq(privateServerLinks.id, id));
  if (!row) throw errors.notFound('Privatserver-Verknüpfung');
  return row;
}

// ---------------------------------------------------------------------------
// Verwaltung durch den Haupt-Discord / das Dashboard
// ---------------------------------------------------------------------------

export async function linkGuild(ctx: CoreContext, actor: Actor, input: z.infer<typeof linkSchema>, reason: string) {
  requirePermission(actor, 'private_servers:edit');
  if (actor.kind === 'user' && actor.guild)
    throw errors.forbidden('Nur der Haupt-Discord kann Privatserver verknüpfen.');
  if (ctx.config.guildId && input.guildId === ctx.config.guildId)
    throw errors.badRequest('Der Haupt-Discord kann kein Privatserver-Discord sein.');
  const [known] = await ctx.db
    .select({ id: robloxUsers.id, username: robloxUsers.username })
    .from(robloxUsers)
    .where(
      input.ownerRobloxId
        ? eq(robloxUsers.id, input.ownerRobloxId)
        : sql`lower(${robloxUsers.username}) = ${input.ownerUsername!.toLowerCase()}`,
    );
  if (!known && !input.ownerRobloxId)
    throw errors.badRequest(
      `Roblox-Konto „${input.ownerUsername}“ ist unbekannt (noch nie im Spiel). Bitte die Roblox-ID angeben.`,
    );
  const ownerRobloxId = known?.id ?? input.ownerRobloxId!;
  const now = ctx.now();
  const link = await ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(privateServerLinks)
      .where(
        and(
          eq(privateServerLinks.active, true),
          sql`(${privateServerLinks.guildId} = ${input.guildId} or ${privateServerLinks.ownerRobloxId} = ${ownerRobloxId})`,
        ),
      );
    if (existing)
      throw errors.conflict(
        existing.guildId === input.guildId
          ? 'Dieser Discord ist bereits als Privatserver-Discord verknüpft.'
          : `Dieser Besitzer ist bereits mit „${existing.name}“ verknüpft.`,
      );
    const [row] = await tx
      .insert(privateServerLinks)
      .values({
        guildId: input.guildId,
        name: input.name,
        ownerRobloxId,
        ownerName: known?.username ?? input.ownerUsername ?? null,
        linkedBy: actorId(actor),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'private_server.link',
        resourceType: 'private_server_link',
        resourceId: row!.id,
        reason,
        after: { guildId: row!.guildId, name: row!.name, ownerRobloxId },
      },
      now,
    );
    return row!;
  });
  ctx.realtime.publish('servers', 'private_server.linked', { id: link.id });
  return link;
}

/** Verknüpfung beenden: alle von diesem Discord vergebenen Spielrechte entfallen sofort. */
export async function unlinkGuild(ctx: CoreContext, actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'private_servers:edit');
  if (actor.kind === 'user' && actor.guild)
    throw errors.forbidden('Nur der Haupt-Discord kann Verknüpfungen entfernen.');
  const link = await getLink(ctx.db, id);
  if (!link.active) throw errors.conflict('Die Verknüpfung ist bereits entfernt.');
  const now = ctx.now();
  const updated = await ctx.db.transaction(async (tx) => {
    const removed = await tx.delete(privateServerGrants).where(eq(privateServerGrants.linkId, link.id)).returning();
    const [row] = await tx
      .update(privateServerLinks)
      .set({ active: false, removedAt: now, removedBy: actorId(actor), updatedAt: now })
      .where(eq(privateServerLinks.id, link.id))
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'private_server.unlink',
        resourceType: 'private_server_link',
        resourceId: link.id,
        reason,
        before: { guildId: link.guildId, grants: removed.length },
        after: { active: false },
      },
      now,
    );
    return row!;
  });
  ctx.realtime.publish('servers', 'private_server.unlinked', { id: link.id });
  return updated;
}

async function rightRolesOf(db: DbExecutor, linkIds: string[]) {
  if (!linkIds.length) return [];
  return db.select().from(privateServerRightRoles).where(inArray(privateServerRightRoles.linkId, linkIds));
}

async function grantsOf(db: DbExecutor, linkId: string) {
  return db
    .select({
      discordUserId: privateServerGrants.discordUserId,
      robloxUserId: privateServerGrants.robloxUserId,
      username: robloxUsers.username,
      right: privateServerGrants.right,
      grantedAt: privateServerGrants.grantedAt,
    })
    .from(privateServerGrants)
    .leftJoin(robloxUsers, eq(robloxUsers.id, privateServerGrants.robloxUserId))
    .where(eq(privateServerGrants.linkId, linkId))
    .orderBy(privateServerGrants.right, robloxUsers.username);
}

/** Laufende Privatserver eines Besitzers mit Spielern. */
async function ownServers(ctx: CoreContext, link: Link) {
  const own = isOwnPrivateServer(link);
  return (await onlineServers(ctx.db, ctx.now()))
    .filter(({ server }) => own(server))
    .map(({ server, live }) => ({ server, players: live.players, teams: live.teams }));
}

export async function listLinks(ctx: CoreContext, actor: Actor, includeRemoved = false) {
  requirePermission(actor, 'private_servers:view');
  const links = await ctx.db
    .select()
    .from(privateServerLinks)
    .where(includeRemoved ? undefined : eq(privateServerLinks.active, true))
    .orderBy(privateServerLinks.name);
  const counts = await ctx.db
    .select({
      linkId: privateServerGrants.linkId,
      n: sql<number>`count(distinct ${privateServerGrants.discordUserId})::int`,
    })
    .from(privateServerGrants)
    .groupBy(privateServerGrants.linkId);
  const online = await onlineServers(ctx.db, ctx.now());
  return {
    items: links.map((link) => ({
      ...link,
      grantedPeople: counts.find((c) => c.linkId === link.id)?.n ?? 0,
      serversOnline: online.filter(({ server }) => isOwnPrivateServer(link)(server)).length,
    })),
  };
}

export async function getLinkDetail(ctx: CoreContext, actor: Actor, id: string) {
  requirePermission(actor, 'private_servers:view');
  const link = await getLink(ctx.db, id);
  return {
    link,
    rightRoles: await rightRolesOf(ctx.db, [link.id]),
    grants: await grantsOf(ctx.db, link.id),
    servers: await ownServers(ctx, link),
  };
}

// ---------------------------------------------------------------------------
// Bot: Registrierung der Befehle und Rollenabgleich
// ---------------------------------------------------------------------------

function requireService(actor: Actor) {
  if (actor.kind !== 'service') throw errors.forbidden('Nur für den Bot.');
}

/** Aktive Verknüpfungen mit Rollen-Zuordnung (für Befehlsregistrierung und Abgleich im Bot). */
export async function botLinks(db: DbExecutor, actor: Actor) {
  requireService(actor);
  const links = await db.select().from(privateServerLinks).where(eq(privateServerLinks.active, true));
  const roles = await rightRolesOf(
    db,
    links.map((l) => l.id),
  );
  return {
    items: links.map((l) => ({
      id: l.id,
      guildId: l.guildId,
      name: l.name,
      teamRoleId: l.teamRoleId,
      rightRoles: roles.filter((r) => r.linkId === l.id).map((r) => ({ right: r.right, roleId: r.discordRoleId })),
    })),
  };
}

export const syncSchema = z.object({
  /** true = vollständige Liste aller Mitglieder mit einer zugeordneten Rolle; sonst nur diese Mitglieder. */
  full: z.boolean(),
  members: z.array(z.object({ discordUserId: snowflake, roleIds: z.array(snowflake).max(250) })).max(25_000),
});

/**
 * Rollenabgleich: berechnet aus den Discord-Rollen die Spielrechte. Nur Personen mit verifiziertem Roblox-Konto
 * bekommen Rechte (sonst Hinweis „ohne Konto“). Änderungen werden protokolliert und – falls eingestellt – im
 * Log-Kanal des Privatserver-Discords gemeldet.
 */
export async function syncGrants(ctx: CoreContext, actor: Actor, linkId: string, input: z.infer<typeof syncSchema>) {
  requireService(actor);
  const link = await getLink(ctx.db, linkId);
  if (!link.active) throw errors.conflict('Die Verknüpfung ist nicht mehr aktiv.');
  const roles = await rightRolesOf(ctx.db, [link.id]);
  const { rights: allowed } = await getSetting(ctx.db, 'private_servers');
  const now = ctx.now();
  const wanted = new Map<string, Set<string>>();
  for (const m of input.members) {
    const rights = new Set(
      roles.filter((r) => m.roleIds.includes(r.discordRoleId) && allowed.includes(r.right)).map((r) => r.right),
    );
    wanted.set(m.discordUserId, rights);
  }
  const ids = [...wanted.keys()];
  const links = ids.length
    ? await ctx.db
        .select({ discordUserId: accountLinks.discordUserId, robloxUserId: accountLinks.robloxUserId })
        .from(accountLinks)
        .where(and(inArray(accountLinks.discordUserId, ids), eq(accountLinks.status, 'active')))
    : [];
  const robloxOf = new Map(links.map((l) => [l.discordUserId, l.robloxUserId]));
  const missingAccount = ids.filter((id) => wanted.get(id)!.size > 0 && !robloxOf.has(id));

  const result = await ctx.db.transaction(async (tx) => {
    const before = await tx
      .select()
      .from(privateServerGrants)
      .where(
        and(
          eq(privateServerGrants.linkId, link.id),
          input.full ? undefined : ids.length ? inArray(privateServerGrants.discordUserId, ids) : sql`false`,
        ),
      );
    const target = ids.flatMap((id) =>
      robloxOf.has(id)
        ? [...wanted.get(id)!].map((right) => ({ discordUserId: id, robloxUserId: robloxOf.get(id)!, right }))
        : [],
    );
    const keyOf = (g: { discordUserId: string; robloxUserId: number; right: string }) =>
      `${g.discordUserId}|${g.robloxUserId}|${g.right}`;
    const beforeKeys = new Set(before.map(keyOf));
    const targetKeys = new Set(target.map(keyOf));
    const added = target.filter((g) => !beforeKeys.has(keyOf(g)));
    const removed = before.filter((g) => !targetKeys.has(keyOf(g)));
    for (const g of removed)
      await tx
        .delete(privateServerGrants)
        .where(
          and(
            eq(privateServerGrants.linkId, link.id),
            eq(privateServerGrants.discordUserId, g.discordUserId),
            eq(privateServerGrants.right, g.right),
          ),
        );
    if (added.length)
      await tx
        .insert(privateServerGrants)
        .values(added.map((g) => ({ linkId: link.id, ...g, grantedAt: now })))
        .onConflictDoUpdate({
          target: [privateServerGrants.linkId, privateServerGrants.discordUserId, privateServerGrants.right],
          set: { robloxUserId: sql`excluded.roblox_user_id`, grantedAt: now },
        });
    if (input.full)
      await tx.update(privateServerLinks).set({ syncedAt: now }).where(eq(privateServerLinks.id, link.id));
    if (added.length || removed.length)
      await writeAudit(
        tx,
        actor,
        {
          action: 'private_server.rights_sync',
          resourceType: 'private_server_link',
          resourceId: link.id,
          after: {
            added: added.map((g) => `${g.robloxUserId}:${g.right}`),
            removed: removed.map((g) => `${g.robloxUserId}:${g.right}`),
          },
        },
        now,
      );
    return { added, removed };
  });

  if (link.logChannelId && (result.added.length || result.removed.length || missingAccount.length)) {
    const lines = [
      ...result.added.map((g) => `➕ <@${g.discordUserId}> → **${g.right}**`),
      ...result.removed.map((g) => `➖ <@${g.discordUserId}> → **${g.right}**`),
      ...missingAccount.map(
        (id) => `⚠️ <@${id}> hat eine Rechte-Rolle, aber kein verifiziertes Roblox-Konto (/verify).`,
      ),
    ];
    await ctx.queue.enqueue('discord', 'message.send', {
      channelId: link.logChannelId,
      embed: { title: '🎮 Spielrechte geändert', description: lines.join('\n').slice(0, 4000), color: '#2563eb' },
    });
  }
  return { added: result.added.length, removed: result.removed.length, missingAccount };
}

/**
 * Für den Heartbeat eines Privatservers: Teamsperre und Spielrechte aller Personen mit Recht (nicht nur der
 * anwesenden – wer zwischen zwei Heartbeats beitritt, hat seine Rechte sofort). Für öffentliche/reservierte oder
 * nicht verknüpfte Server null: dort gibt es nie eine Teamsperre.
 */
export async function heartbeatInfo(
  db: DbExecutor,
  server: { serverType: string; privateServerOwnerId: number | null },
) {
  if (server.serverType !== 'private' || !server.privateServerOwnerId) return null;
  const [link] = await db
    .select()
    .from(privateServerLinks)
    .where(and(eq(privateServerLinks.active, true), eq(privateServerLinks.ownerRobloxId, server.privateServerOwnerId)));
  if (!link) return null;
  const settings = await getSetting(db, 'private_servers');
  const grants = await db
    .select({ robloxUserId: privateServerGrants.robloxUserId, right: privateServerGrants.right })
    .from(privateServerGrants)
    .where(eq(privateServerGrants.linkId, link.id))
    .limit(5000);
  const rights: Record<string, string[]> = {};
  for (const g of grants) {
    if (!settings.rights.includes(g.right)) continue;
    (rights[String(g.robloxUserId)] ??= []).push(g.right);
  }
  if (settings.ownerHasAllRights) rights[String(link.ownerRobloxId)] = [...settings.rights];
  for (const key of Object.keys(rights)) rights[key] = [...new Set(rights[key])].sort();
  return {
    name: link.name,
    teamLock: link.teamLock,
    teamRights: link.teamLock ? teamRightsMap(settings) : {},
    fallbackTeam: settings.fallbackTeam,
    rights,
  };
}

// ---------------------------------------------------------------------------
// Befehle im Privatserver-Discord (/ps)
// ---------------------------------------------------------------------------

/** Verknüpfung des Discords, aus dem die Person handelt. */
export async function linkForActor(db: DbExecutor, actor: Actor) {
  const user = requireUser(actor);
  if (!user.guild) throw errors.forbidden('Dieser Befehl ist nur in Privatserver-Discords verfügbar.');
  const [link] = await db
    .select()
    .from(privateServerLinks)
    .where(and(eq(privateServerLinks.active, true), eq(privateServerLinks.guildId, user.guild.id)));
  if (!link)
    throw errors.forbidden('Dieser Discord ist nicht als Privatserver-Discord verknüpft. Das macht der Haupt-Discord.');
  return { link, user: user as UserActor & { guild: NonNullable<UserActor['guild']> } };
}

function requireGuildAdmin(user: { guild: { admin: boolean } }) {
  if (!user.guild.admin) throw errors.forbidden('Dafür brauchst du in diesem Discord „Server verwalten“.');
}

function requireGuildTeam(user: { guild: { admin: boolean; roleIds: string[] } }, link: Link) {
  if (user.guild.admin) return;
  if (link.teamRoleId && user.guild.roleIds.includes(link.teamRoleId)) return;
  throw errors.forbidden(
    link.teamRoleId
      ? `Dafür brauchst du die Team-Rolle <@&${link.teamRoleId}> oder „Server verwalten“.`
      : 'Dafür brauchst du „Server verwalten“ (oder eine Team-Rolle, die mit /ps teamrolle eingestellt wird).',
  );
}

async function guildLog(ctx: CoreContext, link: Link, text: string) {
  if (link.logChannelId)
    await ctx.queue.enqueue('discord', 'message.send', { channelId: link.logChannelId, content: text.slice(0, 1900) });
}

export async function guildStatus(ctx: CoreContext, actor: Actor) {
  const { link, user } = await linkForActor(ctx.db, actor);
  requireGuildTeam(user, link);
  const settings = await getSetting(ctx.db, 'private_servers');
  return {
    link,
    rightRoles: await rightRolesOf(ctx.db, [link.id]),
    rights: settings.rights,
    teamRights: teamRightsMap(settings),
    servers: await ownServers(ctx, link),
  };
}

export const guildSettingsSchema = z.object({
  teamLock: z.boolean().optional(),
  teamRoleId: snowflake.nullable().optional(),
  logChannelId: snowflake.nullable().optional(),
});

export async function updateGuildSettings(ctx: CoreContext, actor: Actor, input: z.infer<typeof guildSettingsSchema>) {
  const { link, user } = await linkForActor(ctx.db, actor);
  requireGuildAdmin(user);
  const now = ctx.now();
  const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) return link;
  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(privateServerLinks)
      .set({ ...changes, updatedAt: now })
      .where(eq(privateServerLinks.id, link.id))
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'private_server.settings',
        resourceType: 'private_server_link',
        resourceId: link.id,
        before: Object.fromEntries(Object.keys(changes).map((k) => [k, link[k as keyof Link]])),
        after: changes,
        metadata: { guildId: link.guildId },
      },
      now,
    );
    return row!;
  });
  if (input.teamLock !== undefined)
    await guildLog(
      ctx,
      updated,
      `🔐 Teamsperre ${input.teamLock ? 'eingeschaltet' : 'ausgeschaltet'} von <@${user.discordUserId}> (wirkt im Spiel innerhalb von 30 s).`,
    );
  return updated;
}

export async function setRightRole(ctx: CoreContext, actor: Actor, right: string, roleId: string | null) {
  const { link, user } = await linkForActor(ctx.db, actor);
  requireGuildAdmin(user);
  const { rights } = await getSetting(ctx.db, 'private_servers');
  if (!rights.includes(right)) throw errors.badRequest(`Unbekanntes Recht „${right}“. Vorhanden: ${rights.join(', ')}`);
  if (roleId !== null && !/^\d{15,22}$/.test(roleId)) throw errors.badRequest('Ungültige Rolle.');
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx
      .delete(privateServerRightRoles)
      .where(and(eq(privateServerRightRoles.linkId, link.id), eq(privateServerRightRoles.right, right)));
    if (roleId) await tx.insert(privateServerRightRoles).values({ linkId: link.id, right, discordRoleId: roleId });
    else
      await tx
        .delete(privateServerGrants)
        .where(and(eq(privateServerGrants.linkId, link.id), eq(privateServerGrants.right, right)));
    await writeAudit(
      tx,
      actor,
      {
        action: 'private_server.right_role',
        resourceType: 'private_server_link',
        resourceId: link.id,
        after: { right, roleId },
        metadata: { guildId: link.guildId },
      },
      now,
    );
  });
  return { rightRoles: await rightRolesOf(ctx.db, [link.id]) };
}

export async function guildGrants(ctx: CoreContext, actor: Actor) {
  const { link, user } = await linkForActor(ctx.db, actor);
  requireGuildTeam(user, link);
  return { items: await grantsOf(ctx.db, link.id), syncedAt: link.syncedAt };
}

export const guildActionSchema = z.union([playerActionSchema, z.object({ action: z.literal('kick') })]);

/** Aktion des Privatserver-Teams – nur auf eigenen Privatservern und nie am Besitzer. */
export async function guildAction(
  ctx: CoreContext,
  actor: Actor,
  robloxUserId: number,
  input: z.infer<typeof guildActionSchema>,
  reason: string,
) {
  const { link, user } = await linkForActor(ctx.db, actor);
  requireGuildTeam(user, link);
  if (robloxUserId === link.ownerRobloxId)
    throw errors.forbidden('Aktionen am Besitzer des Privatservers sind nicht erlaubt.');
  const result = await queuePlayerAction(ctx, actor, robloxUserId, input, reason, {
    scope: isOwnPrivateServer(link),
    scopeError: 'Der Spieler ist nicht auf einem eurer Privatserver.',
    audit: { guildId: link.guildId, privateServerLinkId: link.id },
  });
  await guildLog(
    ctx,
    link,
    `🎮 **${input.action}** an **${result.player.username}** durch <@${user.discordUserId}> · Grund: ${reason}`,
  );
  return result;
}
