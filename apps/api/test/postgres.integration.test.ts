/**
 * Läuft nur, wenn TEST_DATABASE_URL auf einen PostgreSQL-Server zeigt (z. B. in der CI).
 * Für jeden Lauf wird eine eigene, frische Datenbank angelegt und danach wieder gelöscht –
 * bestehende Datenbanken auf dem Server werden nicht angefasst. Die Rolle braucht CREATEDB.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDatabase, type DatabaseHandle } from '../src/db/database.js';
import { getMigrationStatus, migrate } from '../src/db/migrate.js';
import { testConfig } from './helpers.js';
import { expectSchemaMatchesDatabase } from './support/database.js';

const serverUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!serverUrl)('Echte PostgreSQL-Datenbank (TEST_DATABASE_URL)', () => {
  const dbName = `emden_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Client;
  let url: string;
  const handles: DatabaseHandle[] = [];
  const open = async () => {
    const handle = await openDatabase({ kind: 'postgres', url });
    handles.push(handle);
    return handle;
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: serverUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const target = new URL(serverUrl as string);
    target.pathname = `/${dbName}`;
    url = target.toString();
  });

  afterAll(async () => {
    await Promise.all(handles.map((handle) => handle.close()));
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('wendet die Migrationen an, auch wenn zwei Prozesse gleichzeitig migrieren', async () => {
    const [a, b] = await Promise.all([open(), open()]);
    const results = await Promise.all([migrate(a), migrate(b)]);
    // Die Sperre sorgt dafür, dass genau ein Prozess die Migration ausführt.
    expect(results.map((r) => r.applied.length).sort()).toEqual([0, 1]);
    expect((await getMigrationStatus(a)).pending).toEqual([]);
  });

  it('erzeugt genau das erwartete Schema', async () => {
    await expectSchemaMatchesDatabase(await open());
  });

  it('meldet sich im Systemstatus als PostgreSQL mit aktuellem Schema', async () => {
    const app = await buildApp(testConfig(), { db: await open() });
    const res = await app.inject({ url: '/ready' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().checks[0]).toMatchObject({ status: 'ok', message: 'PostgreSQL, Schema-Version 1.' });
  });
});
