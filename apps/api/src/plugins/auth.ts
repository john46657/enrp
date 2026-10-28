import { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  anonymousActor,
  buildUserActor,
  recordSecurityEvent,
  safeEqual,
  sha256Hex,
  verification,
  type Actor,
  type UserActor,
} from '@enrp/core';
import { adminSessions, and, eq, gt, isNull, memberRoleCache } from '@enrp/database';
import { AppError } from '@enrp/shared';

export const SESSION_COOKIE = 'enrp_session';
const SESSION_IDLE_MS = 12 * 3600_000;
const SESSION_ABSOLUTE_MS = 7 * 86400_000;
const ROLE_CACHE_MS = 5 * 60_000;
const SNOWFLAKE = /^\d{15,22}$/;

/** Kurzlebiger Cache für Bot-Akteure (gleiche Person + Rollen innerhalb weniger Sekunden). */
const actorCache = new Map<string, { at: number; actor: UserActor }>();
const userSync = new Map<string, number>();

/** Lädt die Discord-Rollen eines Dashboard-Nutzers (gecacht), damit Rollenänderungen zeitnah wirken. */
export async function memberRoles(
  app: FastifyInstance,
  discordUserId: string,
  force = false,
): Promise<{ roleIds: string[]; inGuild: boolean }> {
  const { core } = app.deps;
  const [cached] = await core.db.select().from(memberRoleCache).where(eq(memberRoleCache.discordUserId, discordUserId));
  if (!force && cached && core.now().getTime() - cached.fetchedAt.getTime() < ROLE_CACHE_MS)
    return { roleIds: cached.roleIds, inGuild: cached.inGuild };
  if (!core.discord.configured || !core.config.guildId)
    return { roleIds: cached?.roleIds ?? [], inGuild: cached?.inGuild ?? false };
  try {
    const member = await core.discord.getMember(core.config.guildId, discordUserId);
    const value = { roleIds: member?.roleIds ?? [], inGuild: Boolean(member), fetchedAt: core.now() };
    await core.db
      .insert(memberRoleCache)
      .values({ discordUserId, ...value })
      .onConflictDoUpdate({ target: memberRoleCache.discordUserId, set: value });
    return value;
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'Discord-Rollen konnten nicht geladen werden');
    return { roleIds: cached?.roleIds ?? [], inGuild: cached?.inGuild ?? false };
  }
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

async function resolveBotActor(app: FastifyInstance, request: FastifyRequest): Promise<Actor> {
  const { core } = app.deps;
  const actorIdHeader = request.headers['x-actor-id'];
  if (typeof actorIdHeader !== 'string') return { kind: 'service', name: 'bot' };
  if (!SNOWFLAKE.test(actorIdHeader)) throw new AppError('BAD_REQUEST', 'Ungültiger X-Actor-Id-Header.');
  const rolesHeader = typeof request.headers['x-actor-roles'] === 'string' ? request.headers['x-actor-roles'] : '';
  const roleIds = rolesHeader
    .split(',')
    .filter((r) => SNOWFLAKE.test(r))
    .slice(0, 250);
  const key = `${actorIdHeader}|${roleIds.sort().join(',')}`;
  const now = Date.now();
  const hit = actorCache.get(key);
  if (hit && now - hit.at < 5_000) return hit.actor;
  const actor = await buildUserActor(core.db, core.config, { discordUserId: actorIdHeader, roleIds, via: 'bot' });
  actorCache.set(key, { at: now, actor });
  if (actorCache.size > 5000) actorCache.clear();
  // Anzeigenamen für das Dashboard aktuell halten (höchstens alle 10 Minuten je Person).
  const name = request.headers['x-actor-name'];
  if (typeof name === 'string' && name.length <= 64 && now - (userSync.get(actorIdHeader) ?? 0) > 600_000) {
    userSync.set(actorIdHeader, now);
    await verification
      .upsertDiscordUser(core.db, { id: actorIdHeader, username: decodeURIComponent(name) }, core.now())
      .catch(() => undefined);
  }
  return actor;
}

async function resolveSession(app: FastifyInstance, request: FastifyRequest, token: string): Promise<Actor | null> {
  const { core } = app.deps;
  const now = core.now();
  const [session] = await core.db
    .select()
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.tokenHash, sha256Hex(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, now),
      ),
    );
  if (!session) return null;
  // Gleitende Verlängerung bis zur absoluten Höchstdauer.
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    const absolute = session.createdAt.getTime() + SESSION_ABSOLUTE_MS;
    await core.db
      .update(adminSessions)
      .set({ lastSeenAt: now, expiresAt: new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absolute)) })
      .where(eq(adminSessions.id, session.id));
  }
  request.session = {
    id: session.id,
    discordUserId: session.discordUserId,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
  const { roleIds } = await memberRoles(app, session.discordUserId);
  return buildUserActor(core.db, core.config, {
    discordUserId: session.discordUserId,
    roleIds,
    via: 'dashboard',
    sessionId: session.id,
  });
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Ermittelt für jede Anfrage den Akteur. Rollenprüfungen erfolgen anschließend in der Geschäftslogik. */
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('actor', null as never);
  app.decorateRequest('authMethod', 'none');
  app.decorateRequest('session', undefined);

  app.addHook('preValidation', async (request) => {
    request.actor = anonymousActor;
    if (request.routeOptions.config.skipAuth) return;
    const token = bearer(request);
    const { env, core } = app.deps;
    if (token && !token.startsWith('enrp_rbx_')) {
      if (!safeEqual(token, env.BOT_API_TOKEN)) {
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'auth.invalid_service_token',
          ip: request.ip,
          details: { path: request.routeOptions.url },
        });
        throw new AppError('UNAUTHENTICATED', 'Ungültiges Service-Token.');
      }
      request.authMethod = 'bot';
      request.actor = await resolveBotActor(app, request);
      return;
    }
    if (token) return; // Roblox-Schlüssel werden in den Spielrouten geprüft.

    const cookie = request.cookies[SESSION_COOKIE];
    if (!cookie) return;
    const actor = await resolveSession(app, request, cookie);
    if (!actor) return;
    request.authMethod = 'session';
    request.actor = actor;

    // CSRF-Schutz für browserbasierte Schreibaktionen: Origin-Prüfung + Synchronizer-Token.
    if (UNSAFE.has(request.method)) {
      const origin = request.headers.origin;
      const allowed = new Set([new URL(env.DASHBOARD_URL).origin, new URL(env.PUBLIC_URL).origin]);
      const csrf = request.headers['x-csrf-token'];
      if (
        (origin && !allowed.has(origin)) ||
        typeof csrf !== 'string' ||
        !safeEqual(csrf, request.session!.csrfToken)
      ) {
        await recordSecurityEvent(core.db, core.config.hashSecret, {
          type: 'auth.csrf_failed',
          actorId: request.session!.discordUserId,
          ip: request.ip,
        });
        throw new AppError('CSRF_FAILED', 'Sicherheitsprüfung fehlgeschlagen. Bitte lade die Seite neu.');
      }
    }
  });
}

/** Für Routen, die eine angemeldete Person (Dashboard oder Bot im Namen einer Person) erfordern. */
export function requireAuthenticated(request: FastifyRequest): void {
  if (request.actor.kind !== 'user') throw new AppError('UNAUTHENTICATED', 'Anmeldung erforderlich.');
}
