import {
  type DiscordEmbedInput,
  type DiscordGateway,
  type DiscordMemberInfo,
  type DiscordMessageInput,
} from '@enrp/core';

const API = 'https://discord.com/api/v10';

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly discordCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

const FRIENDLY: Record<number, string> = {
  10007: 'Mitglied ist nicht (mehr) auf dem Server.',
  10013: 'Unbekannter Discord-Nutzer.',
  10026: 'Kein Bann vorhanden.',
  50001: 'Dem Bot fehlt der Zugriff auf diesen Kanal.',
  50007: 'Der Nutzer akzeptiert keine Direktnachrichten.',
  50013: 'Dem Bot fehlen die nötigen Discord-Berechtigungen oder die Rolle steht über der Bot-Rolle.',
};

function toColor(hex?: string): number | undefined {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : undefined;
}

export function toDiscordEmbed(embed: DiscordEmbedInput) {
  return {
    title: embed.title?.slice(0, 256),
    description: embed.description?.slice(0, 4096),
    color: toColor(embed.color),
    url: embed.url,
    fields: embed.fields
      ?.slice(0, 25)
      .map((f) => ({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: f.inline })),
    footer: embed.footer ? { text: embed.footer.slice(0, 2048) } : undefined,
    timestamp: new Date().toISOString(),
  };
}

const BUTTON_STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 } as const;

function toMessageBody(payload: DiscordMessageInput) {
  const buttons = payload.buttons?.slice(0, 25) ?? [];
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({
      type: 1,
      components: buttons.slice(i, i + 5).map((b) => ({
        type: 2,
        style: BUTTON_STYLE[b.style ?? 'secondary'],
        label: b.label.slice(0, 80),
        custom_id: b.customId.slice(0, 100),
        emoji: b.emoji ? { name: b.emoji } : undefined,
        disabled: b.disabled ?? false,
      })),
    });
  }
  return {
    content: payload.content?.slice(0, 2000),
    embeds: payload.embed ? [toDiscordEmbed(payload.embed)] : [],
    components: rows,
    // Keine @everyone-/Rollen-Erwähnungen aus Inhalten zulassen.
    allowed_mentions: { parse: [] },
  };
}

/**
 * Minimaler Discord-REST-Client mit Bot-Token. Beachtet Rate-Limits (Retry-After, einmaliger Wiederholversuch)
 * und übersetzt bekannte Fehlercodes in verständliche Meldungen. Erwähnungen sind standardmäßig deaktiviert.
 */
export class DiscordRestGateway implements DiscordGateway {
  readonly configured = true;
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, reason?: string, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bot ${this.token}`,
      'user-agent': 'ENRP-Platform (https://github.com, 1.0)',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (reason) headers['x-audit-log-reason'] = encodeURIComponent(reason.slice(0, 400));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt === 0) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const waitMs = Math.min(Math.ceil((data.retry_after ?? 1) * 1000), 10_000);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(method, path, body, reason, 1);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const code = (data as { code?: number } | undefined)?.code;
      throw new DiscordApiError(res.status, code, FRIENDLY[code ?? -1] ?? `Discord-API-Fehler ${res.status}`);
    }
    return data as T;
  }

  async getMember(guildId: string, userId: string): Promise<DiscordMemberInfo | null> {
    try {
      const m = await this.request<{
        user: { id: string; username: string; global_name: string | null; avatar: string | null };
        roles: string[];
      }>('GET', `/guilds/${guildId}/members/${userId}`);
      return {
        id: m.user.id,
        username: m.user.username,
        globalName: m.user.global_name,
        avatarHash: m.user.avatar,
        roleIds: m.roles,
      };
    } catch (err) {
      if (
        err instanceof DiscordApiError &&
        (err.discordCode === 10007 || err.discordCode === 10013 || err.status === 404)
      )
        return null;
      throw err;
    }
  }

  addRole(guildId: string, userId: string, roleId: string, reason: string) {
    return this.request<void>('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, reason);
  }

  removeRole(guildId: string, userId: string, roleId: string, reason: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, undefined, reason);
  }

  async timeout(guildId: string, userId: string, until: Date | null, reason: string) {
    await this.request(
      'PATCH',
      `/guilds/${guildId}/members/${userId}`,
      { communication_disabled_until: until ? until.toISOString() : null },
      reason,
    );
  }

  kick(guildId: string, userId: string, reason: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/members/${userId}`, undefined, reason);
  }

  ban(guildId: string, userId: string, reason: string, deleteMessageSeconds = 0) {
    return this.request<void>(
      'PUT',
      `/guilds/${guildId}/bans/${userId}`,
      { delete_message_seconds: deleteMessageSeconds },
      reason,
    );
  }

  async unban(guildId: string, userId: string, reason: string) {
    try {
      await this.request<void>('DELETE', `/guilds/${guildId}/bans/${userId}`, undefined, reason);
    } catch (err) {
      if (err instanceof DiscordApiError && err.discordCode === 10026) return; // bereits entbannt
      throw err;
    }
  }

  async sendMessage(channelId: string, payload: DiscordMessageInput) {
    const msg = await this.request<{ id: string }>('POST', `/channels/${channelId}/messages`, toMessageBody(payload));
    return { id: msg.id };
  }

  async editMessage(channelId: string, messageId: string, payload: DiscordMessageInput) {
    await this.request('PATCH', `/channels/${channelId}/messages/${messageId}`, toMessageBody(payload));
  }

  async sendDirectMessage(userId: string, payload: DiscordMessageInput) {
    try {
      const channel = await this.request<{ id: string }>('POST', '/users/@me/channels', { recipient_id: userId });
      await this.sendMessage(channel.id, payload);
      return true;
    } catch (err) {
      if (err instanceof DiscordApiError && err.discordCode === 50007) return false;
      throw err;
    }
  }
}
