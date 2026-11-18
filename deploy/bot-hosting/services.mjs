// Dienstplan für den Betrieb auf bot-hosting.net (Pterodactyl, ein Node.js-Deployment, ein öffentlicher Port).
//
// Nur das Dashboard lauscht auf dem vom Hoster vergebenen Port (SERVER_PORT) und damit auf der Domain.
// Es reicht /api/* intern an die API (127.0.0.1) weiter. API, Worker und Bot laufen als Kindprozesse
// im selben Deployment. PostgreSQL und Redis laufen als eigene Datenbank-Deployments (oder extern).
//
// Reine Funktionen ohne Seiteneffekte → unit-getestet in services.test.mjs.

export const ALL_SERVICES = ['api', 'worker', 'bot', 'dashboard'];

/** Variablen, die nur ein bestimmter Dienst sehen darf (Geheimnisse so wenig wie möglich streuen). */
const API_ONLY = [
  'DISCORD_CLIENT_SECRET',
  'ROBLOX_CLIENT_SECRET',
  'ROBLOX_OPEN_CLOUD_KEY',
  'METRICS_TOKEN',
  'RELEASE_WEBHOOK_SECRET',
];
const WORKER_ONLY = ['GITHUB_DEPLOY_TOKEN'];
/** Das Dashboard braucht keine Geheimnisse – es ist nur Oberfläche und Proxy. */
const DASHBOARD_ALLOWED = ['NODE_ENV', 'APP_ENV', 'PATH', 'HOME', 'TZ', 'LANG', 'NODE_OPTIONS', 'APP_VERSION'];

export class PlanError extends Error {}

/** Liest den öffentlichen Port wie Pterodactyl/bot-hosting ihn vergibt. */
export function publicPort(env) {
  const raw = env.SERVER_PORT ?? env.PORT;
  const port = Number(raw);
  if (!raw || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PlanError('SERVER_PORT fehlt oder ist ungültig (wird von bot-hosting.net automatisch gesetzt).');
  }
  return port;
}

export function selectedServices(env) {
  const raw = (env.ENRP_SERVICES ?? '').trim();
  if (!raw) return [...ALL_SERVICES];
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = list.filter((s) => !ALL_SERVICES.includes(s));
  if (unknown.length) throw new PlanError(`Unbekannte Dienste in ENRP_SERVICES: ${unknown.join(', ')}`);
  return ALL_SERVICES.filter((s) => list.includes(s));
}

function strip(env, keys) {
  const copy = { ...env };
  for (const k of keys) delete copy[k];
  return copy;
}

/**
 * Erzeugt die Startbefehle. `root` = Repository-Wurzel auf dem Hoster.
 * Rückgabe: [{ name, cwd, command, args, env }]
 */
export function planServices(env, root) {
  const port = publicPort(env);
  const services = selectedServices(env);
  const apiPort = Number(env.API_PORT ?? 4000);
  if (apiPort === port) throw new PlanError('API_PORT darf nicht dem öffentlichen SERVER_PORT entsprechen.');
  const internalApi = env.API_URL ?? `http://127.0.0.1:${apiPort}`;

  // Port-Variablen entfernen: sonst würde z. B. das alte Express-Dashboard der Altmodule den Port belegen.
  const base = strip({ ...env, NODE_ENV: env.NODE_ENV ?? 'production' }, ['SERVER_PORT', 'PORT', 'SERVER_IP']);
  base.APP_ENV ??= 'production';
  base.TRUST_PROXY ??= 'true';

  const node = env.NODE_BINARY ?? 'node';
  const plan = [];
  for (const name of services) {
    if (name === 'api') {
      plan.push({
        name,
        cwd: `${root}/apps/api`,
        command: node,
        args: ['dist/main.js'],
        env: strip(
          {
            ...base,
            API_HOST: '127.0.0.1',
            API_PORT: String(apiPort),
            RUN_MIGRATIONS: env.RUN_MIGRATIONS ?? 'true',
            MIGRATIONS_DIR: env.MIGRATIONS_DIR ?? `${root}/packages/database/drizzle`,
          },
          WORKER_ONLY,
        ),
      });
    } else if (name === 'worker') {
      plan.push({
        name,
        cwd: `${root}/apps/worker`,
        command: node,
        args: ['dist/main.js'],
        env: strip({ ...base, BACKUP_DIR: env.BACKUP_DIR ?? `${root}/data/backups` }, API_ONLY),
      });
    } else if (name === 'bot') {
      plan.push({
        name,
        cwd: `${root}/apps/bot`,
        command: node,
        args: ['dist/main.js'],
        env: strip({ ...base, API_URL: internalApi, LEGACY_DASHBOARD: 'false' }, [...API_ONLY, ...WORKER_ONLY]),
      });
    } else if (name === 'dashboard') {
      const dashEnv = {};
      for (const k of DASHBOARD_ALLOWED) if (base[k] !== undefined) dashEnv[k] = base[k];
      Object.assign(dashEnv, {
        API_URL: internalApi,
        PORT: String(port),
        HOSTNAME: '0.0.0.0',
        NEXT_TELEMETRY_DISABLED: '1',
      });
      plan.push({
        name,
        cwd: `${root}/apps/dashboard`,
        command: node,
        // Standalone-Server von Next.js (weniger Arbeitsspeicher als `next start`); boot.sh kopiert .next/static.
        args: ['.next/standalone/apps/dashboard/server.js'],
        env: dashEnv,
      });
    }
  }
  return plan;
}

/** Wartezeit bis zum nächsten Neustart eines abgestürzten Dienstes (exponentiell, gedeckelt). */
export function restartDelay(attempt) {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
}

/** Prüft die Pflichtvariablen vor dem Start und nennt nur Namen, nie Werte. */
export function missingVariables(env, services = selectedServices(env)) {
  const need = new Set();
  if (services.some((s) => s === 'api' || s === 'worker'))
    ['DATABASE_URL', 'REDIS_URL', 'HASH_SECRET'].forEach((k) => need.add(k));
  if (services.includes('api'))
    ['BOT_API_TOKEN', 'PUBLIC_URL', 'DASHBOARD_URL', 'OWNER_DISCORD_IDS'].forEach((k) => need.add(k));
  if (services.includes('bot')) ['BOT_API_TOKEN'].forEach((k) => need.add(k));
  if (services.includes('bot') && !env.DISCORD_BOT_TOKEN && !env.DISCORD_TOKEN) need.add('DISCORD_BOT_TOKEN');
  return [...need].filter((k) => !env[k] || String(env[k]).trim() === '').sort();
}
