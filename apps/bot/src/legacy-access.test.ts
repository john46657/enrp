import { describe, expect, it } from 'vitest';
import { LEGACY_COMMAND_PERMISSIONS, isKnownCommand } from '@enrp/permissions';
import { LEGACY_COMMAND_FILES } from './legacy';
import { legacyAccess } from './legacy-access';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'legacy', 'index.js'));

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
