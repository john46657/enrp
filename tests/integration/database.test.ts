import { mkdtemp, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, createPool, migrate, withTransaction, type Pool } from '@emden-network/database';
import { ensureUser } from '@emden-network/core';
import { resetDb, snowflake, testPool } from '../helpers/db.js';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb(pool);
});

describe('Datenbank', () => {
  it('rollt Transaktionen bei Fehlern vollständig zurück', async () => {
    const id = snowflake();
    await expect(
      withTransaction(pool, async (tx) => {
        await ensureUser(tx, id);
        throw new Error('Abbruch');
      }),
    ).rejects.toThrow('Abbruch');
    expect((await pool.query('SELECT count(*)::int AS n FROM users WHERE discord_id = $1', [id])).rows[0].n).toBe(0);
  });

  it('erzwingt eindeutige aktive Verknüpfungen auf Datenbankebene', async () => {
    const a = await ensureUser(pool, snowflake());
    const b = await ensureUser(pool, snowflake());
    await pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, 42)', [a]);
    await expect(pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, 42)', [b])).rejects.toMatchObject({ code: '23505', constraint: 'discord_links_active_roblox_uq' });
    await expect(pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, 43)', [a])).rejects.toMatchObject({ code: '23505', constraint: 'discord_links_active_user_uq' });
    // Nach Aufheben ist die Roblox-ID wieder frei, die Historie bleibt erhalten
    await pool.query(`UPDATE discord_links SET revoked_at = now(), revoked_reason = 'x' WHERE user_id = $1`, [a]);
    await pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, 42)', [b]);
    expect((await pool.query('SELECT count(*)::int AS n FROM discord_links WHERE roblox_user_id = 42')).rows[0].n).toBe(2);
  });

  it('lehnt ungültige Discord-IDs per CHECK ab', async () => {
    await expect(pool.query(`INSERT INTO users (discord_id) VALUES ('abc')`)).rejects.toMatchObject({ code: '23514' });
  });

  it('ist idempotent und erkennt nachträglich veränderte Migrationen', async () => {
    expect(await migrate(pool)).toEqual([]);
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await writeFile(path.join(dir, '0001_core_identity.sql'), '-- verändert\n', { flag: 'a' });
    await expect(migrate(pool, { dir })).rejects.toThrow(/Prüfsumme/);
  });

  it('rollt eine fehlerhafte Migration zurück', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await writeFile(path.join(dir, '9999_kaputt.sql'), 'CREATE TABLE zzz_probe (id int); SELECT kaputt FROM gibtsnicht;');
    await expect(migrate(pool, { dir })).rejects.toThrow(/9999_kaputt/);
    expect((await pool.query(`SELECT to_regclass('zzz_probe') AS t`)).rows[0].t).toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM schema_migrations WHERE version = '9999'`)).rows[0].n).toBe(0);
  });

  it('meldet Datenbankausfälle als Fehler statt zu hängen', async () => {
    const broken = createPool({ connectionString: 'postgres://enrp:falsch@127.0.0.1:1/nichts' });
    await expect(broken.query('SELECT 1')).rejects.toThrow();
    await broken.end();
  });
});
