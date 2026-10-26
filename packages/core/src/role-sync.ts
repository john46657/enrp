import { BRAND } from '@emden-network/shared';
import type { Pool } from '@emden-network/database';
import { writeAudit } from './audit.js';
import { getGuildConfig } from './guild-config.js';
import { PermanentError, type OutboxEvent, type OutboxProcessor } from './outbox.js';
import { OUTBOX_ROLE_GRANT, OUTBOX_ROLE_REVOKE, type RoleOutboxPayload } from './verification.js';

/** Abstraktion über Discord, damit die Logik ohne echten Discord-Server testbar ist. */
export interface DiscordGateway {
  /** Liefert false, wenn das Mitglied nicht (mehr) auf dem Server ist. */
  memberExists(guildId: string, userId: string): Promise<boolean>;
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  /** Darf fehlschlagen (DMs deaktiviert) – liefert dann false. */
  sendDirectMessage(userId: string, content: string): Promise<boolean>;
}

/**
 * Registriert die Handler für Rollenvergabe/-entzug. Der Bot vergibt dabei ausschließlich die Rolle
 * „Verifiziert“ (und entfernt optional „Unverified“) – niemals Fraktionsrollen.
 */
export function registerRoleSyncHandlers(processor: OutboxProcessor, pool: Pool, discord: DiscordGateway): void {
  processor.on(OUTBOX_ROLE_GRANT, async (event: OutboxEvent) => {
    const p = event.payload as RoleOutboxPayload;
    const cfg = await getGuildConfig(pool, p.guildId);
    if (!cfg.verifiedRoleId) throw new PermanentError('Rolle „Verifiziert“ ist nicht konfiguriert (/system config)');

    // Verknüpfung könnte zwischenzeitlich aufgehoben worden sein -> keine Rolle vergeben.
    const { rows } = await pool.query(
      'SELECT 1 FROM discord_links l JOIN users u ON u.id = l.user_id WHERE u.discord_id = $1 AND l.revoked_at IS NULL',
      [p.discordId],
    );
    if (rows.length === 0) return;
    if (!(await discord.memberExists(p.guildId, p.discordId))) throw new PermanentError('Mitglied ist nicht auf dem Server');

    await discord.addRole(p.guildId, p.discordId, cfg.verifiedRoleId, `${BRAND.name}: Roblox-Verifizierung`);
    if (cfg.unverifiedRoleId) await discord.removeRole(p.guildId, p.discordId, cfg.unverifiedRoleId, `${BRAND.name}: Roblox-Verifizierung`);
    await writeAudit(pool, { actorType: 'system', action: 'discord.verified_role_granted', targetType: 'discord_user', targetId: p.discordId, guildId: p.guildId });
    if (p.notify) {
      const who = p.robloxUsername ? ` mit **${p.robloxUsername}**` : '';
      await discord.sendDirectMessage(p.discordId, `✅ Dein Discord-Account wurde erfolgreich${who} verknüpft. Du hast jetzt die Rolle **Verifiziert** auf ${BRAND.name}.`);
    }
  });

  processor.on(OUTBOX_ROLE_REVOKE, async (event: OutboxEvent) => {
    const p = event.payload as RoleOutboxPayload;
    const cfg = await getGuildConfig(pool, p.guildId);
    if (!cfg.verifiedRoleId) throw new PermanentError('Rolle „Verifiziert“ ist nicht konfiguriert');
    // Inzwischen neu verknüpft -> Rolle behalten.
    const { rows } = await pool.query(
      'SELECT 1 FROM discord_links l JOIN users u ON u.id = l.user_id WHERE u.discord_id = $1 AND l.revoked_at IS NULL',
      [p.discordId],
    );
    if (rows.length > 0) return;
    if (!(await discord.memberExists(p.guildId, p.discordId))) return; // nichts zu entziehen
    await discord.removeRole(p.guildId, p.discordId, cfg.verifiedRoleId, `${BRAND.name}: Verknüpfung aufgehoben`);
    if (cfg.unverifiedRoleId) await discord.addRole(p.guildId, p.discordId, cfg.unverifiedRoleId, `${BRAND.name}: Verknüpfung aufgehoben`);
    await writeAudit(pool, { actorType: 'system', action: 'discord.verified_role_removed', targetType: 'discord_user', targetId: p.discordId, guildId: p.guildId });
    if (p.notify) await discord.sendDirectMessage(p.discordId, `ℹ️ Deine Roblox-Verknüpfung auf ${BRAND.name} wurde vom Team aufgehoben.`);
  });
}
