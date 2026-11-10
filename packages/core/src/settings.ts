import { and, configVersions, desc, eq, settings, sql, type DbExecutor } from '@enrp/database';
import { errors } from '@enrp/shared';
import { z } from 'zod';
import { type Actor, actorId, requirePermission } from './actor';
import { writeAudit } from './audit';
import { type CoreContext } from './context';

/** Bekannte Einstellungen mit Schema und Standardwert. */
export const SETTING_DEFINITIONS = {
  welcome: {
    label: 'Begrüßung neuer Mitglieder',
    critical: false,
    schema: z.object({
      enabled: z.boolean(),
      channelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      title: z.string().max(200),
      message: z.string().max(2000),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    default: {
      enabled: false,
      channelId: null,
      title: 'Willkommen!',
      message: 'Willkommen auf {server}, {user}! Bitte lies das Regelwerk und verifiziere dich mit /verify.',
      color: '#2563eb',
    },
  },
  notifications: {
    label: 'Benachrichtigungskanäle',
    critical: false,
    schema: z.object({
      ticketChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      reportChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      moderationLogChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      alertChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      suggestionChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      announcementChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      auditChannelId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
    }),
    default: {
      ticketChannelId: null,
      reportChannelId: null,
      moderationLogChannelId: null,
      alertChannelId: null,
      suggestionChannelId: null,
      announcementChannelId: null,
      auditChannelId: null,
    },
  },
  verification: {
    label: 'Verifizierung',
    critical: true,
    schema: z.object({
      verifiedRoleId: z
        .string()
        .regex(/^\d{15,22}$/)
        .nullable(),
      unlinkCooldownHours: z
        .number()
        .int()
        .min(0)
        .max(24 * 90),
      allowSelfUnlink: z.boolean(),
    }),
    default: { verifiedRoleId: null, unlinkCooldownHours: 24, allowSelfUnlink: true },
  },
  duty: {
    label: 'Dienstsystem',
    critical: false,
    schema: z.object({
      maxSessionHours: z.number().int().min(1).max(48),
      clockSkewToleranceSeconds: z.number().int().min(10).max(3600),
      serverTimeoutSeconds: z.number().int().min(60).max(3600),
    }),
    default: { maxSessionHours: 12, clockSkewToleranceSeconds: 120, serverTimeoutSeconds: 180 },
  },
  retention: {
    label: 'Aufbewahrungsfristen (Tage)',
    critical: true,
    schema: z.object({
      auditEventsDays: z.number().int().min(90).max(3650),
      securityEventsDays: z.number().int().min(30).max(3650),
      gameEventsDays: z.number().int().min(7).max(365),
      closedTicketsDays: z.number().int().min(30).max(3650),
      verificationLogDays: z.number().int().min(30).max(3650),
      privacyExportDays: z.number().int().min(1).max(30),
      backupDays: z.number().int().min(7).max(365),
      jobRunsDays: z.number().int().min(7).max(365),
    }),
    default: {
      auditEventsDays: 730,
      securityEventsDays: 180,
      gameEventsDays: 30,
      closedTicketsDays: 365,
      verificationLogDays: 180,
      privacyExportDays: 7,
      backupDays: 30,
      jobRunsDays: 30,
    },
  },
  bot: {
    label: 'Bot-Module',
    critical: false,
    schema: z.object({
      presenceText: z.string().max(100),
      disabledCommands: z.array(z.string().max(60)).max(200),
    }),
    default: { presenceText: 'GermanRP', disabledCommands: [] as string[] },
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFINITIONS;
}

export async function getSetting<K extends SettingKey>(db: DbExecutor, key: K): Promise<SettingValue<K>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const def = SETTING_DEFINITIONS[key];
  if (!row) return structuredClone(def.default) as SettingValue<K>;
  // Neue Felder mit Standardwerten ergänzen, ungültige gespeicherte Werte nicht verwenden.
  const merged = { ...def.default, ...(row.value as object) };
  const parsed = def.schema.safeParse(merged);
  return (parsed.success ? parsed.data : structuredClone(def.default)) as SettingValue<K>;
}

/** Schreibt eine neue Version in config_versions und das Audit-Log. */
export async function recordConfigVersion(
  db: DbExecutor,
  input: { scope: string; value: unknown; previous: unknown; actorId: string; reason?: string | null },
): Promise<number> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`config:${input.scope}`}))`);
  const [last] = await db
    .select({ version: configVersions.version })
    .from(configVersions)
    .where(eq(configVersions.scope, input.scope))
    .orderBy(desc(configVersions.version))
    .limit(1);
  const version = (last?.version ?? 0) + 1;
  await db.insert(configVersions).values({
    scope: input.scope,
    version,
    value: input.value ?? null,
    previous: input.previous ?? null,
    actorId: input.actorId,
    reason: input.reason ?? null,
  });
  return version;
}

/**
 * Ändert eine Einstellung. Kritische Einstellungen erfordern "settings:configure",
 * alle anderen "settings:edit".
 */
export async function updateSetting<K extends SettingKey>(
  ctx: CoreContext,
  actor: Actor,
  key: K,
  value: unknown,
  reason: string,
): Promise<{ value: SettingValue<K>; version: number }> {
  const def = SETTING_DEFINITIONS[key];
  if (!def) throw errors.notFound('Einstellung');
  requirePermission(actor, def.critical ? 'settings:configure' : 'settings:edit');
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) throw errors.badRequest('Ungültige Einstellung.', parsed.error.issues);
  return ctx.db.transaction(async (tx) => {
    const previous = await getSetting(tx, key);
    await tx
      .insert(settings)
      .values({ key, value: parsed.data, updatedBy: actorId(actor) })
      .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data, updatedBy: actorId(actor) } });
    const version = await recordConfigVersion(tx, {
      scope: `setting:${key}`,
      value: parsed.data,
      previous,
      actorId: actorId(actor),
      reason,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: 'settings.update',
        resourceType: 'setting',
        resourceId: key,
        reason,
        before: previous,
        after: parsed.data,
      },
      ctx.now(),
    );
    return { value: parsed.data as SettingValue<K>, version };
  });
}

export async function listConfigVersions(db: DbExecutor, scope?: string, limit = 50) {
  return db
    .select()
    .from(configVersions)
    .where(scope ? eq(configVersions.scope, scope) : undefined)
    .orderBy(desc(configVersions.createdAt))
    .limit(limit);
}

export async function getConfigVersion(db: DbExecutor, scope: string, version: number) {
  const [row] = await db
    .select()
    .from(configVersions)
    .where(and(eq(configVersions.scope, scope), eq(configVersions.version, version)));
  return row ?? null;
}
