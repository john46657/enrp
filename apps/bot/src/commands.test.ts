import { describe, expect, it } from 'vitest';
import { COMMAND_PERMISSIONS, isKnownCommand } from '@enrp/permissions';
import { COMMANDS } from './commands/index';

describe('Slash-Commands', () => {
  const json = COMMANDS.map(
    (c) => c.data.toJSON() as { name: string; options?: Array<{ type: number; name: string }> },
  );

  it('jeder Befehl/Unterbefehl hat eine Rechteregel im zentralen Katalog', () => {
    for (const command of json) {
      const subs = (command.options ?? []).filter((o) => o.type === 1).map((o) => `${command.name} ${o.name}`);
      for (const key of subs.length ? subs : [command.name]) expect(isKnownCommand(key), key).toBe(true);
    }
  });

  it('Namen sind eindeutig und gültig', () => {
    const names = json.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z-]{1,32}$/);
  });

  it('der Katalog enthält keine Befehle, die es nicht gibt', () => {
    const registered = new Set(
      json.flatMap((c) => [c.name, ...(c.options ?? []).filter((o) => o.type === 1).map((o) => `${c.name} ${o.name}`)]),
    );
    const unknown = Object.keys(COMMAND_PERMISSIONS).filter((k) => !registered.has(k));
    expect(unknown).toEqual([]);
  });
});
