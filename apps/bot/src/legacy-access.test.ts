import { describe, expect, it } from 'vitest';
import {
  LEGACY_ACTIONS,
  LEGACY_COMMAND_PERMISSIONS,
  LEGACY_COMPONENT_PERMISSIONS,
  LEGACY_LIVE,
  LEGACY_SETTING_ROOTS,
  isKnownCommand,
  legacyComponentPermission,
} from '@enrp/permissions';
import { LEGACY_COMMAND_FILES } from './legacy';
import { legacyAccess } from './legacy-access';
import { runLegacyRequest } from './legacy-bridge';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const legacyDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'legacy');
const req = createRequire(path.join(legacyDir, 'index.js'));

describe('Altbefehle im Rechtesystem', () => {
  it('bisherige Rechte bleiben, Plattform-Rechte und Overrides kommen dazu', () => {
    const base = { disabled: false, hasDiscordPermission: false };
    expect(legacyAccess({ ...base, access: { allowed: true, source: 'permission' } })).toBe('grant');
    expect(legacyAccess({ ...base, access: { allowed: true, source: 'override-allow' } })).toBe('grant');
    expect(legacyAccess({ ...base, access: { allowed: true, source: 'owner' } })).toBe('grant');
    // Öffentliche Befehle: nur das bisherige Verhalten (keine Staff-Freigabe)
    expect(legacyAccess({ ...base, access: { allowed: true, source: 'public' } })).toBe('legacy');
    expect(legacyAccess({ ...base, access: { allowed: false, source: 'permission' } })).toBe('denied');
    expect(
      legacyAccess({ ...base, hasDiscordPermission: true, access: { allowed: false, source: 'permission' } }),
    ).toBe('legacy');
    expect(
      legacyAccess({ ...base, hasDiscordPermission: true, access: { allowed: false, source: 'override-deny' } }),
    ).toBe('override-deny');
    expect(legacyAccess({ ...base, disabled: true, access: { allowed: true, source: 'owner' } })).toBe('disabled');
    // Plattform nicht erreichbar → wie bisher
    expect(legacyAccess({ ...base, hasDiscordPermission: true, access: null })).toBe('legacy');
    expect(legacyAccess({ ...base, access: null })).toBe('denied');
  });

  it('jeder Altbefehl/Unterbefehl hat eine Rechteregel, keine erfundenen Einträge', () => {
    const keys: string[] = [];
    for (const file of LEGACY_COMMAND_FILES) {
      const json = req(`./src/commands/${file}`).data.toJSON() as {
        name: string;
        options?: Array<{ type: number; name: string }>;
      };
      const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => `${json.name} ${o.name}`);
      keys.push(...(subs.length ? subs : [json.name]));
    }
    for (const key of keys) expect(isKnownCommand(key), key).toBe(true);
    expect(Object.keys(LEGACY_COMMAND_PERMISSIONS).filter((k) => !keys.includes(k))).toEqual([]);
  });
});

describe('Buttons der Altmodule und Dashboard-Brücke', () => {
  it('jede Staff-Aktion im Katalog gibt es als Komponente der Altmodule', () => {
    const prefixes = new Set(
      LEGACY_COMMAND_FILES.flatMap((file) => Object.keys(req(`./src/commands/${file}`).components ?? {})),
    );
    const source = (prefix: string) =>
      readFileSync(
        path.join(legacyDir, 'src', 'commands', prefix === 'ticket' ? 'tickets/ticket.js' : 'applications/apply.js'),
        'utf8',
      );
    for (const key of Object.keys(LEGACY_COMPONENT_PERMISSIONS)) {
      const [prefix, action] = key.split(':') as [string, string];
      expect(prefixes.has(prefix), key).toBe(true);
      expect(source(prefix), key).toContain(`case '${action}':`);
    }
    expect(legacyComponentPermission('ticket:claim')).toBe('tickets:edit');
    expect(legacyComponentPermission('quali:decide:APP-0001:accept')).toBe('applications:edit');
    // Für alle: Ticket öffnen, bewerben, Rollenpanel
    expect(legacyComponentPermission('ticket:open')).toBeNull();
    expect(legacyComponentPermission('quali:apply:polizei')).toBeNull();
    expect(legacyComponentPermission('role:123')).toBeNull();
  });

  it('Bot und Plattform kennen dieselben Daten, Aktionen und Einstellungsbereiche', () => {
    const bridge = req('./src/lib/platformBridge') as { LIVE: string[]; ACTIONS: string[]; EDITABLE: string[] };
    expect([...bridge.LIVE].sort()).toEqual(Object.keys(LEGACY_LIVE).sort());
    expect([...bridge.ACTIONS].sort()).toEqual(Object.keys(LEGACY_ACTIONS).sort());
    expect([...bridge.EDITABLE].sort()).toEqual(Object.keys(LEGACY_SETTING_ROOTS).sort());
  });

  it('Fehler der Altmodule werden zur Meldung, Ergebnisse zu JSON', async () => {
    const guild = { id: '1' } as never;
    const request = { id: 'r', kind: 'action', name: 'x', payload: {}, actorDiscordId: '2' };
    expect(await runLegacyRequest(async () => undefined, guild, request)).toEqual({ ok: true, result: null });
    expect(await runLegacyRequest(async () => ({ a: 1, b: undefined }), guild, request)).toEqual({
      ok: true,
      result: { a: 1 },
    });
    expect(
      await runLegacyRequest(
        async () => {
          throw new Error('Diese Bewerbung gibt es nicht mehr.');
        },
        guild,
        request,
      ),
    ).toEqual({ ok: false, error: 'Diese Bewerbung gibt es nicht mehr.' });
    expect(await runLegacyRequest(async () => 1, null, request)).toMatchObject({ ok: false });
  });
});
