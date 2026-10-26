import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from './pool.js';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(path.join(dir, file), 'utf8');
      return {
        version: file.slice(0, 4),
        name: file.slice(5, -4),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

// Fester Schlüssel für pg_advisory_lock, damit nie zwei Prozesse gleichzeitig migrieren.
const LOCK_KEY = 0x656d64656e; // "emden"

/**
 * Wendet alle ausstehenden Migrationen an – jede in einer eigenen Transaktion.
 * Bereits angewendete Migrationen werden per Prüfsumme gegen nachträgliche Änderungen geprüft.
 */
export async function migrate(pool: Pool, opts: { dir?: string; log?: (msg: string) => void } = {}): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const migrations = await loadMigrations(opts.dir);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const m of migrations) {
      const existing = done.get(m.version);
      if (existing !== undefined) {
        if (existing !== m.checksum) {
          throw new Error(`Migration ${m.version}_${m.name} wurde nach dem Anwenden verändert (Prüfsumme weicht ab). Lege stattdessen eine neue Migration an.`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.version}_${m.name} fehlgeschlagen: ${(err as Error).message}`, { cause: err });
      }
      applied.push(`${m.version}_${m.name}`);
      log(`angewendet: ${m.version}_${m.name}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function migrationStatus(pool: Pool, dir?: string): Promise<{ version: string; name: string; applied: boolean }[]> {
  const migrations = await loadMigrations(dir);
  const exists = await pool.query<{ t: string | null }>("SELECT to_regclass('schema_migrations') AS t");
  const appliedVersions = new Set<string>();
  if (exists.rows[0]?.t) {
    const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
    for (const r of rows) appliedVersions.add(r.version);
  }
  return migrations.map((m) => ({ version: m.version, name: m.name, applied: appliedVersions.has(m.version) }));
}
