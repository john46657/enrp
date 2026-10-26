import pg from 'pg';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Alles, worauf man Queries ausführen kann: Pool oder Client innerhalb einer Transaktion. */
export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

// bigint (int8) als string zurückgeben, um Präzisionsverlust bei Roblox-IDs zu vermeiden.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

export interface PoolOptions {
  connectionString: string;
  max?: number;
  applicationName?: string;
  statementTimeoutMs?: number;
}

export function createPool(opts: PoolOptions): Pool {
  return new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? 'emden-network',
    statement_timeout: opts.statementTimeoutMs ?? 10_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Führt fn in einer Transaktion aus. Bei einem Fehler wird zurückgerollt und der Fehler weitergeworfen.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Verbindung ist kaputt; der ursprüngliche Fehler ist relevanter.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** PostgreSQL-Fehlercodes, die fachlich ausgewertet werden. */
export const PgErrorCode = {
  UniqueViolation: '23505',
  ForeignKeyViolation: '23503',
  CheckViolation: '23514',
} as const;

export function isPgError(err: unknown, code?: string): err is { code: string; constraint?: string } {
  return typeof err === 'object' && err !== null && 'code' in err && (code === undefined || (err as { code: unknown }).code === code);
}
