import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRoles, eq, roleBindings } from '@enrp/database';
import { closeDb, createTestContext, OWNER_ID, resetDatabase } from './helpers';
import { botHeaders, createTestApp } from './api-helpers';

const MOD = '730000000000000001';
const MOD_ROLE = '740000000000000001';
const PS_GUILD = '750000000000000001';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('API: Privatserver-Discords', () => {
  it('Rollen aus einem fremden Discord geben keine Plattform-Rechte; /ps-Routen prüfen den Discord', async () => {
    const ctx = createTestContext();
    const { app } = await createTestApp(ctx);
    const [modRole] = await ctx.db.select().from(appRoles).where(eq(appRoles.key, 'moderation'));
    await ctx.db.insert(roleBindings).values({ roleId: modRole!.id, discordRoleId: MOD_ROLE });

    // Im Haupt-Discord gibt die Rolle Moderationsrechte …
    const main = await app.inject({ url: '/api/v1/mod-calls', headers: botHeaders(MOD, [MOD_ROLE]) });
    expect(main.statusCode).toBe(200);
    // … aus einem anderen Discord mit derselben Rollen-ID nicht.
    const foreign = { ...botHeaders(MOD, [MOD_ROLE]), 'x-actor-guild': PS_GUILD, 'x-actor-guild-admin': '1' };
    expect((await app.inject({ url: '/api/v1/mod-calls', headers: foreign })).statusCode).toBe(403);
    const bad = { ...botHeaders(MOD), 'x-actor-guild': 'abc' };
    expect((await app.inject({ url: '/api/v1/mod-calls', headers: bad })).statusCode).toBe(400);

    // Nicht verknüpfter Discord → 403
    expect((await app.inject({ url: '/api/v1/private-servers/guild/status', headers: foreign })).statusCode).toBe(403);

    // Verknüpfen (Owner im Haupt-Discord), dann klappt /ps status im Privatserver-Discord
    const owner = botHeaders(OWNER_ID);
    const linked = await app.inject({
      method: 'POST',
      url: '/api/v1/private-servers',
      headers: owner,
      payload: { link: { guildId: PS_GUILD, name: 'Partner', ownerRobloxId: 5555 }, reason: 'Partnerschaft' },
    });
    expect(linked.statusCode).toBe(200);
    const status = await app.inject({ url: '/api/v1/private-servers/guild/status', headers: foreign });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ link: { name: 'Partner' }, servers: [] });

    const settings = await app.inject({
      method: 'PATCH',
      url: '/api/v1/private-servers/guild/settings',
      headers: foreign,
      payload: { teamLock: true },
    });
    expect(settings.json()).toMatchObject({ teamLock: true });
    const noAdmin = { ...foreign, 'x-actor-guild-admin': '0' };
    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/v1/private-servers/guild/settings',
      headers: noAdmin,
      payload: { teamLock: false },
    });
    expect(denied.statusCode).toBe(403);
    const right = await app.inject({
      method: 'PUT',
      url: '/api/v1/private-servers/guild/rights/polizei',
      headers: foreign,
      payload: { roleId: '760000000000000001' },
    });
    expect(right.json().rightRoles).toEqual([expect.objectContaining({ right: 'polizei' })]);

    // Bot-Endpunkte nur mit Service-Token ohne Person
    expect((await app.inject({ url: '/api/v1/private-servers/bot/links', headers: owner })).statusCode).toBe(403);
    const links = await app.inject({ url: '/api/v1/private-servers/bot/links', headers: botHeaders() });
    expect(links.json().items).toEqual([
      expect.objectContaining({ guildId: PS_GUILD, rightRoles: [{ right: 'polizei', roleId: '760000000000000001' }] }),
    ]);
    const id = links.json().items[0].id;
    const sync = await app.inject({
      method: 'POST',
      url: `/api/v1/private-servers/${id}/sync`,
      headers: botHeaders(),
      payload: { full: true, members: [] },
    });
    expect(sync.json()).toEqual({ added: 0, removed: 0, missingAccount: [] });

    const action = await app.inject({
      method: 'POST',
      url: '/api/v1/private-servers/guild/players/4711/actions',
      headers: foreign,
      payload: { command: { action: 'kick' }, reason: 'Offline-Test' },
    });
    expect(action.statusCode).toBe(400); // Spieler nicht online
    await app.close();
  });
});
