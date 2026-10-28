import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Alle Zeitpunkte werden als timestamptz gespeichert und in UTC verarbeitet. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const id = () => uuid('id').primaryKey().defaultRandom();
/** Roblox-User-IDs passen sicher in JS-Zahlen (< 2^53). */
export const robloxId = (name: string) => bigint(name, { mode: 'number' });
