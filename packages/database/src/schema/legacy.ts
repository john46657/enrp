import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_helpers';

/**
 * Brücke Dashboard → Altmodule des Bots (Bewerbungen, Level, Rollenpanel, Ticketpanel, /einstellungen).
 * Die Daten der Altmodule liegen beim Bot (data/db.json). Das Dashboard stellt eine Anfrage, der Bot holt sie
 * ab, führt sie mit den Altmodulen aus und meldet das Ergebnis zurück. Zeilen sind kurzlebig.
 */
export const legacyRequests = pgTable(
  'legacy_requests',
  {
    id: id(),
    /** live = Daten lesen, action = Aktion ausführen, settings = Einstellungen ändern, reset = zurücksetzen */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actorDiscordId: text('actor_discord_id'),
    /** pending → running → done | failed */
    status: text('status').notNull().default('pending'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
    claimedAt: ts('claimed_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('legacy_requests_status_idx').on(t.status, t.createdAt)],
);
