import type { ReadinessCheck } from '@emden/shared';
import type { DatabaseHandle } from './database.js';
import { MigrationError, getMigrationStatus } from './migrate.js';

const TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Bereitschaftsprüfung der Datenbank: erreichbar und Schema auf dem neuesten Stand?
 * Meldungen sind für den Systemstatus gedacht und enthalten nie Verbindungsdaten.
 */
export async function databaseReadiness(
  handle: DatabaseHandle,
  onError: (err: unknown) => void,
): Promise<ReadinessCheck> {
  try {
    await withTimeout(handle.query('SELECT 1'), TIMEOUT_MS);
  } catch (err) {
    onError(err);
    return { name: 'database', status: 'failed', message: `${handle.label} ist nicht erreichbar.` };
  }

  try {
    const status = await withTimeout(getMigrationStatus(handle), TIMEOUT_MS);
    if (status.pending.length > 0) {
      return {
        name: 'database',
        status: 'failed',
        message: `${status.pending.length} Migration(en) ausstehend. Ausführen mit: npm run db:migrate`,
      };
    }
    return { name: 'database', status: 'ok', message: `${handle.label}, Schema-Version ${status.latest}.` };
  } catch (err) {
    if (err instanceof MigrationError) {
      return { name: 'database', status: 'failed', message: err.message };
    }
    onError(err);
    return {
      name: 'database',
      status: 'failed',
      message: 'Der Migrationsstand konnte nicht geprüft werden.',
    };
  }
}
