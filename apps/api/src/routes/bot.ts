import { type FastifyInstance } from 'fastify';
import { getSetting, loadFlags } from '@enrp/core';
import { AppError } from '@enrp/shared';

/** Konfiguration, die der Discord-Bot regelmäßig abruft (Begrüßung, deaktivierte Befehle, Flags). */
export async function botRoutes(app: FastifyInstance) {
  const { core } = app.deps;
  app.get('/bot/config', { schema: { tags: ['Bot'], summary: 'Bot-Konfiguration (nur Service-Token)' } }, async (request) => {
    if (request.authMethod !== 'bot') throw new AppError('FORBIDDEN', 'Nur für den Bot.');
    const flags = Object.fromEntries(await loadFlags(core.db));
    return {
      welcome: await getSetting(core.db, 'welcome'),
      bot: await getSetting(core.db, 'bot'),
      notifications: await getSetting(core.db, 'notifications'),
      verification: await getSetting(core.db, 'verification'),
      flags,
    };
  });
}
