import { AppError, type ErrorCode } from '@emden-network/shared';
import { isPgError, PgErrorCode, withTransaction, type Pool, type PoolClient } from '@emden-network/database';
import { codeChallengeS256, createCodeVerifier, randomToken, safeEqual, sha256 } from './crypto.js';
import { writeAudit } from './audit.js';
import { enqueueOutbox } from './outbox.js';
import { ensureUser, getActiveLinkByDiscord } from './users.js';
import { RobloxOAuthError, type RobloxOAuthClient, type RobloxUserInfo } from './roblox-oauth.js';

export const OUTBOX_ROLE_GRANT = 'discord.verified_role.grant';
export const OUTBOX_ROLE_REVOKE = 'discord.verified_role.revoke';

export interface RoleOutboxPayload {
  guildId: string;
  discordId: string;
  /** Benachrichtigung per DM nach erfolgreicher Vergabe/Entzug */
  notify: boolean;
  robloxUsername?: string | null;
}

export interface VerificationConfig {
  /** Öffentliche Basis-URL der API (für den Start-Link), z. B. https://api.example.de */
  publicBaseUrl: string;
  /** Gültigkeit des Start-Links aus Discord */
  startTtlSeconds?: number;
  /** Zeit zwischen Weiterleitung zu Roblox und Callback */
  authorizeTtlSeconds?: number;
  /** Maximale Anzahl neu erzeugter Sessions je Discord-Nutzer innerhalb von 15 Minuten */
  maxSessionsPer15Min?: number;
}

export type CallbackResult =
  | { ok: true; robloxUserId: string; robloxUsername: string | null; alreadyLinked: boolean }
  | { ok: false; code: ErrorCode };

export interface CallbackInput {
  state?: string | undefined;
  code?: string | undefined;
  error?: string | undefined;
  /** Wert des Browser-Bindungs-Cookies, gesetzt bei /auth/roblox/start */
  browserBinding?: string | undefined;
}

interface StartedSession {
  id: string;
  discord_id: string;
  guild_id: string;
  code_verifier: string;
  browser_binding_hash: Buffer;
  expired: boolean;
}

export class VerificationService {
  private readonly startTtl: number;
  private readonly authorizeTtl: number;
  private readonly maxSessions: number;

  constructor(
    private readonly pool: Pool,
    /**
     * Nur die API benötigt den OAuth-Client (Client-Secret). Der Bot erzeugt lediglich Sessions
     * und übergibt null – so liegt das Roblox-Secret nie im Bot-Prozess.
     */
    private readonly oauthClient: RobloxOAuthClient | null,
    private readonly cfg: VerificationConfig,
    private readonly log: (msg: string, meta?: Record<string, unknown>) => void = () => {},
  ) {
    this.startTtl = cfg.startTtlSeconds ?? 600;
    this.authorizeTtl = cfg.authorizeTtlSeconds ?? 600;
    this.maxSessions = cfg.maxSessionsPer15Min ?? 5;
  }

  private get oauth(): RobloxOAuthClient {
    if (!this.oauthClient) throw new Error('VerificationService ohne OAuth-Client: nur createSession/revokeLink/cleanup verfügbar');
    return this.oauthClient;
  }

  /**
   * Schritt 1 (Bot): legt eine OAuth-Session für den Discord-Nutzer an, der /verify ausgeführt hat.
   * Die Discord-ID stammt ausschließlich aus der Discord-Interaktion – nie aus einer URL.
   */
  async createSession(discordId: string, guildId: string): Promise<{ url: string; expiresAt: Date }> {
    return withTransaction(this.pool, async (tx) => {
      // Serialisiert parallele /verify-Aufrufe desselben Nutzers.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`verify:${discordId}`]);

      if (await getActiveLinkByDiscord(tx, discordId)) throw new AppError('DISCORD_ALREADY_LINKED', 409);

      const { rows: recent } = await tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM oauth_verification_sessions WHERE discord_id = $1 AND created_at > now() - interval '15 minutes'`,
        [discordId],
      );
      if (Number(recent[0]!.n) >= this.maxSessions) throw new AppError('TOO_MANY_ATTEMPTS', 429);

      // Ältere offene Sessions dieses Nutzers werden ungültig – es gilt immer nur der neueste Link.
      await tx.query(
        `UPDATE oauth_verification_sessions SET status = 'failed', failure_code = 'SUPERSEDED', code_verifier = NULL, completed_at = now()
         WHERE discord_id = $1 AND status IN ('created', 'started')`,
        [discordId],
      );

      const startToken = randomToken();
      const { rows } = await tx.query<{ expires_at: Date }>(
        `INSERT INTO oauth_verification_sessions (discord_id, guild_id, start_token_hash, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING expires_at`,
        [discordId, guildId, sha256(startToken), this.startTtl],
      );
      await writeAudit(tx, { actorType: 'discord_user', actorId: discordId, action: 'verification.session_created', guildId });
      const url = new URL('/auth/roblox/start', this.cfg.publicBaseUrl);
      url.searchParams.set('t', startToken);
      return { url: url.toString(), expiresAt: rows[0]!.expires_at };
    });
  }

  /**
   * Schritt 2 (Browser): löst den Start-Link einmalig ein, erzeugt state + PKCE und liefert die
   * Roblox-Autorisierungs-URL sowie einen Bindungswert für ein HttpOnly-Cookie.
   */
  async beginAuthorization(startToken: string): Promise<{ authorizeUrl: string; browserBinding: string; maxAgeSeconds: number }> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(startToken)) throw new AppError('INVALID_STATE', 400);
    const state = randomToken();
    const verifier = createCodeVerifier();
    const binding = randomToken();

    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE oauth_verification_sessions
       SET status = 'started', state_hash = $2, code_verifier = $3, browser_binding_hash = $4, started_at = now(),
           expires_at = now() + make_interval(secs => $5)
       WHERE start_token_hash = $1 AND status = 'created' AND expires_at > now()
       RETURNING id`,
      [sha256(startToken), sha256(state), verifier, sha256(binding), this.authorizeTtl],
    );
    if (rows.length === 0) {
      const { rows: existing } = await this.pool.query<{ status: string; expired: boolean }>(
        `SELECT status, expires_at <= now() AS expired FROM oauth_verification_sessions WHERE start_token_hash = $1`,
        [sha256(startToken)],
      );
      const s = existing[0];
      if (!s) throw new AppError('INVALID_STATE', 400);
      if (s.status === 'created' && s.expired) throw new AppError('SESSION_EXPIRED', 410);
      throw new AppError('SESSION_ALREADY_USED', 409);
    }
    return {
      authorizeUrl: this.oauth.buildAuthorizeUrl({ state, codeChallenge: codeChallengeS256(verifier) }),
      browserBinding: binding,
      maxAgeSeconds: this.authorizeTtl,
    };
  }

  /** Schritt 3 (Browser): verarbeitet den Roblox-Callback. Wirft nie; liefert ein Ergebnis für die Ergebnisseite. */
  async handleCallback(input: CallbackInput): Promise<CallbackResult> {
    const { state } = input;
    if (!state || state.length > 200) return { ok: false, code: 'INVALID_STATE' };
    const stateHash = sha256(state);

    // Atomar und einmalig: nur genau ein Request kann die Session von 'started' nach 'exchanging' bringen.
    const { rows } = await this.pool.query<StartedSession>(
      `UPDATE oauth_verification_sessions SET status = 'exchanging'
       WHERE state_hash = $1 AND status = 'started'
       RETURNING id, discord_id, guild_id, code_verifier, browser_binding_hash, expires_at <= now() AS expired`,
      [stateHash],
    );
    const session = rows[0];
    if (!session) {
      const { rows: existing } = await this.pool.query('SELECT 1 FROM oauth_verification_sessions WHERE state_hash = $1', [stateHash]);
      if (existing.length > 0) {
        await writeAudit(this.pool, { actorType: 'api', action: 'verification.replay_rejected', outcome: 'denied' });
        return { ok: false, code: 'SESSION_ALREADY_USED' };
      }
      return { ok: false, code: 'INVALID_STATE' };
    }

    const fail = async (code: ErrorCode, detail?: string): Promise<CallbackResult> => {
      await this.finishFailed(session, code, detail);
      return { ok: false, code };
    };

    if (session.expired) return fail('SESSION_EXPIRED');
    if (!input.browserBinding || !safeEqual(sha256(input.browserBinding), session.browser_binding_hash)) {
      return fail('BROWSER_MISMATCH');
    }
    if (input.error) return fail(input.error === 'access_denied' ? 'OAUTH_DENIED' : 'OAUTH_ERROR', input.error.slice(0, 64));
    if (!input.code || input.code.length > 2048) return fail('INVALID_STATE', 'code fehlt');

    let user: RobloxUserInfo;
    try {
      const tokens = await this.oauth.exchangeCode(input.code, session.code_verifier);
      try {
        user = await this.oauth.fetchUserInfo(tokens.access_token);
      } finally {
        // Tokens werden nach der Identitätsprüfung nicht benötigt: Refresh-Token widerrufen, nichts speichern.
        if (tokens.refresh_token) void this.oauth.revokeRefreshToken(tokens.refresh_token);
      }
    } catch (err) {
      const code: ErrorCode = err instanceof RobloxOAuthError && err.kind === 'userinfo' ? 'USERINFO_INVALID' : 'TOKEN_EXCHANGE_FAILED';
      return fail(code, err instanceof Error ? err.message : undefined);
    }

    try {
      return await withTransaction(this.pool, (tx) => this.linkAccount(tx, session, user));
    } catch (err) {
      if (err instanceof AppError) return fail(err.code);
      if (isPgError(err, PgErrorCode.UniqueViolation)) {
        const constraint = (err as { constraint?: string }).constraint;
        return fail(constraint === 'discord_links_active_roblox_uq' ? 'ROBLOX_ALREADY_LINKED' : 'DISCORD_ALREADY_LINKED');
      }
      this.log('Verknüpfung fehlgeschlagen', { sessionId: session.id, error: (err as Error).message });
      return fail('INTERNAL', (err as Error).message);
    }
  }

  private async linkAccount(tx: PoolClient, session: StartedSession, user: RobloxUserInfo): Promise<CallbackResult> {
    const userId = await ensureUser(tx, session.discord_id);
    const { rows: existing } = await tx.query<{ roblox_user_id: string }>(
      'SELECT roblox_user_id FROM discord_links WHERE user_id = $1 AND revoked_at IS NULL FOR UPDATE',
      [userId],
    );
    let alreadyLinked = false;
    if (existing[0]) {
      if (existing[0].roblox_user_id !== user.sub) throw new AppError('DISCORD_ALREADY_LINKED', 409);
      alreadyLinked = true;
      await tx.query(
        'UPDATE discord_links SET roblox_username = $2, roblox_display_name = $3 WHERE user_id = $1 AND revoked_at IS NULL',
        [userId, user.preferred_username ?? null, user.name ?? null],
      );
    } else {
      const { rows: other } = await tx.query('SELECT 1 FROM discord_links WHERE roblox_user_id = $1 AND revoked_at IS NULL', [user.sub]);
      if (other.length > 0) throw new AppError('ROBLOX_ALREADY_LINKED', 409);
      await tx.query(
        'INSERT INTO discord_links (user_id, roblox_user_id, roblox_username, roblox_display_name) VALUES ($1, $2, $3, $4)',
        [userId, user.sub, user.preferred_username ?? null, user.name ?? null],
      );
    }

    await tx.query(
      `UPDATE oauth_verification_sessions SET status = 'completed', code_verifier = NULL, completed_at = now(), roblox_user_id = $2 WHERE id = $1`,
      [session.id, user.sub],
    );
    const payload: RoleOutboxPayload = {
      guildId: session.guild_id,
      discordId: session.discord_id,
      notify: true,
      robloxUsername: user.preferred_username ?? null,
    };
    await enqueueOutbox(tx, OUTBOX_ROLE_GRANT, payload, { dedupeKey: `verified:${session.guild_id}:${session.discord_id}` });
    await writeAudit(tx, {
      actorType: 'discord_user',
      actorId: session.discord_id,
      action: alreadyLinked ? 'verification.relinked' : 'verification.linked',
      targetType: 'roblox_user',
      targetId: user.sub,
      guildId: session.guild_id,
    });
    return { ok: true, robloxUserId: user.sub, robloxUsername: user.preferred_username ?? null, alreadyLinked };
  }

  private async finishFailed(session: StartedSession, code: ErrorCode, detail?: string): Promise<void> {
    await this.pool.query(
      `UPDATE oauth_verification_sessions SET status = 'failed', failure_code = $2, code_verifier = NULL, completed_at = now() WHERE id = $1`,
      [session.id, code],
    );
    await writeAudit(this.pool, {
      actorType: 'discord_user',
      actorId: session.discord_id,
      action: 'verification.failed',
      guildId: session.guild_id,
      outcome: 'failure',
      reason: code,
      metadata: detail ? { detail } : {},
    });
  }

  /**
   * Hebt die aktive Verknüpfung auf und plant den Entzug der Rolle „Verifiziert“.
   * actorDiscordId ist der Auslöser (Nutzer selbst oder berechtigtes Teammitglied – Prüfung beim Aufrufer).
   */
  async revokeLink(params: { discordId: string; guildId: string; actorDiscordId: string; reason: string }): Promise<{ robloxUserId: string }> {
    return withTransaction(this.pool, async (tx) => {
      const { rows } = await tx.query<{ roblox_user_id: string }>(
        `UPDATE discord_links l SET revoked_at = now(), revoked_reason = $2
         FROM users u WHERE u.id = l.user_id AND u.discord_id = $1 AND l.revoked_at IS NULL
         RETURNING l.roblox_user_id`,
        [params.discordId, params.reason],
      );
      const row = rows[0];
      if (!row) throw new AppError('NOT_LINKED', 404);
      const payload: RoleOutboxPayload = { guildId: params.guildId, discordId: params.discordId, notify: params.actorDiscordId !== params.discordId };
      await enqueueOutbox(tx, OUTBOX_ROLE_REVOKE, payload, { dedupeKey: `unverified:${params.guildId}:${params.discordId}` });
      await writeAudit(tx, {
        actorType: 'discord_user',
        actorId: params.actorDiscordId,
        action: 'verification.revoked',
        targetType: 'discord_user',
        targetId: params.discordId,
        guildId: params.guildId,
        reason: params.reason,
        metadata: { robloxUserId: row.roblox_user_id },
      });
      return { robloxUserId: row.roblox_user_id };
    });
  }

  /**
   * Bereinigung: abgelaufene offene Sessions schließen (Verifier löschen) und Sessions älter als
   * retentionHours vollständig entfernen.
   */
  async cleanup(retentionHours = 24): Promise<{ expired: number; deleted: number }> {
    const expired = await this.pool.query(
      `UPDATE oauth_verification_sessions SET status = 'failed', failure_code = 'SESSION_EXPIRED', code_verifier = NULL, completed_at = now()
       WHERE status IN ('created', 'started') AND expires_at <= now()`,
    );
    // 'exchanging' hängt nur bei Prozessabsturz während des Token-Austauschs fest.
    await this.pool.query(
      `UPDATE oauth_verification_sessions SET status = 'failed', failure_code = 'INTERNAL', code_verifier = NULL, completed_at = now()
       WHERE status = 'exchanging' AND expires_at <= now() - interval '5 minutes'`,
    );
    const deleted = await this.pool.query(
      `DELETE FROM oauth_verification_sessions WHERE created_at < now() - make_interval(hours => $1)`,
      [retentionHours],
    );
    return { expired: expired.rowCount ?? 0, deleted: deleted.rowCount ?? 0 };
  }
}
