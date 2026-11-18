import { type Client, type Guild } from 'discord.js';
import { type Logger } from '@enrp/config';
import { type ApiClient } from '@enrp/shared';

/**
 * Altmodule im Dashboard: Der Bot holt Anfragen der Plattform per Long-Polling ab (Daten lesen, Aktionen,
 * Einstellungen), führt sie mit den Altmodulen aus (apps/bot/legacy/src/lib/platformBridge.js) und meldet das
 * Ergebnis zurück. Rechte und Audit liegen bei der API.
 */
export interface LegacyRequest {
  id: string;
  kind: string;
  name: string;
  payload: Record<string, unknown>;
  actorDiscordId: string | null;
}

export type LegacyResult = { ok: true; result: unknown } | { ok: false; error: string };

/** Führt eine Anfrage aus; Fehler der Altmodule werden zur Meldung fürs Dashboard. */
export async function runLegacyRequest(
  handle: (guild: Guild, request: LegacyRequest) => Promise<unknown>,
  guild: Guild | null,
  request: LegacyRequest,
): Promise<LegacyResult> {
  if (!guild) return { ok: false, error: 'Der Bot ist nicht auf dem Haupt-Discord.' };
  try {
    const result = await handle(guild, request);
    // Nur Werte, die sich als JSON übertragen lassen (undefined → null).
    return { ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'Unbekannter Fehler';
    return { ok: false, error: message.slice(0, 1000) };
  }
}

export function startLegacyBridge(options: {
  client: Client;
  /** API-Client mit Service-Token und langem Timeout (Long-Polling). */
  api: ApiClient;
  handle: (guild: Guild, request: LegacyRequest) => Promise<unknown>;
  guildId?: string;
  logger: Logger;
}) {
  const { client, api, handle, guildId, logger } = options;
  let stopped = false;
  const mainGuild = () => (guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first()) ?? null;

  async function execute(request: LegacyRequest) {
    const outcome = await runLegacyRequest(handle, mainGuild(), request);
    if (!outcome.ok && request.kind !== 'live')
      logger.info({ name: request.name, error: outcome.error }, 'Dashboard-Aktion der Altmodule abgelehnt');
    await api
      .post(`/api/v1/bot/legacy/requests/${request.id}/result`, outcome)
      .catch((err: Error) => logger.warn({ err: err.message, name: request.name }, 'Ergebnis nicht übermittelt'));
  }

  void (async () => {
    let backoff = 1000;
    let warned = false;
    while (!stopped) {
      try {
        const { items } = await api.get<{ items: LegacyRequest[] }>('/api/v1/bot/legacy/requests', {
          query: { wait: 20 },
        });
        backoff = 1000;
        warned = false;
        // Nicht auf die Ausführung warten: lange Aktionen blockieren sonst das Abholen weiterer Anfragen.
        for (const request of items) void execute(request);
      } catch (err) {
        if (!warned) logger.warn({ err: (err as Error).message }, 'Altmodule: Anfragen der Plattform nicht abrufbar');
        warned = true;
        await new Promise((resolve) => setTimeout(resolve, backoff).unref());
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
