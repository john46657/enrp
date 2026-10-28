import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, ROLE_KEYS } from '@emden/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseLockedError, openDatabase, type DatabaseHandle } from '../src/db/database.js';
import {
  MigrationError,
  checksum,
  getMigrationStatus,
  loadMigrations,
  migrate,
  parseMigrations,
} from '../src/db/migrate.js';
import { createTestDatabase, expectSchemaMatchesDatabase } from './support/database.js';

describe('parseMigrations', () => {
  it('sortiert nach Nummer und liest Version und Namen', () => {
    const migrations = parseMigrations([
      { fileName: '0002_zwei.sql', sql: 'SELECT 2;' },
      { fileName: '0001_eins.sql', sql: 'SELECT 1;' },
    ]);
    expect(migrations.map((m) => [m.version, m.name])).toEqual([
      [1, 'eins'],
      [2, 'zwei'],
    ]);
  });

  it.each(['1_kurz.sql', '0001-bindestrich.sql', '0001_Gross.sql', '0001_.sql'])(
    'lehnt den Dateinamen %s ab',
    (name) => {
      expect(() => parseMigrations([{ fileName: name, sql: '' }])).toThrow(MigrationError);
    },
  );

  it('lehnt Lücken und doppelte Nummern ab', () => {
    expect(() => parseMigrations([{ fileName: '0002_ohne_eins.sql', sql: '' }])).toThrow(/lückenlos/);
    expect(() =>
      parseMigrations([
        { fileName: '0001_a.sql', sql: '' },
        { fileName: '0001_b.sql', sql: '' },
      ]),
    ).toThrow(/lückenlos/);
  });

  it('behandelt Windows-Zeilenenden wie Unix-Zeilenenden', () => {
    expect(checksum('A;\r\nB;\r\n')).toBe(checksum('A;\nB;\n'));
  });

  it('findet die mitgelieferten Migrationen', async () => {
    const migrations = await loadMigrations();
    expect(migrations[0]).toMatchObject({ version: 1, name: 'initial' });
  });
});

describe('Migrationen auf einer frischen Datenbank', () => {
  let db: DatabaseHandle;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db.close();
  });

  it('wendet alle Migrationen an und meldet nichts mehr als ausstehend', async () => {
    const status = await getMigrationStatus(db);
    expect(status.pending).toEqual([]);
    expect(status.applied).toEqual([1]);
  });

  it('ist idempotent: ein zweiter Lauf ändert nichts', async () => {
    const { applied } = await migrate(db);
    expect(applied).toEqual([]);
  });

  it('erzeugt genau das Schema, das der TypeScript-Code erwartet (Schema-Abgleich)', async () => {
    await expectSchemaMatchesDatabase(db);
  });

  it('legt die Systemrollen in der richtigen Rangfolge an', async () => {
    const rows = await db.query<{ key: string }>('SELECT key FROM roles ORDER BY rank DESC');
    expect(rows.map((r) => r.key)).toEqual([...ROLE_KEYS]);
  });

  it('legt genau die im Code definierten Berechtigungen und Standardzuordnungen an', async () => {
    const permissions = await db.query<{ key: string }>('SELECT key FROM permissions ORDER BY key');
    expect(permissions.map((r) => r.key)).toEqual([...PERMISSION_KEYS].sort());

    const mapping = await db.query<{ role_key: string; permission_key: string }>(
      'SELECT role_key, permission_key FROM role_permissions ORDER BY role_key, permission_key',
    );
    const expected = Object.entries(DEFAULT_ROLE_PERMISSIONS)
      .flatMap(([role, keys]) => keys.map((key) => ({ role_key: role, permission_key: key })))
      .sort((a, b) => `${a.role_key} ${a.permission_key}`.localeCompare(`${b.role_key} ${b.permission_key}`));
    expect(mapping).toEqual(expected);
  });

  it('verhindert nachträgliche Änderungen an Audit-Einträgen', async () => {
    await db.query(
      `INSERT INTO audit_log (actor_type, actor_label, action, outcome) VALUES ('system', 'Test', 'test.event', 'success')`,
    );
    await expect(db.query(`UPDATE audit_log SET actor_label = 'Manipuliert'`)).rejects.toThrow(
      /dürfen nicht verändert werden/,
    );
  });

  it('erzwingt gültige Daten direkt in der Datenbank', async () => {
    const insertUser = (discordId: string, status = 'active') =>
      db.query(
        `INSERT INTO users (discord_user_id, display_name, role_key, status) VALUES ($1, 'Test', 'viewer', $2)`,
        [discordId, status],
      );
    await expect(insertUser('123')).rejects.toThrow(); // zu kurz für eine Discord-ID
    await expect(insertUser('12345678901234567x')).rejects.toThrow();
    await expect(insertUser('123456789012345678', 'gelöscht')).rejects.toThrow();
    await expect(insertUser('123456789012345678')).resolves.toBeDefined();
    await expect(insertUser('123456789012345678')).rejects.toThrow(); // doppelt
    // Ein "user"-Eintrag ohne Benutzer-ID ist widersprüchlich.
    await expect(
      db.query(
        `INSERT INTO audit_log (actor_type, actor_label, action, outcome) VALUES ('user', 'X', 'a.b', 'success')`,
      ),
    ).rejects.toThrow();
  });

  it('erkennt nachträglich veränderte Migrationsdateien', async () => {
    const [migration] = await loadMigrations();
    const tampered = parseMigrations([
      { fileName: '0001_initial.sql', sql: `${migration?.sql}\n-- geändert` },
    ]);
    await expect(getMigrationStatus(db, tampered)).rejects.toThrow(/nach dem Anwenden verändert/);
    await expect(migrate(db, tampered)).rejects.toThrow(MigrationError);
  });

  it('erkennt Migrationen in der Datenbank, die im Code fehlen', async () => {
    await expect(getMigrationStatus(db, [])).rejects.toThrow(/die im Code fehlt/);
  });
});

describe('Fehlgeschlagene Migration', () => {
  it('nimmt eine fehlerhafte Migration vollständig zurück', async () => {
    const db = await openDatabase({ kind: 'pglite', dataDir: null });
    try {
      const migrations = parseMigrations([
        { fileName: '0001_gut.sql', sql: 'CREATE TABLE gut (id int);' },
        { fileName: '0002_kaputt.sql', sql: 'CREATE TABLE halb (id int);\nSELECT * FROM gibt_es_nicht;' },
      ]);
      await expect(migrate(db, migrations)).rejects.toThrow(/0002_kaputt\.sql ist fehlgeschlagen/);
      const [row] = await db.query<{ gut: string | null; halb: string | null }>(
        `SELECT to_regclass('gut')::text AS gut, to_regclass('halb')::text AS halb`,
      );
      expect(row).toEqual({ gut: 'gut', halb: null });
      expect((await getMigrationStatus(db, migrations)).applied).toEqual([1]);
    } finally {
      await db.close();
    }
  });
});

describe('Lokale Entwicklungsdatenbank (PGlite mit Ordner)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emden-pglite-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lässt sich nicht zweimal gleichzeitig öffnen und gibt die Sperre beim Schließen frei', async () => {
    const dataDir = path.join(dir, 'db');
    const first = await openDatabase({ kind: 'pglite', dataDir });
    try {
      await expect(openDatabase({ kind: 'pglite', dataDir })).rejects.toThrow(DatabaseLockedError);
    } finally {
      await first.close();
    }
    // Sperre eines nicht mehr laufenden Prozesses wird übernommen.
    writeFileSync(`${dataDir}.lock`, '2147483646');
    const second = await openDatabase({ kind: 'pglite', dataDir });
    await second.close();
  });
});
