import type { DiscordGateway } from '@emden-network/core';

export class FakeDiscord implements DiscordGateway {
  members = new Set<string>();
  roles = new Map<string, Set<string>>();
  dms: { userId: string; content: string }[] = [];
  failAddRole: Error | null = null;
  dmsDisabled = false;

  async memberExists(_guildId: string, userId: string) {
    return this.members.has(userId);
  }
  async addRole(_guildId: string, userId: string, roleId: string) {
    if (this.failAddRole) throw this.failAddRole;
    if (!this.roles.has(userId)) this.roles.set(userId, new Set());
    this.roles.get(userId)!.add(roleId);
  }
  async removeRole(_guildId: string, userId: string, roleId: string) {
    this.roles.get(userId)?.delete(roleId);
  }
  async sendDirectMessage(userId: string, content: string) {
    if (this.dmsDisabled) return false;
    this.dms.push({ userId, content });
    return true;
  }
  hasRole(userId: string, roleId: string) {
    return this.roles.get(userId)?.has(roleId) ?? false;
  }
}
