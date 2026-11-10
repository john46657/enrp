import { backups, game, monitoring, pendingApprovalCount, support, incidents, isFlagEnabled } from '@enrp/core';
import { type ApiDeps } from '../types';

async function timed<T>(
  fn: () => Promise<T>,
  timeoutMs = 2000,
): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const start = performance.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung')), timeoutMs)),
    ]);
    return { ok: true, ms: Math.round(performance.now() - start), value };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - start), error: (err as Error).message };
  }
}

/** Abhängigkeiten mit echten Messungen. Nicht konfigurierte Dienste werden als solche gekennzeichnet. */
export async function dependencyStatus(deps: ApiDeps) {
  const db = await timed(() => deps.database.ping());
  const redis = deps.redis ? await timed(() => deps.redis!.ping()) : null;
  return [
    { name: 'postgres', status: db.ok ? 'up' : 'down', latencyMs: db.ms, error: db.error ?? null },
    redis
      ? { name: 'redis', status: redis.ok ? 'up' : 'down', latencyMs: redis.ms, error: redis.error ?? null }
      : { name: 'redis', status: 'not_configured', latencyMs: null, error: null },
    {
      name: 'discord_api',
      status: deps.core.discord.configured ? 'configured' : 'not_configured',
      latencyMs: null,
      error: null,
    },
    {
      name: 'discord_oauth',
      status: deps.oauth.discord.configured ? 'configured' : 'not_configured',
      latencyMs: null,
      error: null,
    },
    {
      name: 'roblox_oauth',
      status: deps.oauth.roblox.configured ? 'configured' : 'not_configured',
      latencyMs: null,
      error: null,
    },
  ];
}

export async function healthReport(deps: ApiDeps) {
  const now = deps.core.now();
  const dependencies = await dependencyStatus(deps);
  const db = dependencies.find((d) => d.name === 'postgres')!;
  if (db.status !== 'up') return { status: 'down' as const, dependencies, services: null, roblox: null, queues: null };
  const services = await monitoring.serviceStatuses(deps.core.db, now);
  const roblox = await game.serverOverview(deps.core.db, now);
  const queues = deps.bullQueue ? await timed(() => deps.bullQueue!.counts()) : null;
  const degraded = dependencies.some((d) => d.status === 'down') || services.some((s) => s.status === 'down');
  return {
    status: degraded ? ('degraded' as const) : ('up' as const),
    dependencies,
    services: services.map((s) => (s.service === 'api' ? { ...s, status: 'up' as const } : s)),
    roblox: {
      connected: roblox.connected,
      servers: roblox.servers.length,
      playersOnline: roblox.playersOnline,
      lastHeartbeatAt: roblox.lastHeartbeatAt,
    },
    queues: queues?.ok ? queues.value : null,
    version: deps.env.APP_ENV + '/' + deps.env.APP_VERSION,
  };
}

/** Warnungen aus echten Zuständen (keine erfundenen Werte). */
export async function activeAlerts(deps: ApiDeps) {
  const now = deps.core.now();
  const alerts: Array<{ severity: 'critical' | 'warning' | 'info'; code: string; message: string }> = [];
  if (await isFlagEnabled(deps.core.db, 'kill_switch'))
    alerts.push({ severity: 'critical', code: 'kill_switch', message: 'Notfall-Kill-Switch ist aktiv.' });
  if (await isFlagEnabled(deps.core.db, 'maintenance_mode'))
    alerts.push({ severity: 'warning', code: 'maintenance', message: 'Wartungsmodus ist aktiv.' });
  const NAMES: Record<string, string> = { bot: 'Der Discord-Bot', worker: 'Der Worker' };
  for (const s of await monitoring.serviceStatuses(deps.core.db, now)) {
    if (s.service !== 'api' && s.status === 'down')
      alerts.push({
        severity: 'critical',
        code: `${s.service}_down`,
        message: `${NAMES[s.service]} meldet sich seit ${Math.round((s.ageSeconds ?? 0) / 60)} Minuten nicht.`,
      });
    if (s.service !== 'api' && s.status === 'unknown')
      alerts.push({
        severity: 'info',
        code: `${s.service}_unknown`,
        message: `${NAMES[s.service]} hat sich noch nie gemeldet.`,
      });
  }
  const b = await backups.backupHealth(deps.core.db, now);
  if (b.consecutiveFailures > 0)
    alerts.push({
      severity: b.consecutiveFailures >= 2 ? 'critical' : 'warning',
      code: 'backup_failed',
      message: `${b.consecutiveFailures} Backup(s) in Folge fehlgeschlagen.`,
    });
  if (b.lastSuccessAt === null)
    alerts.push({
      severity: 'warning',
      code: 'backup_none',
      message: 'Es gibt noch kein erfolgreich geprüftes Backup.',
    });
  else if ((b.hoursSinceSuccess ?? 0) > 36)
    alerts.push({
      severity: 'warning',
      code: 'backup_stale',
      message: `Letztes erfolgreiches Backup vor ${b.hoursSinceSuccess} Stunden.`,
    });
  const roblox = await game.serverOverview(deps.core.db, now);
  if (!roblox.connected && roblox.lastHeartbeatAt)
    alerts.push({
      severity: 'warning',
      code: 'roblox_disconnected',
      message: 'Kein Roblox-Server meldet sich aktuell.',
    });
  const errorRate = deps.metrics.snapshot().last5Minutes.errorRate;
  if (errorRate !== null && errorRate > 5)
    alerts.push({ severity: 'warning', code: 'error_rate', message: `Fehlerquote der API: ${errorRate} % (5 Min.).` });
  return alerts;
}

export async function overview(deps: ApiDeps) {
  const now = deps.core.now();
  const [health, counts, openIncidents, approvals, alerts] = await Promise.all([
    healthReport(deps),
    support.supportCounts(deps.core.db),
    incidents.openIncidentCount(deps.core.db),
    pendingApprovalCount(deps.core.db),
    activeAlerts(deps),
  ]);
  return {
    generatedAt: now,
    health,
    ...counts,
    openIncidents,
    pendingApprovals: approvals,
    alerts,
    api: deps.metrics.snapshot(),
  };
}
