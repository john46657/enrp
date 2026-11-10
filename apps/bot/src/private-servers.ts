import { type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { type Logger } from '@enrp/config';
import { type ApiFactory, describeError } from './api';

interface BotLink {
  id: string;
  guildId: string;
  name: string;
  teamRoleId: string | null;
  rightRoles: Array<{ right: string; roleId: string }>;
}

const REFRESH_MS = 60_000;
const FULL_SYNC_MS = 15 * 60_000;
const MEMBER_DEBOUNCE_MS = 3_000;

/**
 * Privatserver-Discords im Bot:
 *  - registriert /ps nur in verknüpften Discords (und entfernt es, wenn die Verknüpfung endet),
 *  - gleicht die Spielrechte ab: vollständig beim Start, alle 15 Minuten und nach /ps spielrecht|abgleichen,
 *    einzeln bei Rollenänderungen und beim Verlassen des Discords.
 * Die Rechte selbst berechnet die API; der Bot meldet nur, wer welche der zugeordneten Rollen hat.
 */
export function createPrivateServerSync(options: {
  client: Client;
  apis: ApiFactory;
  logger: Logger;
  mainGuildId: string | undefined;
  commands: unknown[];
}) {
  const { client, apis, logger, mainGuildId } = options;
  let links = new Map<string, BotLink>(); // guildId → Verknüpfung
  const registered = new Set<string>();
  const lastFull = new Map<string, number>();
  const pending = new Map<string, NodeJS.Timeout>();
  let initialized = false;

  const mappedRoles = (link: BotLink) => new Set(link.rightRoles.map((r) => r.roleId));

  async function fullSync(link: BotLink) {
    const guild = client.guilds.cache.get(link.guildId);
    if (!guild) return;
    const roles = mappedRoles(link);
    const members = roles.size ? await guild.members.fetch() : new Map<string, GuildMember>();
    const payload = [...members.values()]
      .filter((m) => !m.user.bot && m.roles.cache.some((r) => roles.has(r.id)))
      .map((m) => ({ discordUserId: m.id, roleIds: [...m.roles.cache.keys()].filter((id) => roles.has(id)) }));
    const result = await apis.service.post<{ added: number; removed: number; missingAccount: string[] }>(
      `/api/v1/private-servers/${link.id}/sync`,
      { full: true, members: payload },
    );
    lastFull.set(link.guildId, Date.now());
    if (result.added || result.removed)
      logger.info(
        { guild: link.name, ...result, missingAccount: result.missingAccount.length },
        'Spielrechte abgeglichen',
      );
  }

  async function memberSync(guildId: string, member: { id: string; roleIds: string[] }) {
    const link = links.get(guildId);
    if (!link) return;
    const roles = mappedRoles(link);
    await apis.service.post(`/api/v1/private-servers/${link.id}/sync`, {
      full: false,
      members: [{ discordUserId: member.id, roleIds: member.roleIds.filter((id) => roles.has(id)) }],
    });
  }

  /** Rollenänderungen kurz sammeln (mehrere Rollen auf einmal = ein Abgleich). */
  function scheduleMember(guildId: string, memberId: string, roleIds: () => string[]) {
    const key = `${guildId}:${memberId}`;
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        memberSync(guildId, { id: memberId, roleIds: roleIds() }).catch((err) =>
          logger.warn({ err: describeError(err) }, 'Rechte-Abgleich (Mitglied) fehlgeschlagen'),
        );
      }, MEMBER_DEBOUNCE_MS).unref(),
    );
  }

  async function refresh() {
    if (!mainGuildId) return; // Ohne festen Haupt-Discord keine Privatserver-Discords (Befehle wären global).
    const res = await apis.service.get<{ items: BotLink[] }>('/api/v1/private-servers/bot/links');
    links = new Map(res.items.map((l) => [l.guildId, l]));
    for (const guild of client.guilds.cache.values()) {
      if (guild.id === mainGuildId) continue;
      const linked = links.has(guild.id);
      // Beim ersten Durchlauf alle Discords setzen (auch /ps aus früher verknüpften entfernen), danach nur Änderungen.
      if (linked && (!registered.has(guild.id) || !initialized)) {
        await guild.commands
          .set(options.commands as never)
          .catch((err) => logger.warn({ err, guild: guild.name }, '/ps nicht registriert'));
        registered.add(guild.id);
        logger.info({ guild: guild.name }, 'Privatserver-Discord: /ps registriert');
      } else if (!linked && (registered.has(guild.id) || !initialized)) {
        await guild.commands.set([]).catch(() => undefined);
        registered.delete(guild.id);
      }
    }
    initialized = true;
    for (const link of links.values()) {
      if (Date.now() - (lastFull.get(link.guildId) ?? 0) > FULL_SYNC_MS)
        await fullSync(link).catch((err) =>
          logger.warn({ err: describeError(err), guild: link.name }, 'Rechte-Abgleich fehlgeschlagen'),
        );
    }
  }

  return {
    refresh,
    async start() {
      if (!mainGuildId) {
        logger.warn('DISCORD_GUILD_ID fehlt – Privatserver-Discords (/ps) sind deaktiviert.');
        return;
      }
      await refresh().catch((err) =>
        logger.warn({ err: describeError(err) }, 'Privatserver-Verknüpfungen nicht abrufbar'),
      );
      setInterval(
        () => refresh().catch((err) => logger.warn({ err: describeError(err) }, 'Privatserver-Abgleich')),
        REFRESH_MS,
      ).unref();
    },
    /** Nach /ps spielrecht oder /ps abgleichen: Zuordnung neu laden und vollständig abgleichen. */
    async resync(guildId: string) {
      await refresh();
      const link = links.get(guildId);
      if (link) await fullSync(link);
    },
    onMemberUpdate(before: GuildMember | PartialGuildMember, after: GuildMember) {
      const link = links.get(after.guild.id);
      if (!link) return;
      const roles = mappedRoles(link);
      const had = before.partial
        ? null
        : [...before.roles.cache.keys()]
            .filter((id) => roles.has(id))
            .sort()
            .join();
      const has = [...after.roles.cache.keys()]
        .filter((id) => roles.has(id))
        .sort()
        .join();
      if (had === has) return;
      scheduleMember(after.guild.id, after.id, () => [...after.roles.cache.keys()]);
    },
    onMemberRemove(member: GuildMember | PartialGuildMember) {
      if (links.has(member.guild.id)) scheduleMember(member.guild.id, member.id, () => []);
    },
  };
}
