import {
  accountLinks,
  adminSessions,
  and,
  appeals,
  codeRedemptions,
  desc,
  discordUsers,
  dutySessions,
  eq,
  factionMemberships,
  giveawayEntries,
  memberRoleCache,
  moderationActions,
  oauthStates,
  or,
  playSessions,
  pollVotes,
  privacyRequests,
  profileEvents,
  recordEvents,
  reports,
  robloxUsers,
  ruleAcceptances,
  sql,
  suggestionVotes,
  suggestions,
  tickets,
  vehicleAssignments,
  verifications,
  type DbExecutor,
  type SQL,
} from '@enrp/database';
import { type PgTable } from 'drizzle-orm/pg-core';
import { errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission, systemActor } from '../actor';
import { createApproval, registerApprovalExecutor } from '../approvals';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';
import { getSetting } from '../settings';

export interface DataSubject {
  discordUserId?: string | null;
  robloxUserId?: number | null;
}

/** Ergänzt die jeweils andere Kennung über eine aktive Verknüpfung. */
async function resolveSubject(
  db: DbExecutor,
  subject: DataSubject,
): Promise<{ discordUserId: string | null; robloxUserId: number | null }> {
  let discordUserId = subject.discordUserId ?? null;
  let robloxUserId = subject.robloxUserId ?? null;
  if (!discordUserId && !robloxUserId) throw errors.badRequest('Discord- oder Roblox-ID angeben.');
  const [link] = await db
    .select()
    .from(accountLinks)
    .where(
      and(
        eq(accountLinks.status, 'active'),
        or(
          discordUserId ? eq(accountLinks.discordUserId, discordUserId) : undefined,
          robloxUserId ? eq(accountLinks.robloxUserId, robloxUserId) : undefined,
        ),
      ),
    );
  discordUserId ??= link?.discordUserId ?? null;
  robloxUserId ??= link?.robloxUserId ?? null;
  return { discordUserId, robloxUserId };
}

const D = (id: string | null) => id ?? '__none__';
const R = (id: number | null) => id ?? -1;

/** /data inspect: welche personenbezogenen Daten liegen wo (nur Anzahl, keine Inhalte)? */
export async function inspectSubject(db: DbExecutor, actor: Actor, input: DataSubject) {
  requirePermission(actor, 'privacy:view');
  const s = await resolveSubject(db, input);
  const count = async (table: PgTable, where: SQL) => {
    const r = await db.execute<{ c: number }>(sql`select count(*)::int as c from ${table} where ${where}`);
    return r.rows[0]?.c ?? 0;
  };
  const d = D(s.discordUserId);
  const r = R(s.robloxUserId);
  return {
    subject: s,
    categories: {
      discordAccount: await count(discordUsers, sql`id = ${d}`),
      robloxAccount: await count(robloxUsers, sql`id = ${r}`),
      accountLinks: await count(accountLinks, sql`discord_user_id = ${d} or roblox_user_id = ${r}`),
      verifications: await count(verifications, sql`discord_user_id = ${d}`),
      profileEvents: await count(profileEvents, sql`discord_user_id = ${d} or roblox_user_id = ${r}`),
      playSessions: await count(playSessions, sql`roblox_user_id = ${r}`),
      dutySessions: await count(dutySessions, sql`roblox_user_id = ${r}`),
      factionMemberships: await count(factionMemberships, sql`roblox_user_id = ${r}`),
      vehicleAssignments: await count(vehicleAssignments, sql`roblox_user_id = ${r}`),
      tickets: await count(tickets, sql`creator_discord_id = ${d}`),
      ticketMessages: await count(recordEvents, sql`actor_id = ${d}`),
      reportsFiled: await count(reports, sql`reporter_discord_id = ${d}`),
      reportsAbout: await count(reports, sql`reported_discord_id = ${d} or reported_roblox_id = ${r}`),
      moderationActions: await count(moderationActions, sql`target_discord_id = ${d} or target_roblox_id = ${r}`),
      appeals: await count(appeals, sql`appellant_discord_id = ${d}`),
      suggestions: await count(suggestions, sql`author_discord_id = ${d}`),
      votes:
        (await count(pollVotes, sql`discord_user_id = ${d}`)) +
        (await count(suggestionVotes, sql`discord_user_id = ${d}`)),
      giveawayEntries: await count(giveawayEntries, sql`discord_user_id = ${d}`),
      ruleAcceptances: await count(ruleAcceptances, sql`discord_user_id = ${d}`),
      codeRedemptions: await count(codeRedemptions, sql`roblox_user_id = ${r}`),
      sessions: await count(adminSessions, sql`discord_user_id = ${d}`),
    },
  };
}

async function collectExport(db: DbExecutor, s: { discordUserId: string | null; robloxUserId: number | null }) {
  const d = D(s.discordUserId);
  const r = R(s.robloxUserId);
  return {
    generatedAt: new Date().toISOString(),
    discordAccount: await db.select().from(discordUsers).where(eq(discordUsers.id, d)),
    robloxAccount: await db.select().from(robloxUsers).where(eq(robloxUsers.id, r)),
    accountLinks: await db
      .select()
      .from(accountLinks)
      .where(or(eq(accountLinks.discordUserId, d), eq(accountLinks.robloxUserId, r))),
    verifications: await db.select().from(verifications).where(eq(verifications.discordUserId, d)),
    profileHistory: await db
      .select()
      .from(profileEvents)
      .where(or(eq(profileEvents.discordUserId, d), eq(profileEvents.robloxUserId, r))),
    playSessions: await db.select().from(playSessions).where(eq(playSessions.robloxUserId, r)),
    dutySessions: await db.select().from(dutySessions).where(eq(dutySessions.robloxUserId, r)),
    factionMemberships: await db.select().from(factionMemberships).where(eq(factionMemberships.robloxUserId, r)),
    vehicleAssignments: await db.select().from(vehicleAssignments).where(eq(vehicleAssignments.robloxUserId, r)),
    tickets: await db.select().from(tickets).where(eq(tickets.creatorDiscordId, d)),
    // Interne Teamnotizen sind nicht Teil der Auskunft über eigene Beiträge.
    ownMessages: await db
      .select()
      .from(recordEvents)
      .where(and(eq(recordEvents.actorId, d), eq(recordEvents.internal, false))),
    reportsFiled: await db.select().from(reports).where(eq(reports.reporterDiscordId, d)),
    moderationActions: await db
      .select({
        number: moderationActions.number,
        type: moderationActions.type,
        platform: moderationActions.platform,
        reason: moderationActions.reason,
        status: moderationActions.status,
        createdAt: moderationActions.createdAt,
        expiresAt: moderationActions.expiresAt,
      })
      .from(moderationActions)
      .where(or(eq(moderationActions.targetDiscordId, d), eq(moderationActions.targetRobloxId, r))),
    appeals: await db.select().from(appeals).where(eq(appeals.appellantDiscordId, d)),
    suggestions: await db.select().from(suggestions).where(eq(suggestions.authorDiscordId, d)),
    pollVotes: await db.select().from(pollVotes).where(eq(pollVotes.discordUserId, d)),
    suggestionVotes: await db.select().from(suggestionVotes).where(eq(suggestionVotes.discordUserId, d)),
    giveawayEntries: await db.select().from(giveawayEntries).where(eq(giveawayEntries.discordUserId, d)),
    ruleAcceptances: await db.select().from(ruleAcceptances).where(eq(ruleAcceptances.discordUserId, d)),
    codeRedemptions: await db.select().from(codeRedemptions).where(eq(codeRedemptions.robloxUserId, r)),
  };
}

/** /data export: erzeugt eine Datenauskunft, die nach Ablauf der Aufbewahrungsfrist automatisch gelöscht wird. */
export async function exportSubject(ctx: CoreContext, actor: Actor, input: DataSubject & { reason: string }) {
  requirePermission(actor, 'privacy:export');
  const s = await resolveSubject(ctx.db, input);
  const retention = await getSetting(ctx.db, 'retention');
  const data = await collectExport(ctx.db, s);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(privacyRequests)
      .values({
        type: 'export',
        subjectDiscordId: s.discordUserId,
        subjectRobloxId: s.robloxUserId,
        status: 'completed',
        requestedBy: actorId(actor),
        reason: input.reason,
        result: data,
        completedAt: now,
        expiresAt: new Date(now.getTime() + retention.privacyExportDays * 86400_000),
      })
      .returning({ id: privacyRequests.id, number: privacyRequests.number, expiresAt: privacyRequests.expiresAt });
    await writeAudit(
      tx,
      actor,
      {
        action: 'privacy.export',
        resourceType: 'privacy_request',
        resourceId: row!.id,
        reason: input.reason,
        metadata: s,
      },
      now,
    );
    return row!;
  });
}

/** /data deletion-request: legt einen Löschantrag mit Vorschau an; ausgeführt wird erst nach Vier-Augen-Freigabe. */
export async function requestDeletion(ctx: CoreContext, actor: Actor, input: DataSubject & { reason: string }) {
  requirePermission(actor, 'privacy:delete');
  const inspection = await inspectSubject(ctx.db, actor, input);
  const s = inspection.subject;
  const [request] = await ctx.db
    .insert(privacyRequests)
    .values({
      type: 'deletion',
      subjectDiscordId: s.discordUserId,
      subjectRobloxId: s.robloxUserId,
      status: 'awaiting_approval',
      requestedBy: actorId(actor),
      reason: input.reason,
      preview: { ...inspection.categories, retained: ['moderationActions', 'appeals', 'auditEvents'] },
    })
    .returning();
  const approval = await createApproval(ctx, actor, {
    actionType: 'privacy.deletion',
    summary: `Personenbezogene Daten löschen (Discord ${s.discordUserId ?? '–'}, Roblox ${s.robloxUserId ?? '–'})`,
    payload: { privacyRequestId: request!.id },
    reason: input.reason,
    ttlHours: 72,
  });
  await ctx.db
    .update(privacyRequests)
    .set({ approvalRequestId: approval.id })
    .where(eq(privacyRequests.id, request!.id));
  await writeAudit(
    ctx.db,
    actor,
    {
      action: 'privacy.deletion.request',
      resourceType: 'privacy_request',
      resourceId: request!.id,
      reason: input.reason,
    },
    ctx.now(),
  );
  return { request: request!, approval, preview: request!.preview };
}

/**
 * Löscht bzw. pseudonymisiert die Daten. Moderationsaktionen und Einsprüche bleiben zur Durchsetzung
 * von Sanktionen erhalten (berechtigtes Interesse) und werden über Aufbewahrungsfristen bereinigt;
 * das Audit-Log bleibt unveränderlich.
 */
async function executeDeletion(ctx: TxContext, requestId: string) {
  const [request] = await ctx.db.select().from(privacyRequests).where(eq(privacyRequests.id, requestId));
  if (!request || request.status !== 'awaiting_approval') throw errors.invalidState('Löschantrag nicht mehr offen.');
  const d = D(request.subjectDiscordId);
  const r = R(request.subjectRobloxId);
  const db = ctx.db;
  const placeholder = 'deleted';
  const counts: Record<string, number> = {};
  const track = async (name: string, p: Promise<unknown[]>) => {
    counts[name] = (await p).length;
  };
  await track(
    'verifications',
    db.delete(verifications).where(eq(verifications.discordUserId, d)).returning({ id: verifications.id }),
  );
  await track(
    'oauthStates',
    db.delete(oauthStates).where(eq(oauthStates.discordUserId, d)).returning({ id: oauthStates.stateHash }),
  );
  await track(
    'sessions',
    db.delete(adminSessions).where(eq(adminSessions.discordUserId, d)).returning({ id: adminSessions.id }),
  );
  await track(
    'memberRoleCache',
    db
      .delete(memberRoleCache)
      .where(eq(memberRoleCache.discordUserId, d))
      .returning({ id: memberRoleCache.discordUserId }),
  );
  await track(
    'profileEvents',
    db
      .delete(profileEvents)
      .where(or(eq(profileEvents.discordUserId, d), eq(profileEvents.robloxUserId, r)))
      .returning({ id: profileEvents.id }),
  );
  await track(
    'pollVotes',
    db.delete(pollVotes).where(eq(pollVotes.discordUserId, d)).returning({ id: pollVotes.pollId }),
  );
  await track(
    'suggestionVotes',
    db
      .delete(suggestionVotes)
      .where(eq(suggestionVotes.discordUserId, d))
      .returning({ id: suggestionVotes.suggestionId }),
  );
  await track(
    'giveawayEntries',
    db
      .delete(giveawayEntries)
      .where(eq(giveawayEntries.discordUserId, d))
      .returning({ id: giveawayEntries.giveawayId }),
  );
  await track(
    'ruleAcceptances',
    db.delete(ruleAcceptances).where(eq(ruleAcceptances.discordUserId, d)).returning({ id: ruleAcceptances.ruleSetId }),
  );
  await track(
    'codeRedemptions',
    db.delete(codeRedemptions).where(eq(codeRedemptions.robloxUserId, r)).returning({ id: codeRedemptions.id }),
  );
  // Pseudonymisieren: Inhalte bleiben für die Nachvollziehbarkeit von Tickets/Reports erhalten, der Personenbezug nicht.
  await track(
    'ticketsAnonymized',
    db
      .update(tickets)
      .set({ creatorDiscordId: placeholder })
      .where(eq(tickets.creatorDiscordId, d))
      .returning({ id: tickets.id }),
  );
  await track(
    'messagesAnonymized',
    db
      .update(recordEvents)
      .set({
        actorId: placeholder,
        body: sql`case when ${recordEvents.internal} then ${recordEvents.body} else '[gelöscht]' end`,
      })
      .where(eq(recordEvents.actorId, d))
      .returning({ id: recordEvents.id }),
  );
  await track(
    'reportsAnonymized',
    db
      .update(reports)
      .set({ reporterDiscordId: placeholder })
      .where(eq(reports.reporterDiscordId, d))
      .returning({ id: reports.id }),
  );
  await track(
    'suggestionsAnonymized',
    db
      .update(suggestions)
      .set({ authorDiscordId: placeholder })
      .where(eq(suggestions.authorDiscordId, d))
      .returning({ id: suggestions.id }),
  );
  // Kaskadiert: Verknüpfungen, Spiel-/Dienstsessions, Mitgliedschaften, Fahrzeugzuweisungen.
  await track('robloxAccount', db.delete(robloxUsers).where(eq(robloxUsers.id, r)).returning({ id: robloxUsers.id }));
  await track(
    'discordAccount',
    db.delete(discordUsers).where(eq(discordUsers.id, d)).returning({ id: discordUsers.id }),
  );
  await db
    .update(privacyRequests)
    .set({ status: 'completed', completedAt: ctx.now(), result: { counts } })
    .where(eq(privacyRequests.id, requestId));
  await writeAudit(
    db,
    systemActor('privacy'),
    {
      action: 'privacy.deletion.execute',
      resourceType: 'privacy_request',
      resourceId: requestId,
      metadata: { counts },
    },
    ctx.now(),
  );
  return { counts };
}

registerApprovalExecutor('privacy.deletion', {
  requiredPermission: 'privacy:delete',
  execute: (ctx, payload) => executeDeletion(ctx, String(payload.privacyRequestId)),
});

export async function listPrivacyRequests(db: DbExecutor, actor: Actor, limit = 50) {
  requirePermission(actor, 'privacy:view');
  return db
    .select({
      id: privacyRequests.id,
      number: privacyRequests.number,
      type: privacyRequests.type,
      status: privacyRequests.status,
      subjectDiscordId: privacyRequests.subjectDiscordId,
      subjectRobloxId: privacyRequests.subjectRobloxId,
      requestedBy: privacyRequests.requestedBy,
      reason: privacyRequests.reason,
      preview: privacyRequests.preview,
      approvalRequestId: privacyRequests.approvalRequestId,
      completedAt: privacyRequests.completedAt,
      expiresAt: privacyRequests.expiresAt,
      createdAt: privacyRequests.createdAt,
    })
    .from(privacyRequests)
    .orderBy(desc(privacyRequests.createdAt))
    .limit(limit);
}

/** Lädt den Inhalt einer Datenauskunft (nur solange sie nicht abgelaufen ist). */
export async function getPrivacyExport(ctx: CoreContext, actor: Actor, id: string) {
  requirePermission(actor, 'privacy:export');
  const [row] = await ctx.db
    .select()
    .from(privacyRequests)
    .where(and(eq(privacyRequests.id, id), eq(privacyRequests.type, 'export')));
  if (!row) throw errors.notFound('Datenauskunft');
  if (!row.result || (row.expiresAt && row.expiresAt <= ctx.now()))
    throw errors.invalidState('Die Datenauskunft ist abgelaufen.');
  await writeAudit(
    ctx.db,
    actor,
    { action: 'privacy.export.download', resourceType: 'privacy_request', resourceId: id },
    ctx.now(),
  );
  return row.result;
}
