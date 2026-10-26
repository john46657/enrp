import { automations, backups, expireApprovals, game, monitoring, type CoreContext } from '@enrp/core';

/**
 * Prüft regelmäßig Dienste, Roblox-Verbindung und Backups und löst passende Automatisierungen aus.
 * Wiederholungen werden durch Cooldowns der Regeln und Deduplizierung der Vorfälle begrenzt.
 */
export async function runWatchdog(ctx: CoreContext) {
  const now = ctx.now();
  const fired: string[] = [];
  for (const s of await monitoring.serviceStatuses(ctx.db, now)) {
    if (s.service !== 'worker' && s.status === 'down') {
      await automations.fireTrigger(ctx, 'service_down', { service: s.service, summary: `${s.service} meldet sich seit ${s.ageSeconds} s nicht.`, dedupeKey: s.service });
      fired.push(`service_down:${s.service}`);
    }
  }
  const roblox = await game.serverOverview(ctx.db, now);
  if (!roblox.connected && roblox.lastHeartbeatAt && now.getTime() - roblox.lastHeartbeatAt.getTime() > 10 * 60_000) {
    await automations.fireTrigger(ctx, 'roblox_disconnected', { summary: `Kein Roblox-Server seit ${Math.round((now.getTime() - roblox.lastHeartbeatAt.getTime()) / 60_000)} Minuten.`, dedupeKey: 'roblox' });
    fired.push('roblox_disconnected');
  }
  const b = await backups.backupHealth(ctx.db, now);
  if (b.consecutiveFailures > 0) {
    await automations.fireTrigger(ctx, 'backup_failed', { count: b.consecutiveFailures, summary: `${b.consecutiveFailures} Backup(s) in Folge fehlgeschlagen.`, dedupeKey: 'backup' });
    fired.push('backup_failed');
  }
  const expired = await expireApprovals(ctx.db, now);
  return { fired, expiredApprovals: expired };
}
