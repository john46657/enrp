import { type Interaction } from 'discord.js';
import { ApiClientError, createApiClient, type ApiClient } from '@enrp/shared';
import { type BotEnv } from './env';

export function memberRoleIds(interaction: Interaction): string[] {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  return [...roles.cache.keys()].filter((id) => id !== interaction.guildId);
}

/** API-Client im Namen der handelnden Person. Die API prüft alle Rechte selbst. */
export function createApiFactory(env: BotEnv) {
  const service = createApiClient({ baseUrl: env.API_URL, headers: () => ({ authorization: `Bearer ${env.BOT_API_TOKEN}` }) });
  return {
    service,
    forInteraction(interaction: Interaction): ApiClient {
      return createApiClient({
        baseUrl: env.API_URL,
        timeoutMs: 10_000,
        headers: () => ({
          authorization: `Bearer ${env.BOT_API_TOKEN}`,
          'x-actor-id': interaction.user.id,
          'x-actor-roles': memberRoleIds(interaction).join(','),
          'x-actor-name': encodeURIComponent(interaction.user.username),
        }),
      });
    },
  };
}
export type ApiFactory = ReturnType<typeof createApiFactory>;

const MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Die Plattform ist gerade nicht erreichbar. Bitte versuche es später erneut.',
  TIMEOUT: 'Die Plattform antwortet nicht rechtzeitig. Bitte versuche es später erneut.',
  RATE_LIMITED: 'Zu viele Anfragen – bitte kurz warten.',
  KILL_SWITCH_ACTIVE: '🛑 Der Notfall-Kill-Switch ist aktiv. Schreibende Aktionen sind vorübergehend gesperrt.',
};

export function describeError(err: unknown): string {
  if (err instanceof ApiClientError) {
    const base = MESSAGES[err.code] ?? err.message;
    return err.code === 'INTERNAL' && err.requestId ? `${base} (Referenz: ${err.requestId})` : base;
  }
  return 'Unerwarteter Fehler. Das Team wurde informiert.';
}
