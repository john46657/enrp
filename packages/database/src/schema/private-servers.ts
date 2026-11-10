import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, robloxId, ts, updatedAt } from './_helpers';

/**
 * Privatserver-Discords: Ein Discord-Server wird (nur vom Haupt-Discord bzw. Dashboard aus) mit dem Roblox-Besitzer
 * von Privatservern verknüpft. Sein Team darf dann ausschließlich die Privatserver dieses Besitzers steuern und dort
 * Spielrechte über eigene Discord-Rollen vergeben. Erkannt wird ein Privatserver über game.PrivateServerOwnerId.
 */
export const privateServerLinks = pgTable(
  'private_server_links',
  {
    id: id(),
    /** Discord-Server (Guild) des Privatserver-Teams. */
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    ownerRobloxId: robloxId('owner_roblox_id').notNull(),
    ownerName: text('owner_name'),
    /** Teamsperre: Nur Spieler mit Spielrecht dürfen in gesperrte Teams (Standard aus). */
    teamLock: boolean('team_lock').notNull().default(false),
    /** Rolle im Privatserver-Discord, die Aktionen ausführen darf (zusätzlich zu „Server verwalten“). */
    teamRoleId: text('team_role_id'),
    /** Log-Kanal im Privatserver-Discord. */
    logChannelId: text('log_channel_id'),
    active: boolean('active').notNull().default(true),
    linkedBy: text('linked_by').notNull(),
    removedAt: ts('removed_at'),
    removedBy: text('removed_by'),
    /** Zeitpunkt des letzten vollständigen Rollenabgleichs durch den Bot. */
    syncedAt: ts('synced_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('private_server_links_guild_uq')
      .on(t.guildId)
      .where(sql`${t.active}`),
    index('private_server_links_owner_idx').on(t.ownerRobloxId),
  ],
);

/** Welche Discord-Rolle im Privatserver-Discord welches Spielrecht gibt. */
export const privateServerRightRoles = pgTable(
  'private_server_right_roles',
  {
    linkId: uuid('link_id')
      .notNull()
      .references(() => privateServerLinks.id, { onDelete: 'cascade' }),
    right: text('right').notNull(),
    discordRoleId: text('discord_role_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.right] })],
);

/**
 * Aktuell vergebene Spielrechte (aus dem letzten Rollenabgleich). Nur Personen mit verifiziertem Roblox-Konto
 * bekommen Rechte; wer die Rolle verliert oder den Discord verlässt, verliert das Recht beim nächsten Abgleich.
 */
export const privateServerGrants = pgTable(
  'private_server_grants',
  {
    linkId: uuid('link_id')
      .notNull()
      .references(() => privateServerLinks.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    robloxUserId: robloxId('roblox_user_id').notNull(),
    right: text('right').notNull(),
    grantedAt: ts('granted_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.discordUserId, t.right] }),
    index('private_server_grants_roblox_idx').on(t.linkId, t.robloxUserId),
  ],
);
