import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;
/** Drizzle-Datenbank – gleiche Schnittstelle für PostgreSQL und PGlite. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export type DatabaseConfig =
  /** Echte PostgreSQL-Datenbank (Pflicht in Produktion). */
  | { kind: 'postgres'; url: string }
  /** PGlite: PostgreSQL als WebAssembly im selben Prozess. dataDir null = nur im Arbeitsspeicher. */
  | { kind: 'pglite'; dataDir: string | null };

type Row = Record<string, unknown>;

/** Eigene Verbindung, z. B. für Migrationen mit mehreren Anweisungen und eigenen Transaktionen. */
export interface SqlConnection {
  /** Mehrere SQL-Anweisungen ohne Parameter ausführen. */
  exec(sql: string): Promise<void>;
  query<R extends Row = Row>(sql: string, params?: unknown[]): Promise<R[]>;
  release(): Promise<void>;
}

export interface DatabaseHandle {
  readonly kind: DatabaseConfig['kind'];
  /** Für Menschen lesbare Bezeichnung, z. B. im Systemstatus. */
  readonly label: string;
  readonly db: Database;
  query<R extends Row = Row>(sql: string, params?: unknown[]): Promise<R[]>;
  connect(): Promise<SqlConnection>;
  close(): Promise<void>;
}

export class DatabaseLockedError extends Error {
  override name = 'DatabaseLockedError';
}

export interface OpenDatabaseOptions {
  /** Fehler ruhender PostgreSQL-Verbindungen (z. B. Neustart des Datenbankservers). */
  onIdleError?: (err: Error) => void;
}

export async function openDatabase(
  config: DatabaseConfig,
  options: OpenDatabaseOptions = {},
): Promise<DatabaseHandle> {
  return config.kind === 'postgres' ? openPostgres(config.url, options) : openPglite(config.dataDir);
}

function openPostgres(url: string, options: OpenDatabaseOptions): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Hängende Abfragen und vergessene Transaktionen werden von PostgreSQL selbst abgebrochen.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'emden-network-backend',
  });
  // Ohne diesen Handler würde der Abbruch einer ruhenden Verbindung den ganzen Prozess beenden.
  pool.on('error', (err) => options.onIdleError?.(err));

  return {
    kind: 'postgres',
    label: 'PostgreSQL',
    db: drizzleNodePg({ client: pool, schema }),
    async query<R extends Row>(text: string, params?: unknown[]) {
      return (await pool.query<R>(text, params)).rows;
    },
    async connect() {
      const client = await pool.connect();
      return {
        async exec(text: string) {
          await client.query(text);
        },
        async query<R extends Row>(text: string, params?: unknown[]) {
          return (await client.query<R>(text, params)).rows;
        },
        async release() {
          client.release();
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
}

async function openPglite(dataDir: string | null): Promise<DatabaseHandle> {
  const releaseLock = dataDir ? acquireDirectoryLock(dataDir) : () => undefined;
  let client: PGlite;
  try {
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    client = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  } catch (err) {
    releaseLock();
    throw err;
  }

  const query = async <R extends Row>(text: string, params?: unknown[]) =>
    (await client.query<R>(text, params)).rows;

  return {
    kind: 'pglite',
    label: dataDir ? 'Lokale Entwicklungsdatenbank (PGlite)' : 'Testdatenbank im Arbeitsspeicher (PGlite)',
    db: drizzlePglite({ client, schema }),
    query,
    async connect() {
      // PGlite hat genau eine Verbindung; "release" gibt daher nichts frei.
      return {
        async exec(text: string) {
          await client.exec(text);
        },
        query,
        async release() {},
      };
    },
    async close() {
      try {
        await client.close();
      } finally {
        releaseLock();
      }
    },
  };
}

/**
 * Verhindert, dass zwei Prozesse dieselbe lokale PGlite-Datenbank öffnen – das könnte sie beschädigen.
 * Die Sperrdatei enthält die Prozessnummer; eine Sperre eines beendeten Prozesses wird übernommen.
 */
function acquireDirectoryLock(dataDir: string): () => void {
  const lockPath = `${path.resolve(dataDir)}.lock`;
  mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.off('exit', release);
        rmSync(lockPath, { force: true });
      };
      process.on('exit', release);
      return release;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const owner = Number(readFileSync(lockPath, 'utf8').trim());
      if (Number.isInteger(owner) && owner > 0 && (owner === process.pid || isProcessAlive(owner))) {
        throw new DatabaseLockedError(
          `Die lokale Entwicklungsdatenbank wird gerade von einem anderen Programm benutzt (Prozess ${owner}). ` +
            'Läuft "npm run dev:api" noch in einem anderen Terminal-Tab? Dort zuerst mit Control + C beenden.',
        );
      }
      rmSync(lockPath, { force: true });
    }
  }
  throw new DatabaseLockedError(
    'Die Sperrdatei der lokalen Entwicklungsdatenbank konnte nicht angelegt werden.',
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
