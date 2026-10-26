import { z } from 'zod';
import { ROLE_KEYS, snowflake, type RoleKey } from '@emden-network/shared';
import type { Queryable } from '@emden-network/database';

export interface GuildConfig {
  guildId: string;
  verifiedRoleId: string | null;
  unverifiedRoleId: string | null;
  roleMap: Partial<Record<RoleKey, string>>;
  auditChannelId: string | null;
}

const roleMapSchema = z.partialRecord(z.enum(ROLE_KEYS), snowflake);

export async function getGuildConfig(db: Queryable, guildId: string): Promise<GuildConfig> {
  const { rows } = await db.query<{ verified_role_id: string | null; unverified_role_id: string | null; role_map: unknown; audit_channel_id: string | null }>(
    'SELECT verified_role_id, unverified_role_id, role_map, audit_channel_id FROM guild_config WHERE guild_id = $1',
    [guildId],
  );
  const r = rows[0];
  const parsed = roleMapSchema.safeParse(r?.role_map ?? {});
  const roleMap = parsed.success ? parsed.data : {};
  return {
    guildId,
    verifiedRoleId: r?.verified_role_id ?? roleMap.verifiziert ?? null,
    unverifiedRoleId: r?.unverified_role_id ?? roleMap.unverified ?? null,
    roleMap,
    auditChannelId: r?.audit_channel_id ?? null,
  };
}

export async function setGuildRole(db: Queryable, guildId: string, key: RoleKey, roleId: string | null, actorDiscordId: string): Promise<void> {
  const patch = roleId ? { [key]: roleId } : {};
  await db.query(
    `INSERT INTO guild_config (guild_id, role_map, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (guild_id) DO UPDATE
       SET role_map = (guild_config.role_map - $4) || $2::jsonb, updated_at = now(), updated_by = $3`,
    [guildId, JSON.stringify(patch), actorDiscordId, key],
  );
  if (key === 'verifiziert' || key === 'unverified') {
    const col = key === 'verifiziert' ? 'verified_role_id' : 'unverified_role_id';
    await db.query(`UPDATE guild_config SET ${col} = $2 WHERE guild_id = $1`, [guildId, roleId]);
  }
}

export async function setAuditChannel(db: Queryable, guildId: string, channelId: string | null, actorDiscordId: string): Promise<void> {
  await db.query(
    `INSERT INTO guild_config (guild_id, audit_channel_id, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET audit_channel_id = $2, updated_at = now(), updated_by = $3`,
    [guildId, channelId, actorDiscordId],
  );
}
