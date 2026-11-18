import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { and, asc, eq, gte, inArray, legacyRequests, lt } from '@enrp/database';
import { LEGACY_ACTIONS, LEGACY_LIVE, LEGACY_SETTING_ROOTS } from '@enrp/permissions';
import { AppError, errors } from '@enrp/shared';
import { type Actor, hasPermission, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';

/**
 * Altmodule des Bots im Dashboard (Bewerbungen, Level, Rollenpanel, Ticketpanel, /einstellungen).
 *
 * Die Daten der Altmodule liegen beim Bot (apps/bot/legacy, data/db.json). Damit es weiterhin genau eine Stelle
 * für Rechte und Audit gibt, läuft alles über die API: Das Dashboard stellt eine Anfrage (Recht wird hier geprüft,
 * Änderungen landen im Audit-Log), der Bot holt sie per Long-Polling ab, führt sie mit den Altmodulen aus und
 * meldet das Ergebnis zurück. Die Anfrage wartet so lange auf die Antwort des Bots.
 */

const pathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w-]+(\.[\w-]+)*$/, 'Ungültiger Pfad')
  .refine((p) => !p.split('.').some((k) => ['__proto__', 'prototype', 'constructor'].includes(k)), 'Ungültiger Pfad');

export const legacySettingsSchema = z.object({
  changes: z
    .array(z.object({ path: pathSchema, value: z.unknown() }))
    .min(1)
    .max(100),
});

const MAX_PAYLOAD_BYTES = 200_000;
/** So lange wartet eine Anfrage, bis der Bot sie abholt. */
const CLAIM_TIMEOUT_MS = 12_000;
/** So lange darf der Bot danach an einer abgeholten Anfrage arbeiten. */
const RUN_TIMEOUT_MS = 30_000;
const KEEP_MS = 24 * 3_600_000;

// Weckt wartende Anfragen in diesem Prozess sofort; über mehrere API-Instanzen greift das regelmäßige Nachsehen.
const wake = new EventEmitter();
wake.setMaxListeners(0);
const sleep = (ms: number, event: string) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      wake.off(event, done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    wake.once(event, done);
  });

type Kind = 'live' | 'action' | 'settings' | 'reset';

async function call(
  ctx: CoreContext,
  actor: Actor,
  request: { kind: Kind; name: string; payload: Record<string, unknown>; audit?: boolean },
  timeouts = { claimMs: CLAIM_TIMEOUT_MS, runMs: RUN_TIMEOUT_MS },
) {
  const user = requireUser(actor);
  if (JSON.stringify(request.payload).length > MAX_PAYLOAD_BYTES)
    throw new AppError('PAYLOAD_TOO_LARGE', 'Die Anfrage ist zu groß.');
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(legacyRequests)
      .values({
        kind: request.kind,
        name: request.name,
        payload: request.payload,
        actorDiscordId: user.discordUserId,
        createdAt: ctx.now(),
      })
      .returning();
    if (request.audit)
      await writeAudit(
        tx,
        actor,
        {
          action: `legacy.${request.kind === 'action' ? request.name : request.kind}`,
          resourceType: 'legacy_module',
          resourceId: created!.id,
          after: request.payload,
        },
        ctx.now(),
      );
    return created!;
  });
  wake.emit('request');

  const started = Date.now();
  for (;;) {
    await sleep(250, `result:${row.id}`);
    const [current] = await ctx.db.select().from(legacyRequests).where(eq(legacyRequests.id, row.id));
    if (!current)
      throw new AppError('SERVICE_UNAVAILABLE', 'Die Anfrage ist verloren gegangen. Bitte erneut versuchen.');
    if (current.status === 'done') return current.result as unknown;
    if (current.status === 'failed')
      throw errors.badRequest(current.error ?? 'Der Bot konnte die Anfrage nicht ausführen.');
    const waited = Date.now() - started;
    if (current.status === 'pending' && waited > timeouts.claimMs) {
      // Nur verwerfen, wenn der Bot sie nicht genau jetzt doch noch abgeholt hat.
      const expired = await ctx.db
        .update(legacyRequests)
        .set({ status: 'failed', error: 'Bot nicht erreichbar', finishedAt: ctx.now() })
        .where(and(eq(legacyRequests.id, row.id), eq(legacyRequests.status, 'pending')))
        .returning({ id: legacyRequests.id });
      if (expired.length)
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Der Bot antwortet nicht. Läuft er, und sind die Altmodule aktiv (LEGACY_MODULES)?',
        );
    }
    if (waited > timeouts.claimMs + timeouts.runMs)
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Der Bot braucht ungewöhnlich lange. Bitte prüfe gleich, ob die Aktion ausgeführt wurde.',
      );
  }
}

export async function readLive(
  ctx: CoreContext,
  actor: Actor,
  name: string,
  timeouts?: { claimMs: number; runMs: number },
) {
  const allowed = LEGACY_LIVE[name];
  if (!allowed) throw errors.notFound('Datenquelle');
  if (actor.kind === 'anonymous') throw errors.unauthenticated();
  if (!allowed.some((permission) => hasPermission(actor, permission))) requirePermission(actor, allowed[0]!);
  return call(ctx, actor, { kind: 'live', name, payload: {} }, timeouts);
}

export async function runAction(
  ctx: CoreContext,
  actor: Actor,
  name: string,
  payload: Record<string, unknown>,
  timeouts?: { claimMs: number; runMs: number },
) {
  const permission = LEGACY_ACTIONS[name];
  if (!permission) throw errors.notFound('Aktion');
  requirePermission(actor, permission);
  return call(ctx, actor, { kind: 'action', name, payload, audit: true }, timeouts);
}

export async function saveSettings(
  ctx: CoreContext,
  actor: Actor,
  input: z.infer<typeof legacySettingsSchema>,
  timeouts?: { claimMs: number; runMs: number },
) {
  for (const { path } of input.changes) {
    const root = path.split('.')[0]!;
    const permission = LEGACY_SETTING_ROOTS[root];
    if (!permission) throw errors.badRequest(`„${root}“ kann im Dashboard nicht geändert werden.`);
    requirePermission(actor, permission);
  }
  return call(
    ctx,
    actor,
    { kind: 'settings', name: 'save', payload: { changes: input.changes }, audit: true },
    timeouts,
  );
}

/** Alle Änderungen aus Discord/Dashboard verwerfen – es gilt wieder die config.json der Altmodule. */
export async function resetSettings(ctx: CoreContext, actor: Actor, timeouts?: { claimMs: number; runMs: number }) {
  requirePermission(actor, 'settings:configure');
  return call(ctx, actor, { kind: 'reset', name: 'reset', payload: {}, audit: true }, timeouts);
}

// ---------- Seite des Bots ----------

/** Der Bot holt offene Anfragen ab (wartet bis zu waitMs, wenn keine da sind; signal = Verbindung getrennt). */
export async function claimRequests(ctx: CoreContext, waitMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 25_000);
  for (;;) {
    // Verbindung des Bots weg (z. B. Neustart): nichts mehr abholen, sonst ginge die Anfrage ins Leere.
    if (signal?.aborted) return [];
    const now = ctx.now();
    const pending = await ctx.db
      .select({ id: legacyRequests.id })
      .from(legacyRequests)
      .where(
        and(
          eq(legacyRequests.status, 'pending'),
          gte(legacyRequests.createdAt, new Date(now.getTime() - CLAIM_TIMEOUT_MS)),
        ),
      )
      .orderBy(asc(legacyRequests.createdAt))
      .limit(10);
    if (pending.length) {
      const claimed = await ctx.db
        .update(legacyRequests)
        .set({ status: 'running', claimedAt: now })
        .where(
          and(
            inArray(
              legacyRequests.id,
              pending.map((p) => p.id),
            ),
            eq(legacyRequests.status, 'pending'),
          ),
        )
        .returning();
      if (claimed.length)
        return claimed
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => ({
            id: r.id,
            kind: r.kind,
            name: r.name,
            payload: r.payload,
            actorDiscordId: r.actorDiscordId,
          }));
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      // Aufräumen: alte Zeilen löschen (Ergebnisse können personenbezogene Daten enthalten).
      await ctx.db.delete(legacyRequests).where(lt(legacyRequests.createdAt, new Date(now.getTime() - KEEP_MS)));
      return [];
    }
    await sleep(Math.min(left, 1000), 'request');
  }
}

export const legacyResultSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(1000).optional(),
});

export async function completeRequest(ctx: CoreContext, id: string, input: z.infer<typeof legacyResultSchema>) {
  const updated = await ctx.db
    .update(legacyRequests)
    .set({
      status: input.ok ? 'done' : 'failed',
      result: input.ok ? (input.result ?? null) : null,
      error: input.ok ? null : (input.error ?? 'Unbekannter Fehler'),
      finishedAt: ctx.now(),
    })
    .where(and(eq(legacyRequests.id, id), eq(legacyRequests.status, 'running')))
    .returning({ id: legacyRequests.id });
  if (!updated.length) throw errors.notFound('Anfrage');
  wake.emit(`result:${id}`);
  return { ok: true };
}
