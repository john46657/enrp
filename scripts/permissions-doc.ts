// Aktualisiert die Matrix in docs/berechtigungen.md: pnpm docs:permissions
import { readFile, writeFile } from 'node:fs/promises';
import { permissionMatrixMarkdown } from '@emden-network/shared';

const file = new URL('../docs/berechtigungen.md', import.meta.url);
const doc = await readFile(file, 'utf8');
const start = '<!-- matrix:start -->';
const end = '<!-- matrix:end -->';
const next = doc.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${permissionMatrixMarkdown()}\n${end}`);
await writeFile(file, next);
console.log('docs/berechtigungen.md aktualisiert.');
