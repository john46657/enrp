import { DEFAULT_ROLE_PERMISSIONS } from '@emden/shared';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { expect } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../src/db/database.js';
import { migrate } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';

/** Frische PGlite-Datenbank im Arbeitsspeicher mit allen Migrationen (Start dauert einige Sekunden). */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const db = await openDatabase({ kind: 'pglite', dataDir: null });
  await migrate(db);
  return db;
}

/** Leert alle Bewegungsdaten und stellt die Standard-Rollenrechte wieder her – für Tests nacheinander. */
export async function resetDatabase(handle: DatabaseHandle): Promise<void> {
  const conn = await handle.connect();
  try {
    await conn.exec(
      'TRUNCATE sessions, audit_log, users RESTART IDENTITY CASCADE; DELETE FROM role_permissions;',
    );
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        await conn.query('INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2)', [
          role,
          permission,
        ]);
      }
    }
  } finally {
    await conn.release();
  }
}

// Alle in schema.ts definierten Tabellen – neue Tabellen werden automatisch mitgeprüft.
const TABLES = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));

/** Schema-Abgleich: Stimmen die Drizzle-Tabellen exakt mit dem überein, was die Migrationen erzeugen? */
export async function expectSchemaMatchesDatabase(handle: DatabaseHandle): Promise<void> {
  const rows = await handle.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, column_name`,
  );
  const actual = rows.map(
    (r) => `${r.table_name}.${r.column_name}: ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`,
  );
  const expected = TABLES.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns.map(
      (column) => `${config.name}.${column.name}: ${column.getSQLType()}${column.notNull ? ' NOT NULL' : ''}`,
    );
  }).sort();
  expect(actual.sort()).toEqual(expected);
}
