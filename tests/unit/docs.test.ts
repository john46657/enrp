import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { permissionMatrixMarkdown } from '@emden-network/shared';

describe('Dokumentation', () => {
  it('Berechtigungsmatrix in docs/berechtigungen.md entspricht dem Code (pnpm docs:permissions)', async () => {
    const doc = await readFile(new URL('../../docs/berechtigungen.md', import.meta.url), 'utf8');
    expect(doc).toContain(permissionMatrixMarkdown());
  });
});
