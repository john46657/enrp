import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseHandle, SqlConnection } from './database.js';

/** apps/api/migrations – gilt für src/db (Entwicklung) und dist/db (Produktion) gleichermaßen. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Beliebige, feste Zahl: verhindert, dass zwei Prozesse gleichzeitig migrieren (nur PostgreSQL).
const ADVISORY_LOCK_ID = 7_310_524;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  applied: number[];
  pending: Migration[];
  /** Höchste Version, die die Datenbank haben sollte. */
  latest: number;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export function checksum(sql: string): string {
  // Zeilenenden vereinheitlichen, damit ein Windows-Checkout nicht als Änderung zählt.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Prüft Dateinamen und Reihenfolge; Lücken oder doppelte Nummern sind ein Fehler. */
export function parseMigrations(files: { fileName: string; sql: string }[]): Migration[] {
  const migrations = files
    .map(({ fileName, sql }) => {
      const match = FILE_PATTERN.exec(fileName);
      if (!match) {
        throw new MigrationError(
          `Ungültiger Dateiname "${fileName}". Erwartet: 0001_beschreibung.sql (Kleinbuchstaben, Ziffern, _).`,
        );
      }
      return { version: Number(match[1]), name: match[2] as string, sql, checksum: checksum(sql) };
    })
    .sort((a, b) => a.version - b.version);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        `Migrationen müssen lückenlos ab 0001 nummeriert sein; erwartet ${String(index + 1).padStart(4, '0')}, ` +
          `gefunden ${String(migration.version).padStart(4, '0')}_${migration.name}.sql.`,
      );
    }
  });
  return migrations;
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const fileNames = (await readdir(dir)).filter((name) => name.endsWith('.sql'));
  const files = await Promise.all(
    fileNames.map(async (fileName) => ({ fileName, sql: await readFile(path.join(dir, fileName), 'utf8') })),
  );
  return parseMigrations(files);
}

async function ensureBookkeeping(conn: SqlConnection): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     integer PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
}

async function readApplied(conn: SqlConnection): Promise<Map<number, { name: string; checksum: string }>> {
  const exists = await conn.query<{ found: string | null }>(
    `SELECT to_regclass('schema_migrations')::text AS found`,
  );
  if (!exists[0]?.found) return new Map();
  const rows = await conn.query<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map((row) => [Number(row.version), { name: row.name, checksum: row.checksum }]));
}

function compare(
  applied: Map<number, { name: string; checksum: string }>,
  migrations: Migration[],
): MigrationStatus {
  const known = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const [version, row] of applied) {
    const migration = known.get(version);
    if (!migration) {
      throw new MigrationError(
        `Die Datenbank kennt Migration ${version} (${row.name}), die im Code fehlt. ` +
          'Läuft hier eine ältere Programmversion als zuletzt verwendet?',
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `Migration ${String(version).padStart(4, '0')}_${migration.name}.sql wurde nach dem Anwenden verändert. ` +
          'Angewendete Migrationen dürfen nicht geändert werden – bitte die Änderung rückgängig machen ' +
          'und stattdessen eine neue Migration anlegen.',
      );
    }
  }
  return {
    applied: [...applied.keys()].sort((a, b) => a - b),
    pending: migrations.filter((migration) => !applied.has(migration.version)),
    latest: migrations.at(-1)?.version ?? 0,
  };
}

/** Nur lesen: Welche Migrationen sind angewendet, welche fehlen noch? */
export async function getMigrationStatus(
  handle: DatabaseHandle,
  migrations?: Migration[],
): Promise<MigrationStatus> {
  const all = migrations ?? (await loadMigrations());
  const conn = await handle.connect();
  try {
    return compare(await readApplied(conn), all);
  } finally {
    await conn.release();
  }
}

/** Wendet alle ausstehenden Migrationen an – jede in einer eigenen Transaktion. */
export async function migrate(
  handle: DatabaseHandle,
  migrations?: Migration[],
): Promise<{ applied: Migration[]; status: MigrationStatus }> {
  const all = migrations ?? (await loadMigrations());
  const conn = await handle.connect();
  const useLock = handle.kind === 'postgres';
  try {
    if (useLock) await conn.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    await ensureBookkeeping(conn);
    const { pending } = compare(await readApplied(conn), all);

    const applied: Migration[] = [];
    for (const migration of pending) {
      await conn.exec('BEGIN');
      try {
        await conn.exec(migration.sql);
        await conn.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await conn.exec('COMMIT');
      } catch (err) {
        await conn.exec('ROLLBACK');
        throw new MigrationError(
          `Migration ${String(migration.version).padStart(4, '0')}_${migration.name}.sql ist fehlgeschlagen ` +
            `und wurde vollständig zurückgenommen: ${(err as Error).message}`,
        );
      }
      applied.push(migration);
    }
    return { applied, status: compare(await readApplied(conn), all) };
  } finally {
    if (useLock) await conn.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => undefined);
    await conn.release();
  }
}
