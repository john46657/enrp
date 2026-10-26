import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** Transaktion oder Datenbank – Services akzeptieren beides. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
  ping: () => Promise<number>;
}

export function createDatabase(url: string, options: { max?: number; applicationName?: string } = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'enrp',
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
    /** Liefert die Antwortzeit der Datenbank in Millisekunden. */
    ping: async () => {
      const start = performance.now();
      await pool.query('select 1');
      return Math.round(performance.now() - start);
    },
  };
}
