import { AsyncLocalStorage } from 'node:async_hooks';

/** Anfragebezogene Daten (z. B. Request-ID für Audit-Einträge), gesetzt von der API pro Anfrage. */
export const requestContext = new AsyncLocalStorage<{ requestId?: string }>();
