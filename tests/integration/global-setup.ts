import pg from 'pg';
import { runMigrations } from '@enrp/database';

/** Setzt die Testdatenbank vollständig zurück und führt alle Migrationen aus. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://enrp:enrp@localhost:5432/enrp_test';
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`Testdatenbank nicht erreichbar (${(err as Error).message}). Setze TEST_DATABASE_URL oder starte PostgreSQL (docker compose up -d postgres).`);
  }
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  await runMigrations(url);
}
