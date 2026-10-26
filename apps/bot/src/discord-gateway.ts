import { DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import { PermanentError, type DiscordGateway } from '@emden-network/core';

/** Fehler, die sich durch Wiederholen nicht beheben lassen (fehlende Rechte, Rolle gelöscht, ...). */
const PERMANENT_CODES = new Set<number>([
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownRole,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
]);

function classify(err: unknown): never {
  if (err instanceof DiscordAPIError && typeof err.code === 'number' && PERMANENT_CODES.has(err.code)) {
    throw new PermanentError(`Discord ${err.code}: ${err.message}`);
  }
  throw err;
}

export class DiscordJsGateway implements DiscordGateway {
  constructor(private readonly client: Client) {}

  async memberExists(guildId: string, userId: string): Promise<boolean> {
    const guild = await this.client.guilds.fetch(guildId).catch(classify);
    try {
      await guild.members.fetch({ user: userId, force: true });
      return true;
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) return false;
      throw err;
    }
  }

  async addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void> {
    const guild = await this.client.guilds.fetch(guildId).catch(classify);
    await guild.members.addRole({ user: userId, role: roleId, reason }).catch(classify);
  }

  async removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void> {
    const guild = await this.client.guilds.fetch(guildId).catch(classify);
    await guild.members.removeRole({ user: userId, role: roleId, reason }).catch(classify);
  }

  async sendDirectMessage(userId: string, content: string): Promise<boolean> {
    try {
      const user = await this.client.users.fetch(userId);
      await user.send({ content });
      return true;
    } catch {
      return false; // DMs deaktiviert – kein Fehler
    }
  }
}
