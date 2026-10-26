import type { Queryable } from '@emden-network/database';

export interface LinkedAccount {
  userId: string;
  discordId: string;
  robloxUserId: string;
  robloxUsername: string | null;
  robloxDisplayName: string | null;
  linkedAt: Date;
}

/** Legt den Nutzer an, falls nötig, und liefert die interne ID. */
export async function ensureUser(db: Queryable, discordId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (discord_id) VALUES ($1)
     ON CONFLICT (discord_id) DO UPDATE SET updated_at = users.updated_at
     RETURNING id`,
    [discordId],
  );
  return rows[0]!.id;
}

export async function findUserIdByDiscord(db: Queryable, discordId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE discord_id = $1', [discordId]);
  return rows[0]?.id ?? null;
}

const LINK_COLUMNS = `u.id AS "userId", u.discord_id AS "discordId", l.roblox_user_id AS "robloxUserId",
  l.roblox_username AS "robloxUsername", l.roblox_display_name AS "robloxDisplayName", l.linked_at AS "linkedAt"`;

export async function getActiveLinkByDiscord(db: Queryable, discordId: string): Promise<LinkedAccount | null> {
  const { rows } = await db.query<LinkedAccount>(
    `SELECT ${LINK_COLUMNS} FROM users u JOIN discord_links l ON l.user_id = u.id AND l.revoked_at IS NULL WHERE u.discord_id = $1`,
    [discordId],
  );
  return rows[0] ?? null;
}

export async function getActiveLinkByRoblox(db: Queryable, robloxUserId: string): Promise<LinkedAccount | null> {
  const { rows } = await db.query<LinkedAccount>(
    `SELECT ${LINK_COLUMNS} FROM discord_links l JOIN users u ON u.id = l.user_id WHERE l.roblox_user_id = $1 AND l.revoked_at IS NULL`,
    [robloxUserId],
  );
  return rows[0] ?? null;
}
