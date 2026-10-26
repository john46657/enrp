import { createPool, migrate } from '@emden-network/database';

/** Setzt die Test-Datenbank vollständig zurück und wendet alle Migrationen an. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://enrp:enrp_dev@localhost:5432/enrp_test';
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error(`Sicherheitsabbruch: TEST_DATABASE_URL muss auf eine Datenbank mit "test" im Namen zeigen (${new URL(url).pathname}).`);
  }
  const pool = createPool({ connectionString: url, statementTimeoutMs: 0 });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
