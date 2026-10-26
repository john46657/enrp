import { and, automationRules, automationRuns, desc, eq, sql, type DbExecutor } from '@enrp/database';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, errors, type AutomationAction, type AutomationTrigger } from '@enrp/shared';
import { z } from 'zod';
import { type Actor, actorId, requirePermission, systemActor } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { isFlagEnabled } from '../flags';
import { getSetting } from '../settings';
import { createIncident } from './incidents';

/** Maximale Verkettungstiefe: Aktionen einer Automatisierung lösen höchstens eine weitere Ebene aus. */
export const MAX_AUTOMATION_DEPTH = 1;
const MIN_COOLDOWN_SECONDS = 60;

export const automationInput = z.object({
  name: z.string().trim().min(3).max(100),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: z.object({ threshold: z.number().int().min(1).max(100).optional(), service: z.string().max(40).optional() }).default({}),
  action: z.enum(AUTOMATION_ACTIONS),
  actionConfig: z
    .object({
      channelId: z.string().regex(/^\d{15,22}$/).optional(),
      message: z.string().max(1000).optional(),
      severity: z.enum(['sev1', 'sev2', 'sev3', 'sev4']).optional(),
    })
    .default({}),
  cooldownSeconds: z.number().int().min(MIN_COOLDOWN_SECONDS).max(7 * 86400).default(900),
  enabled: z.boolean().default(true),
});
export type AutomationInput = z.input<typeof automationInput>;

export async function listAutomations(db: DbExecutor) {
  return db.select().from(automationRules).orderBy(automationRules.name);
}

export async function createAutomation(ctx: CoreContext, actor: Actor, input: AutomationInput, reason: string) {
  requirePermission(actor, 'automations:create');
  const data = automationInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(automationRules).values({ ...data, createdBy: actorId(actor) }).returning();
    await writeAudit(tx, actor, { action: 'automation.create', resourceType: 'automation', resourceId: row!.id, reason, after: row }, ctx.now());
    return row!;
  });
}

export async function setAutomationEnabled(ctx: CoreContext, actor: Actor, id: string, enabled: boolean, reason: string) {
  requirePermission(actor, 'automations:edit');
  const [row] = await ctx.db.update(automationRules).set({ enabled }).where(eq(automationRules.id, id)).returning();
  if (!row) throw errors.notFound('Automatisierung');
  await writeAudit(ctx.db, actor, { action: enabled ? 'automation.resume' : 'automation.pause', resourceType: 'automation', resourceId: id, reason }, ctx.now());
  return row;
}

export async function deleteAutomation(ctx: CoreContext, actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'automations:delete');
  const [row] = await ctx.db.delete(automationRules).where(eq(automationRules.id, id)).returning();
  if (!row) throw errors.notFound('Automatisierung');
  await writeAudit(ctx.db, actor, { action: 'automation.delete', resourceType: 'automation', resourceId: id, reason, before: row }, ctx.now());
  return row;
}

export async function automationHistory(db: DbExecutor, ruleId?: string, limit = 50) {
  return db
    .select()
    .from(automationRuns)
    .where(ruleId ? eq(automationRuns.ruleId, ruleId) : undefined)
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

export interface TriggerContext {
  /** z. B. Anzahl fehlgeschlagener Backups in Folge oder betroffener Dienst. */
  count?: number;
  service?: string;
  summary: string;
  dedupeKey?: string;
  depth?: number;
}

function conditionsMet(rule: typeof automationRules.$inferSelect, context: TriggerContext): boolean {
  const c = rule.conditions as { threshold?: number; service?: string };
  if (c.threshold !== undefined && (context.count ?? 0) < c.threshold) return false;
  if (c.service && context.service && c.service !== context.service) return false;
  return true;
}

async function runAction(ctx: CoreContext, rule: typeof automationRules.$inferSelect, context: TriggerContext) {
  const config = rule.actionConfig as { channelId?: string; message?: string; severity?: 'sev1' | 'sev2' | 'sev3' | 'sev4' };
  const action = rule.action as AutomationAction;
  switch (action) {
    case 'notify_discord': {
      const channelId = config.channelId ?? (await getSetting(ctx.db, 'notifications')).alertChannelId;
      if (!channelId) return { skipped: 'Kein Benachrichtigungskanal konfiguriert' };
      await ctx.queue.enqueue('discord', 'message.send', {
        channelId,
        embed: { title: `⚙️ Automatisierung: ${rule.name}`, description: `${config.message ? `${config.message}\n\n` : ''}${context.summary}`.slice(0, 3500), color: '#f59e0b' },
      });
      return { notified: channelId };
    }
    case 'create_incident': {
      const { incident, deduplicated } = await createIncident(ctx, systemActor(`automation:${rule.id}`), {
        title: `[Automatisch] ${rule.name}`,
        description: context.summary,
        severity: config.severity ?? 'sev3',
        source: 'automation',
        dedupeKey: `automation:${rule.id}:${context.dedupeKey ?? rule.trigger}`,
      });
      return { incidentId: incident.id, deduplicated };
    }
    case 'run_health_check':
      await ctx.queue.enqueue('maintenance', 'health.check', { reason: `automation:${rule.id}` }, { jobId: `health-${rule.id}-${Math.floor(ctx.now().getTime() / 60_000)}` });
      return { queued: true };
  }
}

/**
 * Löst passende Regeln für ein Ereignis aus. Schutz gegen Endlosschleifen: Cooldown je Regel,
 * begrenzte Verkettungstiefe, atomare Cooldown-Prüfung (nur eine Instanz feuert).
 */
export async function fireTrigger(ctx: CoreContext, trigger: AutomationTrigger, context: TriggerContext) {
  const depth = context.depth ?? 0;
  if (depth > MAX_AUTOMATION_DEPTH) return [];
  if (!(await isFlagEnabled(ctx.db, 'automations')) || (await isFlagEnabled(ctx.db, 'kill_switch'))) return [];
  const rules = await ctx.db.select().from(automationRules).where(and(eq(automationRules.trigger, trigger), eq(automationRules.enabled, true)));
  const results: Array<{ ruleId: string; status: string; details?: unknown }> = [];
  const now = ctx.now();
  for (const rule of rules) {
    if (!conditionsMet(rule, context)) continue;
    const [claimed] = await ctx.db
      .update(automationRules)
      .set({ lastFiredAt: now })
      .where(
        and(
          eq(automationRules.id, rule.id),
          sql`(${automationRules.lastFiredAt} is null or ${automationRules.lastFiredAt} < ${new Date(now.getTime() - rule.cooldownSeconds * 1000)})`,
        ),
      )
      .returning({ id: automationRules.id });
    if (!claimed) {
      await ctx.db.insert(automationRuns).values({ ruleId: rule.id, status: 'skipped_cooldown', depth, details: { summary: context.summary } });
      results.push({ ruleId: rule.id, status: 'skipped_cooldown' });
      continue;
    }
    try {
      const details = await runAction(ctx, rule, { ...context, depth: depth + 1 });
      await ctx.db.insert(automationRuns).values({ ruleId: rule.id, status: 'succeeded', depth, details: { summary: context.summary, ...details } });
      await writeAudit(ctx.db, systemActor('automation'), { action: 'automation.run', resourceType: 'automation', resourceId: rule.id, metadata: { trigger, ...details } }, now);
      results.push({ ruleId: rule.id, status: 'succeeded', details });
    } catch (err) {
      await ctx.db.insert(automationRuns).values({ ruleId: rule.id, status: 'failed', depth, details: { summary: context.summary, error: (err as Error).message } });
      results.push({ ruleId: rule.id, status: 'failed' });
    }
  }
  return results;
}

/** /automation test: prüft Bedingungen und beschreibt die Aktion, ohne sie auszuführen. */
export async function testAutomation(ctx: CoreContext, actor: Actor, id: string, context: TriggerContext) {
  requirePermission(actor, 'automations:edit');
  const [rule] = await ctx.db.select().from(automationRules).where(eq(automationRules.id, id));
  if (!rule) throw errors.notFound('Automatisierung');
  const matches = conditionsMet(rule, context);
  const cooldownUntil = rule.lastFiredAt ? new Date(rule.lastFiredAt.getTime() + rule.cooldownSeconds * 1000) : null;
  const details = { matches, wouldRun: matches && rule.enabled && (!cooldownUntil || cooldownUntil < ctx.now()), action: rule.action, actionConfig: rule.actionConfig, cooldownUntil };
  await ctx.db.insert(automationRuns).values({ ruleId: rule.id, status: 'test', test: true, details });
  return details;
}

export type { AutomationTrigger };
